/**
 * Tests: T-WEB-003 (partial), T-WEB-004 (partial), T-WEB-018 (partial)
 *
 * Verifies useTokenDecimals returns correct decimals and getDecimals
 * helper falls back to 18 when data is missing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useReadContractsMock = vi.fn();

vi.mock("wagmi", () => ({
  useReadContracts: (...args: unknown[]) => useReadContractsMock(...args),
}));

const { useTokenDecimals, getDecimals } = await import(
  "@/hooks/useTokenMeta"
);

beforeEach(() => {
  useReadContractsMock.mockReset();
  useReadContractsMock.mockReturnValue({ data: undefined });
});

describe("useTokenDecimals + getDecimals", () => {
  it("T-WEB-003/004: returns correct decimals for tokens", () => {
    const addr6 = "0x0000000000000000000000000000000000000006" as `0x${string}`;
    const addr18 = "0x0000000000000000000000000000000000000018" as `0x${string}`;

    useReadContractsMock.mockReturnValue({
      data: [
        { result: 6, status: "success" },
        { result: 18, status: "success" },
      ],
    });

    const { result } = renderHook(() =>
      useTokenDecimals([addr6, addr18])
    );

    expect(getDecimals(result.current, addr6)).toBe(6);
    expect(getDecimals(result.current, addr18)).toBe(18);
  });

  it("T-WEB-003/004: falls back to 18 for unknown token", () => {
    useReadContractsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useTokenDecimals([]));
    expect(
      getDecimals(result.current, "0xunknown" as `0x${string}`)
    ).toBe(18);
  });

  it("T-WEB-003/004: handles undefined tokens in input array", () => {
    useReadContractsMock.mockReturnValue({ data: undefined });

    const { result } = renderHook(() =>
      useTokenDecimals([undefined, undefined])
    );
    expect(result.current.size).toBe(0);
  });

  it("T-WEB-003/004: deduplicates identical token addresses", () => {
    const addr = "0x0000000000000000000000000000000000000006" as `0x${string}`;

    useReadContractsMock.mockReturnValue({
      data: [{ result: 6, status: "success" }],
    });

    const { result } = renderHook(() =>
      useTokenDecimals([addr, addr, addr])
    );

    // Should only have one entry despite 3 inputs
    expect(result.current.size).toBe(1);
    expect(getDecimals(result.current, addr)).toBe(6);
  });
});
