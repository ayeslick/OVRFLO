import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";

const states = [
  {
    isSigning: false,
    isConfirming: false,
    isRefreshing: false,
    isInFlight: false,
    refreshFailed: false,
  },
  {
    isSigning: false,
    isConfirming: false,
    isRefreshing: false,
    isInFlight: false,
    refreshFailed: false,
  },
];
let callCount = 0;

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => {
    const state = states[callCount % 2];
    callCount += 1;
    return {
      ...state,
      writeContract: vi.fn(),
      isConfirmed: false,
      isReverted: false,
      hasFailed: false,
      error: null,
    };
  },
}));

vi.mock("@/hooks/useZeroFirstApprove", () => ({
  useZeroFirstApprove: () => ({
    submit: vi.fn(),
    clearing: false,
    usedFallback: false,
  }),
}));

describe("useApprovalWriteFlows", () => {
  beforeEach(() => {
    callCount = 0;
    for (const state of states) {
      state.isSigning = false;
      state.isConfirming = false;
      state.isRefreshing = false;
      state.isInFlight = false;
      state.refreshFailed = false;
    }
  });

  it("returns independent approval and action adapters", () => {
    const { result } = renderHook(() => useApprovalWriteFlows());
    expect(result.current.approveTx).not.toBe(result.current.actionTx);
  });

  it("is busy for either wallet prompt, receipt wait, or critical refresh", () => {
    states[1].isInFlight = true;
    const { result } = renderHook(() => useApprovalWriteFlows());
    expect(result.current.busy).toBe(true);
  });

  it("stays blocked after receipt success when critical refresh failed", () => {
    states[0].refreshFailed = true;
    const { result } = renderHook(() => useApprovalWriteFlows());
    expect(result.current.busy).toBe(true);
  });

  it("is idle when both executor adapters are idle", () => {
    const { result } = renderHook(() => useApprovalWriteFlows());
    expect(result.current.busy).toBe(false);
  });
});
