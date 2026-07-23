"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress, ZERO_ADDRESS } from "@/lib/config";
import { enumerateIds, loanPoolClaimable, MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import { lendingKeys } from "@/lib/query-keys";
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

  const pools = useMemo(() => {
    const rows: Array<{
      pool: LoanPool;
      loan: Loan;
      contribution: bigint;
      received: bigint;
      claimable: bigint;
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
        claimable: loanPoolClaimable({
          contribution,
          received: receivedResult.result as bigint,
          recovered: proceedsResult.result as bigint,
          totalContributed,
        }),
      });
    }
    return rows.sort((a, b) => (a.pool.id > b.pool.id ? -1 : 1));
  }, [ids, reads.data]);

  return {
    queryKey: lendingKeys.lenderPools(lending, lender),
    pools,
    tooLarge: lendingState.params.nextLoanId > MAX_ENUMERATION_IDS + 1n,
    isLoading: lendingState.isLoading || reads.isLoading,
    error: lendingState.error ?? reads.error,
  };
}
