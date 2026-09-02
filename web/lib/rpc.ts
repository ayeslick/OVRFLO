import { http, type Transport } from "viem";
import { defaultShouldThrow, failover, logsDivider } from "@morpho-org/viem-dlc/transports";

// KD18 runtime-dependency exception: @morpho-org/viem-dlc npm 0.0.16 wraps
// public-read RPC only. Release tag provenance is this commit. 7ea8e70 is later
// reviewed documentation context and is not package provenance. Wallet writes,
// historical HTTP, and TanStack Query stay outside this package.
export const VIEM_DLC_NPM_VERSION = "0.0.16" as const;
export const VIEM_DLC_RELEASE_COMMIT = "0df02a9a79bce8ed0a98974034d34cf5c8de7e11" as const;

export type RpcFailureKind =
  | "forbidden"
  | "rate_limited"
  | "quota_exhausted"
  | "revoked_credential"
  | "historical_capability"
  | "execution_reverted"
  | "unknown_block"
  | "transport_unavailable"
  | "unknown";

export type PublicReadProviderPolicy = {
  maxBlockRange: number;
  maxRequestsPerSecond: number;
  maxBurstRequests: number;
  maxConcurrentRequests: number;
};

// Same numeric policy for every URL. Isolation comes from one rateLimiter
// instance per URL, not from different numbers. Ticket 13 consumes
// maxBlockRange for bounded log-range reads.
export const publicReadProviderPolicy: PublicReadProviderPolicy = {
  maxBlockRange: 100_000,
  maxRequestsPerSecond: 10,
  maxBurstRequests: 5,
  maxConcurrentRequests: 5,
};

// Sieve ceiling is far above a Transfer / Deposited / Borrowed / Supplied log.
// A tight ceiling would drop a candidate identifier.
export const PUBLIC_READ_LOG_MAX_BYTES = 1_048_576;

type ErrorShape = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  cause?: unknown;
  details?: unknown;
  shortMessage?: unknown;
};

const publicReadPolicies = new WeakMap<Transport, PublicReadProviderPolicy>();

export function classifyRpcFailure(error: unknown): RpcFailureKind {
  if (typeof error === "string") return classifyRpcFailure({ message: error });
  const shapes = errorChain(error);
  const status = shapes
    .map((shape) => shape.status ?? shape.statusCode)
    .find((value): value is number => typeof value === "number");
  const code = shapes
    .map((shape) => shape.code)
    .find((value): value is number => typeof value === "number");
  const message = shapes
    .flatMap((shape) => [shape.message, shape.details, shape.shortMessage])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (status === 403 || /\b403\b|forbidden/.test(message)) return "forbidden";
  if (status === 429 || /\b429\b|rate.?limit/.test(message)) return "rate_limited";
  if (/quota|compute.?unit|capacity exhausted/.test(message)) return "quota_exhausted";
  if (/revoked|invalid api key|api key.*disabled|credential.*invalid/.test(message)) {
    return "revoked_credential";
  }
  if (
    /block range|response size|historical (?:logs?|range)|archive (?:data|node)|finalized.*unsupported/.test(
      message,
    )
  ) {
    return "historical_capability";
  }
  if (
    code === 3 ||
    /execution reverted|contractfunctionreverted|call reverted|revert reason/.test(message)
  ) {
    return "execution_reverted";
  }
  if (
    /unknown block|block not found|header not found|could not find block|unknown block hash|blockhash.*(not found|unknown)|not in the canonical chain|requirecanonical/.test(
      message,
    )
  ) {
    return "unknown_block";
  }
  if (
    /network|fetch failed|timeout|timed out|connection|socket|unavailable|gateway/.test(message)
  ) {
    return "transport_unavailable";
  }
  return "unknown";
}

function errorChain(error: unknown): ErrorShape[] {
  const found: ErrorShape[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const shape = current as ErrorShape;
    found.push(shape);
    current = shape.cause;
  }
  return found;
}

export function orderedPublicReadPolicy(policy: PublicReadProviderPolicy) {
  return [
    { maxBlockRange: policy.maxBlockRange },
    { maxRequestsPerSecond: policy.maxRequestsPerSecond },
    { maxBurstRequests: policy.maxBurstRequests },
    { maxConcurrentRequests: policy.maxConcurrentRequests },
  ] as const;
}

export function getPublicReadPolicy(transport: Transport): PublicReadProviderPolicy {
  const policy = publicReadPolicies.get(transport);
  if (!policy) {
    throw new Error("Transport has no public-read provider policy");
  }
  return policy;
}

function publicReadShouldThrow(error: unknown): boolean {
  const kind = classifyRpcFailure(error);
  return kind === "execution_reverted" || kind === "unknown_block" || defaultShouldThrow(error);
}

export function wrapPublicReadTransport(
  inner: Transport,
  policy: PublicReadProviderPolicy = publicReadProviderPolicy,
): Transport {
  const [range, sustained, burst, concurrency] = orderedPublicReadPolicy(policy);
  if (range.maxBlockRange < 1) {
    throw new Error("Public-read maxBlockRange must be at least 1");
  }
  const noRetryInner: Transport = (opts) => inner({ ...opts, retryCount: 0 });
  // logsDivider composes sieve, enricher, and rateLimiter. blockTimestamp stays
  // off on this shared wrap: portfolio enrichment is candidate merge, not headers.
  const wrapped = logsDivider(noRetryInner, [
    { maxBlockRange: range.maxBlockRange },
    { retryCount: 0, retryDelay: 0, blockTimestamp: false },
    { maxBytes: PUBLIC_READ_LOG_MAX_BYTES },
    {
      maxRequestsPerSecond: sustained.maxRequestsPerSecond,
      maxBurstRequests: burst.maxBurstRequests,
      maxConcurrentRequests: concurrency.maxConcurrentRequests,
    },
  ]);
  // viem-dlc types the transport value as unknown. wagmi's Transport requires Record.
  publicReadPolicies.set(wrapped as Transport, {
    maxBlockRange: range.maxBlockRange,
    maxRequestsPerSecond: sustained.maxRequestsPerSecond,
    maxBurstRequests: burst.maxBurstRequests,
    maxConcurrentRequests: concurrency.maxConcurrentRequests,
  });
  return wrapped as Transport;
}

export function createOrderedReadTransport<const T extends readonly Transport[]>(
  transports: T,
) {
  if (transports.length === 0) {
    throw new Error("At least one ordinary-read RPC transport is required");
  }
  return failover(
    transports.map((transport) => wrapPublicReadTransport(transport)),
    { shouldThrow: publicReadShouldThrow },
  ) as Transport;
}

export function createHistoricalTransport(url: string) {
  // One synchronization owns exactly one HTTP transport. It may retry the same
  // transport, but it never inherits the ordinary-read fallback set.
  return http(url);
}
