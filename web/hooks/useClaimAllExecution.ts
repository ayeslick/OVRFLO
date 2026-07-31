"use client";

import { useMemo } from "react";
import { useConnection, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { useWriteFlow } from "./useWriteFlow";
import type { UseTxQueueOptions } from "./useTxQueue";
import {
  planClaimAll,
  reconcileQueuedTx,
  type QueuedTx,
} from "@/lib/claim-all";
import { createClaimAllRowExecutionPlan } from "@/lib/claim-all-execution";
import { chainId as configuredChainId } from "@/lib/config";
import type { LiveMarketScope } from "@/lib/live-action-plan";
import type { MarketInfo } from "@/lib/types";

type ClaimAllInput = {
  pools: {
    lending: Address;
    loanId: bigint;
    claimable: bigint;
    asset: Address;
  }[];
  streams: {
    streamId: bigint;
    withdrawable: bigint;
    asset: Address;
  }[];
};

function sameAddress(left: Address | null, right: Address): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function sameRow(left: QueuedTx, right: QueuedTx): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "pool-claims" && right.kind === "pool-claims"
    ? sameAddress(left.lending, right.lending)
    : left.kind === "stream-claim" &&
        right.kind === "stream-claim" &&
        left.streamId === right.streamId;
}

function scopeForRow(
  tx: QueuedTx,
  markets: readonly MarketInfo[],
): LiveMarketScope | null {
  if (tx.kind === "pool-claims") {
    const market =
      markets.find((candidate) => sameAddress(candidate.lending, tx.lending)) ??
      null;
    return market && sameAddress(market.ovrfloToken, tx.asset) ? market : null;
  }
  const market =
    markets.find(
      (candidate) =>
        sameAddress(candidate.ovrfloToken, tx.asset) ||
        sameAddress(candidate.underlying, tx.asset),
    ) ??
    markets[0] ??
    null;
  // Stream claims do not depend on a market contract, but U6's typed stream
  // action uses `underlying` as the payout balance resource to hydrate.
  return market ? { ...market, underlying: tx.asset } : null;
}

/**
 * React composition seam between Claim All and U6.
 *
 * It does not discover, sign, wait for receipts, or refresh. It reconciles the
 * reviewed row against the latest supplied complete projection, constructs a
 * U6 execution plan, and delegates confirmation and refresh-only retry to the
 * existing single-action executor.
 */
export function useClaimAllExecution(
  input: ClaimAllInput,
  markets: readonly MarketInfo[],
  user: Address | undefined,
): Pick<UseTxQueueOptions, "identity" | "rebuild" | "executor"> {
  const publicClient = usePublicClient({ chainId: configuredChainId });
  const connection = useConnection();
  const writeFlow = useWriteFlow(user);
  const account = connection.addresses?.[0] ?? user;
  const identity = useMemo(
    () =>
      account && connection.chainId !== undefined
        ? { account, chainId: connection.chainId }
        : null,
    [account, connection.chainId],
  );

  return useMemo(
    () => ({
      identity,
      rebuild: async (reviewed: QueuedTx, identity: Parameters<UseTxQueueOptions["rebuild"]>[1]) => {
        const current =
          planClaimAll(input).find((candidate) => sameRow(candidate, reviewed)) ??
          null;
        const reconciliation = reconcileQueuedTx(reviewed, current);
        if (reconciliation.status !== "ready") return reconciliation;
        if (!publicClient) throw new Error("Claim All public client is unavailable");
        const scope = scopeForRow(reviewed, markets);
        if (!scope) throw new Error("Claim All market scope is unavailable");
        return {
          status: "ready" as const,
          plan: createClaimAllRowExecutionPlan(
            reviewed,
            identity,
            scope,
            publicClient,
          ),
        };
      },
      executor: {
        confirm: writeFlow.confirmPlan,
        retryRefresh: writeFlow.retryRefresh,
      },
    }),
    [
      input,
      identity,
      markets,
      publicClient,
      writeFlow.confirmPlan,
      writeFlow.retryRefresh,
    ],
  );
}
