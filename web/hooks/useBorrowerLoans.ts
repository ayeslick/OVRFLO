"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress, ZERO_ADDRESS } from "@/lib/config";
import { MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import { lendingKeys } from "@/lib/query-keys";
import type { Loan, LoanPool } from "@/lib/types";
import { useLending } from "./useLending";

export function useBorrowerLoans(lending: Address | null | undefined, borrower: Address | null | undefined) {
  const lendingState = useLending(lending);
  const ids = useMemo(() => enumerateIds(lendingState.params.nextLoanId), [lendingState.params.nextLoanId]);

  const reads = useReadContracts({
    contracts: lending && borrower
      ? ids.flatMap((id) => [
          { address: lending, abi: ovrfloLendingAbi, functionName: "loans" as const, args: [id] as const },
          { address: lending, abi: ovrfloLendingAbi, functionName: "loanPools" as const, args: [id] as const },
        ])
      : [],
    query: { enabled: isConfiguredAddress(lending ?? null) && Boolean(borrower) && ids.length > 0 },
  });

  const loans = useMemo(() => {
    const rows: Array<{ loan: Loan; pool: LoanPool }> = [];
    const normalized = borrower?.toLowerCase();
    for (let index = 0; index < ids.length; index++) {
      const loanResult = reads.data?.[index * 2];
      const poolResult = reads.data?.[index * 2 + 1];
      if (loanResult?.status !== "success" || poolResult?.status !== "success") continue;
      const [loanBorrower, streamId, obligation, drawn, repaid, closed] = loanResult.result as [
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        boolean,
      ];
      if (loanBorrower === ZERO_ADDRESS) continue;
      if (normalized && loanBorrower.toLowerCase() !== normalized) continue;
      const [poolBorrower, aprBps, market, totalContributed] = poolResult.result as [Address, number, Address, bigint];
      rows.push({
        loan: { id: ids[index], borrower: loanBorrower, streamId, obligation, drawn, repaid, closed },
        pool: { id: ids[index], borrower: poolBorrower, aprBps, market, totalContributed },
      });
    }
    return rows.sort((a, b) => (a.loan.id > b.loan.id ? -1 : 1));
  }, [borrower, ids, reads.data]);

  return {
    queryKey: lendingKeys.borrowerLoans(lending, borrower),
    loans,
    tooLarge: lendingState.params.nextLoanId > MAX_ENUMERATION_IDS + 1n,
    isLoading: lendingState.isLoading || reads.isLoading,
    error: lendingState.error ?? reads.error,
  };
}

function enumerateIds(nextId: bigint) {
  const max = nextId - 1n;
  const capped = max > MAX_ENUMERATION_IDS ? MAX_ENUMERATION_IDS : max;
  return Array.from({ length: Number(capped) }, (_, index) => BigInt(index + 1));
}
