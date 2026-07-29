import type { Address } from "viem";

// Pure claim-all planner (plan KTD4). Pool claims batch per lending contract
// (multicall of claimLoanPoolShare), then individual stream claims. `claimable`
// is the caller's projected value from recoveredForClaimable, not raw proceeds.
//
// `asset` is the token the claim pays out in — the market's ovrfloToken for a
// pool share (OVRFLOLending._claimFair transfers it), the stream's own asset for
// a stream withdrawal. It rides along on the plan because the runner needs it to
// invalidate the balance read the payout changed, and the transaction's `to`
// (the lending market, or Sablier) does not name it. One lending contract has
// one ovrfloToken, so batching by lending contract cannot mix assets.

export type QueuedTx =
  | { kind: "pool-claims"; lending: Address; loanIds: bigint[]; asset: Address }
  | { kind: "stream-claim"; streamId: bigint; asset: Address };

export function planClaimAll(input: {
  pools: { lending: Address; loanId: bigint; claimable: bigint; asset: Address }[];
  streams: { streamId: bigint; withdrawable: bigint; asset: Address }[];
}): QueuedTx[] {
  const byLending = new Map<string, { lending: Address; loanIds: bigint[]; asset: Address }>();
  for (const pool of input.pools) {
    if (pool.claimable <= 0n) continue;
    const key = pool.lending.toLowerCase();
    const entry = byLending.get(key) ?? { lending: pool.lending, loanIds: [], asset: pool.asset };
    entry.loanIds.push(pool.loanId);
    byLending.set(key, entry);
  }

  const poolClaims: QueuedTx[] = [...byLending.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, { lending, loanIds, asset }]) => ({
      kind: "pool-claims",
      lending,
      asset,
      loanIds: [...loanIds].sort((a, b) => (a < b ? -1 : 1)),
    }));

  const streamClaims: QueuedTx[] = input.streams
    .filter((s) => s.withdrawable > 0n)
    .sort((a, b) => (a.streamId < b.streamId ? -1 : 1))
    .map((s) => ({ kind: "stream-claim", streamId: s.streamId, asset: s.asset }));

  return [...poolClaims, ...streamClaims];
}
