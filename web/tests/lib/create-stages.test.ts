import { describe, expect, it } from "vitest";
import {
  LOAN_OUTCOME_FIXED_RETURN,
  applyUpstreamChange,
  autoFillChoices,
  blockingCopy,
  emptyChoices,
  firstRequiredOrBlockingStage,
  loanOutcomesRejectFixedReturn,
  previousVisibleStage,
  stageVisibility,
  type CreateStageContext,
} from "@/lib/create-stages";

function loanContext(overrides: Partial<CreateStageContext> = {}): CreateStageContext {
  return {
    positionType: "loan",
    sources: [
      { id: "stream-1", kind: "existing-stream", amountFixed: true },
      { id: "fresh", kind: "fresh", amountFixed: false },
    ],
    underlyings: [{ id: "wsteth" }],
    terms: [{ id: "2027-03" }],
    outcomes: [{ id: "500" }, { id: "800" }],
    ...overrides,
  };
}

describe("create stage grammar", () => {
  it("hides TERM for one valid term and shows it for many", () => {
    const one = stageVisibility(loanContext(), emptyChoices());
    expect(one.term).toBe("hidden");
    const many = stageVisibility(loanContext({ terms: [{ id: "a" }, { id: "b" }] }), emptyChoices());
    expect(many.term).toBe("choose");
  });

  it("hides OUTCOME for one valid outcome and shows it for many", () => {
    const one = stageVisibility(loanContext({ outcomes: [{ id: "500" }] }), emptyChoices());
    expect(one.outcome).toBe("hidden");
    const many = stageVisibility(loanContext(), emptyChoices());
    expect(many.outcome).toBe("choose");
  });

  it("skips AMOUNT when the selected source fixes it", () => {
    const context = loanContext({
      sources: [{ id: "stream-1", kind: "existing-stream", amountFixed: true }],
    });
    const filled = autoFillChoices(context, emptyChoices());
    expect(stageVisibility(context, filled).amount).toBe("hidden");
    expect(filled.amount).toBe("fixed");
  });

  it("shows AMOUNT for fresh capital with a selectable value", () => {
    const context = loanContext({
      sources: [{ id: "fresh", kind: "fresh", amountFixed: false }],
    });
    const filled = autoFillChoices(context, emptyChoices());
    expect(stageVisibility(context, filled).amount).toBe("choose");
  });

  it("opens REVIEW when every prior stage is fixed", () => {
    const context = loanContext({
      sources: [{ id: "stream-1", kind: "existing-stream", amountFixed: true }],
      outcomes: [{ id: "500" }],
    });
    expect(firstRequiredOrBlockingStage(context, emptyChoices())).toBe("review");
  });

  it("blocks with named copy when an option set is empty", () => {
    const none = loanContext({ sources: [], underlyings: [], terms: [], outcomes: [] });
    const visibility = stageVisibility(none, emptyChoices());
    expect(visibility.source).toBe("block");
    expect(visibility.underlying).toBe("block");
    expect(visibility.term).toBe("block");
    expect(visibility.outcome).toBe("block");
    expect(blockingCopy("source", visibility)).toBe("No valid source");
    expect(blockingCopy("underlying", visibility)).toBe("No supported underlying");
    expect(blockingCopy("term", visibility)).toBe("No valid term");
    expect(blockingCopy("outcome", visibility)).toBe("No valid outcome");
    expect(firstRequiredOrBlockingStage(none, emptyChoices())).toBe("source");
    const afterSource = loanContext({ underlyings: [], terms: [], outcomes: [] });
    expect(
      firstRequiredOrBlockingStage(afterSource, { ...emptyChoices(), sourceId: "stream-1" }),
    ).toBe("underlying");
  });

  it("keeps only still-valid dependents after an upstream change", () => {
    const context = loanContext({
      underlyings: [{ id: "wsteth" }, { id: "reth" }],
      terms: [{ id: "2027-03" }],
      outcomes: [{ id: "500" }],
    });
    const started = autoFillChoices(context, {
      sourceId: "stream-1",
      underlyingId: "wsteth",
      amount: "fixed",
      termId: "2027-03",
      outcomeId: "500",
    });
    const nextContext: CreateStageContext = {
      ...context,
      terms: [{ id: "2028-01" }],
      outcomes: [{ id: "900" }],
    };
    const changed = applyUpstreamChange(nextContext, started, "underlyingId", "reth");
    expect(changed.choices.termId).toBe("2028-01");
    expect(changed.choices.outcomeId).toBe("900");
    expect(changed.stage).toBe("review");
  });

  it("moves to the first newly required stage when dependents clear", () => {
    const context = loanContext({
      underlyings: [{ id: "wsteth" }, { id: "reth" }],
      terms: [{ id: "a" }, { id: "b" }],
      outcomes: [{ id: "500" }, { id: "800" }],
    });
    const started = {
      sourceId: "stream-1",
      underlyingId: "wsteth",
      amount: "fixed",
      termId: "a",
      outcomeId: "500",
    };
    const nextContext: CreateStageContext = {
      ...context,
      terms: [{ id: "c" }, { id: "d" }],
      outcomes: [{ id: "900" }, { id: "1100" }],
    };
    const changed = applyUpstreamChange(nextContext, started, "underlyingId", "reth");
    expect(changed.choices.termId).toBeNull();
    expect(changed.choices.outcomeId).toBeNull();
    expect(changed.stage).toBe("term");
  });

  it("never lists Fixed Return as a loan outcome", () => {
    const outcomes = [{ id: "500" }, { id: "800" }];
    expect(loanOutcomesRejectFixedReturn(outcomes)).toBe(true);
    expect(loanOutcomesRejectFixedReturn([...outcomes, { id: LOAN_OUTCOME_FIXED_RETURN }])).toBe(
      false,
    );
  });

  it("walks Back across visible stages only", () => {
    const context = loanContext();
    const filled = autoFillChoices(context, { ...emptyChoices(), sourceId: "stream-1" });
    const visibility = stageVisibility(context, filled);
    expect(previousVisibleStage("review", visibility)).toBe("outcome");
    expect(previousVisibleStage("outcome", visibility)).toBe("source");
    expect(previousVisibleStage("source", visibility)).toBeNull();
  });
});
