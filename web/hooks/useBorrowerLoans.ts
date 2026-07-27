"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { isConfiguredAddress, SABLIER_LOCKUP_ADDRESS, ZERO_ADDRESS } from "@/lib/config";
import { enumerateIds, MAX_ENUMERATION_IDS } from "@/lib/lending-math";
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

  // Separate Sablier batch (mirrors useHeldStreams) — never widen the lending
  // batch's index stride. Feeds the CLOSE gate (canCloseLoan needs withdrawable).
  const withdrawableReads = useReadContracts({
    contracts: loans.map(({ loan }) => ({
      address: SABLIER_LOCKUP_ADDRESS,
      abi: sablierLockupAbi,
      functionName: "withdrawableAmountOf" as const,
      args: [loan.streamId] as const,
    })),
    query: { enabled: loans.length > 0 },
  });

  const loansWithWithdrawable = useMemo(
    () =>
      loans.map((entry, index) => {
        const result = withdrawableReads.data?.[index];
        return { ...entry, withdrawable: result?.status === "success" ? (result.result as bigint) : 0n };
      }),
    [loans, withdrawableReads.data],
  );

  return {
    loans: loansWithWithdrawable,
    tooLarge: lendingState.params.nextLoanId > MAX_ENUMERATION_IDS + 1n,
    isLoading: lendingState.isLoading || reads.isLoading,
    error: lendingState.error ?? reads.error,
  };
}
