import type { Address } from "viem";

export const ovrfloKeys = {
  all: ["ovrflo"] as const,
  list: (factory?: Address) => [...ovrfloKeys.all, "list", factory] as const,
  markets: (factory?: Address) => [...ovrfloKeys.all, "markets", factory] as const,
};

export const lendingKeys = {
  all: ["lending"] as const,
  params: (lending?: Address | null) => [...lendingKeys.all, "params", lending] as const,
  liquidity: (lending?: Address | null) => [...lendingKeys.all, "liquidity", lending] as const,
  lenderPools: (lending?: Address | null, user?: Address | null) =>
    [...lendingKeys.all, "lender-pools", lending, user] as const,
  borrowerLoans: (lending?: Address | null, user?: Address | null) =>
    [...lendingKeys.all, "borrower-loans", lending, user] as const,
};

export const streamKeys = {
  all: ["streams"] as const,
  held: (user?: Address | null) => [...streamKeys.all, "held", user] as const,
};
