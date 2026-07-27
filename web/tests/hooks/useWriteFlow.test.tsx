import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { streamKeys } from "@/lib/query-keys";

const user = "0x0000000000000000000000000000000000000a11" as Address;
const hash = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const wagmiState = {
  writeData: undefined as `0x${string}` | undefined,
  receiptSuccess: false,
};

vi.mock("wagmi", () => ({
  useWriteContract: () => ({
    writeContract: vi.fn(),
    isPending: false,
    data: wagmiState.writeData,
    error: null,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: wagmiState.receiptSuccess,
    error: null,
  }),
}));

describe("useWriteFlow invalidation regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wagmiState.writeData = undefined;
    wagmiState.receiptSuccess = false;
  });
  afterEach(() => vi.useRealTimers());

  it("invalidates the two wagmi roots and the held key exactly once per confirmed hash", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { rerender } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(spy).not.toHaveBeenCalled();

    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    rerender();

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["readContract"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["readContracts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: streamKeys.held(user) });

    // Same hash again — no duplicate invalidation.
    rerender();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("re-invalidates the held key on the indexer-lag retry schedule", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(() => useWriteFlow(user), { wrapper });

    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    rerender();
    expect(spy).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(5000);
    const heldCalls = spy.mock.calls.filter(
      ([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(streamKeys.held(user)),
    );
    expect(heldCalls.length).toBe(3);
  });
});
