import { isAddressEqual, type Address } from "viem";
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
  const open = positions
    .filter((p) => isAddressEqual(p.market, market) && p.availableLiquidity > 0n)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return [...ticks]
    .sort((a, b) => a - b)
    .map((aprBps) => {
      const atTick = open.filter((p) => p.aprBps === aprBps);
      let total = 0n;
      let own = 0n;
      for (const p of atTick) {
        if (self && isAddressEqual(p.lender, self)) own += p.availableLiquidity;
        else total += p.availableLiquidity;
      }
      return { aprBps, total, own, positions: atTick };
    });
}

export type HydratedRouteResult =
  | {
      status: "conservation-failed";
      projectedDepth: bigint;
      aggregateDepth: bigint;
    }
  | {
      status: "ready" | "insufficient" | "fragmented";
      publicDepth: bigint;
      executableDepth: bigint;
      fragmentedDepth: bigint;
      selfExcludedDepth: bigint;
      selectedDepth: bigint;
      selectedIds: bigint[];
    };

export function selectHydratedRoute({
  positions,
  borrower,
  target,
  aggregateDepth,
  maxRouteIds,
}: {
  positions: readonly LiquidityPosition[];
  borrower?: Address;
  target: bigint;
  aggregateDepth: bigint;
  maxRouteIds: number;
}): HydratedRouteResult {
  if (!Number.isSafeInteger(maxRouteIds) || maxRouteIds <= 0) {
    throw new Error("maxRouteIds must be a positive safe integer");
  }
  const projectedDepth = positions.reduce((sum, position) => sum + position.availableLiquidity, 0n);
  if (projectedDepth !== aggregateDepth) {
    return { status: "conservation-failed", projectedDepth, aggregateDepth };
  }

  const selfExcludedDepth = positions
    .filter((position) => borrower && isAddressEqual(position.lender, borrower))
    .reduce((sum, position) => sum + position.availableLiquidity, 0n);
  const ranked = positions
    .filter(
      (position) =>
        position.availableLiquidity > 0n &&
        (!borrower || !isAddressEqual(position.lender, borrower)),
    )
    .sort(
      (left, right) =>
        (left.availableLiquidity > right.availableLiquidity
          ? -1
          : left.availableLiquidity < right.availableLiquidity
            ? 1
            : 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const bounded = ranked.slice(0, maxRouteIds);
  const executableDepth = bounded.reduce((sum, position) => sum + position.availableLiquidity, 0n);
  const usableDepth = ranked.reduce((sum, position) => sum + position.availableLiquidity, 0n);
  const fragmentedDepth = usableDepth - executableDepth;
  const selected: LiquidityPosition[] = [];
  let selectedDepth = 0n;
  for (const position of bounded) {
    if (selectedDepth >= target) break;
    selected.push(position);
    selectedDepth += position.availableLiquidity;
  }
  const selectedIds = selected
    .map((position) => position.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let status: "ready" | "fragmented" | "insufficient";
  if (selectedDepth >= target) {
    status = "ready";
  } else if (fragmentedDepth > 0n) {
    status = "fragmented";
  } else {
    status = "insufficient";
  }
  return {
    status,
    publicDepth: aggregateDepth,
    executableDepth,
    fragmentedDepth,
    selfExcludedDepth,
    selectedDepth,
    selectedIds,
  };
}
