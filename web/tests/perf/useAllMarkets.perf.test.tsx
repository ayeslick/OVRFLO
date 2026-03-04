/**
 * Tests: T-WEB-017
 *
 * T-WEB-017: Performance guard: market aggregation avoids N-hook dynamic churn.
 *            The hook should call useReadContracts a fixed number of times (3)
 *            regardless of how many OVRFLOs exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { OvrfloEntry } from "@/hooks/useOvrflos";

const useReadContractsMock = vi.fn();

vi.mock("wagmi", () => ({
  useReadContracts: (...args: unknown[]) => useReadContractsMock(...args),
}));

const { useAllMarkets } = await import("@/hooks/useAllMarkets");

function makeOvrflo(addr: string): OvrfloEntry {
  return {
    address: addr as `0x${string}`,
    treasury: "0x0000000000000000000000000000000000000002" as `0x${string}`,
    underlying: "0x0000000000000000000000000000000000000003" as `0x${string}`,
    ovrfloToken: "0x0000000000000000000000000000000000000004" as `0x${string}`,
  };
}

beforeEach(() => {
  useReadContractsMock.mockReset();
  useReadContractsMock.mockReturnValue({ data: undefined, isLoading: false });
});

describe("useAllMarkets performance (T-WEB-017)", () => {
  it("T-WEB-017: 1 OVRFLO = 3 hook calls", () => {
    renderHook(() => useAllMarkets([makeOvrflo("0xA1")]));
    expect(useReadContractsMock).toHaveBeenCalledTimes(3);
  });

  it("T-WEB-017: 10 OVRFLOs = still 3 hook calls", () => {
    const ovrflos = Array.from({ length: 10 }, (_, i) =>
      makeOvrflo(`0x${i.toString(16).padStart(40, "0")}`)
    );
    renderHook(() => useAllMarkets(ovrflos));
    expect(useReadContractsMock).toHaveBeenCalledTimes(3);
  });

  it("T-WEB-017: 50 OVRFLOs = still 3 hook calls", () => {
    const ovrflos = Array.from({ length: 50 }, (_, i) =>
      makeOvrflo(`0x${i.toString(16).padStart(40, "0")}`)
    );
    renderHook(() => useAllMarkets(ovrflos));
    expect(useReadContractsMock).toHaveBeenCalledTimes(3);
  });

  it("T-WEB-017: hook count stays at 3 across re-renders with changing list", () => {
    const { rerender } = renderHook(
      ({ list }: { list: OvrfloEntry[] }) => useAllMarkets(list),
      {
        initialProps: {
          list: Array.from({ length: 5 }, (_, i) =>
            makeOvrflo(`0x${i.toString(16).padStart(40, "0")}`)
          ),
        },
      }
    );
    expect(useReadContractsMock).toHaveBeenCalledTimes(3);

    useReadContractsMock.mockClear();

    rerender({
      list: Array.from({ length: 20 }, (_, i) =>
        makeOvrflo(`0x${i.toString(16).padStart(40, "0")}`)
      ),
    });
    expect(useReadContractsMock).toHaveBeenCalledTimes(3);
  });
});
