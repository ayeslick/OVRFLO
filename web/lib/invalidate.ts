import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { SABLIER_LOCKUP_ADDRESS } from "./config";
import { streamKeys } from "./query-keys";
import type { MarketInfo } from "./types";

// wagmi v3 roots useReadContract / useReadContracts keys at these string
// literals, with the call's own parameters — including `address` — nested
// inside (verified against wagmi 3.7.3).
const WAGMI_READ_ROOTS = ["readContract", "readContracts"] as const;

/**
 * Invalidates the on-chain reads a confirmed transaction could have changed.
 *
 * R39: this used to prefix-match the two wagmi roots and refetch *every*
 * mounted read on any write — a deposit into one market refetched every other
 * market's ladder, balances and loan book. Scoping to the contracts the
 * transaction actually touched keeps a write's cost proportional to the write.
 *
 * `contracts` is the set of addresses the transaction interacted with. A read
 * matches if any of them appears in its query key. `useReadContracts` batches
 * several addresses under one key, so a batch is invalidated when it contains
 * *any* touched contract — splitting the batch to be more precise would cost
 * more than the occasional extra refetch.
 */
export function invalidateOnChainReads(
  queryClient: QueryClient,
  options: { contracts: readonly Address[]; user?: Address; streams?: boolean },
) {
  const touched = new Set(options.contracts.filter(Boolean).map((address) => address.toLowerCase()));

  for (const root of WAGMI_READ_ROOTS) {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === root && keyMentionsAny(query.queryKey, touched),
    });
  }

  if (options.streams) {
    queryClient.invalidateQueries({ queryKey: streamKeys.held(options.user) });
  }
}

// Matches on the serialised key rather than walking wagmi's internal key shape:
// that shape is not part of its public contract, and an address sits at
// different depths for a single read versus a batched one.
function keyMentionsAny(queryKey: readonly unknown[], addresses: ReadonlySet<string>): boolean {
  if (addresses.size === 0) return false;
  const serialised = JSON.stringify(queryKey, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  ).toLowerCase();
  for (const address of addresses) {
    if (serialised.includes(address)) return true;
  }
  return false;
}

/**
 * Every contract a write inside one market can change the reads of.
 *
 * The transaction's `to` address is not the whole answer: `supplyLiquidity`
 * targets the lending market but pulls the underlying ERC-20, `deposit` targets
 * the vault but pulls PT and mints ovrfloToken, and `repayLoan` moves underlying
 * back. Those balance/allowance reads are keyed by *token* address, so scoping
 * to `to` alone leaves the balance the user is about to act on next showing a
 * pre-transaction number — and with window-focus refetching off, it stays that
 * way until the view remounts.
 *
 * Naming the market's whole contract set keeps the invalidation honest while
 * staying proportional: one market's reads refresh, not every market's.
 */
export function marketContracts(market: Pick<MarketInfo, "vault" | "lending" | "underlying" | "ovrfloToken" | "ptToken">) {
  return [
    market.vault,
    market.lending,
    market.underlying,
    market.ovrfloToken,
    market.ptToken,
    SABLIER_LOCKUP_ADDRESS,
  ].filter((address): address is Address => Boolean(address));
}

/**
 * The deliberately unscoped refresh.
 *
 * `useStaleRecovery` fires on a classified stale-liquidity error, which is
 * caused by *another* party's write — there is no transaction of ours to scope
 * by, and the whole point is picking up what someone else changed. Handing this
 * an empty scope would quietly turn it into a no-op and reintroduce the
 * liquidity race it exists to recover from, so it keeps the broad behaviour and
 * is named for it.
 */
export function invalidateAllOnChainReads(queryClient: QueryClient, user?: Address) {
  for (const root of WAGMI_READ_ROOTS) {
    queryClient.invalidateQueries({ queryKey: [root] });
  }
  queryClient.invalidateQueries({ queryKey: streamKeys.held(user) });
}

const bigintSafe = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

// The held-streams list is indexer-backed, so the instant invalidation above
// races the indexer (2s polling + indexing time). Re-invalidate on a short
// schedule, stopping early once the result set changes; 3 attempts total
// including the immediate one so a persistently stale indexer never loops.
// Returns a cleanup that cancels pending timers.
export function scheduleHeldStreamsRetry(
  queryClient: QueryClient,
  user: Address | undefined,
  delaysMs: readonly number[] = [2000, 5000],
) {
  const queryKey = streamKeys.held(user);
  const initial = JSON.stringify(queryClient.getQueryData(queryKey) ?? null, bigintSafe);
  const timers = delaysMs.map((delay) =>
    setTimeout(() => {
      const current = JSON.stringify(queryClient.getQueryData(queryKey) ?? null, bigintSafe);
      if (current !== initial) return;
      queryClient.invalidateQueries({ queryKey });
    }, delay),
  );
  return () => timers.forEach((timer) => clearTimeout(timer));
}
