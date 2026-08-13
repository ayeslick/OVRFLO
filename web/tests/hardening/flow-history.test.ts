import { describe, expect, it } from "vitest";
import {
  parseFlowDecision,
  previousDecision,
  revalidateDecision,
  serializeFlowDecision,
  writeFlowDecisionSearch,
} from "@/lib/flow-history";

describe("flow decision history", () => {
  it("maps checkpoint tokens to review so they are never enterable from history", () => {
    expect(parseFlowDecision("sign")).toBe("review");
    expect(parseFlowDecision("pending")).toBe("review");
    expect(parseFlowDecision("confirmed")).toBe("review");
    expect(parseFlowDecision("approve")).toBe("review");
    expect(parseFlowDecision("acknowledge")).toBe("review");
  });

  it("round-trips decision stages and preserves sibling search params", () => {
    expect(serializeFlowDecision("select")).toBeNull();
    expect(serializeFlowDecision("amount-rate")).toBe("amount");
    expect(parseFlowDecision("amount")).toBe("amount-rate");
    expect(writeFlowDecisionSearch("?stream=12", "amount-rate")).toBe("?stream=12&step=amount");
    expect(writeFlowDecisionSearch("?step=review&stream=12", "select")).toBe("?stream=12");
  });

  it("moves Back one decision and drops review without a frozen snapshot", () => {
    expect(previousDecision("review")).toBe("amount-rate");
    expect(previousDecision("amount-rate")).toBe("select");
    expect(previousDecision("select")).toBeNull();
    expect(revalidateDecision("review", false, true)).toBe("amount-rate");
    expect(revalidateDecision("review", true, true)).toBe("review");
    expect(revalidateDecision("amount-rate", false, false)).toBe("select");
  });
});
