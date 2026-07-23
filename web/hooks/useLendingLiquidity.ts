"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { isConfiguredAddress, ZERO_ADDRESS } from "@/lib/config";
import { lendingKeys } from "@/lib/query-keys";
import type { LiquidityPosition } from "@/lib/types";
import { enumerateIds, MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import { useLending } from "./useLending";

export function useLendingLiquidity(lending: Address | null | undefined) {
  const lendingState = useLending(lending);
  const ids = useMemo(
    () => enumerateIds(lendingState.params.nextLiquidityId),
    [lendingState.params.nextLiquidityId],
  );

  const reads = useReadContracts({
    contracts: lending
      ? ids.map((id) => ({
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "liquidityPositions" as const,
          args: [id] as const,
        }))
      : [],
    query: { enabled: isConfiguredAddress(lending ?? null) && ids.length > 0 },
  });

  const liquidity = useMemo<LiquidityPosition[]>(() => {
    return (reads.data ?? [])
      .map((result, index) => {
        if (result.status !== "success") return null;
        const [lender, market, aprBps, availableLiquidity] = result.result as [Address, Address, number, bigint];
        if (lender === ZERO_ADDRESS) return null;
        return {
          id: ids[index],
          lender,
          market,
          aprBps,
          availableLiquidity,
        };
      })
      .filter((position): position is LiquidityPosition => Boolean(position))
      .sort((a, b) => (a.id > b.id ? -1 : 1));
  }, [ids, reads.data]);

  return {
    queryKey: lendingKeys.liquidity(lending),
    liquidity,
    tooLarge: lendingState.params.nextLiquidityId > MAX_ENUMERATION_IDS + 1n,
    isLoading: lendingState.isLoading || reads.isLoading,
    error: lendingState.error ?? reads.error,
  };
}
