import type { Address } from "viem";
import type { ActionIdentity } from "./actions/types";
import type { BlockIdentity } from "./discovery/types";
import { isFreshReady, type ReadOutcome } from "./read-outcome";

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

export type ClaimAllPoolClaim = {
  loanId: bigint;
  claimable: bigint;
};

export type QueuedTx =
  | {
      kind: "pool-claims";
      lending: Address;
      claims: readonly ClaimAllPoolClaim[];
      asset: Address;
    }
  | {
      kind: "stream-claim";
      streamId: bigint;
      withdrawable: bigint;
      asset: Address;
    };

export type ClaimAllInput = {
  pools: { lending: Address; loanId: bigint; claimable: bigint; asset: Address }[];
  streams: { streamId: bigint; withdrawable: bigint; asset: Address }[];
};

export function planClaimAll(input: ClaimAllInput): QueuedTx[] {
  const byLending = new Map<
    string,
    { lending: Address; claims: ClaimAllPoolClaim[]; asset: Address }
  >();
  for (const pool of input.pools) {
    if (pool.claimable <= 0n) continue;
    const key = pool.lending.toLowerCase();
    const entry = byLending.get(key) ?? {
      lending: pool.lending,
      claims: [],
      asset: pool.asset,
    };
    if (entry.asset.toLowerCase() !== pool.asset.toLowerCase()) {
      throw new Error("Pool claims for one lending contract cannot mix payout assets");
    }
    const duplicate = entry.claims.find((claim) => claim.loanId === pool.loanId);
    if (duplicate) {
      if (duplicate.claimable !== pool.claimable) {
        throw new Error("Duplicate pool claim has conflicting claimable amounts");
      }
      continue;
    }
    entry.claims.push({ loanId: pool.loanId, claimable: pool.claimable });
    byLending.set(key, entry);
  }

  const poolClaims: QueuedTx[] = [...byLending.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, { lending, claims, asset }]) => ({
      kind: "pool-claims",
      lending,
      asset,
      claims: [...claims].sort((a, b) =>
        a.loanId < b.loanId ? -1 : a.loanId > b.loanId ? 1 : 0,
      ),
    }));

  const streamClaims: QueuedTx[] = input.streams
    .filter((s) => s.withdrawable > 0n)
    .sort((a, b) => (a.streamId < b.streamId ? -1 : 1))
    .map((s) => ({
      kind: "stream-claim",
      streamId: s.streamId,
      withdrawable: s.withdrawable,
      asset: s.asset,
    }));

  return [...poolClaims, ...streamClaims];
}

export type ClaimAllCandidateId = `pool:${string}:${string}` | `stream:${string}`;

export function claimAllPoolCandidate(
  lending: Address,
  loanId: bigint,
): ClaimAllCandidateId {
  return `pool:${lending.toLowerCase()}:${loanId}`;
}

export function claimAllStreamCandidate(streamId: bigint): ClaimAllCandidateId {
  return `stream:${streamId}`;
}

export type ClaimAllPreflightSource =
  | "markets"
  | "streams"
  | "hydration"
  | "verifier";

export type ClaimAllPreflightCache = {
  identity: ActionIdentity;
  target: BlockIdentity;
  sources: Partial<
    Record<ClaimAllPreflightSource, ReadOutcome<readonly ClaimAllCandidateId[]>>
  >;
};

export type ClaimAllPreflightAttempt = {
  identity: ActionIdentity;
  target: BlockIdentity;
  sources: Partial<
    Record<ClaimAllPreflightSource, ReadOutcome<readonly ClaimAllCandidateId[]>>
  >;
};

export type ClaimAllPreflightProgress = {
  source: ClaimAllPreflightSource;
  status: "waiting" | "loading" | "complete" | "failed";
  retryable: boolean;
  message: string;
};

export type ClaimAllPreflightReason =
  | "discovery-incomplete"
  | "hydration-incomplete"
  | "verifier-unavailable"
  | "provider-disagreement"
  | "snapshot-mismatch";

