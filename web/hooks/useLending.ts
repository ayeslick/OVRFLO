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
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextLiquidityId" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextLoanId" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "nextSaleListingId" },
          { address: lending, abi: ovrfloLendingAbi, functionName: "MAX_ROUTE_IDS" },
        ]
      : [],
    query: { enabled },
  });

  const [aprMin, aprMax, fee, nextLiquidityId, nextLoanId, nextSaleListingId, maxRouteIds] = reads.data ?? [];
  const complete =
    !enabled ||
    (reads.data?.length === 7 &&
      reads.data.every((result) => result.status === "success"));

  return {
    params: {
      aprMinBps: aprMin?.status === "success" ? aprMin.result : 0,
      aprMaxBps: aprMax?.status === "success" ? aprMax.result : 0,
      feeBps: fee?.status === "success" ? fee.result : 0,
      nextLiquidityId: nextLiquidityId?.status === "success" ? nextLiquidityId.result : 1n,
      nextLoanId: nextLoanId?.status === "success" ? nextLoanId.result : 1n,
      nextSaleListingId: nextSaleListingId?.status === "success" ? nextSaleListingId.result : 1n,
      maxRouteIds:
        maxRouteIds?.status === "success" ? Number(maxRouteIds.result) : 0,
    },
    isLoading: reads.isLoading,
    error:
      reads.error ??
      (enabled && !reads.isLoading && !complete
        ? INCOMPLETE_LENDING_PARAMS
        : null),
  };
}
