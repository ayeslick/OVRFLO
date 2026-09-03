import { mulDiv, mulDivUp } from "./lending-math";
import { usd8, type Usd8 } from "./units";
import { classifyUsd, type ChainlinkRound } from "./usd";
import { lookupUsdRecipe, type UsdRecipe } from "./usd-recipes";

export type UsdExecutionReads = {
  underlying: AddressLike;
  round: ChainlinkRound;
  shareRate?: bigint;
  ethUsdRound?: ChainlinkRound;
  assetDecimals: number;
  now: bigint;
};

type AddressLike = `0x${string}`;

export type UsdExecutionOk = {
  status: "ok";
  underlying: AddressLike;
  tokenNativeMin: bigint;
  tokenNativeMax: bigint;
  priceQ: Usd8;
  priceLowQ: Usd8;
  priceHighQ: Usd8;
};

export type UsdExecutionBlocked = {
  status: "blocked";
  reason: "missing-recipe" | "stale" | "incomplete" | "decimals" | "non-positive" | "cutoff";
};

export type UsdExecutionResult = UsdExecutionOk | UsdExecutionBlocked;

/**
 * Execution-grade USD resolver. Never import useUsdPrice from this module.
 * Caller must re-read the recipe row immediately before submit.
 */
export function resolveUsdExecution(
  underlying: AddressLike,
  usdQ: Usd8,
  reads: UsdExecutionReads,
): UsdExecutionResult {
  const recipe = lookupUsdRecipe(underlying);
  if (!recipe) return { status: "blocked", reason: "missing-recipe" };
  if (reads.underlying.toLowerCase() !== underlying.toLowerCase()) {
    return { status: "blocked", reason: "missing-recipe" };
  }
  if (reads.assetDecimals !== 18) {
    return { status: "blocked", reason: "decimals" };
  }
  return encloseTokenNative(recipe, usdQ, reads);
}

function encloseTokenNative(
  recipe: UsdRecipe,
  usdQ: Usd8,
  reads: UsdExecutionReads,
): UsdExecutionResult {
  const quote = classifyUsd({
    round: reads.round,
    now: reads.now,
    heartbeat: recipe.heartbeatSeconds,
    grace: 0n,
    kind: recipe.kind,
    feedDecimals: recipe.feedDecimals,
    shareRate: reads.shareRate,
    ethUsdRound: reads.ethUsdRound,
  });
  if (quote.status !== "available") {
    if (quote.reason === "heartbeat") return { status: "blocked", reason: "stale" };
    if (quote.reason === "incomplete") return { status: "blocked", reason: "incomplete" };
    if (quote.reason === "cutoff") return { status: "blocked", reason: "cutoff" };
    return { status: "blocked", reason: "non-positive" };
  }

  const priceQ = quote.usd8;
  const band = recipe.maxSourceDeviationBps;
  const priceLowQ = usd8(mulDiv(priceQ, 10_000n - band, 10_000n));
  const priceHighQ = usd8(mulDiv(priceQ, 10_000n + band, 10_000n));
  if (priceLowQ <= 0n || priceHighQ <= 0n || usdQ <= 0n) {
    return { status: "blocked", reason: "non-positive" };
  }
  const scale = 10n ** BigInt(reads.assetDecimals);
  return {
    status: "ok",
    underlying: recipe.underlying,
    tokenNativeMin: mulDiv(usdQ, scale, priceHighQ),
    tokenNativeMax: mulDivUp(usdQ, scale, priceLowQ),
    priceQ,
    priceLowQ,
    priceHighQ,
  };
}
