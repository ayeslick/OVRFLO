import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import type {
  ActionExecutionDraft,
  ActionExecutionResult,
  ExecutionPlan,
} from "@/lib/action-runtime";
import type { ActionIdentity, ReadyAction } from "@/lib/actions/types";
import type { QueuedTx } from "@/lib/claim-all";
import { readStepEvidence } from "@/lib/step-evidence";
import {
  useTxQueue,
  type ClaimAllRowBuild,
  type GraphQueueContext,
  type QueueInvariant,
} from "@/hooks/useTxQueue";

const userA = "0x0000000000000000000000000000000000000a11" as Address;
const userB = "0x0000000000000000000000000000000000000b22" as Address;
const lending = "0x00000000000000000000000000000000000000aa" as Address;
const asset = "0x00000000000000000000000000000000000000cc" as Address;
const hash = `0x${"12".repeat(32)}` as Hash;

const rows: QueuedTx[] = [
  {
    kind: "pool-claims",
    lending,
    claims: [
      { loanId: 1n, claimable: 5n },
      { loanId: 2n, claimable: 7n },
    ],
    asset,
  },
  { kind: "stream-claim", streamId: 7n, withdrawable: 9n, asset },
];

function executionPlan(tx: QueuedTx, identity: ActionIdentity): ExecutionPlan {
  const call = {
    target: tx.kind === "pool-claims" ? tx.lending : lending,
    contract: "lending" as const,
    functionName: tx.kind,
    args: [] as const,
    value: 0n,
  };
  const action = {
    type: "claim_share" as const,
    identity,
    preconditions: ["claim-all-row"],
    authorizations: [],
    call,
    touchedResources: [],
    review: {
      actionType: "claim_share" as const,
      title: "CLAIM ALL ROW",
      identity,
      call,
      authorizations: [],
      economics: {},
    },
    receiptSummary: {
      source: call.target,
      eventName: null,
      label: "CLAIMED",
      expectedIds: [],
      expectedAmounts: {},
    },
  } satisfies ReadyAction;
  const accepted: ActionExecutionDraft = { action, request: { address: call.target } };
  return {
    flowId: `claim-all:${tx.kind}`,
    accepted,
    rebuild: vi.fn().mockResolvedValue({ status: "ready", draft: accepted }),
  };
}

function success(plan: ExecutionPlan): ActionExecutionResult {
  return {
    status: "success",
    hash,
    receipt: { transactionHash: hash, status: "success", blockNumber: 100n },
    draft: plan.accepted,
    identity: plan.accepted.action.identity,
  };
}

function setup(initialIdentity: ActionIdentity = { account: userA, chainId: 1 }) {
  let invariant: QueueInvariant = { ready: true };
  const rebuild = vi.fn(async (
    tx: QueuedTx,
    identity: ActionIdentity,
  ): Promise<ClaimAllRowBuild> => ({
    status: "ready" as const,
    plan: executionPlan(tx, identity),
  }));
  const executor = {
    confirm: vi.fn(
      async (plan: ExecutionPlan): Promise<ActionExecutionResult> =>
        success(plan),
    ),
    retryRefresh: vi.fn(
      async (): Promise<ActionExecutionResult | null> => null,
    ),
  };
  const hook = renderHook(
    ({ identity }: { identity: ActionIdentity }) =>
      useTxQueue({
        identity,
        invariants: () => invariant,
        rebuild,
        executor,
      }),
    { initialProps: { identity: initialIdentity } },
  );
  return {
    ...hook,
    rebuild,
    executor,
    setInvariant(next: QueueInvariant) {
      invariant = next;
    },
  };
}

