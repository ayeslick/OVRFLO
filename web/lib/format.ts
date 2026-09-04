import type { Address } from "viem";
import { MAX_UINT128 } from "./units";

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale, options);
  formatterCache.set(key, created);
  return created;
}

function formatWhole(whole: bigint, locale: string): string {
  if (whole <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return formatter(locale, { maximumFractionDigits: 0 }).format(Number(whole));
  }
  return whole.toString();
}

/** Truncate toward zero to `displayDecimals` of `decimals`. */
export function formatTruncatedDecimal(
  value: bigint,
  decimals: number,
  displayDecimals: number,
  locale = "en-US",
): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;
  if (displayDecimals <= 0) {
    return `${negative ? "-" : ""}${formatWhole(whole, locale)}`;
  }
  const fracScale = 10n ** BigInt(decimals - displayDecimals);
  const fracTrunc = fraction / fracScale;
  return `${negative ? "-" : ""}${formatWhole(whole, locale)}.${fracTrunc.toString().padStart(displayDecimals, "0")}`;
}

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
  if (value === MAX_UINT128) return `MAX ${symbol}`;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  const displayDecimals = whole === 0n && fraction > 0n ? 4 : 2;
  return `${formatTruncatedDecimal(value, decimals, displayDecimals)} ${symbol}`;
}

export function formatUsd(usd8: bigint, locale = "en-US"): string {
  const dollars8 = usd8 < 0n ? 0n : usd8;
  const dollars = dollars8 / 100_000_000n;
  if (dollars >= 1000n) {
    return `$${formatTruncatedDecimal(dollars8, 8, 0, locale)}`;
  }
  return `$${formatTruncatedDecimal(dollars8, 8, 2, locale)}`;
}

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

export function formatMaturityId(timestamp: bigint | undefined) {
  if (!timestamp) return "—";
  const date = new Date(Number(timestamp) * 1000);
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date).toUpperCase();
  const year = (date.getUTCFullYear() % 100).toString().padStart(2, "0");
  return `${day}${month}${year}`;
}

export function formatCoverDate(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  const formatted = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `~${formatted}`;
}

export function formatCountdown(secondsRemaining: bigint) {
  if (secondsRemaining <= 0n) return "0d 00h";
  const days = secondsRemaining / 86_400n;
  const hours = (secondsRemaining % 86_400n) / 3_600n;
  return `${days}d ${hours.toString().padStart(2, "0")}h`;
}

export function formatId(id: bigint | undefined) {
  return id === undefined ? "—" : `#${id.toString()}`;
}

export function formatAsOf(timestamp: bigint, locale = "en-US"): string {
  const date = new Date(Number(timestamp) * 1000);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
  return `EVENTS AS OF ${time}`;
}
