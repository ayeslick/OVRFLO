import { describe, expect, it } from "vitest";
import {
  compileActionGraph,
  GRAPH_STEP_BORROW,
  GRAPH_STEP_CLEAR_TO_ZERO,
  GRAPH_STEP_DEPOSIT,
  GRAPH_STEP_POST,
  GRAPH_STEP_SET_ALLOWANCE,
  immediateTotal,
  sameEconomicIdentity,
} from "@/lib/action-graph";

const token = "0x00000000000000000000000000000000000000aa";
const spender = "0x00000000000000000000000000000000000000bb";

describe("action graph compile", () => {
  it("gives clear-to-zero and set-allowance distinct stable step IDs", () => {
    const result = compileActionGraph({
      graphId: "g1",
      chainId: 1,
      kind: "deposit-plus-borrow",
      token,
      amount: "10",
      allowance: { token, spender, current: 3n, required: 10n },
      borrowExecutable: true,
      cs3Available: false,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected graph");
    const ids = result.graph.steps.map((step) => step.stepId);
    expect(ids).toEqual([
      GRAPH_STEP_CLEAR_TO_ZERO,
      GRAPH_STEP_SET_ALLOWANCE,
      GRAPH_STEP_DEPOSIT,
      GRAPH_STEP_BORROW,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    const clear = result.graph.steps[0]!;
    const set = result.graph.steps[1]!;
    expect(set.dependsOn).toEqual([GRAPH_STEP_CLEAR_TO_ZERO]);
    expect(sameEconomicIdentity(clear.economicIdentity, set.economicIdentity)).toBe(false);
  });

  it("blocks no-liquidity deposit-plus-borrow before deposit when CS3 is absent", () => {
    const result = compileActionGraph({
      graphId: "g2",
      chainId: 1,
      kind: "deposit-plus-borrow",
      token,
      amount: "10",
      allowance: null,
      borrowExecutable: false,
      cs3Available: false,
    });
    expect(result).toEqual({ status: "blocked", reason: "no-liquidity-without-cs3" });
  });

  it("compiles deposit-plus-borrow when immediate borrow is executable", () => {
    const result = compileActionGraph({
      graphId: "g3",
      chainId: 1,
      kind: "deposit-plus-borrow",
      token,
      amount: "10",
      allowance: null,
      borrowExecutable: true,
      cs3Available: false,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected graph");
    expect(result.graph.graphId).toBe("g3");
    expect(result.graph.steps.map((step) => step.stepId)).toEqual([GRAPH_STEP_DEPOSIT, GRAPH_STEP_BORROW]);
    expect(result.graph.steps[1]!.dependsOn).toEqual([GRAPH_STEP_DEPOSIT]);
  });

  it("emits a post step when CS3 is live and borrow is not executable", () => {
    const result = compileActionGraph({
      graphId: "g4",
      chainId: 1,
      kind: "borrow",
      token,
      amount: "10",
      allowance: null,
      borrowExecutable: false,
      cs3Available: true,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected graph");
    expect(result.graph.steps.map((step) => step.stepId)).toEqual([GRAPH_STEP_POST]);
  });

  it("emits deposit then post when CS3 continues a no-liquidity composition", () => {
    const result = compileActionGraph({
      graphId: "g5",
      chainId: 1,
      kind: "deposit-plus-borrow",
      token,
      amount: "10",
      allowance: null,
      borrowExecutable: false,
      cs3Available: true,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected graph");
    expect(result.graph.steps.map((step) => step.stepId)).toEqual([
      GRAPH_STEP_DEPOSIT,
      GRAPH_STEP_POST,
    ]);
  });

  it("hides immediate total when borrow is not executable", () => {
    expect(
      immediateTotal({ depositNet: 8n, borrowNet: 5n, borrowExecutable: false }),
    ).toBeNull();
    expect(
      immediateTotal({ depositNet: 8n, borrowNet: 5n, borrowExecutable: true }),
    ).toBe(13n);
  });
});
