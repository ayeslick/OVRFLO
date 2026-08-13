import type { Address } from "viem";
import type { BlockIdentity } from "./discovery/types";

/** Event-truth refetch cadence. Named owner of the read interval (KTD9 / mechanism map). */
export const READ_INTERVAL_MS = 15_000;
/** TanStack retry budget — pinned low so `isError` is not delayed by stacked retries. */
export const QUERY_RETRY = 1;

export const readQuery = {
  refetchInterval: READ_INTERVAL_MS,
  refetchOnWindowFocus: true,
  retry: QUERY_RETRY,
} as const;

function addr(value?: Address | null): string | null {
  return value ? value.toLowerCase() : null;
}

function id(value: bigint | number | string): string {
  return String(value);
}

// Only real useQuery keys live here. wagmi read hooks own their keys (rooted at
// ["readContract"] / ["readContracts"]); post-write invalidation is coarse (KTD5).
// Every custom factory key includes chainId and address; entity IDs are strings
// only (bigint crashes hashKey; mixed 5n/"5" breaks structural matching).
export const streamKeys = {
  all: ["streams"] as const,
  held: (user?: Address | null) => [...streamKeys.all, "held", user] as const,
  candidates: (chainId: number, account?: Address | null) =>
    ["streams", "candidates", chainId, addr(account)] as const,
  truth: (chainId: number, account?: Address | null) =>
    ["streams", "truth", chainId, addr(account)] as const,
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
