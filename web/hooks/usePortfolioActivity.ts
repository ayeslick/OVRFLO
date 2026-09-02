"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { chainId, factoryDeployment, isConfiguredAddress } from "@/lib/config";
import {
  discoverPortfolioLogCandidates,
  type PortfolioActivityRow,
} from "@/lib/discovery/portfolio-log-candidates";
import { activityKeys, readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  partialOutcome,
  readyOutcome,
  readFailure,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";

export type PortfolioActivity = {
  rows: readonly PortfolioActivityRow[];
  complete: boolean;
};

export function usePortfolioActivity(input: {
  account: Address | null | undefined;
  lockup: Address | null | undefined;
  vaults: readonly Address[];
  lendings: readonly Address[];
  toBlock: bigint | null | undefined;
  enabled?: boolean;
}): ReadOutcome<PortfolioActivity> {
  const enabledFlag = input.enabled ?? true;
  const publicClient = usePublicClient({ chainId });
  const configured =
    enabledFlag &&
    isConfiguredAddress(input.account ?? null) &&
    isConfiguredAddress(input.lockup ?? null) &&
    publicClient !== undefined &&
    input.toBlock !== null &&
    input.toBlock !== undefined;

  const query = useQuery({
    queryKey: activityKeys.account(
      chainId,
      input.account,
      factoryDeployment.blockNumber,
      input.toBlock,
      input.lockup,
      input.vaults,
      input.lendings,
    ),
    queryFn: async () => {
      if (!publicClient || !input.account || !input.lockup || input.toBlock === undefined || input.toBlock === null) {
        throw new Error("activity query ran unconfigured");
      }
      return discoverPortfolioLogCandidates(publicClient as never, {
        account: input.account,
        lockup: input.lockup,
        vaults: input.vaults,
        lendings: input.lendings,
        fromBlock: factoryDeployment.blockNumber,
        toBlock: input.toBlock,
      });
    },
    enabled: configured,
    ...readQuery,
  });

  return useMemo(() => {
    const meta = query.dataUpdatedAt > 0 ? { dataUpdatedAt: query.dataUpdatedAt } : {};
    if (!configured) return loadingOutcome<PortfolioActivity>(undefined, meta);
    if (query.isLoading && !query.data) return loadingOutcome<PortfolioActivity>(undefined, meta);
    if (query.isError) {
      return unavailableOutcome(
        [readFailure("usePortfolioActivity", "transport", query.error ?? "activity scan failed")],
        meta,
      );
    }
    const outcome = query.data;
    if (!outcome) return loadingOutcome<PortfolioActivity>(undefined, meta);
    if (outcome.status === "unavailable") {
      return unavailableOutcome(outcome.failures, meta);
    }
    const rows = outcome.data?.activity ?? [];
    if (outcome.status === "partial" || !outcome.complete) {
      return partialOutcome({ rows, complete: false }, outcome.failures, meta);
    }
    return readyOutcome({ rows, complete: true }, meta);
  }, [configured, query.data, query.dataUpdatedAt, query.error, query.isError, query.isLoading]);
}
