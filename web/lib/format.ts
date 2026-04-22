import { isAddress, isHash } from "viem";

export const TRUNCATION_ELLIPSIS = "\u2026" as const;

interface TruncateOptions {
  head?: number;
  tail?: number;
  fallback?: string;
}

function truncateHex(
  value: string,
  { head = 4, tail = 4 }: Pick<TruncateOptions, "head" | "tail">
): string {
  const minLen = 2 + head + tail;
  if (value.length <= minLen) return value;
  return `${value.slice(0, 2 + head)}${TRUNCATION_ELLIPSIS}${value.slice(-tail)}`;
}

/**
 * Truncate an Ethereum address for display: `0x1234…abcd`.
 * Returns the input unchanged when it isn't a valid 20-byte address
 * (so ENS names and other non-hex labels pass through untouched).
 */
export function truncateAddress(
  address: string | undefined | null,
  options: TruncateOptions = {}
): string {
  if (!address) return options.fallback ?? "";
  if (!isAddress(address)) return address;
  return truncateHex(address, options);
}

/**
 * Truncate a tx hash / block hash for display: `0x1234…abcd`.
 * Uses 6/6 by default so the fingerprint is still unambiguous.
 */
export function truncateTxHash(
  hash: string | undefined | null,
  options: TruncateOptions = {}
): string {
  if (!hash) return options.fallback ?? "";
  if (!isHash(hash)) return hash;
  return truncateHex(hash, { head: options.head ?? 6, tail: options.tail ?? 6 });
}
