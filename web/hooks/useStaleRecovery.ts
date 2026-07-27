"use client";

import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import type { BorrowErrorKind } from "@/lib/borrow";
import { invalidateAllOnChainReads } from "@/lib/invalidate";

// Shared between BorrowForm and AdjustRateForm: a liquidity race surfaces as
// a "stale" classified error, which refreshes every on-chain read and asks
// for one explicit re-confirm rather than dead-ending the form. Each form
// still owns when to clear staleRecovery (submit, selection change, wallet
// change) — this hook only owns detecting "stale" and reacting to it.
export function useStaleRecovery(
  error: Error | null | undefined,
  classify: (error: unknown) => BorrowErrorKind,
  queryClient: QueryClient,
  connectedAddress: Address | undefined,
) {
  const [staleRecovery, setStaleRecovery] = useState(false);
  const errorKind = error ? classify(error) : null;

  useEffect(() => {
    if (errorKind !== "stale") return;
    setStaleRecovery(true);
    invalidateAllOnChainReads(queryClient, connectedAddress);
  }, [errorKind, error, queryClient, connectedAddress]);

  return { errorKind, terminal: errorKind === "terminal", staleRecovery, setStaleRecovery };
}
