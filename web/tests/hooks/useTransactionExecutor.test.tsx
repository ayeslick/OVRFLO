import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import {
  clearTransactionExecutionRegistryForTests,
  useTransactionExecutor,
} from "@/hooks/useTransactionExecutor";
import type {
  ActionExecutionDraft,
  ActionExecutionRuntime,
  ExecutionPlan,
} from "@/lib/action-runtime";
import { readPendingHash } from "@/lib/step-evidence";

const account = "0x00000000000000000000000000000000000000a1" as Address;
const target = "0x00000000000000000000000000000000000000b2" as Address;
const hash = `0x${"34".repeat(32)}` as Hash;
const identity = { account, chainId: 1 };

function fixture(): { plan: ExecutionPlan; runtime: ActionExecutionRuntime } {
  const call = {
    target,
    contract: "lending" as const,
    functionName: "withdrawLiquidity",
    args: [1n] as const,
    value: 0n,
  };
  const action = {
    type: "withdraw" as const,
    identity,
    preconditions: ["fresh-position"],
    authorizations: [],
    call,
    touchedResources: [{ kind: "liquidity-position" as const, lending: target, id: 1n }],
    review: {
      actionType: "withdraw" as const,
      title: "WITHDRAW",
      identity,
      call,
      authorizations: [],
      economics: { amount: 1n },
    },
    receiptSummary: {
      source: target,
      eventName: "LiquidityWithdrawn",
      label: "WITHDRAWN",
      expectedIds: [1n],
      expectedAmounts: { amount: 1n },
    },
  };
  const draft: ActionExecutionDraft = {
    action,
    request: { address: target, functionName: "withdrawLiquidity", args: [1n] },
  };
  let releaseSimulation!: () => void;
  const simulationGate = new Promise<void>((resolve) => {
    releaseSimulation = resolve;
  });
  const runtime: ActionExecutionRuntime = {
    getIdentity: vi.fn().mockResolvedValue(identity),
    authorize: vi.fn(),
    simulate: vi.fn().mockImplementation(async () => {
      await simulationGate;
      return { request: { ...draft.request, account, chainId: 1 } };
    }),
    submit: vi.fn().mockResolvedValue(hash),
    waitForReceipt: vi.fn().mockResolvedValue({
      transactionHash: hash,
      status: "success",
      blockNumber: 20n,
    }),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  return {
    plan: {
      flowId: "withdraw:1",
      accepted: draft,
      rebuild: vi.fn().mockResolvedValue({ status: "ready", draft }),
    },
    runtime: Object.assign(runtime, { releaseSimulation }),
  };
}

describe("useTransactionExecutor", () => {
  beforeEach(() => clearTransactionExecutionRegistryForTests());
  afterEach(() => {
    window.localStorage.clear();
  });

  it("coalesces duplicate confirmation and remounted callers for one in-flight identity", async () => {
    const { plan, runtime } = fixture();
    const first = renderHook(() => useTransactionExecutor(runtime));
    const second = renderHook(() => useTransactionExecutor(runtime));

    let firstConfirmation!: Promise<unknown>;
    let secondConfirmation!: Promise<unknown>;
    act(() => {
      firstConfirmation = first.result.current.confirm(plan);
      first.rerender();
      secondConfirmation = second.result.current.confirm(plan);
    });

    await vi.waitFor(() => expect(runtime.simulate).toHaveBeenCalledTimes(1));
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    await act(async () => {
      await Promise.all([firstConfirmation, secondConfirmation]);
    });

    expect(runtime.submit).toHaveBeenCalledTimes(1);
    expect(first.result.current.status).toBe("success");
    expect(second.result.current.status).toBe("success");
  });

  it("retries a failed critical refresh without simulating or writing again", async () => {
    const { plan, runtime } = fixture();
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    vi.mocked(runtime.refresh)
      .mockRejectedValueOnce(new Error("hydration unavailable"))
      .mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useTransactionExecutor(runtime));

    await act(async () => {
      await hook.result.current.confirm(plan);
    });
    expect(hook.result.current.status).toBe("refresh_failed");
    expect(hook.result.current.hash).toBe(hash);

    await act(async () => {
      await hook.result.current.retryRefresh();
    });
    expect(hook.result.current.status).toBe("success");
    expect(runtime.simulate).toHaveBeenCalledTimes(1);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
  });

  it("coalesces duplicate refresh-only retries", async () => {
    const { plan, runtime } = fixture();
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    let releaseRefresh!: () => void;
    vi.mocked(runtime.refresh)
      .mockRejectedValueOnce(new Error("hydration unavailable"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseRefresh = resolve;
          }),
      );
    const hook = renderHook(() => useTransactionExecutor(runtime));
    await act(async () => {
      await hook.result.current.confirm(plan);
    });

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = hook.result.current.retryRefresh();
      second = hook.result.current.retryRefresh();
    });
    await vi.waitFor(() => expect(runtime.refresh).toHaveBeenCalledTimes(2));
    releaseRefresh();
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(hook.result.current.status).toBe("success");
    expect(runtime.refresh).toHaveBeenCalledTimes(2);
    expect(runtime.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps pending execution dedupe across a UI reset", async () => {
    const { plan, runtime } = fixture();
    const hook = renderHook(() => useTransactionExecutor(runtime));
    let first!: Promise<unknown>;
    let resumed!: Promise<unknown>;

    act(() => {
      first = hook.result.current.confirm(plan);
    });
    await vi.waitFor(() => expect(runtime.simulate).toHaveBeenCalledTimes(1));
    act(() => {
      hook.result.current.reset();
      resumed = hook.result.current.confirm(plan);
    });

    expect(runtime.simulate).toHaveBeenCalledTimes(1);
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    await act(async () => {
      await Promise.all([first, resumed]);
    });
    expect(runtime.submit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("success");
  });

  it("does not start a changed plan while the current flow is pending", async () => {
    const { plan, runtime } = fixture();
    const changedPlan = { ...plan, flowId: "withdraw:changed" };
    const hook = renderHook(() => useTransactionExecutor(runtime));
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;

    act(() => {
      first = hook.result.current.confirm(plan);
      second = hook.result.current.confirm(changedPlan);
    });
    await vi.waitFor(() => expect(runtime.simulate).toHaveBeenCalledTimes(1));
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(runtime.submit).toHaveBeenCalledTimes(1);
  });

  it("retires a refresh-failed entry after retry succeeds", async () => {
    const { plan, runtime } = fixture();
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    vi.mocked(runtime.refresh)
      .mockRejectedValueOnce(new Error("hydration unavailable"))
      .mockResolvedValue(undefined);
    const hook = renderHook(() => useTransactionExecutor(runtime));

    await act(async () => {
      await hook.result.current.confirm(plan);
    });
    await act(async () => {
      await hook.result.current.retryRefresh();
    });
    await act(async () => {
      await hook.result.current.confirm(plan);
    });

    expect(runtime.simulate).toHaveBeenCalledTimes(2);
    expect(runtime.submit).toHaveBeenCalledTimes(2);
  });

  it("persists a pending hash from the confirm persist context after unmount", async () => {
    const { plan, runtime } = fixture();
    let releaseSubmit!: (next: Hash) => void;
    vi.mocked(runtime.submit).mockImplementation(
      () =>
        new Promise<Hash>((resolve) => {
          releaseSubmit = resolve;
        }),
    );
    vi.mocked(runtime.waitForReceipt).mockRejectedValue(new Error("unmounted"));
    (runtime as ActionExecutionRuntime & { releaseSimulation: () => void }).releaseSimulation();
    const hook = renderHook(() => useTransactionExecutor(runtime));
    const persist = {
      key: {
        factory: "0x00000000000000000000000000000000000000f1",
        chainId: 1,
        account,
        graphId: "g-1",
        stepId: "deposit" as const,
      },
      identity: { kind: "deposit" as const, chainId: 1, token: target, amount: "1" },
    };
    let confirmation!: Promise<unknown>;
    act(() => {
      confirmation = hook.result.current.confirm(plan, persist);
    });
    await vi.waitFor(() => expect(runtime.submit).toHaveBeenCalledTimes(1));
    hook.unmount();
    await act(async () => {
      releaseSubmit(hash);
      await confirmation;
    });
    expect(readPendingHash(persist.key)).toBe(hash);
  });
});
