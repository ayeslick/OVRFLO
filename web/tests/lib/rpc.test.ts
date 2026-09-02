import { describe, expect, it, vi } from "vitest";
import { custom } from "viem";
import {
  classifyRpcFailure,
  createHistoricalTransport,
  createOrderedReadTransport,
  getPublicReadPolicy,
  orderedPublicReadPolicy,
  publicReadProviderPolicy,
  wrapPublicReadTransport,
  VIEM_DLC_NPM_VERSION,
  VIEM_DLC_RELEASE_COMMIT,
} from "@/lib/rpc";

describe("RPC failure classification", () => {
  it.each([
    [{ status: 403 }, "forbidden"],
    [{ status: 429 }, "rate_limited"],
    [new Error("monthly compute-unit quota exhausted"), "quota_exhausted"],
    [new Error("API key revoked"), "revoked_credential"],
    [new Error("block range is too wide for this provider"), "historical_capability"],
    [new Error("unknown block"), "unknown_block"],
    ["unknown block", "unknown_block"],
    [new Error("header not found"), "unknown_block"],
  ] as const)("classifies %j as %s", (error, expected) => {
    expect(classifyRpcFailure(error)).toBe(expected);
  });

  it("classifies an execution revert separately from transport availability", () => {
    expect(classifyRpcFailure(Object.assign(new Error("execution reverted"), { code: 3 }))).toBe(
      "execution_reverted",
    );
  });
});

describe("ordered transports", () => {
  it("dispatches public reads through viem-dlc failover", () => {
    const transport = createOrderedReadTransport([
      custom({ request: async () => "0x1" }),
    ])({ chain: undefined });
    expect(transport.config.type).toBe("viem-dlc-failover");
  });

  it("uses the secondary ordinary-read transport after a primary transport failure", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const secondary = vi.fn().mockResolvedValue("0x1");
    const transport = createOrderedReadTransport([
      custom({ request: primary }),
      custom({ request: secondary }),
    ])({ chain: undefined });

    await expect(transport.request({ method: "eth_chainId" })).resolves.toBe("0x1");
    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).toHaveBeenCalledOnce();
  });

  it("does not replay an execution revert on an ordinary-read fallback", async () => {
    const revert = Object.assign(new Error("execution reverted"), { code: 3 });
    const primary = vi.fn().mockRejectedValue(revert);
    const secondary = vi.fn().mockResolvedValue("0x1");
    const transport = createOrderedReadTransport([
      custom({ request: primary }),
      custom({ request: secondary }),
    ])({ chain: undefined });

    await expect(transport.request({ method: "eth_call", params: [] })).rejects.toThrow(/execution reverted/i);
    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).not.toHaveBeenCalled();
  });

  it("does not fail over on an unknown-block pin miss", async () => {
    const missing = Object.assign(new Error("unknown block"), { code: -32000 });
    const primary = vi.fn().mockRejectedValue(missing);
    const secondary = vi.fn().mockResolvedValue("0x1");
    const transport = createOrderedReadTransport([
      custom({ request: primary }),
      custom({ request: secondary }),
    ])({ chain: undefined });

    await expect(transport.request({ method: "eth_call", params: [] })).rejects.toThrow(/unknown block/i);
    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).not.toHaveBeenCalled();
  });

  it("creates one historical transport without a fallback set", () => {
    const transport = createHistoricalTransport("https://history.example.com")({ chain: undefined });
    expect(transport.config.type).toBe("http");
    expect("transports" in (transport.value ?? {})).toBe(false);
  });
});

