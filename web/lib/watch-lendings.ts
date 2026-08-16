import type { Address } from "viem";
import { isConfiguredAddress } from "@/lib/config";

/** Unique lending addresses from factory discovery. Order follows the market list. */
export function uniqueLendings(
  markets: readonly { lending: Address | null | undefined }[],
): Address[] {
  const seen = new Set<string>();
  const lendings: Address[] = [];
  for (const market of markets) {
    const lending = market.lending;
    if (!isConfiguredAddress(lending ?? null) || lending === undefined || lending === null) continue;
    const key = lending.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lendings.push(lending);
  }
  return lendings;
}