export type ClaimAllPreflightEvaluation = {
  status: "loading" | "blocked" | "ready";
  canReview: boolean;
  reason: ClaimAllPreflightReason | null;
  candidateIds: readonly ClaimAllCandidateId[];
  progress: readonly ClaimAllPreflightProgress[];
};

const PREFLIGHT_SOURCES: readonly ClaimAllPreflightSource[] = [
  "markets",
  "streams",
  "hydration",
  "verifier",
];

function sameIdentity(left: ActionIdentity, right: ActionIdentity): boolean {
  return (
    left.chainId === right.chainId &&
    left.account.toLowerCase() === right.account.toLowerCase()
  );
}

function sameBlock(left: BlockIdentity, right: BlockIdentity): boolean {
  return (
    left.number === right.number &&
    left.hash.toLowerCase() === right.hash.toLowerCase()
  );
}

/**
 * Reuses completed preflight scopes only inside the same account/chain and
 * captured block/hash. A recapture or identity change discards every prior
 * source rather than mixing snapshots.
 */
export function mergeClaimAllPreflightCache(
  previous: ClaimAllPreflightCache | undefined,
  attempt: ClaimAllPreflightAttempt,
): ClaimAllPreflightCache {
  const reusable =
    previous !== undefined &&
    sameIdentity(previous.identity, attempt.identity) &&
    sameBlock(previous.target, attempt.target);
  const sources = reusable ? { ...previous.sources } : {};
  for (const source of PREFLIGHT_SOURCES) {
    const next = attempt.sources[source];
    if (!next) continue;
    const cached = sources[source];
    // A completed read pinned to this exact immutable block remains stronger
    // than a redundant refetch's transient loading/failure state. Failed
    // scopes still transition through loading/failure normally.
    if (
      source !== "verifier" &&
      cached &&
      isFreshReady(cached) &&
      !isFreshReady(next)
    ) {
      continue;
    }
    sources[source] = next;
  }
  return {
    identity: attempt.identity,
    target: attempt.target,
    sources,
  };
}

function normalizedCandidates(
  candidates: readonly ClaimAllCandidateId[],
): ClaimAllCandidateId[] {
  return [...new Set(candidates)].sort();
}

export function sameClaimAllCandidates(
  left: readonly ClaimAllCandidateId[],
  right: readonly ClaimAllCandidateId[],
): boolean {
  const normalizedLeft = normalizedCandidates(left);
  const normalizedRight = normalizedCandidates(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((candidate, index) => candidate === normalizedRight[index])
  );
}

export function claimAllInputCandidates(
  input: ClaimAllInput,
): ClaimAllCandidateId[] {
  return normalizedCandidates([
    ...input.pools
      .filter((pool) => pool.claimable > 0n)
      .map((pool) => claimAllPoolCandidate(pool.lending, pool.loanId)),
    ...input.streams
      .filter((stream) => stream.withdrawable > 0n)
      .map((stream) => claimAllStreamCandidate(stream.streamId)),
  ]);
}

function sourceMatchesTarget(
  outcome: ReadOutcome<readonly ClaimAllCandidateId[]>,
  target: BlockIdentity,
): boolean {
  return (
    outcome.metadata.blockNumber === target.number &&
    outcome.metadata.blockHash?.toLowerCase() === target.hash.toLowerCase()
  );
}

function preflightProgress(
  source: ClaimAllPreflightSource,
  outcome: ReadOutcome<readonly ClaimAllCandidateId[]> | undefined,
): ClaimAllPreflightProgress {
  if (!outcome) {
    return {
      source,
      status: "waiting",
      retryable: false,
      message: `${source} has not started`,
    };
  }
  if (outcome.status === "loading") {
    return {
      source,
      status: "loading",
      retryable: false,
      message: `${source} is loading`,
    };
  }
  if (isFreshReady(outcome)) {
    return {
      source,
      status: "complete",
      retryable: false,
      message: `${outcome.data.length} candidates`,
    };
  }
  return {
    source,
    status: "failed",
    retryable: outcome.failures.some((failure) => failure.retryable),
    message:
      outcome.failures.map((failure) => failure.message).join("; ") ||
      `${source} is incomplete`,
  };
}

