import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  claimAllPoolCandidate,
  claimAllStreamCandidate,
  evaluateClaimAllPreflight,
  mergeClaimAllPreflightCache,
  planClaimAll,
  reconcileQueuedTx,
} from "@/lib/claim-all";
import {
  readFailure,
  readyOutcome,
  unavailableOutcome,
} from "@/lib/read-outcome";

const lendingA = "0x00000000000000000000000000000000000000aa" as Address;
const lendingB = "0x00000000000000000000000000000000000000bb" as Address;
const assetA = "0x00000000000000000000000000000000000000c1" as Address;
const assetB = "0x00000000000000000000000000000000000000c2" as Address;

describe("planClaimAll", () => {
  it("batches pool claims per lending address with ascending loan ids, then streams ascending", () => {
    const plan = planClaimAll({
      pools: [
        { lending: lendingB, loanId: 7n, claimable: 5n, asset: assetB },
        { lending: lendingA, loanId: 9n, claimable: 1n, asset: assetA },
        { lending: lendingA, loanId: 2n, claimable: 3n, asset: assetA },
      ],
      streams: [
        { streamId: 12n, withdrawable: 4n, asset: assetA },
        { streamId: 3n, withdrawable: 8n, asset: assetA },
      ],
    });
    expect(plan).toEqual([
      {
        kind: "pool-claims",
        lending: lendingA,
        claims: [
          { loanId: 2n, claimable: 3n },
          { loanId: 9n, claimable: 1n },
        ],
        asset: assetA,
      },
      {
        kind: "pool-claims",
        lending: lendingB,
        claims: [{ loanId: 7n, claimable: 5n }],
        asset: assetB,
      },
      { kind: "stream-claim", streamId: 3n, withdrawable: 8n, asset: assetA },
      { kind: "stream-claim", streamId: 12n, withdrawable: 4n, asset: assetA },
    ]);
  });

  it("excludes zero-claimable pools and zero-withdrawable streams", () => {
    const plan = planClaimAll({
      pools: [
        { lending: lendingA, loanId: 1n, claimable: 0n, asset: assetA },
        { lending: lendingA, loanId: 2n, claimable: 6n, asset: assetA },
      ],
      streams: [{ streamId: 5n, withdrawable: 0n, asset: assetA }],
    });
    expect(plan).toEqual([
      {
        kind: "pool-claims",
        lending: lendingA,
        claims: [{ loanId: 2n, claimable: 6n }],
        asset: assetA,
      },
    ]);
  });

  it("returns an empty plan for empty input", () => {
    expect(planClaimAll({ pools: [], streams: [] })).toEqual([]);
  });

  it("groups pools for the same lending address into one batch regardless of casing", () => {
    const upper = lendingA.toUpperCase().replace("0X", "0x") as Address;
    const plan = planClaimAll({
      pools: [
        { lending: lendingA, loanId: 1n, claimable: 3n, asset: assetA },
        { lending: upper, loanId: 2n, claimable: 4n, asset: assetA },
      ],
      streams: [],
    });
    expect(plan).toEqual([
      {
        kind: "pool-claims",
        lending: lendingA,
        claims: [
          { loanId: 1n, claimable: 3n },
          { loanId: 2n, claimable: 4n },
        ],
        asset: assetA,
      },
    ]);
  });
});

const account = "0x0000000000000000000000000000000000000a11" as Address;
const target = {
  number: 100n,
  hash: `0x${"11".repeat(32)}` as const,
};
const targetMetadata = {
  blockNumber: target.number,
  blockHash: target.hash,
};
const identity = { account, chainId: 1 };
const poolA = claimAllPoolCandidate(lendingA, 2n);
const poolB = claimAllPoolCandidate(lendingA, 9n);
const streamA = claimAllStreamCandidate(3n);

function completePreflight() {
  return mergeClaimAllPreflightCache(undefined, {
    identity,
    target,
    sources: {
      markets: readyOutcome([poolA, poolB], targetMetadata),
      streams: readyOutcome([streamA], targetMetadata),
      hydration: readyOutcome([poolA, poolB, streamA], targetMetadata),
      verifier: readyOutcome([poolA, poolB, streamA], targetMetadata),
    },
  });
}

