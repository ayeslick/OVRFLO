import { describe, expect, it } from "vitest";
import { acceptCreateAttempt, compileCreateIntent, createIntentsMatch, intentHasForbiddenFields } from "@/lib/create-intent";
import { emptyChoices, type CreateStageContext } from "@/lib/create-stages";

const loanContext: CreateStageContext = {
  positionType: "loan",
  sources: [{ id: "stream-1", kind: "existing-stream", amountFixed: true }],
  underlyings: [{ id: "wsteth" }],
  terms: [{ id: "2027-03" }],
  outcomes: [{ id: "500" }],
};

const fixedContext: CreateStageContext = {
  positionType: "fixed",
  sources: [{ id: "wallet", kind: "fresh", amountFixed: false }],
  underlyings: [{ id: "wsteth" }],
  terms: [{ id: "2027-03" }],
  outcomes: [{ id: "500" }, { id: "800" }],
};

describe("create intent compiler", () => {
  it("compiles the same borrow intent from Default and Advanced", () => {
    const choices = { ...emptyChoices(), sourceId: "stream-1", outcomeId: "500" };
    const args = {
      positionType: "loan" as const,
      context: loanContext,
      choices,
      streamId: 44n,
      amount: "12.5",
      aprBps: 500,
    };
    const def = compileCreateIntent({ ...args, disclosure: "default" });
    const adv = compileCreateIntent({ ...args, disclosure: "advanced" });
    expect(def).toEqual({ type: "borrow", amount: "12.5", streamId: 44n });
    expect(createIntentsMatch(def, adv)).toBe(true);
    expect(intentHasForbiddenFields(def)).toBe(false);
  });

  it("compiles Fixed Return as ovrfloToken supply at the selected APR tick", () => {
    const choices = {
      ...emptyChoices(),
      sourceId: "wallet",
      amount: "5",
      outcomeId: "800",
    };
    const def = compileCreateIntent({
      positionType: "fixed",
      disclosure: "default",
      context: fixedContext,
      choices,
      amount: "5",
      aprBps: 800,
    });
    const adv = compileCreateIntent({
      positionType: "fixed",
      disclosure: "advanced",
      context: fixedContext,
      choices,
      amount: "5",
      aprBps: 800,
    });
    expect(def).toEqual({ type: "supply", amount: "5", aprBps: 800 });
    expect(createIntentsMatch(def, adv)).toBe(true);
  });

  it("allocates a new graph ID when the user accepts an attempt", () => {
    const first = acceptCreateAttempt(
      {
        positionType: "fixed",
        disclosure: "default",
        context: fixedContext,
        choices: { ...emptyChoices(), amount: "5", outcomeId: "500" },
        amount: "5",
        aprBps: 500,
      },
      () => "graph-a",
    );
    const second = acceptCreateAttempt(
      {
        positionType: "fixed",
        disclosure: "default",
        context: fixedContext,
        choices: { ...emptyChoices(), amount: "5", outcomeId: "500" },
        amount: "5",
        aprBps: 500,
      },
      () => "graph-b",
    );
    expect(first.graphId).toBe("graph-a");
    expect(second.graphId).toBe("graph-b");
    expect(first.intent).toEqual(second.intent);
  });

  it("keeps the token-native amount when USD display mode stays off the intent", () => {
    const intent = compileCreateIntent({
      positionType: "loan",
      disclosure: "default",
      context: loanContext,
      choices: { ...emptyChoices(), sourceId: "stream-1", outcomeId: "500" },
      streamId: 44n,
      amount: "12.5",
      aprBps: 500,
    });
    expect(intent).toEqual({ type: "borrow", amount: "12.5", streamId: 44n });
    expect(intentHasForbiddenFields({ ...intent, usdMode: "usd" } as never)).toBe(true);
  });
});
