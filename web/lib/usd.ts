import { mulDiv } from "./lending-math";
import { usd8, WAD, type Usd8 } from "./units";

/** Chainlink crypto heartbeat (stETH/USD), seconds. Classification params — not a feed address. */
export const STETH_USD_HEARTBEAT_SECONDS = 3_600n;
/** Grace past heartbeat before the answer is unavailable. */
export const USD_HEARTBEAT_GRACE_SECONDS = 120n;
/** Absolute cutoff: never show a USD figure older than this. */
export const USD_ABSOLUTE_CUTOFF_SECONDS = 86_400n;
export const CHAINLINK_USD_DECIMALS = 8;

export type UsdUnavailableReason = "non-positive" | "heartbeat" | "cutoff";

export type UsdQuote =
  | { status: "available"; usd8: Usd8; updatedAt: bigint }
  | { status: "unavailable"; reason: UsdUnavailableReason };

export type ChainlinkRound = {
  answer: bigint;
  updatedAt: bigint;
};

/**
 * wstETH/USD in 8 decimals: stETH/USD × stEthPerToken / 1e18.
 * Feed addresses live in config after explorer verification (KTD14) — this module is pure over answers.
 */
export function wstethUsd8(stEthUsdAnswer: bigint, stEthPerToken: bigint): Usd8 {
  if (stEthUsdAnswer <= 0n || stEthPerToken <= 0n) return usd8(0n);
  return usd8(mulDiv(stEthUsdAnswer, stEthPerToken, WAD));
}

export function tokenUsd8(tokenWei: bigint, wstethUsd: Usd8): Usd8 {
  if (tokenWei <= 0n || wstethUsd <= 0n) return usd8(0n);
  return usd8(mulDiv(tokenWei, wstethUsd, WAD));
}

export function classifyUsd(
  round: ChainlinkRound,
  stEthPerToken: bigint,
  now: bigint,
  options: { heartbeat?: bigint; grace?: bigint; cutoff?: bigint } = {},
): UsdQuote {
  const heartbeat = options.heartbeat ?? STETH_USD_HEARTBEAT_SECONDS;
  const grace = options.grace ?? USD_HEARTBEAT_GRACE_SECONDS;
  const cutoff = options.cutoff ?? USD_ABSOLUTE_CUTOFF_SECONDS;

  if (round.answer <= 0n || stEthPerToken <= 0n) {
    return { status: "unavailable", reason: "non-positive" };
  }
  const age = now > round.updatedAt ? now - round.updatedAt : 0n;
  if (age > cutoff) {
    return { status: "unavailable", reason: "cutoff" };
  }
  if (age > heartbeat + grace) {
    return { status: "unavailable", reason: "heartbeat" };
  }
  return {
    status: "available",
    usd8: wstethUsd8(round.answer, stEthPerToken),
    updatedAt: round.updatedAt,
  };
}
