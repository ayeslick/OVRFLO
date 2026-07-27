"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { isConfiguredAddress, SABLIER_LOCKUP_ADDRESS, ZERO_ADDRESS } from "@/lib/config";
import { enumerateIds, loanPoolClaimable, MAX_ENUMERATION_IDS, recoveredForClaimable } from "@/lib/lending-math";
import type { Loan, LoanPool } from "@/lib/types";
import { useLending } from "./useLending";

// Combines what useLenderPools and useBorrowerLoans used to fetch separately.
// Every current caller (PositionSummary, PositionList) needs both the lender
// and borrower view of the SAME (lending, user) pair, which meant two
// multicalls re-scanning the same id space and re-fetching loans/loanPools
// twice. One multicall + one shared Sablier withdrawable overlay, split into
// both views client-side. RepayForm needs only the lean borrower view for one
// loan and stays on useBorrowerLoans — this hook is for the dual-use sites.
export function useLoanBook(lending: Address | null | undefined, user: Address | null | undefined) {
  const lendingState = useLending(lending);
  const ids = useMemo(() => enumerateIds(lendingState.params.nextLoanId), [lendingState.params.nextLoanId]);

  const reads = useReadContracts({
    contracts:
      lending && user
        ? ids.flatMap((id) => [
            { address: lending, abi: ovrfloLendingAbi, functionName: "loanPools" as const, args: [id] as const },
            { address: lending, abi: ovrfloLendingAbi, functionName: "loans" as const, args: [id] as const },
            {
              address: lending,
              abi: ovrfloLendingAbi,
              functionName: "loanPoolContributions" as const,
              args: [id, user] as const,
            },
            {
              address: lending,
              abi: ovrfloLendingAbi,
              functionName: "loanPoolReceived" as const,
              args: [id, user] as const,
            },
            { address: lending, abi: ovrfloLendingAbi, functionName: "loanPoolProceeds" as const, args: [id] as const },
          ])
        : [],
    query: { enabled: isConfiguredAddress(lending ?? null) && Boolean(user) && ids.length > 0 },
  });

  const rowsBase = useMemo(() => {
    const rows: Array<{
      pool: LoanPool;
      loan: Loan;
      contribution: bigint;
      received: bigint;
      proceeds: bigint;
    }> = [];
    for (let index = 0; index < ids.length; index++) {
      const base = index * 5;
      const poolResult = reads.data?.[base];
      const loanResult = reads.data?.[base + 1];
      const contributionResult = reads.data?.[base + 2];
      const receivedResult = reads.data?.[base + 3];
      const proceedsResult = reads.data?.[base + 4];
      if (
        poolResult?.status !== "success" ||
        loanResult?.status !== "success" ||
        contributionResult?.status !== "success" ||
        receivedResult?.status !== "success" ||
        proceedsResult?.status !== "success"
      ) {
        continue;
      }
      const [poolBorrower, aprBps, market, totalContributed] = poolResult.result as [Address, number, Address, bigint];
      if (poolBorrower === ZERO_ADDRESS) continue;
      const [loanBorrower, streamId, obligation, drawn, repaid, closed] = loanResult.result as [
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ];
      rows.push({
        loan: { id: ids[index], borrower: loanBorrower, streamId, obligation, drawn, repaid, closed },
        pool: { id: ids[index], borrower: poolBorrower, aprBps, market, totalContributed },
        contribution: contributionResult.result as bigint,
        received: receivedResult.result as bigint,
        proceeds: proceedsResult.result as bigint,
      });
    }
    return rows;
  }, [ids, reads.data]);

  // One Sablier batch over the union of loans either view needs, deduped by
  // loan id — never widen this to per-view batches (mirrors useHeldStreams).
  const relevantRows = useMemo(() => {
    const normalized = user?.toLowerCase();
    return rowsBase.filter(
      (row) => row.contribution > 0n || (normalized && row.loan.borrower.toLowerCase() === normalized),
    );
  }, [rowsBase, user]);

  const withdrawableReads = useReadContracts({
    contracts: relevantRows.map(({ loan }) => ({
      address: SABLIER_LOCKUP_ADDRESS,
      abi: sablierLockupAbi,
      functionName: "withdrawableAmountOf" as const,
      args: [loan.streamId] as const,
    })),
    query: { enabled: relevantRows.length > 0 },
  });

  const withdrawableByLoanId = useMemo(() => {
    const map = new Map<bigint, bigint>();
    relevantRows.forEach((row, index) => {
      const result = withdrawableReads.data?.[index];
      map.set(row.loan.id, result?.status === "success" ? (result.result as bigint) : 0n);
    });
    return map;
  }, [relevantRows, withdrawableReads.data]);

  const pools = useMemo(
    () =>
      rowsBase
        .filter((row) => row.contribution > 0n)
        .map((entry) => {
          const withdrawable = withdrawableByLoanId.get(entry.loan.id) ?? 0n;
          return {
            ...entry,
            withdrawable,
            claimable: loanPoolClaimable({
              contribution: entry.contribution,
              received: entry.received,
              recovered: recoveredForClaimable({ loan: entry.loan, withdrawable }),
              totalContributed: entry.pool.totalContributed,
            }),
          };
        })
        .sort((a, b) => (a.pool.id > b.pool.id ? -1 : 1)),
    [rowsBase, withdrawableByLoanId],
  );

  const loans = useMemo(() => {
    const normalized = user?.toLowerCase();
    return rowsBase
      .filter((row) => normalized && row.loan.borrower.toLowerCase() === normalized)
      .map(({ loan, pool }) => ({ loan, pool, withdrawable: withdrawableByLoanId.get(loan.id) ?? 0n }))
      .sort((a, b) => (a.loan.id > b.loan.id ? -1 : 1));
  }, [rowsBase, user, withdrawableByLoanId]);

  return {
    pools,
    loans,
    tooLarge: lendingState.params.nextLoanId > MAX_ENUMERATION_IDS + 1n,
    isLoading: lendingState.isLoading || reads.isLoading,
    error: lendingState.error ?? reads.error,
  };
}
