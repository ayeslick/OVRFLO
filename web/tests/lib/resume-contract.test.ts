import { afterEach, describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { compileActionGraph } from "@/lib/action-graph";
import { resumeGraph } from "@/lib/composite-recovery";
import { globalResetCopy, reconcileUnknownSteps, resumeMayPrompt, routeResetCopy } from "@/lib/resume-contract";
import { persistPendingHash, readStepEvidence, writeStepEvidence } from "@/lib/step-evidence";

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
    const stored = [
      {
        factory,
        chainId: 1,
        account,
        graphId: "g-1",
        stepId: "deposit" as const,
        status: "confirmed" as const,
        hash,
        receiptStatus: "success" as const,
        confirmations: 2,
        decoded: { streamId: "9" },
        economicIdentity: { kind: "deposit" as const, chainId: 1, token, amount: "10" },
        graphComplete: false,
      },
    ];
    const decision = resumeGraph({ graph, stored });
    expect(decision.status).toBe("resume");
    if (decision.status !== "resume") throw new Error("expected resume");
    expect(decision.step.stepId).toBe("borrow");
    expect(resumeMayPrompt(decision)).toBe(true);
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
    const decision = resumeGraph({
      graph,
      stored: stored ? [stored] : [],
    });
    expect(decision.status).toBe("resume");
    if (decision.status !== "resume") throw new Error("expected resume");
    expect(decision.step.stepId).toBe("borrow");
  });
});
