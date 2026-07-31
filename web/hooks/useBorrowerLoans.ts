"use client";

import type { Address } from "viem";
import { useAccountLoanBookProjection } from "./useLendingProjection";

const EMPTY_LOANS: readonly never[] = [];

export function useBorrowerLoans(
  lending: Address | null | undefined,
  borrower: Address | null | undefined,
  refetchInterval?: number,
) {
  const projection = useAccountLoanBookProjection(lending, borrower, refetchInterval);
  return {
    loans:
      projection.outcome.status === "ready"
        ? projection.outcome.data.loans
        : EMPTY_LOANS,
    outcome: projection.outcome,
    isLoading: projection.isLoading,
    error: projection.error,
  };
}
