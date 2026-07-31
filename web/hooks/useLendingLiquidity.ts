"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useMarketLiquidityProjection } from "./useLendingProjection";

export function useLendingLiquidity(
  lending: Address | null | undefined,
  market: Address | null | undefined,
) {
  const projection = useMarketLiquidityProjection(lending, market);
  const liquidity = useMemo(
    () =>
      projection.outcome.status === "ready"
        ? [...projection.outcome.data.positions].sort((left, right) =>
            left.id > right.id ? -1 : left.id < right.id ? 1 : 0,
          )
        : [],
    [projection.outcome],
  );
  return {
    liquidity,
    outcome: projection.outcome,
    isLoading: projection.isLoading,
    error: projection.error,
  };
}
