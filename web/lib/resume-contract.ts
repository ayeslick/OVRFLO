import type { Address, Hash } from "viem";
import type { ActionGraph } from "./action-graph";
import {
  classifyStepOutcome,
  evidenceOutcome,
  reconcilePersistedHash,
  statusFromOutcome,
  suppressSubmit,
  type ResumeDecision,
} from "./composite-recovery";
import { decodeDepositedStreamId } from "./deposit-output";
import { anyUnresolvedHash, listStepEvidence, writeStepEvidence } from "./step-evidence";

export type ReconcileReceipt = {
  status: "success" | "reverted";
  confirmations: number;
  logs?: readonly { data?: `0x${string}`; topics?: readonly `0x${string}`[] }[];
};

export async function receiptFromClient(
  client: {
    getTransactionReceipt: (args: { hash: Hash }) => Promise<{
      status: "success" | "reverted";
      blockNumber: bigint;
      logs?: readonly { data?: `0x${string}`; topics?: readonly `0x${string}`[] }[];
    }>;
    getBlockNumber: () => Promise<bigint>;
  },
  hash: Hash,
): Promise<ReconcileReceipt | null> {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    const head = await client.getBlockNumber();
    return {
      status: receipt.status,
      confirmations: Number(head - receipt.blockNumber) + 1,
      logs: receipt.logs,
    };
  } catch {
    return null;
  }
}

/**
 * Reconcile unresolved hashes for this graph before rebuild or prompt.
 */
export async function reconcileUnknownSteps(args: {
  factory: Address | string;
  chainId: number;
  account: Address | string;
  graph: ActionGraph;
  getReceipt: (hash: Hash) => Promise<ReconcileReceipt | null>;
}): Promise<void> {
  const stored = listStepEvidence(args.factory, args.chainId, args.account);
  for (const row of stored) {
    if (row.graphId !== args.graph.graphId || !row.hash) continue;
    if (row.status !== "unknown" && row.status !== "pending" && row.status !== "mined") continue;
    const receipt = await args.getReceipt(row.hash);
    if (!receipt) continue;
    const outcome = classifyStepOutcome({
      hash: row.hash,
      receiptStatus: receipt.status,
      confirmations: receipt.confirmations,
    });
    if (outcome === "unknown") continue;
    let decoded = row.decoded;
    if (outcome === "confirmed" && row.stepId === "deposit") {
      const output = decodeDepositedStreamId(receipt.logs);
      decoded =
        output.status === "ready"
          ? { streamId: output.streamId.toString() }
          : { blocked: output.reason };
    }
    writeStepEvidence({
      ...row,
      status: statusFromOutcome(outcome),
      receiptStatus: receipt.status,
      confirmations: Math.max(row.confirmations, receipt.confirmations),
      decoded,
    });
  }
  const latest = listStepEvidence(args.factory, args.chainId, args.account);
  const lastStep = args.graph.steps[args.graph.steps.length - 1];
  if (!lastStep) return;
  const last = latest.find((row) => row.graphId === args.graph.graphId && row.stepId === lastStep.stepId);
  if (!last || evidenceOutcome(last) !== "confirmed") return;
  if (last.stepId === "deposit" && last.decoded?.blocked) return;
  for (const prior of latest) {
    if (prior.graphId !== args.graph.graphId || prior.graphComplete) continue;
    writeStepEvidence({ ...prior, graphComplete: true });
  }
}

export type ResumeSource = "route-reset" | "modal-try-again" | "flow-unmount" | "modal-reopen";

/**
 * Route reset, modal TRY AGAIN, and flow unmount cleanup share one contract:
 * reconcile persisted evidence first, resume at the first unconfirmed step,
 * never replay a confirmed step, never re-prompt an unresolved outcome.
 */
export function resumeMayPrompt(decision: ResumeDecision): boolean {
  return !suppressSubmit(decision) && decision.status === "resume";
}

export function routeResetCopy(): string {
  if (anyUnresolvedHash()) {
    return "A transaction may already be in progress. Resume the stored attempt.";
  }
  return "A client-side error interrupted this route.";
}

export function globalResetCopy(): string {
  if (anyUnresolvedHash()) {
    return "A transaction may already be in progress. Resume the stored attempt.";
  }
  return "The application could not recover this view.";
}

export { reconcilePersistedHash };
