import type { Address } from "viem";
import type { LiquidityPosition } from "./types";

// Pure borrow router (plan KTD3). Liquidity-coverage only — price-blind by design:
// the quoting layer clamps to the tick's grossPrice cap (applied in the BORROW form).

export type TickDepth = {
  aprBps: number;
  total: bigint;
  own: bigint;
  positions: LiquidityPosition[];
};

export type BorrowPlan =
  | { kind: "full"; aprBps: number; ids: bigint[] }
  | { kind: "partial"; aprBps: number; ids: bigint[]; available: bigint }
  | { kind: "empty" };

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

// Lowest covering tick wins; within it, the first single covering position (ascending
// id) beats FIFO accumulation. Ids are strictly increasing by construction (contract
// pattern #10) and never include self-owned positions (contract reverts on self-match),
// which is why `self` is threaded here too — `TickDepth.positions` keeps self entries
// for UI display.
export function planBorrow(
  ladder: TickDepth[],
  target: bigint,
  // Required (not optional) so a caller with a connected wallet cannot silently
  // forget it and plan against the borrower's own liquidity; pass undefined only
  // when there is genuinely no connected address.
  self: Address | undefined,
): { primary: BorrowPlan; alternative: BorrowPlan | null } {
  const ticks = [...ladder].sort((a, b) => a.aprBps - b.aprBps);
  const selfKey = self?.toLowerCase();
  const drawable = (tick: TickDepth) =>
    tick.positions.filter((p) => !selfKey || p.lender.toLowerCase() !== selfKey);
  const partialAt = (tick: TickDepth): BorrowPlan => ({
    kind: "partial",
    aprBps: tick.aprBps,
    ids: drawable(tick).map((p) => p.id),
    available: tick.total,
  });

  const coveringTick = ticks.find((t) => t.total > 0n && t.total >= target);
  if (coveringTick) {
    const candidates = drawable(coveringTick);
    const single = candidates.find((p) => p.availableLiquidity >= target);
    let ids: bigint[];
    if (single) {
      ids = [single.id];
    } else {
      ids = [];
      let sum = 0n;
      for (const p of candidates) {
        ids.push(p.id);
        sum += p.availableLiquidity;
        if (sum >= target) break;
      }
    }
    const lower = ticks.find((t) => t.aprBps < coveringTick.aprBps && t.total > 0n);
    return {
      primary: { kind: "full", aprBps: coveringTick.aprBps, ids },
      alternative: lower ? partialAt(lower) : null,
    };
  }

  const lowestLiquid = ticks.find((t) => t.total > 0n);
  if (lowestLiquid) {
    return { primary: partialAt(lowestLiquid), alternative: null };
  }
  return { primary: { kind: "empty" }, alternative: null };
}
