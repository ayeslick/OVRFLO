import type { LiquidityPosition } from "./types";

// Route selection over hydrated liquidity positions. Liquidity-coverage only —
// price-blind by design: the quoting layer clamps to the tick's grossPrice cap.

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
      selectedDepth: bigint;
      selectedIds: bigint[];
    };

export function selectHydratedRoute({
  positions,
  target,
  aggregateDepth,
  maxRouteIds,
}: {
  positions: readonly LiquidityPosition[];
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

  const ranked = positions
    .filter((position) => position.availableLiquidity > 0n)
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
    selectedDepth,
    selectedIds,
  };
}
