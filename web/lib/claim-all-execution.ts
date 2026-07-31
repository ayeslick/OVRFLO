import { encodeFunctionData, type Address } from "viem";
import { ovrfloLendingAbi, sablierLockupAbi } from "./abis";
import type {
  ActionExecutionDraft,
  ExactSimulationRequest,
  ExecutionPlan,
} from "./action-runtime";
import { buildAction } from "./actions/registry";
import type {
  ActionError,
  ActionIdentity,
  MarketActionContext,
  ReadyAction,
} from "./actions/types";
import type { QueuedTx } from "./claim-all";
import { SABLIER_LOCKUP_ADDRESS } from "./config";
import {
  createLiveActionDraft,
  type LiveClient,
  type LiveMarketScope,
} from "./live-action-plan";
import { MAX_UINT128 } from "./lending-math";
import { readyOutcome } from "./read-outcome";

function marketContext(scope: LiveMarketScope): MarketActionContext {
  return {
    vault: scope.vault,
    lending: scope.lending,
    market: scope.market,
    underlying: scope.underlying,
    ovrfloToken: scope.ovrfloToken,
    ptToken: scope.ptToken,
    sablier: SABLIER_LOCKUP_ADDRESS,
    expiry: scope.expiryCached,
    now: 0n,
  };
}

function requestForAction(action: ReadyAction): ExactSimulationRequest {
  return {
    address: action.call.target,
    abi:
      action.call.contract === "sablier"
        ? sablierLockupAbi
        : ovrfloLendingAbi,
    functionName: action.call.functionName,
    args: action.call.args,
    ...(action.call.value === 0n ? {} : { value: action.call.value }),
  };
}

function reviewedDrafts(
  tx: QueuedTx,
  identity: ActionIdentity,
  scope: LiveMarketScope,
): ActionExecutionDraft[] {
  const market = marketContext(scope);
  if (tx.kind === "stream-claim") {
    const result = buildAction(
      { type: "claim_stream", streamId: tx.streamId },
      {
        type: "claim_stream",
        identity,
        market,
        state: readyOutcome({
          streamId: tx.streamId,
          recipient: identity.account,
          withdrawable: tx.withdrawable,
        }),
      },
    );
    if (result.status !== "ready") {
      throw new Error("Reviewed stream claim is not action-ready");
    }
    return [{ action: result.action, request: requestForAction(result.action) }];
  }

  return tx.claims.map((claim) => {
    const result = buildAction(
      { type: "claim_share", loanId: claim.loanId },
      {
        type: "claim_share",
        identity,
        market,
        state: readyOutcome({
          loanId: claim.loanId,
          claimable: claim.claimable,
        }),
      },
    );
    if (result.status !== "ready") {
      throw new Error(`Reviewed pool claim ${claim.loanId} is not action-ready`);
    }
    return { action: result.action, request: requestForAction(result.action) };
  });
}

function combinePoolDrafts(
  lending: Address,
  drafts: readonly ActionExecutionDraft[],
): ActionExecutionDraft {
  if (drafts.length === 0) {
    throw new Error("Cannot compose an empty pool-claim row");
  }
  const identity = drafts[0].action.identity;
  const calls = drafts.map((draft) => draft.action.call);
  const loanIds = drafts.map((draft) => draft.action.receiptSummary.expectedIds[0]);
  const claimables = drafts.map((draft) => {
    const claimable = draft.action.review.economics.claimable;
    if (typeof claimable !== "bigint") {
      throw new Error("Pool claim review is missing its claimable amount");
    }
    return claimable;
  });
  const encoded = calls.map((call) =>
    encodeFunctionData({
      abi: ovrfloLendingAbi,
      functionName: "claimLoanPoolShare",
      args: call.args as readonly [bigint, bigint],
    }),
  );
  const call = {
    target: lending,
    contract: "lending" as const,
    functionName: "multicall",
    args: [encoded] as const,
    value: 0n,
    calls,
  };
  const action: ReadyAction = {
    type: "claim_share",
    identity,
    preconditions: [...new Set(drafts.flatMap((draft) => draft.action.preconditions))],
    authorizations: [],
    call,
    touchedResources: drafts.flatMap((draft) => draft.action.touchedResources),
    review: {
      actionType: "claim_share",
      title: `CLAIM ${drafts.length} POOL SHARE${drafts.length === 1 ? "" : "S"}`,
      identity,
      call,
      authorizations: [],
      economics: {
        loanIds: loanIds.join(","),
        claimables: loanIds
          .map((loanId, index) => `${loanId}:${claimables[index]}`)
          .join(","),
        totalClaimable: claimables.reduce((total, claimable) => total + claimable, 0n),
      },
    },
    receiptSummary: {
      source: lending,
      eventName: "LoanPoolShareClaimed",
      label: "CLAIMED",
      expectedIds: loanIds,
      expectedAmounts: {
        projected: claimables.reduce(
          (total, claimable) => total + claimable,
          0n,
        ),
      },
    },
  };
  return {
    action,
    request: {
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "multicall",
      args: [encoded],
    },
  };
}

