"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { isConfiguredAddress, SABLIER_LOCKUP_ADDRESS, ZERO_ADDRESS } from "@/lib/config";
import { enumerateIds, loanPoolClaimable, MAX_ENUMERATION_IDS, recoveredForClaimable } from "@/lib/lending-math";
import type { Loan, LoanPool } from "@/lib/types";
import { useLending } from "./useLending";

export function useLenderPools(lending: Address | null | undefined, lender: Address | null | undefined) {
  const lendingState = useLending(lending);
  const ids = useMemo(() => enumerateIds(lendingState.params.nextLoanId), [lendingState.params.nextLoanId]);

  const reads = useReadContracts({
    contracts:
      lending && lender
        ? ids.flatMap((id) => [
            { address: lending, abi: ovrfloLendingAbi, functionName: "loanPools" as const, args: [id] as const },
            { address: lending, abi: ovrfloLendingAbi, functionName: "loans" as const, args: [id] as const },
            {
              address: lending,
              abi: ovrfloLendingAbi,
              functionName: "loanPoolContributions" as const,
              args: [id, lender] as const,
            },
            {
              address: lending,
              abi: ovrfloLendingAbi,
              functionName: "loanPoolReceived" as const,
              args: [id, lender] as const,
            },
            { address: lending, abi: ovrfloLendingAbi, functionName: "loanPoolProceeds" as const, args: [id] as const },
          ])
        : [],
    query: { enabled: isConfiguredAddress(lending ?? null) && Boolean(lender) && ids.length > 0 },
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
      const contribution = contributionResult.result as bigint;
      if (contribution === 0n) continue;
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
      const loan = { id: ids[index], borrower: loanBorrower, streamId, obligation, drawn, repaid, closed };
      const pool = { id: ids[index], borrower: poolBorrower, aprBps, market, totalContributed };
      rows.push({
        pool,
        loan,
        contribution,
        received: receivedResult.result as bigint,
        proceeds: proceedsResult.result as bigint,
      });
    }
    return rows.sort((a, b) => (a.pool.id > b.pool.id ? -1 : 1));
  }, [ids, reads.data]);

  // Separate Sablier batch (mirrors useHeldStreams) — never widen the lending
  // batch's index stride. claimable is PROJECTED via recoveredForClaimable so it
  // includes the open stream's harvestable balance, not just banked proceeds.
  const withdrawableReads = useReadContracts({
    contracts: rowsBase.map(({ loan }) => ({
      address: SABLIER_LOCKUP_ADDRESS,
      abi: sablierLockupAbi,
      functionName: "withdrawableAmountOf" as const,
      args: [loan.streamId] as const,
    })),
    query: { enabled: rowsBase.length > 0 },
  });

  const pools = useMemo(
    () =>
      rowsBase.map((entry, index) => {
        const result = withdrawableReads.data?.[index];
        const withdrawable = result?.status === "success" ? (result.result as bigint) : 0n;
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
      }),
    [rowsBase, withdrawableReads.data],
  );

  return {
    pools,
    tooLarge: lendingState.params.nextLoanId > MAX_ENUMERATION_IDS + 1n,
    isLoading: lendingState.isLoading || reads.isLoading,
    error: lendingState.error ?? reads.error,
  };
}
