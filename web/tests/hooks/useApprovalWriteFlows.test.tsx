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

vi.mock("wagmi", () => ({
  useWriteContract: () => ({
    writeContract: vi.fn(),
    isPending: wagmiState.approvePending || wagmiState.actionPending,
    data: undefined,
    error: wagmiState.approveError ?? wagmiState.actionError,
    reset: vi.fn(),
  }),
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
});
