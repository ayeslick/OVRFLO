import { describe, expect, it, vi } from "vitest";
import type { Address, Hex, Log, PublicClient } from "viem";
import {
  captureHeadSnapshot,
  createViemDiscoveryClient,
  evaluateRpcLedger,
  scanLogs,
  type DiscoveryClient,
  type HeadSnapshot,
} from "@/lib/discovery/log-scanner";

const ADDRESS = "0x00000000000000000000000000000000000000aa" as Address;
const TOPIC = hash(0x11);

function hash(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function log(blockNumber: bigint, transactionIndex: number, logIndex: number, data = "0x01" as Hex): Log {
  return {
    address: ADDRESS,
    blockNumber,
    blockHash: hash(Number(blockNumber)),
    transactionHash: hash(10_000 + Number(blockNumber) * 10 + transactionIndex),
    transactionIndex,
    logIndex,
    topics: [TOPIC],
    data,
    removed: false,
  } as Log;
}

const snapshot: HeadSnapshot = {
  finalized: { number: 2n, hash: hash(2) },
  latest: { number: 6n, hash: hash(6) },
};

function client(overrides: Partial<DiscoveryClient> = {}): DiscoveryClient {
  return {
    getBlock: vi.fn(async ({ blockTag, blockNumber }) => {
      const number = blockNumber ?? (blockTag === "finalized" ? snapshot.finalized.number : snapshot.latest.number);
      return { number, hash: hash(Number(number)), timestamp: number * 12n };
    }),
    getLogs: vi.fn(async ({ fromBlock, toBlock }) => [log(fromBlock, 0, 0), log(toBlock, 0, 0)]),
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    address: ADDRESS,
    topics: [TOPIC] as const,
    fromBlock: 1n,
    snapshot,
    rangeSize: 2n,
    decode: (entry: Log) => entry.data,
    sleep: vi.fn(async () => undefined),
    now: (() => {
      let time = 0;
      return () => ++time;
    })(),
    ...overrides,
  };
}

describe("captureHeadSnapshot", () => {
  it("captures exact numeric finalized/latest heads and hashes once", async () => {
    const rpc = client();
    await expect(captureHeadSnapshot(rpc)).resolves.toEqual(snapshot);
    expect(rpc.getBlock).toHaveBeenCalledTimes(2);
  });
});

describe("createViemDiscoveryClient", () => {
  it("uses standard eth_getLogs with exact address/topic and numeric range filters", async () => {
    const request = vi.fn(async () => [
      {
        address: ADDRESS,
        blockHash: hash(4),
        blockNumber: "0x4",
        data: "0x",
        logIndex: "0x0",
        removed: false,
        topics: [TOPIC],
        transactionHash: hash(44),
        transactionIndex: "0x1",
      },
    ]);
    const viem = {
      request,
      getBlock: vi.fn(async () => ({ number: 4n, hash: hash(4), timestamp: 48n })),
    } as unknown as PublicClient;
    const adapter = createViemDiscoveryClient(viem);

    const logs = await adapter.getLogs({
      address: ADDRESS,
      topics: [TOPIC],
      fromBlock: 3n,
      toBlock: 4n,
    });
    expect(request).toHaveBeenCalledWith({
      method: "eth_getLogs",
      params: [{ address: ADDRESS, topics: [TOPIC], fromBlock: "0x3", toBlock: "0x4" }],
    });
    expect(logs[0]).toMatchObject({ blockNumber: 4n, transactionIndex: 1, logIndex: 0 });
  });

  it("aborts promptly while publicClient.request remains unresolved", async () => {
    const controller = new AbortController();
    let requestStarted!: () => void;
    let rejectRequest!: (error: Error) => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const request = vi.fn(() => {
      requestStarted();
      return new Promise<never>((_resolve, reject) => {
        rejectRequest = reject;
      });
    });
    const viem = {
      request,
      getBlock: vi.fn(),
    } as unknown as PublicClient;
    const adapter = createViemDiscoveryClient(viem);

    const pendingLogs = adapter.getLogs({
      address: ADDRESS,
      topics: [TOPIC],
      fromBlock: 3n,
      toBlock: 4n,
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(pendingLogs).rejects.toMatchObject({ name: "AbortError" });

    rejectRequest(new Error("late provider failure"));
    await Promise.resolve();
  });
});

describe("scanLogs", () => {
  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid runtime concurrency %s before starting workers",
    async (concurrency) => {
      const rpc = client();
      const result = await scanLogs(rpc, options({ concurrency }));

      expect(result.status).toBe("failed");
      if (result.status === "failed") expect(result.failure.kind).toBe("invalid-scope");
      expect(rpc.getLogs).not.toHaveBeenCalled();
    },
  );

  it("retries 429 and capacity errors on the same range without bisecting", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    let attempts = 0;
    const rpc = client({
      getLogs: vi.fn(async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 5 });
        if (attempts === 2) throw Object.assign(new Error("provider capacity"), { status: 503 });
        return [log(fromBlock, 0, 0)];
      }),
    });

    const result = await scanLogs(rpc, options({ fromBlock: 1n, rangeSize: 10n }));
    expect(result.status).toBe("complete");
    expect(ranges).toEqual([
      [1n, 6n],
      [1n, 6n],
      [1n, 6n],
    ]);
    expect(result.ledger.attempts.map((attempt) => attempt.outcome)).toEqual([
      "rate-limited",
      "capacity",
      "success",
    ]);
  });

  it("bisects only explicit range-size failures", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    const rpc = client({
      getLogs: vi.fn(async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        if (toBlock - fromBlock >= 2n) throw Object.assign(new Error("query returned more than 10000 results"), { code: -32005 });
        return [log(fromBlock, 0, 0)];
      }),
    });

    const result = await scanLogs(rpc, options({ fromBlock: 1n, rangeSize: 10n }));
    expect(result.status).toBe("complete");
    expect(ranges[0]).toEqual([1n, 6n]);
    expect(ranges).toContainEqual([1n, 3n]);
    expect(ranges).toContainEqual([4n, 6n]);
    expect(result.ledger.attempts.filter((attempt) => attempt.outcome === "range-too-large")).toHaveLength(3);
  });

  it("retries timeouts boundedly before bisection", async () => {
    const calls = new Map<string, number>();
    const rpc = client({
      getLogs: vi.fn(async ({ fromBlock, toBlock }) => {
        const key = `${fromBlock}-${toBlock}`;
        const count = (calls.get(key) ?? 0) + 1;
        calls.set(key, count);
        if (toBlock > fromBlock && count <= 2) throw new Error("request timed out");
        return [log(fromBlock, 0, 0)];
      }),
    });

    const result = await scanLogs(rpc, options({ fromBlock: 1n, rangeSize: 10n, maxTimeoutRetries: 1 }));
    expect(result.status).toBe("complete");
    expect(calls.get("1-6")).toBe(2);
    expect([...calls.keys()]).toContain("1-3");
  });

  it("fails decode errors without retry or split amplification", async () => {
    const rpc = client({ getLogs: vi.fn(async () => [log(1n, 0, 0, "0xdead" as Hex)]) });
    const result = await scanLogs(
      rpc,
      options({
        rangeSize: 10n,
        decode: () => {
          throw new Error("strict decode failed");
        },
      }),
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.kind).toBe("decode");
    expect(rpc.getLogs).toHaveBeenCalledTimes(1);
  });

  it("orders out-of-order ranges canonically and deduplicates overlap replay", async () => {
    const duplicate = log(2n, 1, 4);
    const rpc = client({
      getLogs: vi.fn(async ({ fromBlock }) => {
        if (fromBlock === 1n) {
          await Promise.resolve();
          return [duplicate, log(1n, 2, 1), duplicate];
        }
        if (fromBlock === 3n) return [log(4n, 0, 2)];
        return [log(6n, 1, 0), log(5n, 3, 0)];
      }),
    });

    const result = await scanLogs(rpc, options());
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.logs.map((entry) => [entry.blockNumber, entry.transactionIndex, entry.logIndex])).toEqual([
      [1n, 2, 1],
      [2n, 1, 4],
      [4n, 0, 2],
      [5n, 3, 0],
      [6n, 1, 0],
    ]);
  });

  it("rejects malformed or filter-mismatched logs with identity metadata", async () => {
    const malformed = { ...log(1n, 0, 0), blockHash: null } as unknown as Log;
    const rpc = client({ getLogs: vi.fn(async () => [malformed]) });
    const result = await scanLogs(rpc, options({ rangeSize: 10n }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.kind).toBe("invalid-log");
  });

  it.each([
    {
      label: "wrong address",
      returnedLog: {
        ...log(1n, 0, 0),
        address: "0x00000000000000000000000000000000000000bb" as Address,
      } as Log,
    },
    {
      label: "wrong topic",
      returnedLog: { ...log(1n, 0, 0), topics: [hash(0x22)] } as Log,
    },
  ])("rejects a valid mined log with $label", async ({ returnedLog }) => {
    const rpc = client({ getLogs: vi.fn(async () => [returnedLog]) });
    const result = await scanLogs(rpc, options({ rangeSize: 10n }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.kind).toBe("invalid-log");
  });

  it("verifies a retained checkpoint before requesting logs and drops it on mismatch", async () => {
    const previousCheckpoint = { number: 0n, hash: hash(0) };
    const rpc = client({
      getBlock: vi.fn(async ({ blockNumber }) => ({
        number: blockNumber ?? 0n,
        hash: hash(999),
      })),
    });
    const result = await scanLogs(rpc, options({ previousCheckpoint }));

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.failure.kind).toBe("reorg");
    expect(result.retainedCheckpoint).toBeUndefined();
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("fails closed and redacts checkpoint verification transport errors", async () => {
    const previousCheckpoint = { number: 0n, hash: hash(0) };
    const rpc = client({
      getBlock: vi.fn(async () => {
        throw new Error('Authorization: Bearer checkpoint-secret at https://rpc.example/key');
      }),
    });
    const result = await scanLogs(rpc, options({ previousCheckpoint }));

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.failure.kind).toBe("transport");
    expect(result.failure.message).not.toContain("checkpoint-secret");
    expect(result.failure.message).not.toContain("rpc.example");
    expect(result.retainedCheckpoint).toBeUndefined();
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("does not advance the prior checkpoint when a middle range fails", async () => {
    const previousCheckpoint = { number: 0n, hash: hash(0) };
    const rpc = client({
      getLogs: vi.fn(async ({ fromBlock }) => {
        if (fromBlock === 3n) throw new Error("upstream disconnected");
        return [log(fromBlock, 0, 0)];
      }),
    });
    const result = await scanLogs(rpc, options({ previousCheckpoint, maxCapacityRetries: 0 }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.retainedCheckpoint).toEqual(previousCheckpoint);
      expect(result.completeThrough).toBeUndefined();
    }
  });

  it("rejects anchors beyond the captured latest block without making log requests", async () => {
    const rpc = client();
    const result = await scanLogs(rpc, options({ fromBlock: 7n }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.kind).toBe("invalid-scope");
    expect(rpc.getLogs).not.toHaveBeenCalled();
  });

  it("redacts provider URLs and credentials from surfaced transport failures", async () => {
    const rpc = client({
      getLogs: vi.fn(async () => {
        throw new Error(
          'request to https://rpc.example/v2/secret failed Authorization: Bearer first-secret authorization=Bearer second-secret {"Authorization":"Bearer third-secret"} token=other-secret',
        );
      }),
    });
    const result = await scanLogs(rpc, options({ rangeSize: 10n }));

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.failure.message).toContain("[redacted-url]");
    expect(result.failure.message).not.toContain("rpc.example");
    expect(result.failure.message).not.toContain("first-secret");
    expect(result.failure.message).not.toContain("second-secret");
    expect(result.failure.message).not.toContain("third-secret");
    expect(result.failure.message).not.toContain("other-secret");
  });

  it("re-reads both boundary hashes and discards a multi-range attempt on mismatch", async () => {
    const rpc = client({
      getBlock: vi.fn(async ({ blockTag, blockNumber }) => {
        const number = blockNumber ?? (blockTag === "finalized" ? 2n : 6n);
        return {
          number,
          hash: blockNumber === 2n ? hash(999) : hash(Number(number)),
          timestamp: number * 12n,
        };
      }),
    });

    const result = await scanLogs(rpc, options({ previousCheckpoint: { number: 0n, hash: hash(0) } }));
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failure.kind).toBe("reorg");
      expect(result.completeThrough).toBeUndefined();
    }
  });

  it("re-reads captured boundaries after timeout bisection and discards changed hashes", async () => {
    let latestReads = 0;
    const rpc = client({
      getBlock: vi.fn(async ({ blockNumber }) => {
        const number = blockNumber ?? 0n;
        if (number === snapshot.latest.number) latestReads += 1;
        return {
          number,
          hash:
            number === snapshot.latest.number && latestReads > 0
              ? hash(999)
              : hash(Number(number)),
        };
      }),
      getLogs: vi.fn(async ({ fromBlock, toBlock }) => {
        if (fromBlock === 1n && toBlock === 6n) throw new Error("request timed out");
        return [log(fromBlock, 0, 0)];
      }),
    });

    const result = await scanLogs(
      rpc,
      options({ fromBlock: 1n, rangeSize: 10n, maxTimeoutRetries: 0 }),
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.kind).toBe("reorg");
    expect(latestReads).toBe(1);
  });

  it("cancels cleanly without reporting completeness", async () => {
    const controller = new AbortController();
    const rpc = client({
      getLogs: vi.fn(async () => {
        controller.abort();
        return [log(1n, 0, 0)];
      }),
    });
    const result = await scanLogs(rpc, options({ signal: controller.signal }));

    expect(result.status).toBe("cancelled");
    expect(result.completeThrough).toBeUndefined();
  });

  it("returns cancellation promptly while an RPC request remains unresolved", async () => {
    const controller = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const rpc = client({
      getLogs: vi.fn(() => {
        requestStarted();
        return new Promise<Log[]>(() => undefined);
      }),
    });

    const pendingResult = scanLogs(
      rpc,
      options({ signal: controller.signal, concurrency: 1, rangeSize: 10n }),
    );
    await started;
    controller.abort();
    const result = await pendingResult;

    expect(result.status).toBe("cancelled");
    expect(result.ledger.attempts).toHaveLength(1);
    expect(result.ledger.attempts[0]?.outcome).toBe("cancelled");
  });

  it("returns cancellation promptly while retry backoff remains unresolved", async () => {
    const controller = new AbortController();
    let delayStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      delayStarted = resolve;
    });
    const rpc = client({
      getLogs: vi.fn(async () => {
        throw Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 5_000 });
      }),
    });

    const pendingResult = scanLogs(
      rpc,
      options({
        signal: controller.signal,
        concurrency: 1,
        rangeSize: 10n,
        sleep: () => {
          delayStarted();
          return new Promise<void>(() => undefined);
        },
      }),
    );
    await started;
    controller.abort();
    const result = await pendingResult;

    expect(result.status).toBe("cancelled");
    expect(result.ledger.attempts).toHaveLength(1);
    expect(result.ledger.attempts[0]?.outcome).toBe("cancelled");
  });

  it("includes deduplication and decode reduction in the final wall-clock ledger", async () => {
    let clock = 0;
    const rpc = client({
      getLogs: vi.fn(async () => {
        clock += 5;
        return [log(1n, 0, 0)];
      }),
    });
    const result = await scanLogs(
      rpc,
      options({
        concurrency: 1,
        rangeSize: 10n,
        now: () => clock,
        decode: (entry: Log) => {
          clock += 7;
          return entry.data;
        },
      }),
    );

    expect(result.status).toBe("complete");
    expect(result.ledger.attempts[0]?.durationMs).toBe(5);
    expect(result.ledger.reducerDurationMs).toBe(7);
    expect(result.ledger.durationMs).toBe(12);
  });

  it("records every physical attempt, bytes, duration, and provider-cost estimate", async () => {
    const result = await scanLogs(
      client(),
      options({
        estimateProviderCost: ({
          requestBytes,
          responseBytes,
        }: {
          requestBytes: number;
          responseBytes: number;
        }) => requestBytes + responseBytes,
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.ledger.attempts).toHaveLength(3);
    expect(result.ledger.requestBytes).toBeGreaterThan(0);
    expect(result.ledger.responseBytes).toBeGreaterThan(0);
    expect(result.ledger.reducerDurationMs).toBeGreaterThan(0);
    expect(result.ledger.durationMs).toBeGreaterThan(0);
    expect(result.ledger.providerCostEstimate).toBe(
      result.ledger.requestBytes + result.ledger.responseBytes,
    );
    expect(
      evaluateRpcLedger(result.ledger, {
        maxAttempts: 3,
        maxRequestBytes: result.ledger.requestBytes,
        maxResponseBytes: result.ledger.responseBytes,
        maxDurationMs: result.ledger.durationMs,
      }),
    ).toEqual({ status: "within-budget", exceeded: [] });
    expect(
      evaluateRpcLedger(result.ledger, {
        maxAttempts: 2,
        maxRequestBytes: result.ledger.requestBytes,
        maxResponseBytes: result.ledger.responseBytes,
        maxDurationMs: result.ledger.durationMs,
      }),
    ).toEqual({ status: "over-budget", exceeded: ["maxAttempts"] });
  });
});
