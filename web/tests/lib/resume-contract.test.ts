import { afterEach, describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { compileActionGraph } from "@/lib/action-graph";
import {
  applyResumeContract,
  autoConfirmLatchedPlan,
  globalResetCopy,
  keepAttemptOnModalClose,
  reconcileUnknownSteps,
  resumeMayPrompt,
  routeResetCopy,
} from "@/lib/resume-contract";
import {
  persistPendingHash,
  readStepEvidence,
  writeCurrentAttempt,
  writeStepEvidence,
} from "@/lib/step-evidence";

const factory = "0x00000000000000000000000000000000000000f1";
const account = "0x00000000000000000000000000000000000000a1";
const token = "0x00000000000000000000000000000000000000aa";
const hash = `0x${"11".repeat(32)}` as Hash;

afterEach(() => {
  window.localStorage.clear();
});

function readyGraph(graphId: string) {
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

describe("resume contract", () => {
  it("route reset, modal remount, and unmount converge on resume without replay", () => {
    const graph = readyGraph("g-1");
    writeStepEvidence({
      factory,
      chainId: 1,
      account,
      graphId: "g-1",
      stepId: "deposit",
      status: "confirmed",
      hash,
      receiptStatus: "success",
      confirmations: 2,
      decoded: { streamId: "9" },
      economicIdentity: { kind: "deposit", chainId: 1, token, amount: "10" },
      graphComplete: false,
    });
    for (const source of ["route-reset", "modal-try-again", "flow-unmount"] as const) {
      const decision = applyResumeContract({
        graph,
        factory,
        chainId: 1,
        account,
        source,
      });
      expect(decision.status).toBe("resume");
      if (decision.status !== "resume") throw new Error("expected resume");
      expect(decision.step.stepId).toBe("borrow");
      expect(resumeMayPrompt(decision)).toBe(true);
    }
  });

  it("does not claim no transaction was submitted when a hash is persisted", () => {
    persistPendingHash(
      { factory, chainId: 1, account, graphId: "g-1", stepId: "deposit" },
      hash,
      { kind: "deposit", chainId: 1, token, amount: "10" },
    );
    expect(routeResetCopy()).not.toMatch(/no transaction was submitted/i);
    expect(globalResetCopy()).not.toMatch(/no transaction was submitted/i);
    expect(routeResetCopy()).toMatch(/already be in progress/i);
  });

  it("keeps the graph ID on modal close and never auto-confirms an unaccepted plan", () => {
    writeCurrentAttempt(factory, 1, account, {
      graphId: "g-keep",
      kind: "deposit-plus-borrow",
      accepted: false,
    });
    expect(
      keepAttemptOnModalClose({
        factory,
        chainId: 1,
        account,
        kind: "deposit-plus-borrow",
      }),
    ).toEqual({ graphId: "g-keep" });
    expect(autoConfirmLatchedPlan(false)).toBe(false);
    expect(autoConfirmLatchedPlan(true)).toBe(true);
  });

  it("reconciles a persisted unknown hash to confirmed before resume", async () => {
    const graph = readyGraph("g-1");
    persistPendingHash(
      { factory, chainId: 1, account, graphId: "g-1", stepId: "deposit" },
      hash,
      { kind: "deposit", chainId: 1, token, amount: "10" },
    );
    await reconcileUnknownSteps({
      factory,
      chainId: 1,
      account,
      graph,
      getReceipt: async () => ({ status: "success", confirmations: 2 }),
    });
    const stored = readStepEvidence({
      factory,
      chainId: 1,
      account,
      graphId: "g-1",
      stepId: "deposit",
    });
    expect(stored?.status).toBe("confirmed");
    const decision = applyResumeContract({
      graph,
      factory,
      chainId: 1,
      account,
      source: "route-reset",
    });
    expect(decision.status).toBe("resume");
    if (decision.status !== "resume") throw new Error("expected resume");
    expect(decision.step.stepId).toBe("borrow");
  });
});
