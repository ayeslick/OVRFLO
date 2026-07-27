import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { streamKeys } from "@/lib/query-keys";

const user = "0x0000000000000000000000000000000000000a11" as Address;
const hash = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const writeContractMock = vi.fn();
const wagmiState = {
  writeData: undefined as `0x${string}` | undefined,
  receiptSuccess: false,
  isPending: false,
  receiptLoading: false,
  writeError: null as Error | null,
  receiptError: null as Error | null,
};

vi.mock("wagmi", () => ({
  useWriteContract: () => ({
    writeContract: writeContractMock,
    isPending: wagmiState.isPending,
    data: wagmiState.writeData,
    error: wagmiState.writeError,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: wagmiState.receiptLoading,
    isSuccess: wagmiState.receiptSuccess,
    error: wagmiState.receiptError,
  }),
}));

describe("useWriteFlow invalidation regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeContractMock.mockClear();
    wagmiState.writeData = undefined;
    wagmiState.receiptSuccess = false;
    wagmiState.isPending = false;
    wagmiState.receiptLoading = false;
    wagmiState.writeError = null;
    wagmiState.receiptError = null;
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

describe("useWriteFlow state forwarding", () => {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const queryClient = new QueryClient();
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  beforeEach(() => {
    writeContractMock.mockClear();
    wagmiState.writeData = undefined;
    wagmiState.receiptSuccess = false;
    wagmiState.isPending = false;
    wagmiState.receiptLoading = false;
    wagmiState.writeError = null;
    wagmiState.receiptError = null;
  });

  it("forwards writeContract through to the caller unchanged", () => {
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    const config = { address: user, abi: [], functionName: "deposit", args: [1n, 2n] } as never;
    result.current.writeContract(config);
    // Asserts the exact config object reaches wagmi's writeContract, not just
    // that *a* call happened — useWriteFlow returns write.writeContract
    // directly (no wrapping), so a call with altered/dropped args would still
    // pass a weaker "called once" check.
    expect(writeContractMock).toHaveBeenCalledExactlyOnceWith(config);
  });

  it("surfaces isSigning while the wallet write is pending", () => {
    wagmiState.isPending = true;
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.isSigning).toBe(true);
    expect(result.current.isConfirming).toBe(false);
  });

  it("surfaces isConfirming while waiting on the receipt", () => {
    wagmiState.writeData = hash;
    wagmiState.receiptLoading = true;
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.isConfirming).toBe(true);
    expect(result.current.isConfirmed).toBe(false);
  });

  it("prefers the write error over the receipt error, and falls back to the receipt error otherwise", () => {
    const writeError = new Error("user rejected");
    wagmiState.writeError = writeError;
    wagmiState.receiptError = new Error("should be shadowed");
    const { result: withWriteError } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(withWriteError.current.error).toBe(writeError);

    wagmiState.writeError = null;
    const receiptError = new Error("reverted");
    wagmiState.receiptError = receiptError;
    const { result: withReceiptError } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(withReceiptError.current.error).toBe(receiptError);
  });
});
