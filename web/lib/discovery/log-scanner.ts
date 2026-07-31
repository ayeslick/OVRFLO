import {
  hexToBigInt,
  hexToNumber,
  numberToHex,
  type Address,
  type Hex,
  type Log,
  type LogTopic,
  type PublicClient,
  type RpcLog,
} from "viem";
import type {
  BlockIdentity,
  HeadSnapshot,
  RpcAttempt,
  RpcAttemptOutcome,
  RpcLedger,
  ValidatedLog,
} from "./types";

export type { BlockIdentity, HeadSnapshot, RpcLedger, ValidatedLog } from "./types";

type BlockResult = {
  number: bigint | null;
  hash: Hex | null;
  timestamp?: bigint;
};

export type DiscoveryClient = {
  getBlock(args: { blockTag?: "finalized" | "latest"; blockNumber?: bigint }): Promise<BlockResult>;
  getLogs(args: {
    address: Address | readonly Address[];
    topics: readonly (Hex | readonly Hex[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
    signal?: AbortSignal;
  }): Promise<Log[]>;
};

export function createViemDiscoveryClient(publicClient: PublicClient): DiscoveryClient {
  return {
    getBlock: async ({ blockTag, blockNumber }) => {
      const block = await publicClient.getBlock(blockNumber === undefined ? { blockTag } : { blockNumber });
      return { number: block.number, hash: block.hash, timestamp: block.timestamp };
    },
    getLogs: async ({ address, topics, fromBlock, toBlock, signal }) => {
      if (signal?.aborted) throw new DOMException("Discovery cancelled", "AbortError");
      const rpcAddress: Address | Address[] = typeof address === "string" ? address : [...address];
      const rpcTopics: LogTopic[] = topics.map((topic) => (Array.isArray(topic) ? [...topic] : topic));
      const rpcLogs = (await awaitAbortable(
        publicClient.request({
          method: "eth_getLogs",
          params: [
            {
              address: rpcAddress,
              topics: rpcTopics,
              fromBlock: numberToHex(fromBlock),
              toBlock: numberToHex(toBlock),
            },
          ],
        }),
        signal,
      )) as RpcLog[];
      if (signal?.aborted) throw new DOMException("Discovery cancelled", "AbortError");
      return rpcLogs.map(formatRpcLog);
    },
  };
}

type ScanFailureKind = "transport" | "decode" | "invalid-log" | "invalid-scope" | "reorg";

export type ScanFailure = {
  kind: ScanFailureKind;
  message: string;
  fromBlock?: bigint;
  toBlock?: bigint;
};

type CompleteResult<T> = {
  status: "complete";
  logs: Array<ValidatedLog & { decoded: T }>;
  snapshot: HeadSnapshot;
  completeThrough: BlockIdentity;
  retainedCheckpoint?: BlockIdentity;
  ledger: RpcLedger;
};

type FailedResult = {
  status: "failed";
  failure: ScanFailure;
  snapshot: HeadSnapshot;
  completeThrough?: undefined;
  retainedCheckpoint?: BlockIdentity;
  ledger: RpcLedger;
};

type CancelledResult = {
  status: "cancelled";
  snapshot: HeadSnapshot;
  completeThrough?: undefined;
  retainedCheckpoint?: BlockIdentity;
  ledger: RpcLedger;
};

export type ScanResult<T> = CompleteResult<T> | FailedResult | CancelledResult;

export type ScanLogsOptions<T> = {
  address: Address | readonly Address[];
  topics: readonly (Hex | readonly Hex[] | null)[];
  fromBlock: bigint;
  snapshot?: HeadSnapshot;
  rangeSize: bigint;
  decode(log: ValidatedLog): T;
  previousCheckpoint?: BlockIdentity;
  signal?: AbortSignal;
  concurrency?: number;
  maxCapacityRetries?: number;
  maxTimeoutRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  estimateProviderCost?: (bytes: { requestBytes: number; responseBytes: number }) => number;
};

export type RpcLedgerBudget = {
  maxAttempts: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxDurationMs: number;
};

export function evaluateRpcLedger(ledger: RpcLedger, budget: RpcLedgerBudget) {
  const exceeded: Array<keyof RpcLedgerBudget> = [];
  if (ledger.attempts.length > budget.maxAttempts) exceeded.push("maxAttempts");
  if (ledger.requestBytes > budget.maxRequestBytes) exceeded.push("maxRequestBytes");
  if (ledger.responseBytes > budget.maxResponseBytes) exceeded.push("maxResponseBytes");
  if (ledger.durationMs > budget.maxDurationMs) exceeded.push("maxDurationMs");
  return exceeded.length === 0
    ? { status: "within-budget" as const, exceeded }
    : { status: "over-budget" as const, exceeded };
}

type RangeTask = {
  fromBlock: bigint;
  toBlock: bigint;
  capacityRetries: number;
  timeoutRetries: number;
};

type NormalizedLogFilter = {
  addresses: Set<string>;
  topics: Array<Set<string> | null>;
};

type ClassifiedError = {
  outcome: Exclude<RpcAttemptOutcome, "success" | "cancelled">;
  retryAfterMs?: number;
};

export async function captureHeadSnapshot(client: DiscoveryClient): Promise<HeadSnapshot> {
  const [finalized, latest] = await Promise.all([
    client.getBlock({ blockTag: "finalized" }),
    client.getBlock({ blockTag: "latest" }),
  ]);
  return {
    finalized: requireBlockIdentity(finalized, "finalized"),
    latest: requireBlockIdentity(latest, "latest"),
  };
}

export async function verifyCheckpoint(client: DiscoveryClient, checkpoint: BlockIdentity): Promise<boolean> {
  const block = await client.getBlock({ blockNumber: checkpoint.number });
  return block.hash?.toLowerCase() === checkpoint.hash.toLowerCase();
}

export async function scanLogs<T>(
  client: DiscoveryClient,
  options: ScanLogsOptions<T>,
): Promise<ScanResult<T>> {
  const now = options.now ?? performance.now.bind(performance);
  const synchronizationStartedAt = now();
  const snapshot = options.snapshot ?? (await captureHeadSnapshot(client));
  const attempts: RpcAttempt[] = [];
  const validatedLogs: ValidatedLog[] = [];
  let reducerDurationMs = 0;
  const currentLedger = () =>
    summarizeLedger(
      attempts,
      Math.max(0, now() - synchronizationStartedAt),
      reducerDurationMs,
    );
  const sleep = options.sleep ?? defaultSleep;
  const estimateProviderCost = options.estimateProviderCost ?? (() => 1);
  const maxCapacityRetries = options.maxCapacityRetries ?? 3;
  const maxTimeoutRetries = options.maxTimeoutRetries ?? 2;
  const requestedConcurrency = options.concurrency ?? 2;
  const targetBlock = snapshot.latest.number;
  if (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency <= 0) {
    return {
      status: "failed",
      failure: {
        kind: "invalid-scope",
        message: "Discovery concurrency must be a positive safe integer",
      },
      snapshot,
      ledger: currentLedger(),
    };
  }
  const concurrency = Math.min(requestedConcurrency, 2);
  if (options.fromBlock > targetBlock) {
    return {
      status: "failed",
      failure: { kind: "invalid-scope", message: "Discovery anchor is after the captured latest block" },
      snapshot,
      ledger: currentLedger(),
    };
  }
  if (options.rangeSize <= 0n) throw new Error("rangeSize must be positive");
  let retainedCheckpoint: BlockIdentity | undefined;
  if (options.previousCheckpoint) {
    if (options.signal?.aborted) {
      return { status: "cancelled", snapshot, ledger: currentLedger() };
    }
    try {
      const checkpointBlock = await awaitAbortable(
        client.getBlock({ blockNumber: options.previousCheckpoint.number }),
        options.signal,
      );
      if (checkpointBlock.hash?.toLowerCase() !== options.previousCheckpoint.hash.toLowerCase()) {
        return {
          status: "failed",
          failure: {
            kind: "reorg",
            message: "Stored discovery checkpoint hash no longer matches the provider",
          },
          snapshot,
          ledger: currentLedger(),
        };
      }
      retainedCheckpoint = options.previousCheckpoint;
    } catch (error) {
      if (isCancellation(error, options.signal)) {
        return { status: "cancelled", snapshot, ledger: currentLedger() };
      }
      return {
        status: "failed",
        failure: { kind: "transport", message: redactSensitiveText(errorMessage(error)) },
        snapshot,
        ledger: currentLedger(),
      };
    }
  }
  const pendingRanges: RangeTask[] = [];
  const normalizedFilter = normalizeLogFilter(options.address, options.topics);
  let nextRangeStart = options.fromBlock;
  let failure: ScanFailure | undefined;
  let cancelled = options.signal?.aborted ?? false;
  let attemptNumber = 0;
  let didBisect = false;
  const attemptedRanges = new Set<string>();

  const nextTask = (): RangeTask | undefined => {
    const pending = pendingRanges.shift();
    if (pending) return pending;
    if (nextRangeStart > targetBlock) return undefined;
    const fromBlock = nextRangeStart;
    const proposedEnd = fromBlock + options.rangeSize - 1n;
    const toBlock = proposedEnd < targetBlock ? proposedEnd : targetBlock;
    nextRangeStart = toBlock + 1n;
    return { fromBlock, toBlock, capacityRetries: 0, timeoutRetries: 0 };
  };

  const worker = async () => {
    while (!failure && !cancelled) {
      const task = nextTask();
      if (!task) return;
      if (options.signal?.aborted) {
        cancelled = true;
        return;
      }

      const requestBytes = byteLength({
        address: options.address,
        topics: options.topics,
        fromBlock: task.fromBlock,
        toBlock: task.toBlock,
      });
      const startedAt = now();
      let responseBytes = 0;
      let outcome: RpcAttemptOutcome = "success";
      let logs: Log[] | undefined;
      let caught: unknown;

      try {
        attemptedRanges.add(`${task.fromBlock}:${task.toBlock}`);
        logs = await awaitAbortable(
          client.getLogs({
            address: options.address,
            topics: options.topics,
            fromBlock: task.fromBlock,
            toBlock: task.toBlock,
            signal: options.signal,
          }),
          options.signal,
        );
        responseBytes = byteLength(logs);
      } catch (error) {
        caught = error;
        if (isCancellation(error, options.signal)) {
          outcome = "cancelled";
          cancelled = true;
        } else {
          const classified = classifyScanError(error);
          outcome = classified.outcome;
          if (outcome === "rate-limited" || outcome === "capacity") {
            if (task.capacityRetries < maxCapacityRetries) {
              try {
                await awaitAbortable(sleep(classified.retryAfterMs ?? 0), options.signal);
                pendingRanges.unshift({ ...task, capacityRetries: task.capacityRetries + 1 });
              } catch (delayError) {
                if (isCancellation(delayError, options.signal)) {
                  outcome = "cancelled";
                  cancelled = true;
                } else {
                  failure = rangeFailure(delayError, task);
                }
              }
            } else {
              failure = rangeFailure(error, task);
            }
          } else if (outcome === "timeout") {
            if (task.timeoutRetries < maxTimeoutRetries) {
              pendingRanges.unshift({ ...task, timeoutRetries: task.timeoutRetries + 1 });
            } else if (task.fromBlock < task.toBlock) {
              didBisect = true;
              pendingRanges.unshift(...bisect(task));
            } else {
              failure = rangeFailure(error, task);
            }
          } else if (outcome === "range-too-large") {
            if (task.fromBlock < task.toBlock) {
              didBisect = true;
              pendingRanges.unshift(...bisect(task));
            } else {
              failure = rangeFailure(error, task);
            }
          } else {
            failure = rangeFailure(error, task);
          }
        }
      }

      const durationMs = Math.max(0, now() - startedAt);
      const providerCostEstimate = estimateProviderCost({ requestBytes, responseBytes });
      attempts.push({
        attempt: ++attemptNumber,
        fromBlock: task.fromBlock,
        toBlock: task.toBlock,
        outcome,
        requestBytes,
        responseBytes,
        durationMs,
        providerCostEstimate,
      });

      if (options.signal?.aborted) {
        cancelled = true;
        return;
      }
      if (!caught && logs) {
        try {
          for (const log of logs) validatedLogs.push(validateLog(log, task, normalizedFilter));
        } catch (error) {
          failure = { kind: "invalid-log", message: redactSensitiveText(errorMessage(error)) };
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (cancelled) {
    return { status: "cancelled", snapshot, retainedCheckpoint, ledger: currentLedger() };
  }
  if (failure) {
    return { status: "failed", failure, snapshot, retainedCheckpoint, ledger: currentLedger() };
  }

  let unique: ValidatedLog[];
  const deduplicationStartedAt = now();
  try {
    unique = deduplicateLogs(validatedLogs);
  } catch (error) {
    reducerDurationMs += Math.max(0, now() - deduplicationStartedAt);
    return {
      status: "failed",
      failure: { kind: "invalid-log", message: redactSensitiveText(errorMessage(error)) },
      snapshot,
      retainedCheckpoint,
      ledger: currentLedger(),
    };
  }
  reducerDurationMs += Math.max(0, now() - deduplicationStartedAt);

  if (attemptedRanges.size > 1 || didBisect) {
    let finalizedBoundary: BlockResult;
    let latestBoundary: BlockResult;
    try {
      [finalizedBoundary, latestBoundary] = await Promise.all([
        client.getBlock({ blockNumber: snapshot.finalized.number }),
        client.getBlock({ blockNumber: snapshot.latest.number }),
      ]);
    } catch (error) {
      return {
        status: "failed",
        failure: { kind: "transport", message: redactSensitiveText(errorMessage(error)) },
        snapshot,
        retainedCheckpoint,
        ledger: currentLedger(),
      };
    }
    if (
      finalizedBoundary.hash?.toLowerCase() !== snapshot.finalized.hash.toLowerCase() ||
      latestBoundary.hash?.toLowerCase() !== snapshot.latest.hash.toLowerCase()
    ) {
      return {
        status: "failed",
        failure: { kind: "reorg", message: "Discovery boundary hash changed during synchronization" },
        snapshot,
        retainedCheckpoint,
        ledger: currentLedger(),
      };
    }
  }

  const decoded: Array<ValidatedLog & { decoded: T }> = [];
  const decodingStartedAt = now();
  try {
    for (const log of unique) decoded.push({ ...log, decoded: options.decode(log) });
  } catch (error) {
    reducerDurationMs += Math.max(0, now() - decodingStartedAt);
    return {
      status: "failed",
      failure: { kind: "decode", message: redactSensitiveText(errorMessage(error)) },
      snapshot,
      retainedCheckpoint,
      ledger: currentLedger(),
    };
  }
  reducerDurationMs += Math.max(0, now() - decodingStartedAt);

  return {
    status: "complete",
    logs: decoded,
    snapshot,
    completeThrough: snapshot.latest,
    retainedCheckpoint,
    ledger: currentLedger(),
  };
}

export function classifyScanError(error: unknown): ClassifiedError {
  const candidate = error as { status?: number; code?: number; retryAfterMs?: number; message?: string };
  const message = errorMessage(error).toLowerCase();
  if (candidate.status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return { outcome: "rate-limited", retryAfterMs: candidate.retryAfterMs };
  }
  if (
    candidate.code === -32005 ||
    candidate.status === 413 ||
    message.includes("response size") ||
    message.includes("range too") ||
    /more than .*(results|logs)/.test(message) ||
    message.includes("block range")
  ) {
    return { outcome: "range-too-large" };
  }
  if (message.includes("timeout") || message.includes("timed out") || candidate.status === 408) {
    return { outcome: "timeout" };
  }
  if (
    candidate.status === 502 ||
    candidate.status === 503 ||
    candidate.status === 504 ||
    message.includes("capacity") ||
    message.includes("quota")
  ) {
    return { outcome: "capacity", retryAfterMs: candidate.retryAfterMs };
  }
  return { outcome: "transport-error" };
}

function validateLog(log: Log, range: RangeTask, filter: NormalizedLogFilter): ValidatedLog {
  if (
    log.blockNumber === null ||
    log.blockHash === null ||
    log.transactionHash === null ||
    log.transactionIndex === null ||
    log.logIndex === null
  ) {
    throw new Error("Log is missing mined identity fields");
  }
  if (
    !/^0x[0-9a-f]{64}$/i.test(log.blockHash) ||
    !/^0x[0-9a-f]{64}$/i.test(log.transactionHash) ||
    !Number.isSafeInteger(log.transactionIndex) ||
    log.transactionIndex < 0 ||
    !Number.isSafeInteger(log.logIndex) ||
    log.logIndex < 0 ||
    log.removed
  ) {
    throw new Error("Log has invalid mined identity fields");
  }
  if (log.blockNumber < range.fromBlock || log.blockNumber > range.toBlock) {
    throw new Error("Log block is outside the requested range");
  }
  if (!filter.addresses.has(log.address.toLowerCase())) throw new Error("Log address does not match the scope");
  for (let index = 0; index < filter.topics.length; index += 1) {
    const expected = filter.topics[index];
    if (expected === null) continue;
    const actual = log.topics[index]?.toLowerCase();
    if (!actual || !expected.has(actual)) throw new Error(`Log topic ${index} does not match the scope`);
  }
  if (log.topics.some((topic) => !/^0x[0-9a-f]{64}$/i.test(topic))) throw new Error("Log topic is malformed");
  return log as ValidatedLog;
}

function normalizeLogFilter(
  address: Address | readonly Address[],
  topics: readonly (Hex | readonly Hex[] | null)[],
): NormalizedLogFilter {
  const addresses = new Set((Array.isArray(address) ? address : [address]).map((entry) => entry.toLowerCase()));
  return {
    addresses,
    topics: topics.map((topic) =>
      topic === null
        ? null
        : new Set((Array.isArray(topic) ? topic : [topic]).map((entry) => entry.toLowerCase())),
    ),
  };
}

function deduplicateLogs(logs: ValidatedLog[]): ValidatedLog[] {
  const byIdentity = new Map<string, ValidatedLog>();
  for (const log of logs) {
    const identity = `${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    const existing = byIdentity.get(identity);
    if (existing && serialize(existing) !== serialize(log)) {
      throw new Error("Conflicting duplicate log identity");
    }
    byIdentity.set(identity, log);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      compareBigint(left.blockNumber, right.blockNumber) ||
      left.transactionIndex - right.transactionIndex ||
      left.logIndex - right.logIndex,
  );
}

function bisect(task: RangeTask): RangeTask[] {
  const midpoint = task.fromBlock + (task.toBlock - task.fromBlock) / 2n;
  return [
    { fromBlock: task.fromBlock, toBlock: midpoint, capacityRetries: 0, timeoutRetries: 0 },
    { fromBlock: midpoint + 1n, toBlock: task.toBlock, capacityRetries: 0, timeoutRetries: 0 },
  ];
}

function requireBlockIdentity(block: BlockResult, label: string): BlockIdentity {
  if (block.number === null || block.hash === null) throw new Error(`${label} block is missing identity`);
  return { number: block.number, hash: block.hash };
}

function summarizeLedger(
  attempts: RpcAttempt[],
  durationMs: number,
  reducerDurationMs: number,
): RpcLedger {
  const totals = attempts.reduce<
    Omit<RpcLedger, "attempts" | "durationMs" | "reducerDurationMs">
  >(
    (ledger, attempt) => ({
      requestBytes: ledger.requestBytes + attempt.requestBytes,
      responseBytes: ledger.responseBytes + attempt.responseBytes,
      providerCostEstimate: ledger.providerCostEstimate + attempt.providerCostEstimate,
    }),
    { requestBytes: 0, responseBytes: 0, providerCostEstimate: 0 },
  );
  return { attempts, ...totals, reducerDurationMs, durationMs };
}

function rangeFailure(error: unknown, task: RangeTask): ScanFailure {
  return {
    kind: "transport",
    message: redactSensitiveText(errorMessage(error)),
    fromBlock: task.fromBlock,
    toBlock: task.toBlock,
  };
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(serialize(value)).length;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactSensitiveText(message: string): string {
  return message
    .replace(/\bhttps?:\/\/[^\s)"']+/gi, "[redacted-url]")
    .replace(/\b(wss?):\/\/[^\s)"']+/gi, "[redacted-url]")
    .replace(
      /(["']?(?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)(?:bearer[\s-]+)?[^"'\s,;}]+/gi,
      "$1[redacted]",
    )
    .replace(/\bbearer(?:\s+|=)[^"'\s,;}]+/gi, "Bearer [redacted]");
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function awaitAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    void operation.catch(() => undefined);
    throw abortError();
  }

  let abortListener: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(abortError());
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function abortError(): DOMException {
  return new DOMException("Discovery cancelled", "AbortError");
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

function formatRpcLog(log: RpcLog): Log {
  return {
    address: log.address,
    blockHash: log.blockHash,
    blockNumber: log.blockNumber === null ? null : hexToBigInt(log.blockNumber),
    data: log.data,
    logIndex: log.logIndex === null ? null : hexToNumber(log.logIndex),
    removed: log.removed ?? false,
    topics: log.topics,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex === null ? null : hexToNumber(log.transactionIndex),
  };
}