describe("useTxQueue executor orchestration", () => {
  it("rebuilds and delegates one row at a time, advancing only after executor success plus refresh", async () => {
    const { result, rebuild, executor } = setup();
    let releaseFirst!: () => void;
    executor.confirm
      .mockImplementationOnce(
        (plan) =>
          new Promise<ActionExecutionResult>((resolve) => {
            releaseFirst = () => resolve(success(plan));
          }),
      )
      .mockImplementation(async (plan) => success(plan));

    act(() => result.current.start(rows));
    await vi.waitFor(() => expect(executor.confirm).toHaveBeenCalledTimes(1));
    expect(rebuild).toHaveBeenCalledTimes(1);

    await act(async () => releaseFirst());
    await vi.waitFor(() => expect(executor.confirm).toHaveBeenCalledTimes(2));
    expect(rebuild).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.rows.map((row) => row.status)).toEqual(["confirmed", "confirmed"]);
  });

  it.each(["completeness", "agreement", "hydration"] as const)(
    "preserves confirmed rows and pauses before another executor prompt when %s is lost",
    async (reason) => {
      const { result, executor, setInvariant } = setup();
      executor.confirm.mockImplementationOnce(async (plan) => {
        setInvariant({ ready: false, reason });
        return success(plan);
      });

      act(() => result.current.start(rows));

      await vi.waitFor(() => expect(result.current.paused).toBe(true));
      expect(result.current.rows[0]!.status).toBe("confirmed");
      expect(result.current.rows[1]!.status).toBe("paused");
      expect(executor.confirm).toHaveBeenCalledTimes(1);
    },
  );

  it("marks changed grouped rows needs-review and fully disappeared rows skipped without executing them", async () => {
    const changed = setup();
    changed.rebuild.mockResolvedValueOnce({
      status: "needs-review",
      replacement: {
        ...rows[0]!,
        claims: [{ loanId: 1n, claimable: 5n }],
      } as QueuedTx,
    });
    act(() => changed.result.current.start([rows[0]!]));
    await vi.waitFor(() => expect(changed.result.current.rows[0]!.status).toBe("needs-review"));
    expect(changed.executor.confirm).not.toHaveBeenCalled();

    const disappeared = setup();
    disappeared.rebuild.mockResolvedValueOnce({ status: "skipped" });
    act(() => disappeared.result.current.start([rows[0]!, rows[1]!]));
    await vi.waitFor(() => expect(disappeared.result.current.done).toBe(true));
    expect(disappeared.result.current.rows.map((row) => row.status)).toEqual(["skipped", "confirmed"]);
    expect(disappeared.executor.confirm).toHaveBeenCalledTimes(1);
    expect(disappeared.result.current.outcome).toBe("complete_with_skips");
  });

  it("treats a directly revalidated spent or transferred claim as skipped without a wallet prompt", async () => {
    const spent = setup();
    spent.executor.confirm = vi.fn(async (): Promise<ActionExecutionResult> => ({
      status: "invalid",
      errors: [
        {
          code: "nothing-claimable",
          message: "No pool share is currently claimable",
        },
      ],
    }));

    act(() => spent.result.current.start([rows[0]!, rows[1]!]));

    await vi.waitFor(() => expect(spent.result.current.done).toBe(true));
    expect(spent.result.current.rows.map((row) => row.status)).toEqual([
      "skipped",
      "skipped",
    ]);
  });

  it("retries a post-receipt refresh through the executor without confirming or writing the row again", async () => {
    const { result, executor } = setup();
    executor.confirm.mockImplementationOnce(async (plan) => ({
      status: "refresh_failed",
      hash,
      receipt: { transactionHash: hash, status: "success", blockNumber: 100n },
      draft: plan.accepted,
      identity: plan.accepted.action.identity,
      error: new Error("hydration failed"),
    }));
    executor.retryRefresh.mockImplementationOnce(async () => success(executionPlan(rows[0]!, {
      account: userA,
      chainId: 1,
    })));

    act(() => result.current.start(rows));
    await vi.waitFor(() => expect(result.current.rows[0]!.status).toBe("refresh-failed"));

    act(() => result.current.resume(rows.slice(1)));
    await vi.waitFor(() => expect(result.current.done).toBe(true));
    expect(executor.retryRefresh).toHaveBeenCalledTimes(1);
    expect(executor.confirm).toHaveBeenCalledTimes(2);
    expect(result.current.rows[0]!.status).toBe("confirmed");
  });

  it("never repeats confirmed grouped constituents when a fresh resume plan adds work", async () => {
    const { result, executor, rebuild } = setup();
    executor.confirm
      .mockImplementationOnce(async (plan) => success(plan))
      .mockImplementationOnce(async () => ({
        status: "transport_failed",
        error: new Error("RPC unavailable"),
      }))
      .mockImplementation(async (plan) => success(plan));

    act(() => result.current.start(rows));
    await vi.waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.rows[0]!.status).toBe("confirmed");

    const expanded: QueuedTx[] = [
      {
        ...rows[0]!,
        claims: [
          ...(rows[0]!.kind === "pool-claims" ? rows[0]!.claims : []),
          { loanId: 3n, claimable: 11n },
        ],
      } as QueuedTx,
      rows[1]!,
    ];
    act(() => result.current.resume(expanded));

    expect(result.current.needsReview).toBe(true);
    expect(result.current.rows[0]!.status).toBe("confirmed");
    expect(executor.confirm).toHaveBeenCalledTimes(2);

    act(() => result.current.acceptReview(expanded));
    await vi.waitFor(() => expect(result.current.done).toBe(true));
    const rebuiltAfterReview = rebuild.mock.calls.slice(-2).map(([tx]) => tx);
    expect(rebuiltAfterReview).toEqual([
      {
        kind: "pool-claims",
        lending,
        claims: [{ loanId: 3n, claimable: 11n }],
        asset,
      },
      rows[1]!,
    ]);
  });

  it.each([
    [{ account: userB, chainId: 1 }, "account"],
    [{ account: userA, chainId: 10 }, "chain"],
  ] as const)(
    "cannot lose the account/chain guard when identity changes with receipt resolution",
    async (nextIdentity, expectedReason) => {
      const setupResult = setup();
      const { result, executor, rerender } = setupResult;
      let releaseFirst!: () => void;
      executor.confirm.mockImplementationOnce(
        (plan) =>
          new Promise<ActionExecutionResult>((resolve) => {
            releaseFirst = () => resolve(success(plan));
          }),
      );

      act(() => result.current.start(rows));
      await vi.waitFor(() => expect(executor.confirm).toHaveBeenCalledTimes(1));
      act(() => rerender({ identity: nextIdentity }));
      await act(async () => releaseFirst());

      await vi.waitFor(() => expect(result.current.paused).toBe(true));
      expect(result.current.rows[0]!.status).toBe("confirmed");
      expect(result.current.pauseReason).toBe(expectedReason);
      expect(executor.confirm).toHaveBeenCalledTimes(1);
    },
  );
});

