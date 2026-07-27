"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlock } from "wagmi";
import type { Address } from "viem";
import { ponderUrl } from "@/lib/config";
import { aggregateDemand, type RateDemand } from "@/lib/demand";
import { fetchBorrowDemand } from "@/lib/ponder";
import { demandKeys } from "@/lib/query-keys";

// "unavailable" (indexer unconfigured or unreachable) is deliberately distinct
// from an "ok" result with zero rows — the UI must never render "no data" as
// zero demand or vice versa. The rest of the app never depends on this hook.
export type BorrowDemandStatus = "loading" | "ok" | "unavailable";

export function useBorrowDemand(market: Address | null | undefined, self?: Address) {
  // The trailing window anchors to CHAIN time, not wall-clock time — on a
  // local fork (or a lagging testnet) the two diverge by months, and a
  // wall-clock cutoff would silently exclude every indexed borrow.
  const block = useBlock({ query: { staleTime: 30_000 } });
  const nowSeconds = block.data?.timestamp;
  const configured = Boolean(ponderUrl);

  const query = useQuery({
    queryKey: demandKeys.market(market),
    enabled: Boolean(market) && configured && nowSeconds !== undefined,
    queryFn: () => fetchBorrowDemand(market as Address, nowSeconds as bigint),
    staleTime: 30_000,
    retry: 1,
  });

  const demand = useMemo<RateDemand[]>(
    () =>
      query.data && nowSeconds !== undefined
        ? aggregateDemand(query.data, { nowSeconds, self })
        : [],
    [query.data, nowSeconds, self],
  );

  const peak = useMemo(() => demand.reduce((max, row) => (row.amount > max ? row.amount : max), 0n), [demand]);

  const status: BorrowDemandStatus = !configured
    ? "unavailable"
    : query.isError || block.isError
      ? "unavailable"
      : query.isLoading || nowSeconds === undefined
        ? "loading"
        : "ok";

  return { status, demand, peak };
}
