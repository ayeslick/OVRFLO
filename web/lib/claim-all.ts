import type { Address } from "viem";

// Pure claim-all planner (plan KTD4). Pool claims batch per lending contract
// (multicall of claimLoanPoolShare), then individual stream claims. `claimable`
// is the caller's projected value from recoveredForClaimable, not raw proceeds.

export type QueuedTx =
  | { kind: "pool-claims"; lending: Address; loanIds: bigint[] }
  | { kind: "stream-claim"; streamId: bigint };

export function planClaimAll(input: {
  pools: { lending: Address; loanId: bigint; claimable: bigint }[];
  streams: { streamId: bigint; withdrawable: bigint }[];
}): QueuedTx[] {
  const byLending = new Map<string, { lending: Address; loanIds: bigint[] }>();
  for (const pool of input.pools) {
    if (pool.claimable <= 0n) continue;
    const key = pool.lending.toLowerCase();
    const entry = byLending.get(key) ?? { lending: pool.lending, loanIds: [] };
    entry.loanIds.push(pool.loanId);
    byLending.set(key, entry);
  }

  const poolClaims: QueuedTx[] = [...byLending.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, { lending, loanIds }]) => ({
      kind: "pool-claims",
      lending,
      loanIds: [...loanIds].sort((a, b) => (a < b ? -1 : 1)),
    }));

  const streamClaims: QueuedTx[] = input.streams
    .filter((s) => s.withdrawable > 0n)
    .sort((a, b) => (a.streamId < b.streamId ? -1 : 1))
    .map((s) => ({ kind: "stream-claim", streamId: s.streamId }));

  return [...poolClaims, ...streamClaims];
}
