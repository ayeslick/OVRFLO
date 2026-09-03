/**
 * KD16 create-stage grammar. REVIEW always appears.
 * Zero valid options block. They never hide.
 */

export const CREATE_STAGES = [
  "source",
  "underlying",
  "amount",
  "term",
  "outcome",
  "review",
] as const;

export type CreateStage = (typeof CREATE_STAGES)[number];

export type StageMode = "hidden" | "choose" | "block";

export type CreatePositionType = "loan" | "fixed";

export type CreateSourceKind = "existing-stream" | "fresh";

export type CreateSourceOption = {
  id: string;
  kind: CreateSourceKind;
  amountFixed: boolean;
};

export type CreateChoiceOption = {
  id: string;
};

export type CreateChoices = {
  sourceId: string | null;
  underlyingId: string | null;
  amount: string | null;
  termId: string | null;
  outcomeId: string | null;
};

export type CreateStageContext = {
  positionType: CreatePositionType;
  sources: readonly CreateSourceOption[];
  underlyings: readonly CreateChoiceOption[];
  terms: readonly CreateChoiceOption[];
  outcomes: readonly CreateChoiceOption[];
};

export type StageVisibility = Record<CreateStage, StageMode>;

export const LOAN_OUTCOME_FIXED_RETURN = "fixed-return";

const DECISION_STAGES = ["source", "underlying", "amount", "term", "outcome"] as const;

export function emptyChoices(): CreateChoices {
  return {
    sourceId: null,
    underlyingId: null,
    amount: null,
    termId: null,
    outcomeId: null,
  };
}

export function selectedSource(
  context: CreateStageContext,
  choices: CreateChoices,
): CreateSourceOption | undefined {
  return context.sources.find((row) => row.id === choices.sourceId);
}

export function stageVisibility(context: CreateStageContext, choices: CreateChoices): StageVisibility {
  const sourceMode = optionMode(context.sources.length);
  const underlyingMode = optionMode(context.underlyings.length);
  const source = selectedSource(context, choices);
  const amountFixed = source?.amountFixed === true;
  const amountMode: StageMode = amountFixed ? "hidden" : "choose";
  const termMode = optionMode(context.terms.length);
  const outcomeMode = optionMode(context.outcomes.length);
  return {
    source: sourceMode,
    underlying: underlyingMode,
    amount: amountMode,
    term: termMode,
    outcome: outcomeMode,
    review: "choose",
  };
}

function optionMode(count: number): StageMode {
  if (count === 0) return "block";
  if (count === 1) return "hidden";
  return "choose";
}

export function autoFillChoices(context: CreateStageContext, choices: CreateChoices): CreateChoices {
  const next = { ...choices };
  if (context.sources.length === 1 && next.sourceId === null) {
    next.sourceId = context.sources[0]!.id;
  }
  if (context.underlyings.length === 1 && next.underlyingId === null) {
    next.underlyingId = context.underlyings[0]!.id;
  }
  if (context.terms.length === 1 && next.termId === null) {
    next.termId = context.terms[0]!.id;
  }
  if (context.outcomes.length === 1 && next.outcomeId === null) {
    next.outcomeId = context.outcomes[0]!.id;
  }
  const source = selectedSource(context, next);
  if (source?.amountFixed) next.amount = "fixed";
  return next;
}

export function stageSatisfied(
  stage: CreateStage,
  visibility: StageVisibility,
  choices: CreateChoices,
): boolean {
  const mode = visibility[stage];
  if (stage === "review") return true;
  if (mode === "block") return false;
  if (mode === "hidden") return true;
  if (stage === "source") return choices.sourceId !== null;
  if (stage === "underlying") return choices.underlyingId !== null;
  if (stage === "amount") return Boolean(choices.amount && choices.amount.trim() !== "");
  if (stage === "term") return choices.termId !== null;
  return choices.outcomeId !== null;
}

export function firstRequiredOrBlockingStage(
  context: CreateStageContext,
  choices: CreateChoices,
): CreateStage {
  const filled = autoFillChoices(context, choices);
  const visibility = stageVisibility(context, filled);
  for (const stage of DECISION_STAGES) {
    if (visibility[stage] === "block") return stage;
    if (visibility[stage] === "choose" && !stageSatisfied(stage, visibility, filled)) {
      return stage;
    }
  }
  return "review";
}

export function visibleDecisionStages(
  visibility: StageVisibility,
): Exclude<CreateStage, "review">[] {
  return DECISION_STAGES.filter((stage) => visibility[stage] !== "hidden");
}

export function previousVisibleStage(
  current: CreateStage,
  visibility: StageVisibility,
): CreateStage | null {
  const visible = [...visibleDecisionStages(visibility), "review" as const].filter(
    (stage) => visibility[stage] !== "hidden",
  );
  const index = visible.indexOf(current);
  if (index <= 0) return null;
  return visible[index - 1] ?? null;
}

export type UpstreamField = "sourceId" | "underlyingId" | "termId" | "outcomeId";

const DEPENDENTS: Record<UpstreamField, readonly (keyof CreateChoices)[]> = {
  sourceId: ["underlyingId", "amount", "termId", "outcomeId"],
  underlyingId: ["amount", "termId", "outcomeId"],
  termId: ["outcomeId"],
  outcomeId: [],
};

export function applyUpstreamChange(
  context: CreateStageContext,
  choices: CreateChoices,
  field: UpstreamField,
  value: string | null,
): { choices: CreateChoices; stage: CreateStage } {
  const next: CreateChoices = { ...choices, [field]: value };
  for (const dependent of DEPENDENTS[field]) {
    const current = next[dependent];
    if (current === null) continue;
    if (!dependentStillValid(context, next, dependent, current)) {
      next[dependent] = null;
    }
  }
  const filled = autoFillChoices(context, next);
  return {
    choices: filled,
    stage: firstRequiredOrBlockingStage(context, filled),
  };
}

function dependentStillValid(
  context: CreateStageContext,
  choices: CreateChoices,
  field: keyof CreateChoices,
  value: string,
): boolean {
  if (field === "underlyingId") {
    return context.underlyings.some((row) => row.id === value);
  }
  if (field === "termId") {
    return context.terms.some((row) => row.id === value);
  }
  if (field === "outcomeId") {
    return context.outcomes.some((row) => row.id === value);
  }
  if (field === "amount") {
    const source = selectedSource(context, choices);
    if (source?.amountFixed) return value === "fixed";
    return value.trim() !== "";
  }
  if (field === "sourceId") {
    return context.sources.some((row) => row.id === value);
  }
  return false;
}

export function blockingCopy(
  stage: CreateStage,
  visibility: StageVisibility,
): string | null {
  if (visibility[stage] !== "block") return null;
  if (stage === "source") return "No valid source";
  if (stage === "underlying") return "No supported underlying";
  if (stage === "term") return "No valid term";
  if (stage === "outcome") return "No valid outcome";
  return null;
}

export function loanOutcomesRejectFixedReturn(
  outcomes: readonly CreateChoiceOption[],
): boolean {
  return outcomes.every((row) => row.id !== LOAN_OUTCOME_FIXED_RETURN);
}
