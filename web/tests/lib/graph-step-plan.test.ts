import { describe, expect, it } from "vitest";
import { compileActionGraph } from "@/lib/action-graph";
import { remainingQueuedTx, reuseOrAllocateGraphId } from "@/lib/graph-step-plan";
import type { StepEvidence } from "@/lib/step-evidence";

const token = "0x00000000000000000000000000000000000000aa";
const hash = `0x${"ab".repeat(32)}` as const;

describe("graph-step remaining plan", () => {
  it("drops a confirmed deposit so resume starts at borrow", () => {
    const compiled = compileActionGraph({
      graphId: "g-1",
      chainId: 1,
      kind: "deposit-plus-borrow",
      token,
      amount: "10",
      allowance: null,
      borrowExecutable: true,
      cs3Available: false,
    });
    if (compiled.status !== "ready") throw new Error("expected graph");
    const stored: StepEvidence[] = [
      {
        factory: "0xfactory",
        chainId: 1,
        account: "0xacct",
        graphId: "g-1",
        stepId: "deposit",
        status: "confirmed",
        hash,
        receiptStatus: "success",
        confirmations: 2,
        decoded: { streamId: "7" },
        economicIdentity: { kind: "deposit", chainId: 1, token, amount: "10" },
        graphComplete: false,
      },
    ];
    const remaining = remainingQueuedTx(compiled.graph, stored);
    expect(remaining.map((tx) => tx.stepId)).toEqual(["borrow"]);
  });

  it("reuses an incomplete graph ID and allocates after completion", () => {
    expect(
      reuseOrAllocateGraphId({
        storedGraphId: "g-keep",
        storedKind: "borrow",
        requestedKind: "borrow",
        storedComplete: false,
        sameEconomics: true,
        allocate: () => "g-new",
      }),
    ).toBe("g-keep");
    expect(
      reuseOrAllocateGraphId({
        storedGraphId: "g-done",
        storedKind: "borrow",
        requestedKind: "borrow",
        storedComplete: true,
        sameEconomics: true,
        allocate: () => "g-new",
      }),
    ).toBe("g-new");
  });

  it("allocates a new graph ID when the stored kind does not match", () => {
    expect(
      reuseOrAllocateGraphId({
        storedGraphId: "g-borrow",
        storedKind: "borrow",
        requestedKind: "supply",
        storedComplete: false,
        sameEconomics: true,
        allocate: () => "g-new",
      }),
    ).toBe("g-new");
  });

  it("allocates a new graph ID when the stored economics do not match", () => {
    expect(
      reuseOrAllocateGraphId({
        storedGraphId: "g-old",
        storedKind: "borrow",
        requestedKind: "borrow",
        storedComplete: false,
        sameEconomics: false,
        allocate: () => "g-new",
      }),
    ).toBe("g-new");
  });
});
