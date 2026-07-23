"use client";

import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress } from "@/lib/config";
import { lendingKeys } from "@/lib/query-keys";

export function useLending(lending: Address | null | undefined) {
  const reads = useReadContracts({
    contracts: lending
      ? [
          { address: lending, abi: ovrfloLendingAbi, functionName: "aprMinBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "aprMaxBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "feeBps" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextLiquidityId" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextLoanId" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextSaleListingId" },
        ]
      : [],
    query: { enabled: isConfiguredAddress(lending ?? null) },
  });

  const [aprMin, aprMax, fee, nextLiquidityId, nextLoanId, nextSaleListingId] = reads.data ?? [];

  return {
    queryKey: lendingKeys.params(lending),
    params: {
      aprMinBps: aprMin?.status === "success" ? aprMin.result : 0,
      aprMaxBps: aprMax?.status === "success" ? aprMax.result : 0,
      feeBps: fee?.status === "success" ? fee.result : 0,
      nextLiquidityId: nextLiquidityId?.status === "success" ? nextLiquidityId.result : 1n,
      nextLoanId: nextLoanId?.status === "success" ? nextLoanId.result : 1n,
      nextSaleListingId: nextSaleListingId?.status === "success" ? nextSaleListingId.result : 1n,
    },
    isLoading: reads.isLoading,
    error: reads.error,
  };
}
