import type { Address } from "viem";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, ovrfloRequestBookAbi, sablierLockupAbi } from "./abis";
import type { ActionGraph, GraphSemanticId } from "./action-graph";
import { graphToQueuedTx } from "./action-graph";
import type { ActionExecutionDraft, ExecutionPlan } from "./action-runtime";
import type { ActionIdentity, ReadyAction } from "./actions/types";
import type { ActionType } from "./types";
import type { QueuedTx } from "./claim-all";
import { confirmedStepIds } from "./composite-recovery";
import { createLiveExecutionPlan, type LiveClient, type LiveMarketScope, type LiveWriteArgs } from "./live-action-plan";
import type { ReadyProtocolBootstrap } from "./protocol-bootstrap";
import type { StepEvidence } from "./step-evidence";

export function remainingQueuedTx(
  graph: ActionGraph,
  stored: readonly StepEvidence[],
): Extract<QueuedTx, { kind: "graph-step" }>[] {
  const confirmed = new Set(confirmedStepIds(graph, stored));
  return graphToQueuedTx(graph).filter((tx) => !confirmed.has(tx.stepId));
}

export function reuseOrAllocateGraphId(args: {
  storedGraphId: string | null;
  storedKind?: string | null;
  requestedKind: string;
  storedComplete: boolean;
  sameEconomics?: boolean;
  allocate: () => string;
}): string {
  if (
    args.storedGraphId &&
    !args.storedComplete &&
    args.storedKind === args.requestedKind &&
    args.sameEconomics === true
  ) {
    return args.storedGraphId;
  }
  return args.allocate();
}

export function buildAuthStepPlan(args: {
  identity: ActionIdentity;
  semanticId: GraphSemanticId;
  actionType: ActionType;
  token: Address;
  spender: Address;
  amount: bigint;
  contract: "erc20" | "sablier";
}): ExecutionPlan {
  const call = {
    target: args.token,
    contract: args.contract,
    functionName: "approve",
    args: [args.spender, args.amount] as const,
    value: 0n,
  };
  const action: ReadyAction = {
    type: args.actionType,
    identity: args.identity,
    preconditions: ["graph-auth-step"],
    authorizations: [],
    call,
    touchedResources:
      args.contract === "sablier"
        ? [
            {
              kind: "nft-approval",
              token: args.token,
              owner: args.identity.account,
              spender: args.spender,
              tokenId: args.amount,
            },
          ]
        : [
            {
              kind: "allowance",
              token: args.token,
              owner: args.identity.account,
              spender: args.spender,
            },
          ],
    review: {
      actionType: args.actionType,
      title: args.semanticId,
      identity: args.identity,
      call,
      authorizations: [],
      economics: { amount: args.amount },
    },
    receiptSummary: {
      source: args.token,
      eventName: null,
      label: "AUTHORIZED",
      expectedIds: [],
      expectedAmounts: {},
    },
  };
  const accepted: ActionExecutionDraft = {
    action,
    request: {
      address: call.target,
      abi: args.contract === "sablier" ? sablierLockupAbi : erc20Abi,
      functionName: call.functionName,
      args: call.args,
    },
  };
  return {
    flowId: `graph-step:${args.semanticId}`,
    accepted,
    rebuild: async () => ({ status: "ready", draft: accepted }),
  };
}

export function buildCallStepPlan(args: {
  identity: ActionIdentity;
  actionType: ActionType;
  semanticId: GraphSemanticId;
  target: Address;
  contract: "lending" | "ovrflo" | "request_book";
  functionName: string;
  callArgs: readonly unknown[];
}): ExecutionPlan {
  const call = {
    target: args.target,
    contract: args.contract,
    functionName: args.functionName,
    args: args.callArgs,
    value: 0n,
  };
  const action: ReadyAction = {
    type: args.actionType,
    identity: args.identity,
    preconditions: ["graph-call-step"],
    authorizations: [],
    call,
    touchedResources:
      args.contract === "request_book"
        ? [{ kind: "request", book: args.target, id: 0n }]
        : args.contract === "lending"
          ? [{ kind: "market-depth", lending: args.target, market: args.target }]
          : [{ kind: "market", vault: args.target, market: args.target }],
    review: {
      actionType: args.actionType,
      title: args.semanticId,
      identity: args.identity,
      call,
      authorizations: [],
      economics: {},
    },
    receiptSummary: {
      source: args.target,
      eventName: null,
      label: args.semanticId.toUpperCase(),
      expectedIds: [],
      expectedAmounts: {},
    },
  };
  const accepted: ActionExecutionDraft = {
    action,
    request: {
      address: call.target,
      abi:
        args.contract === "request_book"
          ? ovrfloRequestBookAbi
          : args.contract === "lending"
            ? ovrfloLendingAbi
            : ovrfloAbi,
      functionName: call.functionName,
      args: call.args,
    },
  };
  return {
    flowId: `graph-step:${args.semanticId}`,
    accepted,
    rebuild: async () => ({ status: "ready", draft: accepted }),
  };
}

export async function rebuildProtocolGraphStep(args: {
  raw: LiveWriteArgs;
  identity: ActionIdentity;
  scope: LiveMarketScope;
  client: LiveClient;
  bootstrap: ReadyProtocolBootstrap;
}): Promise<{ status: "ready"; plan: ExecutionPlan }> {
  const result = await createLiveExecutionPlan(args.raw, args.identity, args.scope, args.client, {
    bootstrap: args.bootstrap,
  });
  if (!result) {
    throw new Error("Graph step is not a supported protocol call");
  }
  if (result.status === "invalid") {
    throw new Error(result.errors[0]?.message ?? "Graph step rebuild is invalid");
  }
  if (result.status === "needs_review") {
    throw new Error("Graph step must be reviewed again");
  }
  if (result.plan.accepted.action.authorizations.some((row) => !row.satisfied)) {
    throw new Error("Prior authorization is not confirmed");
  }
  return { status: "ready", plan: result.plan };
}
