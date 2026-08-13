import { formatGroupedInteger } from "./intl";

/**
 * Floor-toward-zero display of a token amount from the wei bigint every call.
 * Never cache a float — a float cache ticks backwards across rounding boundaries.
 */
export function formatTokenFromWei(
  value: bigint,
  decimals: number,
  displayDecimals: number,
  locale = "en-US",
) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const shown = 10n ** BigInt(displayDecimals);
  const quantum = scale / shown;
  const truncated = abs / quantum;
  const whole = truncated / shown;
  const frac = truncated % shown;
  const sign = negative ? "-" : "";
  return `${sign}${formatGroupedInteger(whole, locale)}.${frac.toString().padStart(displayDecimals, "0")}`;
}

export function interpolateAmount(args: {
  startAmount: bigint;
  endAmount: bigint;
  startMs: number;
  endMs: number;
  nowMs: number;
}) {
  const { startAmount, endAmount, startMs, endMs, nowMs } = args;
  if (nowMs <= startMs) return startAmount;
  if (nowMs >= endMs) return endAmount;
  const duration = endMs - startMs;
  if (duration <= 0) return endAmount;
  const elapsed = BigInt(nowMs - startMs);
  const span = BigInt(duration);
  const delta = endAmount - startAmount;
  return startAmount + (delta * elapsed) / span;
}

export function progress01(nowMs: number, startMs: number, endMs: number) {
  if (nowMs <= startMs) return 0;
  if (nowMs >= endMs) return 1;
  const duration = endMs - startMs;
  if (duration <= 0) return 1;
  return (nowMs - startMs) / duration;
}
