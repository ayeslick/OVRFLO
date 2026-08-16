import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import type { ActionIdentity, TouchedResource } from "./actions/types";
import { factoryAddress } from "./config";
import { borrowerBookKeys, lenderBookKeys, protocolBootstrapKeys, streamBookKeys } from "./query-keys";
import type { MarketInfo } from "./types";

// wagmi v3 roots useReadContract / useReadContracts keys at these string
// literals, with the call's own parameters — including `address` — nested
// inside (verified against wagmi 3.7.3).
export const WAGMI_READ_ROOTS = ["readContract", "readContracts"] as const;

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
  options: {
    contracts: readonly Address[];
    user?: Address;
    streams?: boolean;
    stream?: Address;
  },
) {
  const touched = new Set(options.contracts.filter(Boolean).map((address) => address.toLowerCase()));

  for (const root of WAGMI_READ_ROOTS) {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === root && keyMentionsAny(query.queryKey, touched),
    });
  }

  if (options.streams && options.stream) {
    touched.add(options.stream.toLowerCase());
    for (const root of WAGMI_READ_ROOTS) {
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === root && keyMentionsAny(query.queryKey, touched),
      });
    }
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === streamBookKeys.all[0] && keyMentionsAny(query.queryKey, touched),
    });
  }
}

// Matches on the serialised key rather than walking wagmi's internal key shape:
// that shape is not part of its public contract, and an address sits at
// different depths for a single read versus a batched one.
export function keyMentionsAny(
  queryKey: readonly unknown[],
  addresses: ReadonlySet<string>,
): boolean {
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
 * The transaction's `to` address is not the whole answer: `supply`
 * targets the lending market but pulls the underlying ERC-20, `deposit` targets
 * the vault but pulls PT and mints ovrfloToken, and `repay` moves underlying
 * back. Those balance/allowance reads are keyed by *token* address, so scoping
 * to `to` alone leaves the balance the user is about to act on next showing a
 * pre-transaction number — and with window-focus refetching off, it stays that
 * way until the view remounts.
 *
 * Naming the market's whole contract set keeps the invalidation honest while
 * staying proportional: one market's reads refresh, not every market's.
 */
export function marketContracts(
  market: Pick<MarketInfo, "vault" | "lending" | "underlying" | "ovrfloToken" | "ptToken">,
  stream: Address,
) {
  return [
    market.vault,
    market.lending,
    market.underlying,
    market.ovrfloToken,
    market.ptToken,
    stream,
  ].filter((address): address is Address => Boolean(address));
}

function resourceContracts(resource: TouchedResource): Address[] {
  switch (resource.kind) {
    case "contract":
      return [resource.address];
    case "market":
      return [resource.vault, resource.market];
    case "market-depth":
    case "liquidity-position":
    case "loan":
      return [resource.lending];
    case "stream":
      return [resource.sablier];
    case "nft-approval":
      return [resource.token];
    case "token-balance":
    case "allowance":
      return [resource.token];
  }
}

/**
 * After a write receipt, invalidate exactly the declared `touchedResources`.
 * Broadest sensible level: wagmi reads whose keys mention a touched contract,
 * plus the book query factories those resources correspond to.
 */
export function invalidateTouchedResources(
  queryClient: QueryClient,
  resources: readonly TouchedResource[],
  identity?: ActionIdentity,
) {
  void identity;
  const contracts = new Set(resources.flatMap(resourceContracts).map((address) => address.toLowerCase()));
  for (const root of WAGMI_READ_ROOTS) {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === root && keyMentionsAny(query.queryKey, contracts),
    });
  }
  const kinds = new Set(resources.map((resource) => resource.kind));
  if (kinds.has("liquidity-position") || kinds.has("market-depth")) {
    queryClient.invalidateQueries({ queryKey: lenderBookKeys.all });
  }
  if (kinds.has("loan")) {
    queryClient.invalidateQueries({ queryKey: borrowerBookKeys.all });
    queryClient.invalidateQueries({ queryKey: lenderBookKeys.all });
  }
  if (kinds.has("stream") || kinds.has("nft-approval")) {
    queryClient.invalidateQueries({ queryKey: streamBookKeys.all });
  }
  // Append-only factory registry: refresh discovery after a registration write.
  if (contracts.has(factoryAddress.toLowerCase())) {
    queryClient.invalidateQueries({ queryKey: protocolBootstrapKeys.all });
  }
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
  void user;
  for (const root of WAGMI_READ_ROOTS) {
    queryClient.invalidateQueries({ queryKey: [root] });
  }
  queryClient.invalidateQueries({ queryKey: protocolBootstrapKeys.all });
  queryClient.invalidateQueries({ queryKey: streamBookKeys.all });
  queryClient.invalidateQueries({ queryKey: lenderBookKeys.all });
  queryClient.invalidateQueries({ queryKey: borrowerBookKeys.all });
}

/**
 * Drop every address- or chain-keyed cache entry for a departed identity so
 * no surface can keep rendering the previous account's entities.
 */
export function removeIdentityQueries(
  queryClient: QueryClient,
  identity: { account?: Address; chainId?: number },
) {
  const account = identity.account?.toLowerCase();
  const chainId = identity.chainId;
  if (!account && chainId === undefined) return;
  queryClient.removeQueries({
    predicate: (query) => queryTouchesIdentity(query.queryKey, { account, chainId }),
  });
}

export function queryTouchesIdentity(
  queryKey: readonly unknown[],
  identity: { account?: string; chainId?: number },
): boolean {
  if (identity.account) {
    const serialised = JSON.stringify(queryKey, bigintSafe).toLowerCase();
    if (serialised.includes(identity.account)) return true;
  }
  if (identity.chainId !== undefined) {
    return queryKey.some((part) => part === identity.chainId);
  }
  return false;
}

const bigintSafe = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
