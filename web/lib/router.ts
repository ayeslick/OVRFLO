import type { Address } from "viem";
import type { LiquidityPosition } from "./types";

// Pure ladder builder (plan KTD3). Liquidity-coverage only — price-blind by design:
// the quoting layer clamps to the tick's grossPrice cap (applied in the BORROW form).
// Selection-scoped fill planning lives in lib/borrow.ts (planSelectedBorrow).

export type TickDepth = {
  aprBps: number;
  total: bigint;
  own: bigint;
  positions: LiquidityPosition[];
};

// Groups open positions for `market` per tick. `total` excludes self-owned liquidity
// (a borrower can never draw against their own supply), `own` is self-owned only;
// `positions` keeps both, sorted ascending by id — input order is never assumed
// (useLendingLiquidity returns descending ids).
export function buildLadder(
  positions: LiquidityPosition[],
  market: Address,
  ticks: number[],
  self?: Address,
): TickDepth[] {
  const marketKey = market.toLowerCase();
  const selfKey = self?.toLowerCase();
  const open = positions
    .filter((p) => p.market.toLowerCase() === marketKey && p.availableLiquidity > 0n)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  return [...ticks]
    .sort((a, b) => a - b)
    .map((aprBps) => {
      const atTick = open.filter((p) => p.aprBps === aprBps);
      let total = 0n;
      let own = 0n;
      for (const p of atTick) {
        if (selfKey && p.lender.toLowerCase() === selfKey) own += p.availableLiquidity;
        else total += p.availableLiquidity;
      }
      return { aprBps, total, own, positions: atTick };
    });
}
