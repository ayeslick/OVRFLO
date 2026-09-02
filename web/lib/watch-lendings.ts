import { isAddressEqual, type Address } from "viem";
import { isConfiguredAddress } from "@/lib/config";
import type { MarketInfo } from "@/lib/types";

type LendingSource = {
  lending: Address | null | undefined;
  retiredLendings?: readonly Address[];
};

function pushLending(seen: Set<string>, lendings: Address[], value: Address | null | undefined) {
  if (!isConfiguredAddress(value ?? null) || value === undefined || value === null) return;
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  lendings.push(value);
}

/** Unique lending addresses from factory discovery. Active markets first, then retired. */
export function uniqueLendings(markets: readonly LendingSource[]): Address[] {
  const seen = new Set<string>();
  const lendings: Address[] = [];
  for (const market of markets) pushLending(seen, lendings, market.lending);
  for (const market of markets) {
    for (const retired of market.retiredLendings ?? []) {
      pushLending(seen, lendings, retired);
    }
  }
  return lendings;
}

export function retiredLendingSet(markets: readonly LendingSource[]): Set<string> {
  const retired = new Set<string>();
  for (const market of markets) {
    for (const address of market.retiredLendings ?? []) {
      if (!isConfiguredAddress(address)) continue;
      retired.add(address.toLowerCase());
    }
  }
  return retired;
}

export function isRetiredLending(
  markets: readonly LendingSource[],
  lending: Address,
): boolean {
  return retiredLendingSet(markets).has(lending.toLowerCase());
}

export function marketForLending(
  markets: readonly MarketInfo[],
  lending: Address,
  series?: Address,
): MarketInfo | null {
  const matches = markets.filter(
    (market) =>
      (market.lending !== null && isAddressEqual(market.lending, lending)) ||
      market.retiredLendings.some((retired) => isAddressEqual(retired, lending)),
  );
  if (matches.length === 0) return null;
  if (series !== undefined) {
    const exact = matches.find((market) => isAddressEqual(market.market, series));
    if (exact) return exact;
  }
  return matches[0] ?? null;
}
