import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import {
  compileActionGraph,
  GRAPH_STEP_BORROW,
  GRAPH_STEP_DEPOSIT,
  type ActionGraph,
  type EconomicIdentity,
} from "@/lib/action-graph";
import {
  classifyStepOutcome,
  firstUnconfirmedStep,
  positionLabelAllowed,
  reconcilePersistedHash,
  resumeGraph,
  suppressSubmit,
  transferredConfirmedSteps,
} from "@/lib/composite-recovery";
import type { StepEvidence } from "@/lib/step-evidence";

const hash = `0x${"ab".repeat(32)}` as Hash;
const token = "0x00000000000000000000000000000000000000aa";

function graph(graphId: string): ActionGraph {
  const result = compileActionGraph({
    graphId,
    chainId: 1,
    kind: "deposit-plus-borrow",
    token,
    amount: "10",
    allowance: null,
    borrowExecutable: true,
    cs3Available: false,
  });
  if (result.status !== "ready") throw new Error("expected graph");
  return result.graph;
}

function evidence(
  graphId: string,
  stepId: "deposit" | "borrow",
  status: StepEvidence["status"],
  overrides: Partial<StepEvidence> = {},
): StepEvidence {
  const identity: EconomicIdentity = {
    kind: stepId,
    chainId: 1,
    token,
    amount: "10",
  };
  return {
    factory: "0xfactory",
    chainId: 1,
    account: "0xacct",
    graphId,
    stepId,
    status,
    hash,
    receiptStatus: status === "confirmed" ? "success" : status === "failed" ? "reverted" : null,
    confirmations: status === "confirmed" || status === "failed" ? 2 : 0,
    decoded: stepId === "deposit" && status === "confirmed" ? { streamId: "7" } : null,
    economicIdentity: identity,
    graphComplete: false,
    ...overrides,
  };
}

describe("composite resume", () => {
  it("after deposit confirms and borrow is rejected, resume starts at borrow", () => {
    const current = graph("g-new");
    const stored = [evidence("g-new", "deposit", "confirmed")];
    const next = firstUnconfirmedStep(current, stored);
    expect(next?.step.stepId).toBe(GRAPH_STEP_BORROW);
    expect(next?.step.stepId).not.toBe(GRAPH_STEP_DEPOSIT);
    const decision = resumeGraph({ graph: current, stored });
    expect(decision.status).toBe("resume");
    if (decision.status !== "resume") throw new Error("expected resume");
    expect(decision.step.stepId).toBe(GRAPH_STEP_BORROW);
  });

  it("a confirmed step plus a pending-input change blocks only the pending step", () => {
    const current = graph("g-new");
    const stored = [evidence("g-new", "deposit", "confirmed")];
    const decision = resumeGraph({
      graph: current,
      stored,
      pendingChange: "liquidity",
    });
    expect(decision.status).toBe("blocked");
    if (decision.status !== "blocked") throw new Error("expected block");
    expect(decision.step.stepId).toBe(GRAPH_STEP_BORROW);
    expect(decision.reason).toBe("liquidity");
  });

  it("transfer-with-reallocation keys resume on the new graph ID and transfers confirmed deposit", () => {
    const prior = graph("g-old");
    const next = graph("g-new");
    expect(next.graphId).not.toBe(prior.graphId);
    const stored = [evidence("g-old", "deposit", "confirmed")];
    const transferred = transferredConfirmedSteps(next, stored);
    expect(transferred.has(GRAPH_STEP_DEPOSIT)).toBe(true);
    expect(transferred.has(GRAPH_STEP_BORROW)).toBe(false);
    const resume = firstUnconfirmedStep(next, stored);
    expect(resume?.step.stepId).toBe(GRAPH_STEP_BORROW);
    expect(stored[0]!.graphId).toBe("g-old");
  });

  it("does not transfer confirmed deposit from a completed prior graph", () => {
    const next = graph("g-new");
    const stored = [evidence("g-old", "deposit", "confirmed", { graphComplete: true })];
    const transferred = transferredConfirmedSteps(next, stored);
    expect(transferred.has(GRAPH_STEP_DEPOSIT)).toBe(false);
    const resume = firstUnconfirmedStep(next, stored);
    expect(resume?.step.stepId).toBe(GRAPH_STEP_DEPOSIT);
  });

  it("does not treat a same-graph confirmed step as done when the amount changed", () => {
    const current = graph("g-1");
    const stored = [
      evidence("g-1", "deposit", "confirmed", {
        economicIdentity: { kind: "deposit", chainId: 1, token, amount: "5" },
      }),
    ];
    const resume = firstUnconfirmedStep(current, stored);
    expect(resume?.step.stepId).toBe(GRAPH_STEP_DEPOSIT);
  });

  it("treats a graph as complete when only the last row is flagged complete", () => {
    const next = graph("g-new");
    const stored = [
      evidence("g-old", "deposit", "confirmed", { graphComplete: false }),
      evidence("g-old", "borrow", "confirmed", { graphComplete: true }),
    ];
    const transferred = transferredConfirmedSteps(next, stored);
    expect(transferred.has(GRAPH_STEP_DEPOSIT)).toBe(false);
    expect(transferred.has(GRAPH_STEP_BORROW)).toBe(false);
    const resume = firstUnconfirmedStep(next, stored);
    expect(resume?.step.stepId).toBe(GRAPH_STEP_DEPOSIT);
  });
});

describe("finality and unknown outcome", () => {
  it("treats first-mined as pending and a failed confirmed receipt as not complete", () => {
    expect(
      classifyStepOutcome({ hash, receiptStatus: "success", confirmations: 1 }),
    ).toBe("pending");
    expect(
      classifyStepOutcome({ hash, receiptStatus: "reverted", confirmations: 2 }),
    ).toBe("recoverable");
    expect(
      classifyStepOutcome({ hash, receiptStatus: "success", confirmations: 2 }),
    ).toBe("confirmed");
    expect(positionLabelAllowed({ outcome: "pending", authoritativeMatch: true })).toBe(false);
    expect(positionLabelAllowed({ outcome: "confirmed", authoritativeMatch: false })).toBe(false);
    expect(positionLabelAllowed({ outcome: "confirmed", authoritativeMatch: true })).toBe(true);
  });

  it("keeps a persisted hash with no receipt as unknown and suppresses submit", () => {
    const current = graph("g-new");
    const stored = [evidence("g-new", "deposit", "unknown", { receiptStatus: null, confirmations: 0 })];
    const decision = resumeGraph({ graph: current, stored });
    expect(decision.status).toBe("unknown");
    expect(suppressSubmit(decision)).toBe(true);
  });

  it("reconciles a persisted hash without resubmitting", async () => {
    const unknown = await reconcilePersistedHash({
      hash,
      getReceipt: async () => null,
    });
    expect(unknown).toBe("unknown");
    const confirmed = await reconcilePersistedHash({
      hash,
      getReceipt: async () => ({ status: "success", confirmations: 2 }),
    });
    expect(confirmed).toBe("confirmed");
    const recoverable = await reconcilePersistedHash({
      hash,
      getReceipt: async () => ({ status: "reverted", confirmations: 2 }),
    });
    expect(recoverable).toBe("recoverable");
  });
});