describe("per-URL public-read policy", () => {
  const tightPolicy = {
    maxBlockRange: 10_000,
    maxRequestsPerSecond: 10,
    maxBurstRequests: 1,
    maxConcurrentRequests: 1,
  } as const;

  it("applies the four policy values in order", () => {
    expect(Object.keys(publicReadProviderPolicy)).toEqual([
      "maxBlockRange",
      "maxRequestsPerSecond",
      "maxBurstRequests",
      "maxConcurrentRequests",
    ]);
    expect(orderedPublicReadPolicy(publicReadProviderPolicy)).toEqual([
      { maxBlockRange: publicReadProviderPolicy.maxBlockRange },
      { maxRequestsPerSecond: publicReadProviderPolicy.maxRequestsPerSecond },
      { maxBurstRequests: publicReadProviderPolicy.maxBurstRequests },
      { maxConcurrentRequests: publicReadProviderPolicy.maxConcurrentRequests },
    ]);
  });

  it("binds the same ordered policy to each URL without sharing the limiter", () => {
    const primary = wrapPublicReadTransport(custom({ request: async () => "0xa" }));
    const secondary = wrapPublicReadTransport(custom({ request: async () => "0xb" }));
    expect(getPublicReadPolicy(primary)).toEqual(publicReadProviderPolicy);
    expect(getPublicReadPolicy(secondary)).toEqual(publicReadProviderPolicy);
    expect(getPublicReadPolicy(primary)).not.toBe(getPublicReadPolicy(secondary));
  });

  it("keeps one URL's in-flight request from consuming another URL's concurrency budget", async () => {
    let releasePrimary: ((value: string) => void) | undefined;
    const primaryHang = new Promise<string>((resolve) => {
      releasePrimary = resolve;
    });
    const primary = vi.fn(() => primaryHang);
    const secondary = vi.fn().mockResolvedValue("0xb");
    const primaryTransport = wrapPublicReadTransport(custom({ request: primary }), tightPolicy)({
      chain: undefined,
    });
    const secondaryTransport = wrapPublicReadTransport(custom({ request: secondary }), tightPolicy)({
      chain: undefined,
    });

    const primaryPending = primaryTransport.request({ method: "eth_chainId" });
    await expect(secondaryTransport.request({ method: "eth_chainId" })).resolves.toBe("0xb");
    expect(secondary).toHaveBeenCalledOnce();
    releasePrimary!("0xa");
    await expect(primaryPending).resolves.toBe("0xa");
  });

  it("queues a second request on the same URL when that URL's concurrency budget is full", async () => {
    let releaseFirst: ((value: string) => void) | undefined;
    const firstHang = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });
    const inner = vi.fn();
    inner.mockImplementationOnce(() => firstHang);
    inner.mockResolvedValueOnce("0x2");
    const transport = wrapPublicReadTransport(custom({ request: inner }), tightPolicy)({
      chain: undefined,
    });

    const first = transport.request({ method: "eth_chainId" });
    const second = transport.request({ method: "eth_blockNumber" });
    await Promise.resolve();
    expect(inner).toHaveBeenCalledOnce();
    releaseFirst!("0x1");
    await expect(first).resolves.toBe("0x1");
    await expect(second).resolves.toBe("0x2");
    expect(inner).toHaveBeenCalledTimes(2);
  });
});

describe("viem-dlc pin", () => {
  it("records npm 0.0.16 provenance and not the later docs commit", () => {
    expect(VIEM_DLC_NPM_VERSION).toBe("0.0.16");
    expect(VIEM_DLC_RELEASE_COMMIT).toBe("0df02a9a79bce8ed0a98974034d34cf5c8de7e11");
    expect(VIEM_DLC_RELEASE_COMMIT.startsWith("7ea8e70")).toBe(false);
  });
});

describe("bounded log reads", () => {
  it("divides an oversized eth_getLogs range on the public-read wrap", async () => {
    const ranges: Array<{ fromBlock: string; toBlock: string }> = [];
    const inner = vi.fn(async (req: { method: string; params?: unknown[] }) => {
      if (req.method === "eth_blockNumber") return "0x7530";
      if (req.method === "eth_getLogs") {
        const filter = req.params?.[0] as { fromBlock: string; toBlock: string };
        ranges.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
        return [];
      }
      return "0x1";
    });
    const transport = wrapPublicReadTransport(custom({ request: inner }), {
      maxBlockRange: 10_000,
      maxRequestsPerSecond: 100,
      maxBurstRequests: 20,
      maxConcurrentRequests: 20,
    })({ chain: undefined });

    await transport.request({
      method: "eth_getLogs",
      params: [{ fromBlock: "0x0", toBlock: "0x7530" }],
    });

    expect(ranges.length).toBeGreaterThan(1);
    for (const range of ranges) {
      const from = BigInt(range.fromBlock);
      const to = BigInt(range.toBlock);
      expect(to - from + 1n).toBeLessThanOrEqual(10_000n);
    }
  });

  it("fails over a mid-range provider error until the next URL completes the logs", async () => {
    let primaryLogs = 0;
    const primary = vi.fn(async (req: { method: string }) => {
      if (req.method === "eth_blockNumber") return "0x30d40";
      if (req.method === "eth_getLogs") {
        primaryLogs += 1;
        if (primaryLogs > 1) throw new Error("network unavailable");
        return [];
      }
      throw new Error("network unavailable");
    });
    const secondary = vi.fn(async (req: { method: string }) => {
      if (req.method === "eth_blockNumber") return "0x30d40";
      if (req.method === "eth_getLogs") return [];
      return "0x1";
    });
    const transport = createOrderedReadTransport([
      custom({ request: primary }),
      custom({ request: secondary }),
    ])({ chain: undefined });

    await expect(
      transport.request({
        method: "eth_getLogs",
        params: [{ fromBlock: "0x0", toBlock: "0x30d40" }],
      }),
    ).resolves.toEqual([]);
    expect(secondary).toHaveBeenCalled();
  });
});
