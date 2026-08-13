import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { useLending } from "@/hooks/useLending";

const LENDING = "0x0000000000000000000000000000000000000005" as Address;
const success = (result: unknown) => ({ status: "success" as const, result });
const failure = (error: unknown) => ({ status: "failure" as const, error });

let mockReturn: { data?: unknown[]; isLoading: boolean; error: unknown; isSuccess?: boolean };
const readContractsConfig = vi.fn();

vi.mock("wagmi", () => ({
  useReadContracts: (config: unknown) => {
    readContractsConfig(config);
    return mockReturn;
  },
}));

describe("useLending", () => {
  it("returns a ready config from a complete batch", () => {
    mockReturn = {
      data: [success(10n ** 12n), success(10n ** 15n), success(10n ** 6n), success(40), success(1000), success(1200)],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.outcome.status).toBe("ready");
    if (result.current.outcome.status !== "ready") throw new Error("expected ready");
    expect(result.current.outcome.data).toEqual({
      unit: 10n ** 12n,
      minLiquidityAmount: 10n ** 15n,
      minStreamAmount: 10n ** 6n,
      feeBps: 40,
      aprMinBps: 1000,
      aprMaxBps: 1200,
    });
    expect(result.current.error).toBeNull();
  });

  it("classifies a missing read as unavailable, never zero (AE1)", () => {
    mockReturn = { data: undefined, isLoading: true, error: null };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.outcome.status).toBe("loading");
    expect(result.current.outcome.data).toBeUndefined();
  });

  it("fails closed when any required parameter read fails", () => {
    mockReturn = {
      data: [success(10n ** 12n), failure(new Error("rpc")), success(10n ** 6n), success(40), success(1000), success(1200)],
      isLoading: false,
      error: null,
    };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.outcome.status).toBe("unavailable");
    expect(result.current.outcome.data).toBeUndefined();
  });

  it("propagates the read error as unavailable", () => {
    const error = new Error("network down");
    mockReturn = { data: undefined, isLoading: false, error };
    const { result } = renderHook(() => useLending(LENDING));
    expect(result.current.outcome.status).toBe("unavailable");
    expect(result.current.error).toBe(error);
  });

  it("does not issue a read for a null lending address", () => {
    mockReturn = { data: undefined, isLoading: false, error: null };
    renderHook(() => useLending(null));
    expect(readContractsConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ contracts: [], query: expect.objectContaining({ enabled: false }) }),
    );
  });
});
