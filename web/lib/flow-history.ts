/**
 * Decision stages belong in history. Transaction checkpoints revalidate to
 * review and are never enterable from a stale URL or popstate.
 */

import {
  CREATE_STAGES,
  firstRequiredOrBlockingStage,
  previousVisibleStage,
  stageVisibility,
  type CreateChoices,
  type CreateStage,
  type CreateStageContext,
} from "./create-stages";

export const FLOW_DECISIONS = CREATE_STAGES;
export type FlowDecision = CreateStage;

export const FLOW_CHECKPOINTS = [
  "acknowledge",
  "approve",
  "sign",
  "pending",
  "confirmed",
] as const;
export type FlowCheckpoint = (typeof FLOW_CHECKPOINTS)[number];

const CHECKPOINT_SET = new Set<string>(FLOW_CHECKPOINTS);
const DECISION_SET = new Set<string>(FLOW_DECISIONS);

export function isFlowCheckpoint(value: string | null | undefined): value is FlowCheckpoint {
  return typeof value === "string" && CHECKPOINT_SET.has(value);
}

export function isFlowDecision(value: string | null | undefined): value is FlowDecision {
  return typeof value === "string" && DECISION_SET.has(value);
}

/**
 * Map a URL / history token onto a decision. Checkpoint names are never
 * enterable: they fall back to review.
 */
export function parseFlowDecision(raw: string | null | undefined): FlowDecision {
  if (raw === "amount-rate") return "amount";
  if (raw === "select" || raw === "market" || raw === "stream") return "source";
  if (raw && DECISION_SET.has(raw)) return raw as FlowDecision;
  if (isFlowCheckpoint(raw)) return "review";
  return "source";
}

export function serializeFlowDecision(decision: FlowDecision): string {
  return decision;
}

export function previousDecision(
  decision: FlowDecision,
  context?: CreateStageContext,
  choices?: CreateChoices,
): FlowDecision | null {
  if (!context || !choices) {
    const index = FLOW_DECISIONS.indexOf(decision);
    return index > 0 ? FLOW_DECISIONS[index - 1]! : null;
  }
  return previousVisibleStage(decision, stageVisibility(context, choices));
}

/**
 * Review requires a frozen snapshot. A named checkpoint cannot stay in the URL.
 * Hidden or unsatisfied stages fall back to the first required or blocking stage.
 */
export function revalidateDecision(
  decision: FlowDecision,
  hasFrozenSnapshot: boolean,
  context: CreateStageContext,
  choices: CreateChoices,
): FlowDecision {
  const required = firstRequiredOrBlockingStage(context, choices);
  if (decision === "review") {
    return hasFrozenSnapshot ? "review" : required;
  }
  const visibility = stageVisibility(context, choices);
  if (visibility[decision] === "hidden") return required;
  if (visibility[decision] === "block") return decision;
  const order = FLOW_DECISIONS.indexOf(decision);
  const gate = FLOW_DECISIONS.indexOf(required);
  if (order > gate) return required;
  return decision;
}

export function writeFlowDecisionSearch(
  search: string,
  decision: FlowDecision,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("step", serializeFlowDecision(decision));
  const query = params.toString();
  return query ? `?${query}` : "";
}
