import type { ActionIntent, BorrowIntent, SupplyIntent } from "./actions/types";
import type { CreateChoices, CreatePositionType, CreateStageContext } from "./create-stages";
import { autoFillChoices, selectedSource } from "./create-stages";
import type { DisclosureLevel } from "./disclosure";
import { allocateGraphId } from "./graph-id";

export type CreateAttempt = {
  graphId: string;
  intent: ActionIntent;
};

export type CompileCreateArgs = {
  positionType: CreatePositionType;
  disclosure: DisclosureLevel;
  context: CreateStageContext;
  choices: CreateChoices;
  streamId?: bigint;
  aprBps?: number;
  amount?: string;
};

/**
 * Default and Advanced compile the same typed primitive.
 * USD and UI-stage fields stay off the intent.
 */
export function compileCreateIntent(args: CompileCreateArgs): ActionIntent {
  const filled = autoFillChoices(args.context, args.choices);
  const source = selectedSource(args.context, filled);
  if (args.positionType === "fixed") {
    const intent: SupplyIntent = {
      type: "supply",
      amount: args.amount ?? filled.amount ?? "",
      aprBps: args.aprBps ?? Number(filled.outcomeId ?? "NaN"),
    };
    return intent;
  }
  if (source?.kind === "fresh") {
    return {
      type: "deposit",
      amount: args.amount ?? filled.amount ?? "",
    };
  }
  const intent: BorrowIntent = {
    type: "borrow",
    amount: args.amount ?? (source?.amountFixed ? "fixed" : (filled.amount ?? "")),
    streamId: args.streamId ?? 0n,
  };
  return intent;
}

export function acceptCreateAttempt(
  args: CompileCreateArgs,
  allocate = allocateGraphId,
): CreateAttempt {
  return {
    graphId: allocate(),
    intent: compileCreateIntent(args),
  };
}

export function createIntentsMatch(left: ActionIntent, right: ActionIntent): boolean {
  return stableIntent(left) === stableIntent(right);
}

function stableIntent(intent: ActionIntent): string {
  return JSON.stringify(intent, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
}

export function intentHasForbiddenFields(intent: ActionIntent): boolean {
  const keys = Object.keys(intent);
  return keys.some((key) => /usd|stage|step|disclosure|ui/i.test(key));
}