describe("Claim All preflight", () => {
  it("requires every source to be fresh, complete, pinned to one block/hash, and independently agreed", () => {
    expect(evaluateClaimAllPreflight(completePreflight())).toMatchObject({
      status: "ready",
      canReview: true,
      reason: null,
      candidateIds: [poolA, poolB, streamA],
    });

    const disagreement = mergeClaimAllPreflightCache(completePreflight(), {
      identity,
      target,
      sources: {
        verifier: readyOutcome([poolA, streamA], targetMetadata),
      },
    });
    expect(evaluateClaimAllPreflight(disagreement)).toMatchObject({
      status: "blocked",
      canReview: false,
      reason: "provider-disagreement",
    });

    const missingVerifier = mergeClaimAllPreflightCache(completePreflight(), {
      identity,
      target,
      sources: {
        verifier: unavailableOutcome(
          [readFailure("verifier", "transport", "verifier unavailable")],
          targetMetadata,
        ),
      },
    });
    expect(evaluateClaimAllPreflight(missingVerifier)).toMatchObject({
      status: "blocked",
      canReview: false,
      reason: "verifier-unavailable",
    });

    const mismatchedSnapshot = mergeClaimAllPreflightCache(
      completePreflight(),
      {
        identity,
        target,
        sources: {
          verifier: readyOutcome([poolA, poolB, streamA], {
            blockNumber: target.number,
            blockHash: `0x${"99".repeat(32)}`,
          }),
        },
      },
    );
    expect(evaluateClaimAllPreflight(mismatchedSnapshot)).toMatchObject({
      status: "blocked",
      canReview: false,
      reason: "snapshot-mismatch",
    });
  });

  it("does not let provider agreement substitute for complete direct hydration", () => {
    const incompleteHydration = mergeClaimAllPreflightCache(completePreflight(), {
      identity,
      target,
      sources: {
        hydration: readyOutcome([poolA, streamA], targetMetadata),
      },
    });

    expect(evaluateClaimAllPreflight(incompleteHydration)).toMatchObject({
      status: "blocked",
      canReview: false,
      reason: "hydration-incomplete",
    });
  });

  it("reuses completed session work only for the same identity and captured block/hash", () => {
    const marketsOnly = mergeClaimAllPreflightCache(undefined, {
      identity,
      target,
      sources: {
        markets: readyOutcome([poolA, poolB], targetMetadata),
        streams: unavailableOutcome(
          [readFailure("streams", "transport", "stream RPC failed")],
          targetMetadata,
        ),
      },
    });
    const retried = mergeClaimAllPreflightCache(marketsOnly, {
      identity,
      target,
      sources: {
        streams: readyOutcome([streamA], targetMetadata),
      },
    });
    expect(retried.sources.markets).toBe(marketsOnly.sources.markets);
    expect(retried.sources.streams).toMatchObject({ status: "ready" });

    const redundantFailure = mergeClaimAllPreflightCache(retried, {
      identity,
      target,
      sources: {
        markets: unavailableOutcome(
          [readFailure("markets", "transport", "redundant refetch failed")],
          targetMetadata,
        ),
      },
    });
    expect(redundantFailure.sources.markets).toBe(retried.sources.markets);

    const nextTarget = {
      number: 101n,
      hash: `0x${"22".repeat(32)}` as const,
    };
    const recaptured = mergeClaimAllPreflightCache(retried, {
      identity,
      target: nextTarget,
      sources: {
        streams: readyOutcome([streamA], {
          blockNumber: nextTarget.number,
          blockHash: nextTarget.hash,
        }),
      },
    });
    expect(recaptured.sources.markets).toBeUndefined();

    const reconnected = mergeClaimAllPreflightCache(retried, {
      identity: {
        account: "0x0000000000000000000000000000000000000b22",
        chainId: 1,
      },
      target,
      sources: {
        streams: readyOutcome([streamA], targetMetadata),
      },
    });
    expect(reconnected.sources.markets).toBeUndefined();
  });
});

describe("Claim All row reconciliation", () => {
  const reviewed = {
    kind: "pool-claims" as const,
    lending: lendingA,
    claims: [
      { loanId: 2n, claimable: 3n },
      { loanId: 9n, claimable: 1n },
    ],
    asset: assetA,
  };

  it("keeps an unchanged grouped row ready", () => {
    expect(reconcileQueuedTx(reviewed, { ...reviewed })).toEqual({
      status: "ready",
      tx: reviewed,
    });
  });

  it("requires review when grouped constituents or economics change", () => {
    expect(
      reconcileQueuedTx(reviewed, {
        ...reviewed,
        claims: [{ loanId: 2n, claimable: 3n }],
      }),
    ).toMatchObject({ status: "needs-review" });
    expect(
      reconcileQueuedTx(reviewed, {
        ...reviewed,
        claims: [
          { loanId: 2n, claimable: 4n },
          { loanId: 9n, claimable: 1n },
        ],
      }),
    ).toMatchObject({ status: "needs-review" });
  });

  it("skips a grouped row only when every constituent disappeared", () => {
    expect(reconcileQueuedTx(reviewed, null)).toEqual({ status: "skipped" });
  });
});
