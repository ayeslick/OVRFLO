import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useLending } from "@/hooks/useLending";

const LENDING = "0x0000000000000000000000000000000000000005" as Address;
const success = (result: unknown) => ({ status: "success" as const, result });
const failure = (error: unknown) => ({ status: "failure" as const, error });

let mockReturn: { data?: unknown[]; isLoading: boolean; error: unknown };

vi.mock("wagmi", () => ({
  useReadContracts: () => mockReturn,
}));

describe("useLending", () => {
  it("unpacks the 6 params in declared order on success", () => {
    mockReturn = {
      data: [success(1000), success(1200), success(40), success(3n), success(7n), success(2n)],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.params).toEqual({
      aprMinBps: 1000,
      aprMaxBps: 1200,
      feeBps: 40,
      nextLiquidityId: 3n,
      nextLoanId: 7n,
      nextSaleListingId: 2n,
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("falls back to zero/one defaults for a not-yet-loaded read", () => {
    mockReturn = { data: undefined, isLoading: true, error: null };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.params).toEqual({
      aprMinBps: 0,
      aprMaxBps: 0,
      feeBps: 0,
      nextLiquidityId: 1n,
      nextLoanId: 1n,
      nextSaleListingId: 1n,
    });
    expect(result.current.isLoading).toBe(true);
  });

  it("falls back per-field when only some reads fail", () => {
    mockReturn = {
      data: [success(1000), failure(new Error("rpc")), success(40), success(3n), success(7n), success(2n)],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.params.aprMinBps).toBe(1000);
    expect(result.current.params.aprMaxBps).toBe(0); // failed read defaults, doesn't poison siblings
    expect(result.current.params.feeBps).toBe(40);
  });

  it("propagates the read error", () => {
    const error = new Error("network down");
    mockReturn = { data: undefined, isLoading: false, error };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.error).toBe(error);
  });

  it("still returns safe defaults for a null/undefined lending address", () => {
    mockReturn = { data: undefined, isLoading: false, error: null };
    const { result } = renderHook(() => useLending(null));
    expect(result.current.params.nextLiquidityId).toBe(1n);
  });
});
