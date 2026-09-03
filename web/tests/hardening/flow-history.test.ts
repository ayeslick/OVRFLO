import { describe, expect, it } from "vitest";
import {
  parseFlowDecision,
  previousDecision,
  revalidateDecision,
  serializeFlowDecision,
  writeFlowDecisionSearch,
} from "@/lib/flow-history";
import { emptyChoices, type CreateStageContext } from "@/lib/create-stages";

const context: CreateStageContext = {
  positionType: "loan",
  sources: [{ id: "stream-1", kind: "existing-stream", amountFixed: true }],
  underlyings: [{ id: "wsteth" }],
  terms: [{ id: "2027-03" }],
  outcomes: [{ id: "500" }, { id: "800" }],
};

describe("flow decision history", () => {
  it("maps checkpoint tokens to review so they are never enterable from history", () => {
    expect(parseFlowDecision("sign")).toBe("review");
    expect(parseFlowDecision("pending")).toBe("review");
    expect(parseFlowDecision("confirmed")).toBe("review");
    expect(parseFlowDecision("approve")).toBe("review");
    expect(parseFlowDecision("acknowledge")).toBe("review");
    expect(writeFlowDecisionSearch("?step=sign", "review")).toBe("?step=review");
  });

  it("round-trips decision stages and preserves sibling search params", () => {
    expect(serializeFlowDecision("source")).toBe("source");
    expect(serializeFlowDecision("amount")).toBe("amount");
    expect(parseFlowDecision("amount-rate")).toBe("amount");
    expect(parseFlowDecision("amount")).toBe("amount");
    expect(writeFlowDecisionSearch("?stream=12", "amount")).toBe("?stream=12&step=amount");
    const cleared = writeFlowDecisionSearch("?step=review&stream=12", "source");
    expect(new URLSearchParams(cleared).get("step")).toBe("source");
    expect(new URLSearchParams(cleared).get("stream")).toBe("12");
  });

  it("moves Back one visible decision and drops review without a frozen snapshot", () => {
    const filled = {
      sourceId: "stream-1",
      underlyingId: "wsteth",
      amount: "fixed",
      termId: "2027-03",
      outcomeId: "500",
    };
    expect(previousDecision("review", context, filled)).toBe("outcome");
    expect(previousDecision("outcome", context, filled)).toBeNull();
    expect(revalidateDecision("review", false, context, emptyChoices())).toBe("outcome");
    expect(revalidateDecision("review", true, context, filled)).toBe("review");
    expect(revalidateDecision("amount", false, context, filled)).toBe("review");
  });
});
