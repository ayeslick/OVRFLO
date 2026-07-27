import type { Address } from "viem";

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
