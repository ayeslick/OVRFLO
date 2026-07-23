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
  const roundedTotal = (value + divisor / 2n) / divisor;
  const displayScale = 10n ** BigInt(displayDecimals);
  const displayWhole = roundedTotal / displayScale;
  const displayFraction = roundedTotal % displayScale;
  return `${displayWhole}.${displayFraction.toString().padStart(displayDecimals, "0")} ${symbol}`;
}

export function formatMaturity(timestamp: bigint | undefined) {
  if (!timestamp) return "Maturity unknown";
  const date = new Date(Number(timestamp) * 1000);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatId(id: bigint | undefined) {
  return id === undefined ? "—" : `#${id.toString()}`;
}
