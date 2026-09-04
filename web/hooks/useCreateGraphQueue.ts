"use client";

import { useCallback, useEffect } from "react";
import type { Hash } from "viem";
import type { ActionIdentity } from "@/lib/actions/types";
import type { ActionExecutionResult, ExecutionPlan } from "@/lib/action-runtime";
import type { PersistPendingContext } from "@/lib/step-evidence";
import type { ActionGraph } from "@/lib/action-graph";
import { remainingQueuedTx } from "@/lib/graph-step-plan";
import { resumeGraph, suppressSubmit } from "@/lib/composite-recovery";
import { receiptFromClient, reconcileUnknownSteps } from "@/lib/resume-contract";
import { listStepEvidence } from "@/lib/step-evidence";
import { useTxQueue, type ClaimAllRowBuild } from "./useTxQueue";
import type { QueuedTx } from "@/lib/claim-all";

type ReceiptClient = Parameters<typeof receiptFromClient>[0];

export function useCreateGraphQueue(args: {
  identity: ActionIdentity | null;
  factory: string;
  graph: ActionGraph | null;
  confirm: (
    plan: ExecutionPlan,
    persist?: PersistPendingContext,
  ) => Promise<ActionExecutionResult>;
  retryRefresh: () => Promise<ActionExecutionResult | null>;
  rebuild: (tx: QueuedTx, identity: ActionIdentity) => Promise<ClaimAllRowBuild>;
  client?: ReceiptClient | null;
}) {
  const queue = useTxQueue({
    identity: args.identity,
    invariants: () => ({ ready: true }),
    rebuild: args.rebuild,
    executor: {
      confirm: args.confirm,
      retryRefresh: args.retryRefresh,
    },
    graph: args.graph
      ? {
          factory: args.factory,
          graphId: args.graph.graphId,
          economicIdentityOf: (stepId) => {
            const step = args.graph!.steps.find((row) => row.stepId === stepId);
            if (!step) throw new Error(`Unknown graph step ${stepId}`);
            return step.economicIdentity;
          },
        }
      : undefined,
  });

  const account = args.identity?.account;
  const chainId = args.identity?.chainId;
  const getReceipt = useCallback(
    (hash: Hash) => (args.client ? receiptFromClient(args.client, hash) : Promise.resolve(null)),
    [args.client],
  );

  useEffect(() => {
    if (!args.graph || !account || chainId === undefined || !args.client) return;
    void reconcileUnknownSteps({
      factory: args.factory,
      chainId,
      account,
      graph: args.graph,
      getReceipt,
    });
  }, [account, args.client, args.factory, args.graph, chainId, getReceipt]);

  const startRemaining = useCallback(async () => {
    if (!args.graph || !account || chainId === undefined) return;
    if (args.client) {
      await reconcileUnknownSteps({
        factory: args.factory,
        chainId,
        account,
        graph: args.graph,
        getReceipt,
      });
    }
    const stored = listStepEvidence(args.factory, chainId, account);
    const decision = resumeGraph({ graph: args.graph, stored });
    if (suppressSubmit(decision)) return;
    const remaining = remainingQueuedTx(args.graph, stored);
    if (remaining.length === 0) return;
    queue.start(remaining);
  }, [account, args.client, args.factory, args.graph, chainId, getReceipt, queue]);

  return { ...queue, startRemaining };
}
