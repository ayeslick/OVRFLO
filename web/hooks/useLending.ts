"use client";

import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress } from "@/lib/config";

const INCOMPLETE_LENDING_PARAMS = new Error(
  "Required lending parameters are incomplete",
);

export function useLending(lending: Address | null | undefined) {
  const enabled = isConfiguredAddress(lending ?? null);
  const reads = useReadContracts({
    contracts: lending
      ? [
          { address: lending, abi: ovrfloLendingAbi, functionName: "aprMinBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "aprMaxBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "feeBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextLoanId" },
        ]
      : [],
    query: { enabled },
  });

  const [aprMin, aprMax, fee, nextLoanId] = reads.data ?? [];
  const complete =
    !enabled ||
    (reads.data?.length === 4 &&
      reads.data.every((result) => result.status === "success"));

  return {
    params: {
      aprMinBps: aprMin?.status === "success" ? aprMin.result : 0,
      aprMaxBps: aprMax?.status === "success" ? aprMax.result : 0,
      feeBps: fee?.status === "success" ? fee.result : 0,
      nextLoanId: nextLoanId?.status === "success" ? nextLoanId.result : 1n,
    },
    isLoading: reads.isLoading,
    error:
      reads.error ??
      (enabled && !reads.isLoading && !complete
        ? INCOMPLETE_LENDING_PARAMS
        : null),
  };
}
