import {
  fallback,
  http,
  shouldThrow,
  type Transport,
} from "viem";

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

type ErrorShape = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  cause?: unknown;
  details?: unknown;
  shortMessage?: unknown;
};

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

export function createOrderedReadTransport<const T extends readonly Transport[]>(
  transports: T,
) {
  if (transports.length === 0) {
    throw new Error("At least one ordinary-read RPC transport is required");
  }
  return fallback(transports, {
    rank: false,
    retryCount: 0,
    shouldThrow(error) {
      return classifyRpcFailure(error) === "execution_reverted" ||
        classifyRpcFailure(error) === "unknown_block" ||
        shouldThrow(error);
    },
  });
}

export function createHistoricalTransport(url: string) {
  // One synchronization owns exactly one HTTP transport. It may retry the same
  // transport, but it never inherits the ordinary-read fallback set.
  return http(url);
}
