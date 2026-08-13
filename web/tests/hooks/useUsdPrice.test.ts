import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUsdPrice } from "@/hooks/useUsdPrice";

const success = (result: unknown) => ({ status: "success" as const, result });

let mockReturn: { data?: unknown[]; isLoading: boolean; error: unknown };

vi.mock("wagmi", () => ({
  useReadContracts: () => mockReturn,
  useBlock: () => ({ data: { timestamp: 1_700_000_000n } }),
}));

vi.mock("@/hooks/useClock", () => ({
  useClock: () => ({ localNow: 1_700_000_000n, skew: 0n, adjustedNow: 1_700_000_000n }),
}));

describe("useUsdPrice", () => {
  it("classifies a valid feed product as available", () => {
    mockReturn = {
      data: [
        success([1n, 3_000_000_000n, 1_700_000_000n, 1_700_000_000n, 1n]),
        success(10n ** 18n),
      ],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useUsdPrice());
    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") throw new Error("expected ready");
    expect(result.current.data.status).toBe("available");
  });

  it("classifies a failed feed as unavailable, never a zero price", () => {
    mockReturn = { data: undefined, isLoading: false, error: new Error("rpc") };
    const { result } = renderHook(() => useUsdPrice());
    expect(result.current.status).toBe("unavailable");
    expect(result.current.data).toBeUndefined();
  });
});
