/**
 * Tests: T-WEB-001, T-WEB-002
 *
 * T-WEB-001: Ensure market aggregation hook order remains stable
 *            as OVRFLO count changes. No React hook-order violations.
 * T-WEB-002: Validate aggregated market list correctness across
 *            multiple OVRFLOs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { OvrfloEntry } from "@/hooks/useOvrflos";

const useReadContractsMock = vi.fn();

vi.mock("wagmi", () => ({
  useReadContracts: (...args: unknown[]) => useReadContractsMock(...args),
}));

// Must import after mock is established
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
  // Default: all three useReadContracts calls return empty
  useReadContractsMock.mockReturnValue({ data: undefined, isLoading: false });
});

describe("useAllMarkets (T-WEB-001, T-WEB-002)", () => {
  it("T-WEB-001: calls useReadContracts exactly 3 times regardless of ovrflo count", () => {
    const ovrflos = [makeOvrflo("0xA1"), makeOvrflo("0xA2"), makeOvrflo("0xA3")];
    renderHook(() => useAllMarkets(ovrflos));
    // The hook must call useReadContracts exactly 3 times: counts, addresses, series
    expect(useReadContractsMock).toHaveBeenCalledTimes(3);
  });

  it("T-WEB-001: hook call count is stable when ovrflo list changes length", () => {
    // First render with 2 ovrflos
    const { rerender } = renderHook(
      ({ list }: { list: OvrfloEntry[] }) => useAllMarkets(list),
      { initialProps: { list: [makeOvrflo("0xA1"), makeOvrflo("0xA2")] } }
    );
    const callCount1 = useReadContractsMock.mock.calls.length;

    useReadContractsMock.mockClear();

    // Re-render with 4 ovrflos
    rerender({
      list: [
        makeOvrflo("0xA1"),
        makeOvrflo("0xA2"),
        makeOvrflo("0xA3"),
        makeOvrflo("0xA4"),
      ],
    });
    const callCount2 = useReadContractsMock.mock.calls.length;

    // Both should call exactly 3 useReadContracts hooks
    expect(callCount1).toBe(3);
    expect(callCount2).toBe(3);
  });

  it("T-WEB-001: returns empty markets for empty ovrflo list", () => {
    const { result } = renderHook(() => useAllMarkets([]));
    expect(result.current.markets).toEqual([]);
  });

  it("T-WEB-002: correctly aggregates markets from multiple OVRFLOs", () => {
    const ovrfloA = makeOvrflo("0x000000000000000000000000000000000000000A");
    const ovrfloB = makeOvrflo("0x000000000000000000000000000000000000000B");
    const marketA1 = "0x00000000000000000000000000000000000000A1" as `0x${string}`;
    const marketB1 = "0x00000000000000000000000000000000000000B1" as `0x${string}`;

    useReadContractsMock
      // Call 1: counts
      .mockReturnValueOnce({
        data: [
          { result: 1n, status: "success" },
          { result: 1n, status: "success" },
        ],
        isLoading: false,
      })
      // Call 2: addresses
      .mockReturnValueOnce({
        data: [
          { result: marketA1, status: "success" },
          { result: marketB1, status: "success" },
        ],
        isLoading: false,
      })
      // Call 3: series
      .mockReturnValueOnce({
        data: [
          {
            result: [true, 1800, 50, 1700000000n, "0xPT_A", "0xOT_A", "0xU_A"],
            status: "success",
          },
          {
            result: [true, 900, 25, 1800000000n, "0xPT_B", "0xOT_B", "0xU_B"],
            status: "success",
          },
        ],
        isLoading: false,
      });

    const { result } = renderHook(() => useAllMarkets([ovrfloA, ovrfloB]));

    expect(result.current.markets).toHaveLength(2);
    expect(result.current.markets[0].market).toBe(marketA1);
    expect(result.current.markets[0].ovrflo).toBe(ovrfloA.address);
    expect(result.current.markets[0].feeBps).toBe(50);
    expect(result.current.markets[1].market).toBe(marketB1);
    expect(result.current.markets[1].ovrflo).toBe(ovrfloB.address);
    expect(result.current.markets[1].expiry).toBe(1800000000n);
  });

  it("surfaces read failures instead of silently returning empty markets", () => {
    const ovrfloA = makeOvrflo("0x000000000000000000000000000000000000000A");

    useReadContractsMock
      .mockReturnValueOnce({
        data: [{ status: "failure", error: new Error("factory read failed") }],
        isLoading: false,
      })
      .mockReturnValueOnce({ data: [], isLoading: false })
      .mockReturnValueOnce({ data: [], isLoading: false });

    const { result } = renderHook(() => useAllMarkets([ovrfloA]));

    expect(result.current.error?.message).toContain("factory read failed");
  });
});
