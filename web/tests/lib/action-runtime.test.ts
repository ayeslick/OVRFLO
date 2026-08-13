import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import {
  retryCriticalRefresh,
  runActionExecution,
  type ActionExecutionDraft,
  type ActionExecutionRuntime,
  type ExecutionPlan,
} from "@/lib/action-runtime";
import type { ReadyAction } from "@/lib/actions/types";

const account = "0x00000000000000000000000000000000000000a1" as Address;
const token = "0x00000000000000000000000000000000000000b2" as Address;
const lending = "0x00000000000000000000000000000000000000c3" as Address;
const hash = `0x${"12".repeat(32)}` as Hash;
const identity = { account, chainId: 1 };

function readyAction(amount = 10n, authorizationSatisfied = true): ReadyAction {
  const call = {
    target: lending,
    contract: "lending" as const,
    functionName: "supplyLiquidity",
    args: [token, 1_000, amount] as const,
    value: 0n,
  };
  const authorizations = [
    {
      kind: "erc20" as const,
      token,
      spender: lending,
      requiredAmount: amount,
      approvalAmount: amount,
      currentAllowance: authorizationSatisfied ? amount : 0n,
      satisfied: authorizationSatisfied,
      strategy: "optimistic-zero-first" as const,
    },
  ];
  return {
    type: "supply",
    identity,
    preconditions: ["fresh-state"],
    authorizations,
    call,
    touchedResources: [
      { kind: "market-depth", lending, market: token, aprBps: 1_000 },
    ],
    review: {
      actionType: "supply",
      title: "SUPPLY",
      identity,
      call,
      authorizations,
      economics: { amount },
    },
    receiptSummary: {
      source: lending,
      eventName: "LiquiditySupplied",
      label: "SUPPLIED",
      expectedIds: [],
      expectedAmounts: { amount },
    },
  };
}

function draft(action = readyAction()): ActionExecutionDraft {
  return {
    action,
    request: {
      address: action.call.target,
      functionName: action.call.functionName,
      args: action.call.args,
      value: action.call.value,
      chainId: 1,
      account,
    },
  };
}

function plan(initial = draft(), rebuilt = initial): ExecutionPlan {
  return {
    flowId: "supply:market:10",
    accepted: initial,
    rebuild: vi.fn().mockResolvedValue({ status: "ready", draft: rebuilt }),
  };
}

