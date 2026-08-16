import { keepPreviousData } from "@tanstack/react-query";
import type { Address } from "viem";
import type { BlockIdentity } from "./discovery/types";

/** Event-truth refetch cadence. Named owner of the read interval (KTD9 / mechanism map). */
export const READ_INTERVAL_MS = 15_000;
/** Pinned snapshot gc: two intervals. Default five minutes would retain dead pages. */
export const PINNED_GC_TIME_MS = READ_INTERVAL_MS * 2;
/** TanStack retry budget — pinned low so `isError` is not delayed by stacked retries. */
export const QUERY_RETRY = 1;

export const readQuery = {
  refetchInterval: READ_INTERVAL_MS,
  refetchOnWindowFocus: true,
  retry: QUERY_RETRY,
} as const;

/** Pinned enumeration: the pin in the query key is the invalidation. */
export const pinnedQuery = {
  retry: QUERY_RETRY,
  gcTime: PINNED_GC_TIME_MS,
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnWindowFocus: false,
  placeholderData: keepPreviousData,
} as const;

function addr(value?: Address | null): string | null {
  return value ? value.toLowerCase() : null;
}

function id(value: bigint | number | string): string {
  return String(value);
}

// Only real useQuery keys live here. wagmi read hooks own their keys (rooted at
// ["readContract"] / ["readContracts"]); post-write invalidation is coarse (KTD5).
// Held-stream discovery is wagmi-only after U8 — no custom streamKeys factories.
export const borrowKeys = {
  all: ["borrow"] as const,
  quote: (
    chainId: number,
    lending?: Address | null,
    market?: Address | null,
    streamId?: bigint | null,
    aprBps?: number | null,
    targetBorrow?: bigint | null,
  ) =>
    [
      ...borrowKeys.all,
      "quote",
      chainId,
      addr(lending),
      addr(market),
      streamId == null ? null : id(streamId),
      aprBps ?? null,
      targetBorrow == null ? null : id(targetBorrow),
    ] as const,
};

export const demandKeys = {
  all: ["demand"] as const,
  market: (market?: Address | null) => [...demandKeys.all, "market", market] as const,
};

export const ladderKeys = {
  all: ["ladder"] as const,
  market: (chainId: number, lending?: Address | null, market?: Address | null) =>
    [...ladderKeys.all, chainId, addr(lending), addr(market)] as const,
};

export const lenderBookKeys = {
  all: ["lender-book"] as const,
  account: (chainId: number, lending?: Address | null, account?: Address | null) =>
    [...lenderBookKeys.all, chainId, addr(lending), addr(account)] as const,
  factory: (chainId: number, account?: Address | null, lendings?: readonly Address[]) =>
    [
      ...lenderBookKeys.all,
      "factory",
      chainId,
      addr(account),
      (lendings ?? []).map((value) => value.toLowerCase()).join(","),
    ] as const,
  loansOf: (
    chainId: number,
    lending: Address,
    positionId: bigint | string,
  ) =>
    ["lender-book", "loans-of", chainId, addr(lending), id(positionId)] as const,
};

export const borrowerBookKeys = {
  all: ["borrower-book"] as const,
  account: (chainId: number, lending?: Address | null, account?: Address | null) =>
    [...borrowerBookKeys.all, chainId, addr(lending), addr(account)] as const,
  factory: (chainId: number, account?: Address | null, lendings?: readonly Address[]) =>
    [
      ...borrowerBookKeys.all,
      "factory",
      chainId,
      addr(account),
      (lendings ?? []).map((value) => value.toLowerCase()).join(","),
    ] as const,
};

export const streamBookKeys = {
  all: ["stream-book"] as const,
  wall: (
    chainId: number,
    lockup?: Address | null,
    account?: Address | null,
    blockHash?: string | null,
  ) =>
    [
      ...streamBookKeys.all,
      "wall",
      chainId,
      addr(lockup),
      addr(account),
      blockHash ? blockHash.toLowerCase() : null,
    ] as const,
  complete: (
    chainId: number,
    lockup?: Address | null,
    account?: Address | null,
    blockHash?: string | null,
  ) =>
    [
      ...streamBookKeys.all,
      "complete",
      chainId,
      addr(lockup),
      addr(account),
      blockHash ? blockHash.toLowerCase() : null,
    ] as const,
};

export const usdKeys = {
  all: ["usd"] as const,
  price: (chainId: number, feed?: Address | null, wsteth?: Address | null) =>
    [...usdKeys.all, "price", chainId, addr(feed), addr(wsteth)] as const,
};

export const freshnessKeys = {
  all: ["freshness"] as const,
  scope: (chainId: number, account?: Address | null) =>
    [...freshnessKeys.all, chainId, addr(account)] as const,
};

export const protocolBootstrapKeys = {
  all: ["protocolBootstrap"] as const,
  root: (factoryAddress: Address, chainId: number) =>
    [...protocolBootstrapKeys.all, addr(factoryAddress), chainId] as const,
};

export const DISCOVERY_SCHEMA_VERSION = 1;
export const DISCOVERY_GC_TIME_MS = 10 * 60 * 1000;

export type ProjectionScopeKey = {
  chainId: number;
  factoryAnchor: BlockIdentity;
  lending?: Address | null;
  kind: "market-apr" | "lender" | "borrower" | "demand" | "stream" | "claim-verifier";
  market?: Address | null;
  aprBps?: number | null;
  account?: Address | null;
  transportRole?: "primary" | "verifier";
};

export const projectionKeys = {
  all: ["projection", DISCOVERY_SCHEMA_VERSION] as const,
  scope: (scope: ProjectionScopeKey) =>
    [
      ...projectionKeys.all,
      scope.chainId,
      scope.factoryAnchor.number.toString(),
      scope.factoryAnchor.hash.toLowerCase(),
      scope.lending?.toLowerCase() ?? null,
      scope.kind,
      scope.market?.toLowerCase() ?? null,
      scope.aprBps ?? null,
      scope.account?.toLowerCase() ?? null,
      scope.transportRole ?? "primary",
    ] as const,
};
