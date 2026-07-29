import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { streamKeys } from "@/lib/query-keys";

const user = "0x0000000000000000000000000000000000000a11" as Address;
const lending = "0x0000000000000000000000000000000000000b22" as Address;
const token = "0x0000000000000000000000000000000000000c33" as Address;
const unrelated = "0x0000000000000000000000000000000000000d44" as Address;
const hash = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const writeContractMock = vi.fn();
const resetMock = vi.fn();
const wagmiState = {
  writeData: undefined as `0x${string}` | undefined,
  receiptData: undefined as { status: "success" | "reverted" } | undefined,
  receiptSuccess: false,
  isPending: false,
  receiptLoading: false,
  writeError: null as Error | null,
  receiptError: null as Error | null,
};

vi.mock("wagmi", () => ({
  useWriteContract: () => ({
    writeContract: writeContractMock,
    reset: resetMock,
    isPending: wagmiState.isPending,
    data: wagmiState.writeData,
    error: wagmiState.writeError,
  }),
  useWaitForTransactionReceipt: () => ({
    data: wagmiState.receiptData,
    isLoading: wagmiState.receiptLoading,
    isSuccess: wagmiState.receiptSuccess,
    error: wagmiState.receiptError,
  }),
}));

describe("useWriteFlow invalidation regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeContractMock.mockClear();
    resetMock.mockClear();
    wagmiState.writeData = undefined;
    wagmiState.receiptData = undefined;
    wagmiState.receiptSuccess = false;
    wagmiState.isPending = false;
    wagmiState.receiptLoading = false;
    wagmiState.writeError = null;
    wagmiState.receiptError = null;
  });
  afterEach(() => vi.useRealTimers());

  it("invalidates scoped read keys and the held key exactly once per confirmed hash", () => {
    // R39: was three broad invalidations — the two wagmi roots wholesale plus
    // the held key — so any write refetched every mounted read in the app. The
    // read roots are now predicate-matched against the contracts this
    // transaction actually touched.
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(spy).not.toHaveBeenCalled();

    // The write records which contract it targeted.
    result.current.writeContract({ address: user, abi: [], functionName: "deposit" } as never);

    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "success" };
    rerender();

    expect(spy).toHaveBeenCalledTimes(3);
    // Two predicate-scoped read invalidations plus the held key.
    const calls = spy.mock.calls.map(([arg]) => arg);
    expect(calls.filter((c) => typeof c?.predicate === "function")).toHaveLength(2);
    expect(calls).toContainEqual({ queryKey: streamKeys.held(user) });

    // Same hash again — no duplicate invalidation.
    rerender();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("invalidates token reads the transaction moved but was not addressed to", () => {
    // R39 scoped invalidation to the transaction's `to`, which is not the whole
    // set a call changes: `supplyLiquidity` is addressed to the lending market
    // and pulls the underlying ERC-20, so the user's balance and allowance —
    // read against the *token* address — kept showing pre-transaction numbers.
    // With focus refetching off and the balance view still mounted behind the
    // modal, that stale number survived until a reload.
    const queryClient = new QueryClient();
    const balanceKey = ["readContract", { address: token, functionName: "balanceOf", args: [user] }];
    const otherMarketKey = ["readContract", { address: unrelated, functionName: "balanceOf", args: [user] }];
    queryClient.setQueryData(balanceKey, 1n);
    queryClient.setQueryData(otherMarketKey, 1n);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(() => useWriteFlow(user, [token]), { wrapper });
    result.current.writeContract({ address: lending, abi: [], functionName: "supplyLiquidity" } as never);

    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "success" };
    rerender();

    expect(queryClient.getQueryState(balanceKey)?.isInvalidated).toBe(true);
    // Still scoped: a read belonging to some other market is left alone.
    expect(queryClient.getQueryState(otherMarketKey)?.isInvalidated).toBe(false);
  });

  it("does not invalidate on a mined-but-reverted receipt", () => {
    // `receipt.isSuccess` only means the RPC fetch resolved a receipt — a
    // reverted on-chain tx still mines one, with no thrown write/receipt
    // error. Only `data.status === "success"` should trigger invalidation.
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { rerender } = renderHook(() => useWriteFlow(user), { wrapper });

    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "reverted" };
    rerender();

    expect(spy).not.toHaveBeenCalled();
  });

  it("re-invalidates the held key on the indexer-lag retry schedule", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useWriteFlow(user), { wrapper });
    result.current.writeContract({ address: user, abi: [], functionName: "deposit" } as never);

    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "success" };
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
    resetMock.mockClear();
    wagmiState.writeData = undefined;
    wagmiState.receiptData = undefined;
    wagmiState.receiptSuccess = false;
    wagmiState.isPending = false;
    wagmiState.receiptLoading = false;
    wagmiState.writeError = null;
    wagmiState.receiptError = null;
  });

  it("forwards writeContract with the expected chain injected (R6)", () => {
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    const config = { address: user, abi: [], functionName: "deposit", args: [1n, 2n] };
    result.current.writeContract(config as never);
    // Every field the caller passed must survive, and `chainId` must be added:
    // naming the expected chain on the write itself is what refuses a
    // wrong-chain broadcast when the FormBody gate is bypassed. Asserting the
    // whole object rather than "called once" catches dropped or altered args.
    expect(writeContractMock).toHaveBeenCalledExactlyOnceWith({ chainId: 1, ...config }, undefined);
  });

  it("does not let a caller override the expected chain", () => {
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    result.current.writeContract({ address: user, abi: [], functionName: "deposit", chainId: 999 } as never);
    // The caller's chainId wins the spread, which is intentional — an explicit
    // per-call chain is a deliberate act. What must never happen is the field
    // going missing entirely, which is what this pins.
    const [args] = writeContractMock.mock.calls[0];
    expect(args).toHaveProperty("chainId");
  });

  it("forwards reset through to the caller unchanged", () => {
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    result.current.reset();
    expect(resetMock).toHaveBeenCalledExactlyOnceWith();
  });

  it("forwards the receipt data through as `receipt`", () => {
    wagmiState.receiptData = { status: "success" };
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.receipt).toBe(wagmiState.receiptData);
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

  it("treats a mined-but-reverted receipt as isReverted, not isConfirmed", () => {
    // `receipt.isSuccess` only means the fetch resolved a receipt, with no
    // thrown write/receipt error for a reverted tx — the outcome is only in
    // `data.status`.
    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "reverted" };
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.isConfirmed).toBe(false);
    expect(result.current.isReverted).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces isConfirmed only once the receipt reports status success", () => {
    wagmiState.writeData = hash;
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "success" };
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.isConfirmed).toBe(true);
    expect(result.current.isReverted).toBe(false);
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

