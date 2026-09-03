"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import type { FixedReturnLoanTerm } from "@/lib/fixed-return-completion";
import type { LoanShare } from "@/lib/protocol/lending";

export function useFixedReturnTerms(
  lending: Address | null,
  lockup: Address | null,
  pairs: readonly LoanShare[],
): readonly FixedReturnLoanTerm[] | null {
  const loanReads = useReadContracts({
    allowFailure: true,
    contracts:
      lending && pairs.length > 0
        ? pairs.map((pair) => ({
            address: lending,
            abi: ovrfloLendingAbi,
            functionName: "loanState" as const,
            args: [pair.loanId] as const,
          }))
        : [],
    query: { enabled: Boolean(lending) && pairs.length > 0 },
  });

  const streamIds = useMemo(() => {
    if (!loanReads.data || loanReads.data.length !== pairs.length) return [];
    return loanReads.data.map((row) => {
      if (row.status !== "success") return null;
      const stored = (row.result as readonly [{ streamId: bigint }, bigint])[0];
      return stored.streamId;
    });
  }, [loanReads.data, pairs.length]);

  const streamReads = useReadContracts({
    allowFailure: true,
    contracts:
      lockup && streamIds.length > 0 && streamIds.every((id) => id !== null)
        ? streamIds.map((streamId) => ({
            address: lockup,
            abi: sablierLockupAbi,
            functionName: "getStream" as const,
            args: [streamId!] as const,
          }))
        : [],
    query: {
      enabled: Boolean(lockup) && streamIds.length > 0 && streamIds.every((id) => id !== null),
    },
  });

  return useMemo(() => {
    if (pairs.length === 0) return [];
    if (!loanReads.data || !streamReads.data) return null;
    if (loanReads.data.length !== pairs.length || streamReads.data.length !== pairs.length) {
      return null;
    }
    const terms: FixedReturnLoanTerm[] = [];
    for (let index = 0; index < pairs.length; index++) {
      const loanRow = loanReads.data[index];
      const streamRow = streamReads.data[index];
      const pair = pairs[index];
      if (!loanRow || !streamRow || !pair) return null;
      if (loanRow.status !== "success" || streamRow.status !== "success") return null;
      const stream = streamRow.result as { endTime: number | bigint };
      terms.push({
        loanId: pair.loanId,
        matchedAmount: pair.contribution,
        completionDate: BigInt(stream.endTime),
      });
    }
    return terms;
  }, [loanReads.data, pairs, streamReads.data]);
}
