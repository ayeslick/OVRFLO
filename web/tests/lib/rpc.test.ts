import { describe, expect, it, vi } from "vitest";
import { custom } from "viem";
import {
  classifyRpcFailure,
  createHistoricalTransport,
  createOrderedReadTransport,
} from "@/lib/rpc";

describe("RPC failure classification", () => {
  it.each([
    [{ status: 403 }, "forbidden"],
    [{ status: 429 }, "rate_limited"],
    [new Error("monthly compute-unit quota exhausted"), "quota_exhausted"],
    [new Error("API key revoked"), "revoked_credential"],
    [new Error("block range is too wide for this provider"), "historical_capability"],
    [new Error("unknown block"), "unknown_block"],
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
