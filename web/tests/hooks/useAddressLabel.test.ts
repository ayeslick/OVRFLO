/**
 * Tests: R25 — ENS resolution with safe truncation fallback.
 *
 * Covers the two paths readers care about:
 *   1. ENS reverse resolution succeeds → the `.eth` name is returned.
 *   2. ENS resolution missing or pending → the truncated 0x… label is
 *      returned, never the raw full-length address.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useEnsNameMock = vi.fn();

vi.mock("wagmi", () => ({
  useEnsName: (...args: unknown[]) => useEnsNameMock(...args),
}));

const { useAddressLabel } = await import("@/hooks/useAddressLabel");

const ADDR = "0x1234567890abcdef1234567890abcdef12345678" as const;

beforeEach(() => {
  useEnsNameMock.mockReset();
});

describe("useAddressLabel", () => {
  it("returns the ENS name when resolution succeeds", () => {
    useEnsNameMock.mockReturnValue({ data: "vitalik.eth", isLoading: false });
    const { result } = renderHook(() => useAddressLabel(ADDR));
    expect(result.current.label).toBe("vitalik.eth");
    expect(result.current.ensName).toBe("vitalik.eth");
  });

  it("falls back to truncated 0x label when ENS is missing", () => {
    useEnsNameMock.mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => useAddressLabel(ADDR));
    expect(result.current.label).toBe("0x1234\u20265678");
    expect(result.current.ensName).toBeNull();
  });

  it("returns an empty label when the address is undefined", () => {
    useEnsNameMock.mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => useAddressLabel(undefined));
    expect(result.current.label).toBe("");
    expect(result.current.ensName).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("does not call ENS resolution when disabled", () => {
    useEnsNameMock.mockReturnValue({ data: undefined, isLoading: false });
    renderHook(() => useAddressLabel(ADDR, { enabled: false }));
    const arg = useEnsNameMock.mock.calls[0]?.[0] as
      | { query?: { enabled?: boolean } }
      | undefined;
    expect(arg?.query?.enabled).toBe(false);
  });
});