function combineRowDrafts(
  tx: QueuedTx,
  drafts: readonly ActionExecutionDraft[],
): ActionExecutionDraft {
  if (tx.kind === "stream-claim") {
    if (drafts.length !== 1) {
      throw new Error("A stream row must contain exactly one action");
    }
    return drafts[0];
  }
  return combinePoolDrafts(tx.lending, drafts);
}

function rawCalls(tx: QueuedTx) {
  return tx.kind === "stream-claim"
    ? [
        {
          address: SABLIER_LOCKUP_ADDRESS,
          functionName: "withdrawMax",
          args: [tx.streamId, null] as const,
        },
      ]
    : tx.claims.map((claim) => ({
        address: tx.lending,
        functionName: "claimLoanPoolShare",
        args: [claim.loanId, MAX_UINT128] as const,
      }));
}

/**
 * Builds one queue row for U6. The accepted draft comes from the corroborated,
 * directly hydrated preflight snapshot. U6's `rebuild` reloads every
 * constituent at one newly captured block before it can simulate or sign.
 */
export function createClaimAllRowExecutionPlan(
  tx: QueuedTx,
  identity: ActionIdentity,
  scope: LiveMarketScope,
  client: LiveClient,
): ExecutionPlan {
  if (
    tx.kind === "pool-claims" &&
    scope.ovrfloToken.toLowerCase() !== tx.asset.toLowerCase()
  ) {
    throw new Error("Pool claim payout asset does not match its market scope");
  }
  const executionScope =
    tx.kind === "stream-claim" ? { ...scope, underlying: tx.asset } : scope;
  const accepted = combineRowDrafts(
    tx,
    reviewedDrafts(tx, identity, executionScope),
  );
  return {
    flowId:
      tx.kind === "pool-claims"
        ? `claim-all:pool:${tx.lending.toLowerCase()}:${tx.claims
            .map((claim) => claim.loanId)
            .join(",")}`
        : `claim-all:stream:${tx.streamId}`,
    accepted,
    rebuild: async (currentIdentity) => {
      const block = await client.getBlock({ blockTag: "latest" });
      if (!block.hash) {
        return {
          status: "invalid",
          errors: [
            {
              code: "snapshot-not-ready",
              message: "Claim All rebuild block has no hash",
            },
          ],
        };
      }
      const errors: ActionError[] = [];
      const drafts: ActionExecutionDraft[] = [];
      for (const raw of rawCalls(tx)) {
        const args =
          raw.functionName === "withdrawMax"
            ? [raw.args[0], currentIdentity.account]
            : raw.args;
        const rebuilt = await createLiveActionDraft(
          { ...raw, args },
          currentIdentity,
          executionScope,
          client,
          {
            pinnedBlock: {
              number: block.number,
              hash: block.hash,
              timestamp: block.timestamp,
            },
          },
        );
        if (!rebuilt || rebuilt.status === "invalid") {
          errors.push(
            ...(
              rebuilt?.status === "invalid"
                ? rebuilt.errors
                : [
                    {
                      code: "action-snapshot-mismatch" as const,
                      message: "Claim All row is no longer supported",
                    },
                  ]
            ),
          );
        } else {
          drafts.push(rebuilt.draft);
        }
      }
      if (drafts.length === 0) return { status: "invalid", errors };
      return { status: "ready", draft: combineRowDrafts(tx, drafts) };
    },
  };
}
