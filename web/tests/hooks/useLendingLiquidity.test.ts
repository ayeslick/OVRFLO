import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { loadingOutcome, readyOutcome, unavailableOutcome, readFailure } from "@/lib/read-outcome";

const LENDING = "0x00000000000000000000000000000000000000a1" as Address;
const MARKET = "0x00000000000000000000000000000000000000b2" as Address;
const LENDER = "0x00000000000000000000000000000000000000c3" as Address;
const state = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/hooks/useLendingProjection", () => ({
  useMarketLiquidityProjection: () => state.current,
}));

describe("useLendingLiquidity — U9 projection adapter", () => {
  beforeEach(() => {
    state.current = {
      outcome: loadingOutcome(),
      isLoading: true,
      error: null,
    };
  });

  it("returns every projected row beyond the retired 500-id cap", () => {
    const positions = Array.from({ length: 650 }, (_, index) => ({
      id: BigInt(index + 1),
      lender: LENDER,
      market: MARKET,
      aprBps: 1_000,
      availableLiquidity: 1n,
    }));
    state.current = {
      outcome: readyOutcome({
        positions,
        aggregateDepth: 650n,
        aggregateByApr: new Map([[1_000, 650n]]),
        projection: {},
        ledger: {},
      }),
      isLoading: false,
      error: null,
    };

    const { result } = renderHook(() => useLendingLiquidity(LENDING, MARKET));
    expect(result.current.liquidity).toHaveLength(650);
    expect(result.current.liquidity[0].id).toBe(650n);
  });

  it("preserves loading explicitly", () => {
    const { result } = renderHook(() => useLendingLiquidity(LENDING, MARKET));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.liquidity).toEqual([]);
  });

  it("preserves unavailable rather than treating it as empty-ready", () => {
    const error = new Error("projection unavailable");
    state.current = {
      outcome: unavailableOutcome([readFailure("projection", "transport", error)]),
      isLoading: false,
      error,
    };
    const { result } = renderHook(() => useLendingLiquidity(LENDING, MARKET));
    expect(result.current.error).toBe(error);
    expect(result.current.outcome.status).toBe("unavailable");
  });
});
