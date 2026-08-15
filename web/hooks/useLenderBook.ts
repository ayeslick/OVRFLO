"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { chainId, isConfiguredAddress } from "@/lib/config";
import { MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import { lenderBookKeys, readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import type { LiquidityPosition } from "@/lib/types";
import { bigintToSafeLength } from "./useOvrflos";

export type LoanShare = {
  loanId: bigint;
  contribution: bigint;
  claimable: bigint;
};

export type LenderPositionRow = LiquidityPosition & {
  intervalStart: bigint;
  intervalEnd: bigint;
  pairs: readonly LoanShare[];
  pairsTruncated: boolean;
};

export type LenderBook = {
  positions: readonly LenderPositionRow[];
};

const LOANS_OF_PAGE = 64n;

/**
 * Follow `nextSeq` from 0 until exhaustion. Never reuses a foreign `startSeq`.
 */
export async function paginateLoansOf(
  fetchPage: (
    startSeq: bigint,
  ) => Promise<{ entries: readonly LoanShare[]; nextSeq: bigint }>,
): Promise<{ pairs: LoanShare[]; truncated: boolean }> {
  const pairs: LoanShare[] = [];
  let startSeq = 0n;
  const used = new Set<string>();
  for (;;) {
    const { entries, nextSeq } = await fetchPage(startSeq);
    for (const entry of entries) pairs.push({ ...entry });
    if (nextSeq === 0n) return { pairs, truncated: false };
    const key = nextSeq.toString();
    if (used.has(key)) {
      throw new Error("loansOf nextSeq reused");
    }
    used.add(key);
    startSeq = nextSeq;
    if (used.size > 1_024) return { pairs, truncated: true };
  }
}

export function useLenderBook(
  lending: Address | null | undefined,
  account: Address | null | undefined,
): ReadOutcome<LenderBook> {
  const configured =
    isConfiguredAddress(lending ?? null) && isConfiguredAddress(account ?? null);
  const publicClient = usePublicClient({ chainId });

  const countRead = useReadContract({
    address: lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "lenderPositionCount",
    args: account ? [account] : undefined,
    query: { ...readQuery, enabled: configured },
  });

  const count = countRead.data ?? 0n;
  const countOk = countRead.isSuccess;
  const overBudget = countOk && count > MAX_ENUMERATION_IDS;
  const idEnabled = configured && countOk && count > 0n && !overBudget;
  const idContracts = useMemo(() => {
    if (!idEnabled || !lending || !account) return [];
    return Array.from({ length: bigintToSafeLength(count) }, (_, index) => ({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "lenderPositionAt" as const,
      args: [account, BigInt(index)] as const,
    }));
  }, [account, count, idEnabled, lending]);

  const idReads = useReadContracts({
    allowFailure: true,
    contracts: idContracts,
    query: { ...readQuery, enabled: idEnabled },
  });

  const idsComplete =
    !idEnabled ||
    (idReads.data?.length === idContracts.length &&
      idReads.data.every((result) => result.status === "success"));
  const ids = useMemo(() => {
    if (!idsComplete) return [];
    return (idReads.data ?? [])
      .map((result) => (result.status === "success" ? (result.result as bigint) : 0n))
      .filter((value) => value > 0n);
  }, [idReads.data, idsComplete]);

  const stateEnabled = configured && idsComplete && ids.length > 0;
  const stateContracts = useMemo(() => {
    if (!stateEnabled || !lending) return [];
    return ids.map((id) => ({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "positionState" as const,
      args: [id] as const,
    }));
  }, [ids, lending, stateEnabled]);

  const stateReads = useReadContracts({
    allowFailure: true,
    contracts: stateContracts,
    query: { ...readQuery, enabled: stateEnabled },
  });

  const positions = useMemo<LenderPositionRow[]>(() => {
    if (!stateEnabled) return [];
    const rows: LenderPositionRow[] = [];
    for (const [index, id] of ids.entries()) {
      const result = stateReads.data?.[index];
      if (result?.status !== "success") continue;
      const [position, intervalStart, intervalEnd, unfilled] = result.result as [
        { lender: Address; market: Address; aprBps: number; epoch: number; leafIndex: number },
        bigint,
        bigint,
        bigint,
      ];
      rows.push({
        id,
        lender: position.lender,
        market: position.market,
        aprBps: position.aprBps,
        availableLiquidity: unfilled,
        intervalStart,
        intervalEnd,
        pairs: [],
        pairsTruncated: false,
      });
    }
    return rows;
  }, [ids, stateEnabled, stateReads.data]);

  const pairQueries = useQueries({
    queries: positions.map((position) => ({
      queryKey: lenderBookKeys.loansOf(chainId, lending!, position.id),
      queryFn: async () => {
        if (!publicClient || !lending) {
          throw new Error("Public client is unavailable");
        }
        return paginateLoansOf(async (startSeq) => {
          const [entries, nextSeq] = await publicClient.readContract({
            address: lending,
            abi: ovrfloLendingAbi,
            functionName: "loansOf",
            args: [position.id, startSeq, LOANS_OF_PAGE],
          });
          return {
            entries: entries.map((entry) => ({
              loanId: entry.loanId,
              contribution: entry.contribution,
              claimable: entry.claimable,
            })),
            nextSeq,
          };
        });
      },
      ...readQuery,
      enabled: Boolean(publicClient && lending && positions.length > 0),
    })),
  });

  const dataUpdatedAt = Math.max(
    countRead.dataUpdatedAt ?? 0,
    idReads.dataUpdatedAt ?? 0,
    stateReads.dataUpdatedAt ?? 0,
    ...pairQueries.map((query) => query.dataUpdatedAt ?? 0),
  );

  return useMemo(() => {
    const meta = dataUpdatedAt > 0 ? { dataUpdatedAt } : {};
    if (!configured) return loadingOutcome<LenderBook>(undefined, meta);
    if (countRead.isLoading && countRead.data === undefined) {
      return loadingOutcome<LenderBook>(undefined, meta);
    }
    if (countRead.isError) {
      return unavailableOutcome<LenderBook>(
        [readFailure("useLenderBook", "transport", countRead.error ?? "lenderPositionCount failed")],
        meta,
      );
    }
    if (overBudget) {
      return unavailableOutcome<LenderBook>(
        [
          readFailure(
            "useLenderBook",
            "incomplete",
            "Lender enumeration exceeds the fail-closed budget",
          ),
        ],
        meta,
      );
    }
    if (count === 0n) {
      return readyOutcome({ positions: [] }, meta);
    }
    if (idReads.isLoading && !idReads.data) return loadingOutcome<LenderBook>(undefined, meta);
    if (!idsComplete) {
      return unavailableOutcome<LenderBook>(
        [readFailure("useLenderBook", "subcall", "lenderPositionAt batch is incomplete")],
        meta,
      );
    }
    if (stateReads.isLoading && !stateReads.data) {
      return loadingOutcome<LenderBook>(undefined, meta);
    }
    const stateComplete =
      stateReads.data?.length === stateContracts.length &&
      stateReads.data.every((result) => result.status === "success");
    if (!stateComplete) {
      return unavailableOutcome<LenderBook>(
        [readFailure("useLenderBook", "subcall", "positionState batch is incomplete")],
        meta,
      );
    }
    if (pairQueries.some((query) => query.isLoading && query.data === undefined)) {
      return loadingOutcome<LenderBook>(
        { positions: positions.map((row) => ({ ...row })) },
        meta,
      );
    }
    if (pairQueries.some((query) => query.isError)) {
      return unavailableOutcome<LenderBook>(
        [readFailure("useLenderBook", "transport", "loansOf pagination failed")],
        meta,
      );
    }
    const hydrated = positions.map((row, index) => {
      const page = pairQueries[index]?.data;
      return {
        ...row,
        pairs: page?.pairs ?? [],
        pairsTruncated: page?.truncated ?? false,
      };
    });
    return readyOutcome({ positions: hydrated }, meta);
  }, [
    configured,
    count,
    countRead.data,
    countRead.dataUpdatedAt,
    countRead.error,
    countRead.isError,
    countRead.isLoading,
    dataUpdatedAt,
    idReads.data,
    idReads.dataUpdatedAt,
    idReads.isLoading,
    idsComplete,
    overBudget,
    pairQueries,
    positions,
    stateContracts.length,
    stateReads.data,
    stateReads.dataUpdatedAt,
    stateReads.isLoading,
  ]);
}
