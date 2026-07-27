import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import { ZERO_ADDRESS } from "@/lib/config";

const LENDING = "0x0000000000000000000000000000000000000005" as Address;
const LENDER = "0x0000000000000000000000000000000000000a11" as Address;
const MARKET = "0x0000000000000000000000000000000000000333" as Address;

let lendingState: { params: { nextLiquidityId: bigint }; isLoading: boolean; error: unknown };
let readsReturn: { data?: unknown[]; isLoading: boolean; error: unknown };

vi.mock("@/hooks/useLending", () => ({
  useLending: () => lendingState,
}));

vi.mock("wagmi", () => ({
  useReadContracts: () => readsReturn,
}));

const success = (result: unknown) => ({ status: "success" as const, result });
const failure = { status: "failure" as const, error: new Error("rpc") };

describe("useLendingLiquidity", () => {
  it("derives positions from successful reads, sorted descending by id", () => {
    lendingState = { params: { nextLiquidityId: 3n }, isLoading: false, error: null };
    readsReturn = {
      data: [success([LENDER, MARKET, 1000, 50n]), success([LENDER, MARKET, 1100, 80n])],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLendingLiquidity(LENDING));
    expect(result.current.liquidity.map((p) => p.id)).toEqual([2n, 1n]);
    expect(result.current.liquidity[0]).toMatchObject({ aprBps: 1100, availableLiquidity: 80n });
  });

  it("drops zero-address (never-written) liquidity slots", () => {
    lendingState = { params: { nextLiquidityId: 3n }, isLoading: false, error: null };
    readsReturn = {
      data: [success([ZERO_ADDRESS, MARKET, 1000, 50n]), success([LENDER, MARKET, 1100, 80n])],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLendingLiquidity(LENDING));
    expect(result.current.liquidity).toHaveLength(1);
    expect(result.current.liquidity[0].id).toBe(2n);
  });

  it("drops individually failed reads without dropping the whole list", () => {
    lendingState = { params: { nextLiquidityId: 3n }, isLoading: false, error: null };
    readsReturn = { data: [failure, success([LENDER, MARKET, 1100, 80n])], isLoading: false, error: null };
    const { result } = renderHook(() => useLendingLiquidity(LENDING));
    expect(result.current.liquidity).toHaveLength(1);
    expect(result.current.liquidity[0].id).toBe(2n);
  });

  it("reports tooLarge once nextLiquidityId exceeds the enumeration cap", () => {
    lendingState = { params: { nextLiquidityId: MAX_ENUMERATION_IDS + 2n }, isLoading: false, error: null };
    readsReturn = { data: [], isLoading: false, error: null };
    const { result } = renderHook(() => useLendingLiquidity(LENDING));
    expect(result.current.tooLarge).toBe(true);
  });

  it("does not report tooLarge exactly at the cap boundary", () => {
    lendingState = { params: { nextLiquidityId: MAX_ENUMERATION_IDS + 1n }, isLoading: false, error: null };
    readsReturn = { data: [], isLoading: false, error: null };
    const { result } = renderHook(() => useLendingLiquidity(LENDING));
    expect(result.current.tooLarge).toBe(false);
  });

  it("propagates loading and error from either the lending params read or the position reads", () => {
    lendingState = { params: { nextLiquidityId: 1n }, isLoading: true, error: null };
    readsReturn = { data: undefined, isLoading: false, error: null };
    const loadingResult = renderHook(() => useLendingLiquidity(LENDING)).result;
    expect(loadingResult.current.isLoading).toBe(true);

    const readError = new Error("read failed");
    lendingState = { params: { nextLiquidityId: 1n }, isLoading: false, error: null };
    readsReturn = { data: undefined, isLoading: false, error: readError };
    const errorResult = renderHook(() => useLendingLiquidity(LENDING)).result;
    expect(errorResult.current.error).toBe(readError);
  });
});
