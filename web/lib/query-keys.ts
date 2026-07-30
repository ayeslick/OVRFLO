import type { Address } from "viem";
import type { BlockIdentity } from "./discovery/types";

// Only real useQuery keys live here. wagmi read hooks own their keys (rooted at
// ["readContract"] / ["readContracts"]); post-write invalidation is coarse (KTD5).
export const streamKeys = {
  all: ["streams"] as const,
  held: (user?: Address | null) => [...streamKeys.all, "held", user] as const,
};

export const demandKeys = {
  all: ["demand"] as const,
  market: (market?: Address | null) => [...demandKeys.all, "market", market] as const,
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
