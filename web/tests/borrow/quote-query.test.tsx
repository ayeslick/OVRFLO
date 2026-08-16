import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { useState, type ReactNode } from "react";
import {
  QUOTE_DEBOUNCE_MS,
  useBorrowPreview,
  useDebouncedBorrowTarget,
} from "@/components/borrow/quote";

const LENDING = "0x0000000000000000000000000000000000000a11" as Address;
const MARKET = "0x0000000000000000000000000000000000000b22" as Address;
const HASH = `0x${"cd".repeat(32)}` as Hex;
const ETHER = 10n ** 18n;

const simulateContract = vi.fn();
const getBlock = vi.fn();

vi.mock("wagmi", () => ({
  usePublicClient: () => ({ simulateContract, getBlock }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function previewResult(actualBorrow: bigint) {
  return {
    result: [actualBorrow, actualBorrow / 250n, actualBorrow + ETHER] as const,
  };
}

describe("borrow quote query", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getBlock.mockResolvedValue({ number: 10n, hash: HASH });
    simulateContract.mockReset();
    simulateContract.mockImplementation(async (args: { args?: readonly unknown[] }) => {
      const target = args.args?.[2];
      if (target === (1n << 128n) - 1n) return previewResult(20n * ETHER);
      return previewResult(typeof target === "bigint" ? target : 4n * ETHER);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces amount input to one quote per pause and flushes on tick change", async () => {
    const { result, rerender } = renderHook(
      ({ amountRaw, flushKey }: { amountRaw: string; flushKey: string }) =>
        useDebouncedBorrowTarget(amountRaw, flushKey),
      { initialProps: { amountRaw: "1", flushKey: "31:1000" } },
    );
    expect(result.current.isDebouncing).toBe(false);
    expect(result.current.debouncedRaw).toBe("1");
    act(() => {
      rerender({ amountRaw: "12", flushKey: "31:1000" });
      rerender({ amountRaw: "123", flushKey: "31:1000" });
    });
    expect(result.current.isDebouncing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(QUOTE_DEBOUNCE_MS - 1);
    });
    expect(result.current.debouncedRaw).toBe("1");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.debouncedRaw).toBe("123");
    expect(result.current.isDebouncing).toBe(false);

    act(() => {
      rerender({ amountRaw: "123", flushKey: "31:1100" });
    });
    expect(result.current.debouncedRaw).toBe("123");
    expect(result.current.isDebouncing).toBe(false);
  });

  it("keeps previous figures while a later quote is in flight", async () => {
    let release: (() => void) | undefined;
    simulateContract.mockImplementation(async (args: { args?: readonly unknown[] }) => {
      const target = args.args?.[2];
      if (target === (1n << 128n) - 1n) return previewResult(20n * ETHER);
      if (target === 5n * ETHER) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return previewResult(5n * ETHER);
      }
      return previewResult(4n * ETHER);
    });

    const { result, rerender } = renderHook(
      ({ amountRaw }: { amountRaw: string }) =>
        useBorrowPreview({
          lending: LENDING,
          market: MARKET,
          streamId: 31n,
          aprBps: 1000,
          amountRaw,
          streamRemaining: 110n * ETHER,
          depth: 50n * ETHER,
          minLiquidity: 10n ** 15n,
        }),
      { wrapper, initialProps: { amountRaw: "4" } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS);
    });
    await vi.waitFor(() => {
      expect(result.current.quote?.actualBorrow).toBe(4n * ETHER);
    });
    const firstNet = result.current.quote?.net;
    expect(firstNet).toBeGreaterThan(0n);
    expect(result.current.showDashes).toBe(false);

    act(() => {
      rerender({ amountRaw: "5" });
    });
    expect(result.current.isStale).toBe(true);
    expect(result.current.quote?.net).toBe(firstNet);
    expect(result.current.quote?.net).not.toBe(0n);
    expect(result.current.showDashes).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS);
    });
    expect(result.current.quote?.net).toBe(firstNet);
    await act(async () => {
      release?.();
    });
    await vi.waitFor(() => {
      expect(result.current.quote?.actualBorrow).toBe(5n * ETHER);
    });
  });
});
