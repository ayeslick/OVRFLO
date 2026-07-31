"use client";

import type { Address } from "viem";
import { useAccountLoanBookProjection } from "./useLendingProjection";

const EMPTY_ROWS: readonly never[] = [];

// One account-scoped projection supplies both lender-pool and borrower-loan
// views so consumers share one pinned candidate set and hydration result.
export function useLoanBook(lending: Address | null | undefined, user: Address | null | undefined) {
  const projection = useAccountLoanBookProjection(lending, user);
  return {
    pools:
      projection.outcome.status === "ready"
        ? projection.outcome.data.pools
        : EMPTY_ROWS,
    loans:
      projection.outcome.status === "ready"
        ? projection.outcome.data.loans
        : EMPTY_ROWS,
    outcome: projection.outcome,
    isLoading: projection.isLoading,
    error: projection.error,
  };
}
