import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ReactNode } from "react";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";

const user = "0x0000000000000000000000000000000000000a11" as Address;

const wagmiState = {
  approvePending: false,
  approveError: null as Error | null,
  actionPending: false,
  actionError: null as Error | null,
};

// useApprovalWriteFlows calls useWriteFlow (and therefore useWriteContract)
// exactly twice per render, in a fixed order: approveTx first, actionTx
// second. Discriminating by call order lets tests drive each flow's pending
// state independently — a shared mock (the same isPending for both calls)
// can only ever confirm the OR fires at all, not that BOTH operands are
// live (a regression that hardcoded `busy = approveTx.isSigning` and
// dropped `actionTx.isSigning` would still pass a shared-mock test).
let useWriteContractCallCount = 0;

vi.mock("wagmi", () => ({
  useWriteContract: () => {
    useWriteContractCallCount += 1;
    const isApprove = useWriteContractCallCount % 2 === 1;
    return {
      writeContract: vi.fn(),
      isPending: isApprove ? wagmiState.approvePending : wagmiState.actionPending,
      data: undefined,
      error: isApprove ? wagmiState.approveError : wagmiState.actionError,
      reset: vi.fn(),
    };
  },
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    error: null,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useApprovalWriteFlows", () => {
  beforeEach(() => {
    useWriteContractCallCount = 0;
    wagmiState.approvePending = false;
    wagmiState.approveError = null;
    wagmiState.actionPending = false;
    wagmiState.actionError = null;
  });
  afterEach(() => vi.clearAllMocks());

  it("returns two independent write flows", () => {
    const { result } = renderHook(() => useApprovalWriteFlows(user), { wrapper });
    expect(result.current.approveTx).toBeDefined();
    expect(result.current.actionTx).toBeDefined();
    expect(result.current.approveTx).not.toBe(result.current.actionTx);
  });

  it("is not busy when neither flow is signing or confirming", () => {
    const { result } = renderHook(() => useApprovalWriteFlows(user), { wrapper });
    expect(result.current.busy).toBe(false);
  });

  it("is busy when only the approval write is pending", () => {
    wagmiState.approvePending = true;
    const { result } = renderHook(() => useApprovalWriteFlows(user), { wrapper });
    expect(result.current.busy).toBe(true);
  });

  it("is busy when only the action write is pending", () => {
    // Independent of the approval side thanks to the call-order-discriminating
    // mock above — this would fail if useApprovalWriteFlows ever dropped
    // `actionTx.isSigning` from the busy OR.
    wagmiState.actionPending = true;
    const { result } = renderHook(() => useApprovalWriteFlows(user), { wrapper });
    expect(result.current.busy).toBe(true);
  });
});