function freshCandidates(
  outcome: ReadOutcome<readonly ClaimAllCandidateId[]> | undefined,
): readonly ClaimAllCandidateId[] {
  return outcome && isFreshReady(outcome) ? outcome.data : [];
}

export function evaluateClaimAllPreflight(
  cache: ClaimAllPreflightCache,
): ClaimAllPreflightEvaluation {
  const progress = PREFLIGHT_SOURCES.map((source) =>
    preflightProgress(source, cache.sources[source]),
  );
  const markets = cache.sources.markets;
  const streams = cache.sources.streams;
  const hydration = cache.sources.hydration;
  const verifier = cache.sources.verifier;
  const primaryCandidates = normalizedCandidates([
    ...freshCandidates(markets),
    ...freshCandidates(streams),
  ]);

  if (!verifier || !isFreshReady(verifier)) {
    const loading = !verifier || verifier.status === "loading";
    return {
      status: loading ? "loading" : "blocked",
      canReview: false,
      reason: loading ? "discovery-incomplete" : "verifier-unavailable",
      candidateIds: primaryCandidates,
      progress,
    };
  }
  if (!markets || !streams || !isFreshReady(markets) || !isFreshReady(streams)) {
    const loading =
      !markets ||
      !streams ||
      markets.status === "loading" ||
      streams.status === "loading";
    return {
      status: loading ? "loading" : "blocked",
      canReview: false,
      reason: "discovery-incomplete",
      candidateIds: primaryCandidates,
      progress,
    };
  }
  if (!hydration || !isFreshReady(hydration)) {
    return {
      status: hydration?.status === "loading" || !hydration ? "loading" : "blocked",
      canReview: false,
      reason: "hydration-incomplete",
      candidateIds: primaryCandidates,
      progress,
    };
  }
  if (
    ![markets, streams, hydration, verifier].every((outcome) =>
      sourceMatchesTarget(outcome, cache.target),
    )
  ) {
    return {
      status: "blocked",
      canReview: false,
      reason: "snapshot-mismatch",
      candidateIds: primaryCandidates,
      progress,
    };
  }
  if (!sameClaimAllCandidates(primaryCandidates, verifier.data)) {
    return {
      status: "blocked",
      canReview: false,
      reason: "provider-disagreement",
      candidateIds: primaryCandidates,
      progress,
    };
  }
  if (!sameClaimAllCandidates(primaryCandidates, hydration.data)) {
    return {
      status: "blocked",
      canReview: false,
      reason: "hydration-incomplete",
      candidateIds: primaryCandidates,
      progress,
    };
  }
  return {
    status: "ready",
    canReview: true,
    reason: null,
    candidateIds: primaryCandidates,
    progress,
  };
}

export type ClaimAllRowReconciliation =
  | { status: "ready"; tx: QueuedTx }
  | { status: "needs-review"; replacement: QueuedTx }
  | { status: "skipped" };

function stableTx(tx: QueuedTx): string {
  return JSON.stringify(tx, (_key, value) =>
    typeof value === "bigint" ? `${value}n` : value,
  ).toLowerCase();
}

export function sameClaimAllPlan(
  left: readonly QueuedTx[],
  right: readonly QueuedTx[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tx, index) => stableTx(tx) === stableTx(right[index]))
  );
}

export function reconcileQueuedTx(
  reviewed: QueuedTx,
  current: QueuedTx | null,
): ClaimAllRowReconciliation {
  if (!current) return { status: "skipped" };
  return stableTx(reviewed) === stableTx(current)
    ? { status: "ready", tx: reviewed }
    : { status: "needs-review", replacement: current };
}