describe("useTxQueue graph-step recovery", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  const token = "0x00000000000000000000000000000000000000aa" as Address;
  const depositStep: QueuedTx = {
    kind: "graph-step",
    stepId: "deposit",
    semanticId: "deposit",
    economicIdentity: { kind: "deposit", chainId: 1, token, amount: "10" },
  };
  const borrowStep: QueuedTx = {
    kind: "graph-step",
    stepId: "borrow",
    semanticId: "borrow",
    economicIdentity: { kind: "borrow", chainId: 1, token, amount: "10" },
  };

  it("skips a confirmed deposit and rebuilds borrow only", async () => {
    const { result, rebuild, executor } = setup();
    executor.confirm
      .mockImplementationOnce(async (plan) => success(plan))
      .mockImplementationOnce(async () => ({
        status: "rejected",
        error: new Error("user rejected borrow"),
      }));
    act(() => result.current.start([depositStep, borrowStep]));
    await vi.waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.rows[0]!.status).toBe("confirmed");
    expect(result.current.rows[1]!.status).toBe("failed");
    executor.confirm.mockClear();
    rebuild.mockClear();
    executor.confirm.mockImplementation(async (plan) => success(plan));
    act(() => result.current.resume([depositStep, borrowStep]));
    await vi.waitFor(() => expect(result.current.done).toBe(true));
    expect(rebuild.mock.calls.map(([tx]) => tx)).toEqual([borrowStep]);
    expect(executor.confirm).toHaveBeenCalledTimes(1);
  });

  it("persists unknown and does not advance or re-prompt that step", async () => {
    const { result, executor } = setup();
    executor.confirm.mockImplementationOnce(async () => ({
      status: "unknown",
      hash,
      error: new Error("wait threw"),
    }));
    act(() => result.current.start([depositStep, borrowStep]));
    await vi.waitFor(() => expect(result.current.unknown).toBe(true));
    expect(result.current.rows[0]!.status).toBe("unknown");
    expect(result.current.rows[1]!.status).toBe("pending");
    expect(executor.confirm).toHaveBeenCalledTimes(1);
    act(() => result.current.resume([depositStep, borrowStep]));
    expect(result.current.rows[0]!.status).toBe("unknown");
    expect(executor.confirm).toHaveBeenCalledTimes(1);
  });

  it("persists confirmed receipt evidence when post-receipt refresh fails", async () => {
    const factory = "0x00000000000000000000000000000000000000f1";
    const graph: GraphQueueContext = {
      factory,
      graphId: "g-1",
      economicIdentityOf: (stepId) => ({
        kind: stepId as "deposit",
        chainId: 1,
        token,
        amount: "10",
      }),
    };
    const rebuild = vi.fn(async (
      tx: QueuedTx,
      identity: ActionIdentity,
    ): Promise<ClaimAllRowBuild> => ({
      status: "ready" as const,
      plan: executionPlan(tx, identity),
    }));
    const executor = {
      confirm: vi.fn(async (plan: ExecutionPlan): Promise<ActionExecutionResult> => ({
        status: "refresh_failed",
        hash,
        receipt: { transactionHash: hash, status: "success", blockNumber: 100n },
        draft: plan.accepted,
        identity: plan.accepted.action.identity,
        error: new Error("hydration failed"),
      })),
      retryRefresh: vi.fn(async (): Promise<ActionExecutionResult | null> => null),
    };
    const { result } = renderHook(() =>
      useTxQueue({
        identity: { account: userA, chainId: 1 },
        invariants: () => ({ ready: true }),
        rebuild,
        executor,
        graph,
      }),
    );
    act(() => result.current.start([depositStep]));
    await vi.waitFor(() => expect(result.current.rows[0]!.status).toBe("refresh-failed"));
    expect(
      readStepEvidence({
        factory,
        chainId: 1,
        account: userA,
        graphId: "g-1",
        stepId: "deposit",
      })?.status,
    ).toBe("confirmed");
  });
});
