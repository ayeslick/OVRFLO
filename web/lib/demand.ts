import type { Address } from "viem";

// Pure aggregation for the trailing 30-day borrow-demand column (ticket 09).
// Fetching stays in lib/ponder.ts; the hook decides reachable-vs-empty.

export const DEMAND_WINDOW_SECONDS = 30n * 24n * 60n * 60n;

export type BorrowDemandEvent = {
  aprBps: number;
  amount: bigint;
  borrower: Address;
  blockTimestamp: bigint;
};

export type RateDemand = { aprBps: number; count: number; amount: bigint };

export function aggregateDemand(
  events: BorrowDemandEvent[],
  { nowSeconds, self }: { nowSeconds: bigint; self?: Address },
): RateDemand[] {
  const selfKey = self?.toLowerCase();
  // The SQL fetch pre-filters this same window; re-filtering here keeps cached
  // query rows honest as chain time advances between refetches.
  const cutoff = nowSeconds - DEMAND_WINDOW_SECONDS;
  const byRate = new Map<number, RateDemand>();
  for (const event of events) {
    if (event.blockTimestamp < cutoff) continue;
    if (selfKey && event.borrower.toLowerCase() === selfKey) continue;
    const row = byRate.get(event.aprBps) ?? { aprBps: event.aprBps, count: 0, amount: 0n };
    row.count += 1;
    row.amount += event.amount;
    byRate.set(event.aprBps, row);
  }
  return [...byRate.values()].sort((a, b) => a.aprBps - b.aprBps);
}

export type DemandLevel = "NONE" | "LOW" | "MODERATE" | "HIGH";

// Qualitative grade relative to this market's own peak rate-volume — a market
// with tiny absolute volume still shows which of its rates borrowers prefer.
export function demandLevel(amount: bigint, peak: bigint): DemandLevel {
  if (amount === 0n || peak === 0n) return "NONE";
  if (amount * 3n <= peak) return "LOW";
  if (amount * 3n <= peak * 2n) return "MODERATE";
  return "HIGH";
}
