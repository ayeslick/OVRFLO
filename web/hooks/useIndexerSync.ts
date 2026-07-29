"use client";

import { useQuery } from "@tanstack/react-query";
import { useBlockNumber } from "wagmi";
import { ponderUrl } from "@/lib/config";

// How far the indexer may trail chain head before the view says so. Ponder polls
// at 2s and mainnet blocks land every ~12s, so a lag of one or two blocks is the
// normal resting state and flagging it would train users to ignore the warning.
const LAG_TOLERANCE_BLOCKS = 5n;

/**
 * Whether indexer-backed data can be trusted to be current.
 *
 * R40 originally read "lagging the user's last confirmed write". That cannot
 * fire for the person it most needs to protect: in a sale fill the *borrower*
 * signs, so the lender who just acquired a stream has no write of their own to
 * lag behind — they would see a confident, complete-looking list that silently
 * omits what they just bought. Same for a borrower whose stream returns via a
 * permissionless `closeLoan`.
 *
 * Anchoring to chain head covers both, and every other case the original
 * wording covered, because a user's own write is by definition at or behind
 * head.
 */
export function useIndexerSync() {
  const chainHead = useBlockNumber({ query: { refetchInterval: 12_000 } });

  const synced = useQuery({
    queryKey: ["indexer", "status"],
    enabled: Boolean(ponderUrl),
    refetchInterval: 10_000,
    queryFn: async () => {
      const base = (ponderUrl as string).replace(/\/sql\/?$/, "").replace(/\/$/, "");
      const response = await fetch(`${base}/status`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`Indexer status unavailable (${response.status}).`);
      const body = (await response.json()) as Record<string, { block?: { number?: number } }>;
      // Ponder keys status by chain name; the app is single-chain, so take
      // whichever entry carries a block rather than hard-coding the name.
      const entry = Object.values(body).find((chain) => typeof chain?.block?.number === "number");
      if (!entry?.block) throw new Error("Indexer reported no synced block.");
      return BigInt(entry.block.number as number);
    },
  });

  const syncedBlock = synced.data;
  const headBlock = chainHead.data;

  const lagBlocks = syncedBlock !== undefined && headBlock !== undefined ? headBlock - syncedBlock : null;

  return {
    syncedBlock,
    headBlock,
    lagBlocks,
    // Unknown is not stale: a failed status read is its own signal, and the
    // degraded-view states in useHeldStreams already cover discovery failing.
    lagging: lagBlocks !== null && lagBlocks > LAG_TOLERANCE_BLOCKS,
  };
}