function runtime(overrides: Partial<ActionExecutionRuntime> = {}): ActionExecutionRuntime {
  const simulatedRequest = { ...draft().request, gas: 123n };
  return {
    getIdentity: vi.fn().mockResolvedValue(identity),
    authorize: vi.fn().mockResolvedValue({
      transactionHash: hash,
      status: "success",
      blockNumber: 100n,
    }),
    simulate: vi.fn().mockResolvedValue({ request: simulatedRequest }),
    submit: vi.fn().mockResolvedValue(hash),
    waitForReceipt: vi.fn().mockResolvedValue({
      transactionHash: hash,
      status: "success",
      blockNumber: 101n,
    }),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runActionExecution", () => {
  it("submits the exact object returned by the final successful simulation", async () => {
    const rt = runtime();
    const result = await runActionExecution(plan(), rt);

    expect(result.status).toBe("success");
    const simulated = await vi.mocked(rt.simulate).mock.results[0]!.value;
    expect(rt.submit).toHaveBeenCalledExactlyOnceWith(simulated.request);
    expect(vi.mocked(rt.submit).mock.calls[0]![0]).toBe(simulated.request);
  });

  it("does not prompt the wallet when final simulation fails", async () => {
    const rt = runtime({
      simulate: vi.fn().mockRejectedValue(new Error("execution reverted: stale route")),
    });

    const result = await runActionExecution(plan(), rt);

    expect(result.status).toBe("simulation_failed");
    expect(rt.submit).not.toHaveBeenCalled();
  });

  it("requires a renewed review when a material rebuilt field changes", async () => {
    const accepted = draft(readyAction(10n));
    const changed = draft(readyAction(11n));
    const rt = runtime();

    const result = await runActionExecution(plan(accepted, changed), rt);

    expect(result.status).toBe("needs_review");
    expect(rt.authorize).not.toHaveBeenCalled();
    expect(rt.simulate).not.toHaveBeenCalled();
    expect(rt.submit).not.toHaveBeenCalled();
  });

  it.each([
    {
      field: "calldata",
      change: (action: ReadyAction) => {
        const call = { ...action.call, args: [token, 1_001, 10n] as const };
        return { ...action, call, review: { ...action.review, call } };
      },
    },
    {
      field: "value",
      change: (action: ReadyAction) => {
        const call = { ...action.call, value: 1n };
        return { ...action, call, review: { ...action.review, call } };
      },
    },
    {
      field: "route",
      change: (action: ReadyAction) => ({
        ...action,
        review: {
          ...action.review,
          route: { ids: [1n], amounts: [10n], aprBps: 1_000 },
        },
      }),
    },
    {
      field: "approval plan",
      change: (action: ReadyAction) => {
        const authorizations = action.authorizations.map((authorization) => ({
          ...authorization,
          requiredAmount: 11n,
          approvalAmount: 11n,
        }));
        return {
          ...action,
          authorizations,
          review: { ...action.review, authorizations },
        } as ReadyAction;
      },
    },
    {
      field: "queue predecessor",
      change: (action: ReadyAction) => ({
        ...action,
        review: {
          ...action.review,
          economics: { ...action.review.economics, queuePredecessor: "0x02" },
        },
      }),
    },
  ])("requires renewed review when rebuilt $field changes", async ({ change }) => {
    const accepted = draft(readyAction());
    const changed = draft(change(accepted.action) as ReadyAction);
    const rt = runtime();

    const result = await runActionExecution(plan(accepted, changed), rt);

    expect(result.status).toBe("needs_review");
    expect(rt.authorize).not.toHaveBeenCalled();
    expect(rt.simulate).not.toHaveBeenCalled();
    expect(rt.submit).not.toHaveBeenCalled();
  });

  it.each([
    { field: "account", changedIdentity: { account: token, chainId: 1 } },
    { field: "chain", changedIdentity: { account, chainId: 10 } },
  ])("stops when the rebuilt $field differs from the latch", async ({ changedIdentity }) => {
    const accepted = draft(readyAction());
    const changedAction = readyAction();
    changedAction.identity = changedIdentity;
    changedAction.review = { ...changedAction.review, identity: changedIdentity };
    const rt = runtime();

    const result = await runActionExecution(plan(accepted, draft(changedAction)), rt);

    expect(result.status).toBe("invalid");
    expect(rt.simulate).not.toHaveBeenCalled();
    expect(rt.submit).not.toHaveBeenCalled();
  });

  it("rebuilds after approval and stops if the latched identity changed", async () => {
    const beforeApproval = draft(readyAction(10n, false));
    const afterApproval = draft(readyAction(10n, true));
    const identities = [
      identity,
      identity,
      identity,
      { ...identity, account: token },
    ];
    const rt = runtime({
      getIdentity: vi.fn().mockImplementation(async () => identities.shift() ?? identity),
    });
    const executionPlan = plan(beforeApproval, afterApproval);
    vi.mocked(executionPlan.rebuild)
      .mockResolvedValueOnce({ status: "ready", draft: beforeApproval })
      .mockResolvedValueOnce({ status: "ready", draft: afterApproval });

    const result = await runActionExecution(executionPlan, rt);

    expect(result.status).toBe("identity_changed");
    expect(rt.authorize).toHaveBeenCalledTimes(1);
    expect(executionPlan.rebuild).toHaveBeenCalledTimes(2);
    expect(rt.submit).not.toHaveBeenCalled();
  });

  it("rebuilds after a successful approval before simulating and submitting", async () => {
    const beforeApproval = draft(readyAction(10n, false));
    const afterApproval = draft(readyAction(10n, true));
    const rt = runtime();
    const executionPlan = plan(beforeApproval, afterApproval);
    vi.mocked(executionPlan.rebuild)
      .mockResolvedValueOnce({ status: "ready", draft: beforeApproval })
      .mockResolvedValueOnce({ status: "ready", draft: afterApproval });

    const result = await runActionExecution(executionPlan, rt);

    expect(result.status).toBe("success");
    expect(rt.authorize).toHaveBeenCalledTimes(1);
    expect(executionPlan.rebuild).toHaveBeenCalledTimes(2);
    expect(rt.simulate).toHaveBeenCalledTimes(1);
    expect(rt.submit).toHaveBeenCalledTimes(1);
  });

  it("stops when identity changes after rebuild but before the approval prompt", async () => {
    const beforeApproval = draft(readyAction(10n, false));
    const rt = runtime({
      getIdentity: vi.fn()
        .mockResolvedValueOnce(identity)
        .mockResolvedValueOnce({ ...identity, account: token }),
    });

    const result = await runActionExecution(plan(beforeApproval), rt);

    expect(result.status).toBe("identity_changed");
    expect(rt.authorize).not.toHaveBeenCalled();
    expect(rt.simulate).not.toHaveBeenCalled();
  });

  it("classifies an identity switch during authorization as identity_changed", async () => {
    const beforeApproval = draft(readyAction(10n, false));
    let currentIdentity = identity;
    const rt = runtime({
      getIdentity: vi.fn().mockImplementation(async () => currentIdentity),
      authorize: vi.fn().mockImplementation(async () => {
        currentIdentity = { ...identity, account: token };
        throw new Error("Wallet identity changed during authorization simulation");
      }),
    });

    const result = await runActionExecution(plan(beforeApproval), rt);

    expect(result.status).toBe("identity_changed");
    expect(rt.simulate).not.toHaveBeenCalled();
    expect(rt.submit).not.toHaveBeenCalled();
  });

  it("classifies a mined revert as failure and skips success refresh", async () => {
    const rt = runtime({
      waitForReceipt: vi.fn().mockResolvedValue({
        transactionHash: hash,
        status: "reverted",
        blockNumber: 101n,
      }),
    });

    const result = await runActionExecution(plan(), rt);

    expect(result.status).toBe("reverted");
    expect(rt.refresh).not.toHaveBeenCalled();
  });

  it("preserves receipt evidence when critical refresh fails and retries refresh only", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("projection incomplete"))
      .mockResolvedValueOnce(undefined);
    const rt = runtime({ refresh });

    const first = await runActionExecution(plan(), rt);
    expect(first.status).toBe("refresh_failed");
    if (first.status !== "refresh_failed") throw new Error("expected refresh failure");
    expect(first.hash).toBe(hash);
    expect(first.receipt.status).toBe("success");

    const retried = await retryCriticalRefresh(first, rt);
    expect(retried.status).toBe("success");
    if (retried.status !== "success") throw new Error("expected refresh retry success");
    expect(retried.hash).toBe(hash);
    expect(rt.submit).toHaveBeenCalledTimes(1);
    expect(rt.waitForReceipt).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("preserves refresh-failed evidence when retry identity lookup fails", async () => {
    const rt = runtime({
      refresh: vi.fn().mockRejectedValue(new Error("projection incomplete")),
    });
    const first = await runActionExecution(plan(), rt);
    if (first.status !== "refresh_failed") throw new Error("expected refresh failure");
    vi.mocked(rt.getIdentity).mockRejectedValueOnce(new Error("wallet unavailable"));

    const retried = await retryCriticalRefresh(first, rt);

    expect(retried.status).toBe("refresh_failed");
    if (retried.status !== "refresh_failed") throw new Error("expected retained refresh failure");
    expect(retried.hash).toBe(hash);
    expect(retried.error).toEqual(new Error("wallet unavailable"));
    expect(rt.submit).toHaveBeenCalledTimes(1);
  });

  it("does not refresh or write when the identity changes before refresh retry", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("projection incomplete"));
    const rt = runtime({ refresh });
    const first = await runActionExecution(plan(), rt);
    if (first.status !== "refresh_failed") throw new Error("expected refresh failure");
    vi.mocked(rt.getIdentity).mockResolvedValueOnce({ ...identity, account: token });

    const retried = await retryCriticalRefresh(first, rt);

    expect(retried.status).toBe("identity_changed");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(rt.submit).toHaveBeenCalledTimes(1);
    expect(rt.waitForReceipt).toHaveBeenCalledTimes(1);
  });
});
