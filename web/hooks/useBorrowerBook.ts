"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress } from "@/lib/config";
import { MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import { readQuery } from "@/lib/query-keys";
import {
  loadingOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadOutcome,
} from "@/lib/read-outcome";
import type { Loan } from "@/lib/types";
import { bigintToSafeLength } from "./useOvrflos";

export type BorrowerLoanRow = Loan & {
  outstanding: bigint;
};

export type BorrowerBook = {
  loans: readonly BorrowerLoanRow[];
};

export function useBorrowerBook(
  lending: Address | null | undefined,
  account: Address | null | undefined,
): ReadOutcome<BorrowerBook> {
  const configured =
    isConfiguredAddress(lending ?? null) && isConfiguredAddress(account ?? null);

  const countRead = useReadContract({
    address: lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "borrowerLoanCount",
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
      functionName: "borrowerLoanAt" as const,
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
      functionName: "loanState" as const,
      args: [id] as const,
    }));
  }, [ids, lending, stateEnabled]);

  const stateReads = useReadContracts({
    allowFailure: true,
    contracts: stateContracts,
    query: { ...readQuery, enabled: stateEnabled },
  });

  const dataUpdatedAt = Math.max(
    countRead.dataUpdatedAt ?? 0,
    idReads.dataUpdatedAt ?? 0,
    stateReads.dataUpdatedAt ?? 0,
  );

  return useMemo(() => {
    const meta = dataUpdatedAt > 0 ? { dataUpdatedAt } : {};
    if (!configured) return loadingOutcome<BorrowerBook>(undefined, meta);
    if (countRead.isLoading && countRead.data === undefined) {
      return loadingOutcome<BorrowerBook>(undefined, meta);
    }
    if (countRead.isError) {
      return unavailableOutcome<BorrowerBook>(
        [readFailure("useBorrowerBook", "transport", countRead.error ?? "borrowerLoanCount failed")],
        meta,
      );
    }
    if (overBudget) {
      return unavailableOutcome<BorrowerBook>(
        [
          readFailure(
            "useBorrowerBook",
            "incomplete",
            "Borrower enumeration exceeds the fail-closed budget",
          ),
        ],
        meta,
      );
    }
    if (count === 0n) {
      return readyOutcome({ loans: [] }, meta);
    }
    if (idReads.isLoading && !idReads.data) return loadingOutcome<BorrowerBook>(undefined, meta);
    if (!idsComplete) {
      return unavailableOutcome<BorrowerBook>(
        [readFailure("useBorrowerBook", "subcall", "borrowerLoanAt batch is incomplete")],
        meta,
      );
    }
    if (stateReads.isLoading && !stateReads.data) {
      return loadingOutcome<BorrowerBook>(undefined, meta);
    }
    const stateComplete =
      stateReads.data?.length === stateContracts.length &&
      stateReads.data.every((result) => result.status === "success");
    if (!stateComplete) {
      return unavailableOutcome<BorrowerBook>(
        [readFailure("useBorrowerBook", "subcall", "loanState batch is incomplete")],
        meta,
      );
    }
    const loans: BorrowerLoanRow[] = [];
    for (const [index, id] of ids.entries()) {
      const result = stateReads.data?.[index];
      if (result?.status !== "success") continue;
      const [stored, outstanding] = result.result;
      const loan: BorrowerLoanRow = {
        id,
        borrower: stored.borrower,
        streamId: stored.streamId,
        obligation: stored.obligation,
        drawn: stored.drawn,
        repaid: stored.repaid,
        closed: stored.closed,
        outstanding,
      };
      loans.push(loan);
    }
    return readyOutcome({ loans }, meta);
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
    ids,
    idsComplete,
    overBudget,
    stateContracts.length,
    stateReads.data,
    stateReads.dataUpdatedAt,
    stateReads.isLoading,
  ]);
}
