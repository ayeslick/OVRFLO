/**
 * Decision stages belong in history. Transaction checkpoints revalidate to
 * review and are never enterable from a stale URL or popstate.
 */

export const FLOW_DECISIONS = ["select", "amount-rate", "review"] as const;
export type FlowDecision = (typeof FLOW_DECISIONS)[number];

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
 * Map a URL / history token onto a decision. Checkpoint names and unknown
 * tokens fall back to review (then the caller drops to amount-rate when no
 * frozen snapshot exists).
 */
export function parseFlowDecision(raw: string | null | undefined): FlowDecision {
  if (raw === "amount" || raw === "amount-rate") return "amount-rate";
  if (raw === "market" || raw === "stream" || raw === "select") return "select";
  if (raw === "review" || isFlowCheckpoint(raw)) return "review";
  return "select";
}

export function serializeFlowDecision(decision: FlowDecision): string | null {
  if (decision === "select") return null;
  if (decision === "amount-rate") return "amount";
  return "review";
}

export function previousDecision(decision: FlowDecision): FlowDecision | null {
  if (decision === "review") return "amount-rate";
  if (decision === "amount-rate") return "select";
  return null;
}

/**
 * Review requires a frozen snapshot. Without one, history that names review
 * (or a checkpoint) falls back to the nearest safe selection.
 */
export function revalidateDecision(
  decision: FlowDecision,
  hasFrozenSnapshot: boolean,
  hasSelection: boolean,
): FlowDecision {
  if (decision === "review" && !hasFrozenSnapshot) {
    return hasSelection ? "amount-rate" : "select";
  }
  if (decision === "amount-rate" && !hasSelection) return "select";
  return decision;
}

export function writeFlowDecisionSearch(
  search: string,
  decision: FlowDecision,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const token = serializeFlowDecision(decision);
  if (token === null) params.delete("step");
  else params.set("step", token);
  const query = params.toString();
  return query ? `?${query}` : "";
}