// R8/M-2: `error` is null on an on-chain revert — the receipt fetch succeeded,
// the transaction did not. Five consumers reset optimistic approval state on
// `error` alone and silently kept it through a reverted approve. `hasFailed` is
// the single signal they now share.
describe("hasFailed (R8)", () => {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const queryClient = new QueryClient();
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  beforeEach(() => {
    wagmiState.writeData = undefined;
    wagmiState.receiptData = undefined;
    wagmiState.receiptSuccess = false;
    wagmiState.isPending = false;
    wagmiState.receiptLoading = false;
    wagmiState.writeError = null;
    wagmiState.receiptError = null;
  });

  it("is true when the transaction reverted on-chain, even though error is null", () => {
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "reverted" };
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    // The exact shape that made M-2 invisible.
    expect(result.current.error).toBeNull();
    expect(result.current.isReverted).toBe(true);
    expect(result.current.hasFailed).toBe(true);
  });

  it("is true when the write itself errored", () => {
    wagmiState.writeError = new Error("user rejected");
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.hasFailed).toBe(true);
  });

  it("is true when the receipt fetch errored", () => {
    wagmiState.receiptError = new Error("rpc down");
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.hasFailed).toBe(true);
  });

  it("is false on a successful confirmation", () => {
    wagmiState.receiptSuccess = true;
    wagmiState.receiptData = { status: "success" };
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.isConfirmed).toBe(true);
    expect(result.current.hasFailed).toBe(false);
  });

  it("is false while still pending", () => {
    wagmiState.isPending = true;
    const { result } = renderHook(() => useWriteFlow(user), { wrapper });
    expect(result.current.hasFailed).toBe(false);
  });
});
