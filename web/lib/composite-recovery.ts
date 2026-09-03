import type { Hash } from "viem";
import {
  sameEconomicIdentity,
  type ActionGraph,
  type ActionGraphStep,
  type GraphSemanticId,
} from "./action-graph";
import { RECEIPT_CONFIRMATIONS } from "./receipts";
import type { StepEvidence, StepEvidenceStatus } from "./step-evidence";

export type StepOutcome = "unknown" | "pending" | "confirmed" | "recoverable";

export type ResumeDecision =
  | { status: "complete" }
  | { status: "unknown"; step: ActionGraphStep; hash: Hash }
  | { status: "resume"; step: ActionGraphStep }
  | { status: "blocked"; step: ActionGraphStep; reason: PendingChange };

export type PendingChange =
  | "account"
  | "chain"
  | "allowance"
  | "liquidity"
  | "deadline"
  | "router";

/**
 * A first-mined receipt stays pending. A confirmed hash with a failed receipt
 * is not complete. Confirmations must equal RECEIPT_CONFIRMATIONS.
 */
export function classifyStepOutcome(args: {
  hash: Hash | null;
  receiptStatus: "success" | "reverted" | null;
  confirmations: number;
}): StepOutcome {
  if (args.hash && args.receiptStatus === null) return "unknown";
  if (!args.hash) return "recoverable";
  if (args.confirmations < RECEIPT_CONFIRMATIONS) return "pending";
  if (args.receiptStatus === "success") return "confirmed";
  return "recoverable";
}

export function evidenceOutcome(evidence: StepEvidence): StepOutcome {
  return classifyStepOutcome({
    hash: evidence.hash,
    receiptStatus: evidence.receiptStatus,
    confirmations: evidence.confirmations,
  });
}

export function stepIsConfirmed(evidence: StepEvidence | null): boolean {
  return evidence !== null && evidenceOutcome(evidence) === "confirmed";
}

export function stepEvidenceMatches(step: ActionGraphStep, evidence: StepEvidence | null): boolean {
  return (
    stepIsConfirmed(evidence) &&
    evidence !== null &&
    sameEconomicIdentity(evidence.economicIdentity, step.economicIdentity)
  );
}

/**
 * Transfer confirmed-step status from an incomplete prior attempt by
 * economic identity. A completed prior graph is audit-only.
 */
export function transferredConfirmedSteps(
  graph: ActionGraph,
  prior: readonly StepEvidence[],
): Set<string> {
  const transferred = new Set<string>();
  const completedGraphs = new Set(
    prior.filter((row) => row.graphComplete).map((row) => row.graphId),
  );
  const incomplete = prior.filter(
    (row) => !completedGraphs.has(row.graphId) && evidenceOutcome(row) === "confirmed",
  );
  for (const step of graph.steps) {
    const match = incomplete.find((row) => sameEconomicIdentity(row.economicIdentity, step.economicIdentity));
    if (match) transferred.add(step.stepId);
  }
  return transferred;
}

export function evidenceForGraph(graph: ActionGraph, stored: readonly StepEvidence[]): Map<string, StepEvidence> {
  const map = new Map<string, StepEvidence>();
  for (const row of stored) {
    if (row.graphId !== graph.graphId) continue;
    map.set(row.stepId, row);
  }
  return map;
}

export function firstUnconfirmedStep(
  graph: ActionGraph,
  stored: readonly StepEvidence[],
): { step: ActionGraphStep; evidence: StepEvidence | null; transferred: boolean } | null {
  const mine = evidenceForGraph(graph, stored);
  const transferred = transferredConfirmedSteps(graph, stored.filter((row) => row.graphId !== graph.graphId));
  for (const step of graph.steps) {
    const evidence = mine.get(step.stepId) ?? null;
    if (stepEvidenceMatches(step, evidence) || transferred.has(step.stepId)) continue;
    return { step, evidence, transferred: false };
  }
  return null;
}

export function resumeGraph(args: {
  graph: ActionGraph;
  stored: readonly StepEvidence[];
  pendingChange?: PendingChange | null;
}): ResumeDecision {
  const next = firstUnconfirmedStep(args.graph, args.stored);
  if (!next) return { status: "complete" };
  const outcome = next.evidence ? evidenceOutcome(next.evidence) : null;
  if (outcome === "unknown" && next.evidence?.hash) {
    return { status: "unknown", step: next.step, hash: next.evidence.hash };
  }
  if (args.pendingChange) {
    return { status: "blocked", step: next.step, reason: args.pendingChange };
  }
  return { status: "resume", step: next.step };
}

export function suppressSubmit(decision: ResumeDecision): boolean {
  return decision.status === "unknown" || decision.status === "complete";
}

export async function reconcilePersistedHash(args: {
  hash: Hash;
  getReceipt: (hash: Hash) => Promise<{
    status: "success" | "reverted";
    confirmations: number;
  } | null>;
}): Promise<StepOutcome> {
  const receipt = await args.getReceipt(args.hash);
  if (!receipt) return "unknown";
  return classifyStepOutcome({
    hash: args.hash,
    receiptStatus: receipt.status,
    confirmations: receipt.confirmations,
  });
}

/** Completion labels need finality and a fresh authoritative state read. */
export function positionLabelAllowed(args: {
  outcome: StepOutcome;
  authoritativeMatch: boolean;
}): boolean {
  return args.outcome === "confirmed" && args.authoritativeMatch;
}

export function pendingChangeFor(args: {
  accountChanged: boolean;
  chainChanged: boolean;
  allowanceChanged: boolean;
  liquidityChanged: boolean;
  deadlineChanged: boolean;
  routerChanged: boolean;
}): PendingChange | null {
  if (args.accountChanged) return "account";
  if (args.chainChanged) return "chain";
  if (args.allowanceChanged) return "allowance";
  if (args.liquidityChanged) return "liquidity";
  if (args.deadlineChanged) return "deadline";
  if (args.routerChanged) return "router";
  return null;
}

export function statusFromOutcome(outcome: StepOutcome): StepEvidenceStatus {
  if (outcome === "unknown") return "unknown";
  if (outcome === "pending") return "pending";
  if (outcome === "confirmed") return "confirmed";
  return "failed";
}

export function confirmedStepIds(
  graph: ActionGraph,
  stored: readonly StepEvidence[],
): GraphSemanticId[] {
  const mine = evidenceForGraph(graph, stored);
  const transferred = transferredConfirmedSteps(
    graph,
    stored.filter((row) => row.graphId !== graph.graphId),
  );
  return graph.steps
    .filter((step) => stepEvidenceMatches(step, mine.get(step.stepId) ?? null) || transferred.has(step.stepId))
    .map((step) => step.stepId);
}

