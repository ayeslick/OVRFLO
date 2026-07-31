"use client";

import { useMemo } from "react";
import { useBlock } from "wagmi";
import type { Address } from "viem";
import { aggregateDemand, type RateDemand } from "@/lib/demand";
import { useBorrowDemandProjection } from "./useLendingProjection";

export type BorrowDemandStatus = "loading" | "ok" | "unavailable";

export function useBorrowDemand(
  lending: Address | null | undefined,
  market: Address | null | undefined,
  self?: Address,
) {
  const block = useBlock({ query: { staleTime: 30_000 } });
  const projection = useBorrowDemandProjection(lending, market);
  const nowSeconds = block.data?.timestamp;
  const demand = useMemo<RateDemand[]>(
    () =>
      projection.outcome.status === "ready" && nowSeconds !== undefined
        ? aggregateDemand([...projection.outcome.data.events], {
            nowSeconds,
            self,
          })
        : [],
    [nowSeconds, projection.outcome, self],
  );
  const peak = useMemo(
    () =>
      demand.reduce(
        (maximum, row) => (row.amount > maximum ? row.amount : maximum),
        0n,
      ),
    [demand],
  );
  const status: BorrowDemandStatus =
    projection.outcome.status === "unavailable" || block.isError
      ? "unavailable"
      : projection.outcome.status === "loading" || nowSeconds === undefined
        ? "loading"
        : "ok";
  return { status, demand, peak, outcome: projection.outcome };
}
