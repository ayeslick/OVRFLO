import { mulDiv } from "./lending-math";
import { usd8, WAD, type Usd8 } from "./units";
import type { UsdRecipeKind } from "./usd-recipes";

/** Grace past heartbeat before a display quote is unavailable. Execution uses zero grace. */
export const USD_HEARTBEAT_GRACE_SECONDS = 120n;
/** Absolute cutoff: never show a USD figure older than this. */
export const USD_ABSOLUTE_CUTOFF_SECONDS = 86_400n;
export const CHAINLINK_USD_DECIMALS = 8;

/** @deprecated Use the recipe heartbeat. Kept for display-path tests of the wstETH row. */
export const STETH_USD_HEARTBEAT_SECONDS = 3_600n;

export type UsdUnavailableReason =
  | "non-positive"
  | "heartbeat"
  | "cutoff"
  | "incomplete"
  | "missing-recipe"
  | "decimals";

export type UsdQuote =
  | { status: "available"; usd8: Usd8; updatedAt: bigint }
  | { status: "unavailable"; reason: UsdUnavailableReason };

export type ChainlinkRound = {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
};

export function isCompleteRound(round: ChainlinkRound): boolean {
  return round.answeredInRound >= round.roundId && round.answer > 0n;
}

export function scaleFeedToUsd8(answer: bigint, feedDecimals: number): Usd8 {
  if (feedDecimals === CHAINLINK_USD_DECIMALS) return usd8(answer);
  if (feedDecimals < CHAINLINK_USD_DECIMALS) {
    return usd8(answer * 10n ** BigInt(CHAINLINK_USD_DECIMALS - feedDecimals));
  }
  return usd8(answer / 10n ** BigInt(feedDecimals - CHAINLINK_USD_DECIMALS));
}

/**
 * wstETH/USD in 8 decimals: stETH/USD × stEthPerToken / 1e18.
 * Feed addresses live on the recipe row after explorer verification.
 */
export function wstethUsd8(stEthUsdAnswer: bigint, stEthPerToken: bigint): Usd8 {
  if (stEthUsdAnswer <= 0n || stEthPerToken <= 0n) return usd8(0n);
  return usd8(mulDiv(stEthUsdAnswer, stEthPerToken, WAD));
}

export function tokenUsd8(tokenWei: bigint, tokenUsd: Usd8): Usd8 {
  if (tokenWei <= 0n || tokenUsd <= 0n) return usd8(0n);
  return usd8(mulDiv(tokenWei, tokenUsd, WAD));
}

export function priceFromRecipe(args: {
  kind: UsdRecipeKind;
  feedUsd8: Usd8;
  shareRate?: bigint;
  ethUsd8?: Usd8;
}): Usd8 {
  if (args.kind === "chainlink-usd-direct") return args.feedUsd8;
  if (args.kind === "chainlink-usd-times-share-rate") {
    const shareRate = args.shareRate ?? 0n;
    if (args.feedUsd8 <= 0n || shareRate <= 0n) return usd8(0n);
    return usd8(mulDiv(args.feedUsd8, shareRate, WAD));
  }
  const ethUsd = args.ethUsd8 ?? usd8(0n);
  const assetPerEth = args.shareRate ?? 0n;
  if (ethUsd <= 0n || assetPerEth <= 0n) return usd8(0n);
  return usd8(mulDiv(ethUsd, assetPerEth, WAD));
}

export function classifyUsd(args: {
  round: ChainlinkRound;
  now: bigint;
  heartbeat: bigint;
  grace: bigint;
  cutoff?: bigint;
  kind: UsdRecipeKind;
  feedDecimals: number;
  shareRate?: bigint;
  ethUsdRound?: ChainlinkRound;
}): UsdQuote {
  const cutoff = args.cutoff ?? USD_ABSOLUTE_CUTOFF_SECONDS;
  if (!isCompleteRound(args.round)) {
    return { status: "unavailable", reason: "incomplete" };
  }
  if (args.kind === "chainlink-eth-usd-times-eth-rate") {
    if (!args.ethUsdRound || !isCompleteRound(args.ethUsdRound)) {
      return { status: "unavailable", reason: "incomplete" };
    }
  }
  const needsShare = args.kind !== "chainlink-usd-direct";
  if (needsShare && (args.shareRate === undefined || args.shareRate <= 0n)) {
    return { status: "unavailable", reason: "non-positive" };
  }

  const feedUsd8 = scaleFeedToUsd8(args.round.answer, args.feedDecimals);
  const ethUsd8 = args.ethUsdRound
    ? scaleFeedToUsd8(args.ethUsdRound.answer, CHAINLINK_USD_DECIMALS)
    : undefined;
  const priceQ = priceFromRecipe({
    kind: args.kind,
    feedUsd8,
    shareRate: args.shareRate,
    ethUsd8,
  });
  if (priceQ <= 0n) {
    return { status: "unavailable", reason: "non-positive" };
  }

  const age = args.now > args.round.updatedAt ? args.now - args.round.updatedAt : 0n;
  if (age > cutoff) {
    return { status: "unavailable", reason: "cutoff" };
  }
  if (age > args.heartbeat + args.grace) {
    return { status: "unavailable", reason: "heartbeat" };
  }
  return {
    status: "available",
    usd8: priceQ,
    updatedAt: args.round.updatedAt,
  };
}
