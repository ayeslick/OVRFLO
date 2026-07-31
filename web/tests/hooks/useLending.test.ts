import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useLending } from "@/hooks/useLending";

const LENDING = "0x0000000000000000000000000000000000000005" as Address;
const success = (result: unknown) => ({ status: "success" as const, result });
const failure = (error: unknown) => ({ status: "failure" as const, error });

let mockReturn: { data?: unknown[]; isLoading: boolean; error: unknown };
const readContractsConfig = vi.fn();

vi.mock("wagmi", () => ({
  useReadContracts: (config: unknown) => {
    readContractsConfig(config);
    return mockReturn;
  },
}));

describe("useLending", () => {
  it("unpacks the 7 params in declared order on success", () => {
    mockReturn = {
      data: [success(1000), success(1200), success(40), success(3n), success(7n), success(2n), success(128n)],
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
      maxRouteIds: 128,
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    // Pins the positional unpack to the actual requested order — the values
    // above are deliberately distinct-and-non-sequential (1000, 1200, 40, 3,
    // 7, 2) so a swap between any two positions would be caught even though
    // the assertion above already would; this makes the "declared order"
    // claim in the test name an assertion on the request, not just the result.
    expect(readContractsConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contracts: [
          expect.objectContaining({ functionName: "aprMinBps" }),
          expect.objectContaining({ functionName: "aprMaxBps" }),
          expect.objectContaining({ functionName: "feeBps" }),
          expect.objectContaining({ functionName: "nextLiquidityId" }),
          expect.objectContaining({ functionName: "nextLoanId" }),
          expect.objectContaining({ functionName: "nextSaleListingId" }),
          expect.objectContaining({ functionName: "MAX_ROUTE_IDS" }),
        ],
      }),
    );
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
      maxRouteIds: 0,
    });
    expect(result.current.isLoading).toBe(true);
  });

  it("fails closed when any required parameter read fails", () => {
    mockReturn = {
      data: [success(1000), failure(new Error("rpc")), success(40), success(3n), success(7n), success(2n), success(128n)],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.params.aprMinBps).toBe(1000);
    expect(result.current.params.aprMaxBps).toBe(0);
    expect(result.current.params.feeBps).toBe(40);
    expect(result.current.error).toEqual(
      new Error("Required lending parameters are incomplete"),
    );
  });

  it("propagates the read error", () => {
    const error = new Error("network down");
    mockReturn = { data: undefined, isLoading: false, error };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.error).toBe(error);
  });

  it("still returns safe defaults for a null/undefined lending address, with the read disabled", () => {
    mockReturn = { data: undefined, isLoading: false, error: null };
    const { result } = renderHook(() => useLending(null));
    expect(result.current.params.nextLiquidityId).toBe(1n);

    // The defaults above hold regardless of `enabled` (mockReturn.data is
    // undefined either way) — this asserts the hook actually gates the read
    // on a valid address rather than issuing an unconditioned request.
    expect(readContractsConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ contracts: [], query: { enabled: false } }),
    );
  });
});
