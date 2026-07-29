"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { fetchHeldStreamIds } from "@/lib/ponder";
import { streamKeys } from "@/lib/query-keys";
import type { HeldStream } from "@/lib/types";

type SablierStream = {
  sender: Address;
  asset: Address;
  endTime: bigint | number;
  wasCanceled: boolean;
  isDepleted: boolean;
  isStream: boolean;
  amounts: { deposited: bigint; withdrawn: bigint };
};

/**
 * Discovers a user's streams through the indexer, then reads every value the
 * app displays or acts on from Sablier itself.
 *
 * R37/M-9: only `withdrawable` used to be hydrated. Recipient, sender, asset,
 * end time, canceled, depleted, deposited and withdrawn all came straight from
 * the indexer — and `isSeriesMatchedStream` gates eligibility on four of them.
 * A stale or wrong indexer could therefore present an ineligible stream as
 * eligible, or show one the connected address no longer owns, and the app would
 * let the user act on it.
 *
 * So the indexer answers exactly one question — *which stream ids might be
 * mine* — and the chain answers everything else. A stream whose on-chain owner
 * is not the connected address is dropped rather than rendered: the indexer
 * naming an id is a hint, not a claim of ownership.
 */
// R43: how long a cached stream set may be served after discovery starts
// failing. Past this the set is discarded rather than shown behind a warning —
// an hour-old list of streams is not "slightly stale", it is a different
// picture of the user's holdings, and the direct-contract route in R44 is a
// better answer than a confident wrong one.
const MAX_STALE_MS = 10 * 60 * 1000;

export function useHeldStreams(user: Address | null | undefined) {
  const discovery = useQuery({
    queryKey: streamKeys.held(user),
    enabled: Boolean(user),
    queryFn: () => fetchHeldStreamIds(user as Address),
  });

  // Cache lives in the in-memory query cache only — deliberately not persisted
  // across reloads. Persisting it would put one address's stream set at rest in
  // a possibly-shared browser, and the on-chain recipient re-check protects what
  // renders, not what sits on disk. A reload paying one discovery round trip is
  // the cheaper trade.
  const servingCache = Boolean(discovery.isError && discovery.data);
  const cacheAgeMs = discovery.dataUpdatedAt ? Date.now() - discovery.dataUpdatedAt : Infinity;
  const cacheExpired = servingCache && cacheAgeMs > MAX_STALE_MS;

  const streamIds = useMemo(
    () => (cacheExpired ? [] : (discovery.data ?? [])),
    [cacheExpired, discovery.data],
  );

  // Three reads per stream, batched into one multicall: the full record, the
  // live withdrawable amount (which the record does not carry), and the NFT
  // owner — the only authority on who holds the stream right now.
  const chainReads = useReadContracts({
    contracts: streamIds.flatMap((streamId) => [
      {
        address: SABLIER_LOCKUP_ADDRESS,
        abi: sablierLockupAbi,
        functionName: "getStream" as const,
        args: [streamId] as const,
      },
      {
        address: SABLIER_LOCKUP_ADDRESS,
        abi: sablierLockupAbi,
        functionName: "withdrawableAmountOf" as const,
        args: [streamId] as const,
      },
      {
        address: SABLIER_LOCKUP_ADDRESS,
        abi: sablierLockupAbi,
        functionName: "ownerOf" as const,
        args: [streamId] as const,
      },
    ]),
    query: { enabled: streamIds.length > 0 },
  });

  const streams = useMemo<HeldStream[]>(() => {
    const ids: bigint[] = cacheExpired ? [] : (discovery.data ?? []);
    const results = chainReads.data;
    if (!results) return [];

    const hydrated: HeldStream[] = [];
    ids.forEach((streamId, index) => {
      const record = results[index * 3];
      const withdrawable = results[index * 3 + 1];
      const owner = results[index * 3 + 2];

      // A read that did not resolve is not evidence of anything. Dropping is
      // the safe direction — falling back to the indexer's copy is exactly what
      // this hook exists to stop.
      if (record?.status !== "success" || owner?.status !== "success") return;

      const stream = record.result as unknown as SablierStream;
      if (!stream.isStream) return;

      // The ownership check. The indexer said this id belongs to the user; the
      // chain decides whether it does.
      if ((owner.result as Address).toLowerCase() !== (user ?? "").toLowerCase()) return;

      hydrated.push({
        streamId,
        recipient: owner.result as Address,
        sender: stream.sender,
        asset: stream.asset,
        endTime: BigInt(stream.endTime),
        canceled: stream.wasCanceled,
        depleted: stream.isDepleted,
        deposited: stream.amounts.deposited,
        withdrawn: stream.amounts.withdrawn,
        withdrawable:
          withdrawable?.status === "success" ? (withdrawable.result as bigint) : 0n,
      });
    });
    return hydrated;
  }, [cacheExpired, chainReads.data, discovery.data, user]);

  return {
    streams,
    isLoading: discovery.isLoading || chainReads.isLoading,
    error: discovery.error ?? chainReads.error,
    // R43: discovery is failing but a usable cached set is still being served,
    // hydrated from chain. Actions stay enabled — the contracts validate every
    // one at submission, and blocking them reproduces the H-5 harm of a user
    // unable to reach their own withdraw path through the app.
    stale: servingCache && !cacheExpired,
    // R44: nothing to show and no way to find out. The caller must render the
    // direct-contract recovery route, never an empty list.
    unavailable: Boolean(discovery.isError) && (!discovery.data || cacheExpired),
  };
}
