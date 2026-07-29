import type { Address } from "viem";

export function formatAddress(address?: Address | null) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAprBps(aprBps: bigint | number) {
  const value = typeof aprBps === "bigint" ? aprBps : BigInt(aprBps);
  const whole = value / 100n;
  const fractional = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fractional}%`;
}

export function formatTokenAmount(value: bigint | undefined, symbol: string, decimals = 18) {
  if (value === undefined) return `— ${symbol}`;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const displayDecimals = whole === 0n && fraction > 0n ? 4 : 2;
  const divisor = 10n ** BigInt(decimals - displayDecimals);
  // R21/M-14: floor, never round half-up. Rounding up overstates what the user
  // holds — a 0.999 balance rendering as "1.00" invites them to spend a whole
  // unit they do not have and eat the revert. Displaying slightly less than the
  // truth is the safe direction for a balance.
  const roundedTotal = value / divisor;
  const displayScale = 10n ** BigInt(displayDecimals);
  const displayWhole = roundedTotal / displayScale;
  const displayFraction = roundedTotal % displayScale;
  return `${displayWhole}.${displayFraction.toString().padStart(displayDecimals, "0")} ${symbol}`;
}

// DESIGN.md §10 gives maturity distinct forms per job. L-10: only the bare date
// existed, so identifiers had no compact form and the countdown lost its hours.
// The spec's caption form ("Matures Jun 27, 2027") has no call site today — no
// surface renders maturity as prose — so it is deliberately not defined here
// rather than shipped as dead code (R30). Add it with its first consumer.

/// Bare date, for places that supply their own surrounding prose.
export function formatMaturityDate(timestamp: bigint | undefined) {
  if (!timestamp) return "unknown";
  const date = new Date(Number(timestamp) * 1000);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/// Identifier form: `27JUN27` — day, month, two-digit year, no separators.
export function formatMaturityId(timestamp: bigint | undefined) {
  if (!timestamp) return "—";
  const date = new Date(Number(timestamp) * 1000);
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date).toUpperCase();
  const year = (date.getUTCFullYear() % 100).toString().padStart(2, "0");
  return `${day}${month}${year}`;
}

/// Countdown form: `142d 06h`. Floors both parts — a countdown that rounds up
/// tells the user they have more time than they do.
export function formatCountdown(secondsRemaining: bigint) {
  if (secondsRemaining <= 0n) return "0d 00h";
  const days = secondsRemaining / 86_400n;
  const hours = (secondsRemaining % 86_400n) / 3_600n;
  return `${days}d ${hours.toString().padStart(2, "0")}h`;
}

export function formatId(id: bigint | undefined) {
  return id === undefined ? "—" : `#${id.toString()}`;
}
