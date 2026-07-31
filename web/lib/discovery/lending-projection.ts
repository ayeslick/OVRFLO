import { decodeEventLog, encodeEventTopics, isAddressEqual, type Address, type Hex } from "viem";
import { ovrfloLendingAbi } from "../abis";
import { ZERO_ADDRESS } from "../config";
import type { BlockIdentity, ValidatedLog } from "./types";

export const LIQUIDITY_REASON_V1_SUPPLY = 1;
export const LIQUIDITY_REASON_V1_WITHDRAWAL = 2;
export const LIQUIDITY_REASON_V1_STREAM_SALE = 3;
export const LIQUIDITY_REASON_V1_LOAN_CONSUMPTION = 4;

export type LiquidityCheckpoint = {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  lender: Address;
  market: Address;
  aprBps: number;
  liquidityId: bigint;
  availableLiquidity: bigint;
  reason: number;
  referenceId: bigint;
};

export type ProjectedLiquidityPosition = {
  id: bigint;
  lender: Address;
  market: Address;
  aprBps: number;
  availableLiquidity: bigint;
};

export type LendingProjection = {
  positions: Map<bigint, ProjectedLiquidityPosition>;
  activeByMarketApr: Map<string, bigint[]>;
  loanIdsByLender: Map<string, bigint[]>;
  completeThrough: BlockIdentity;
};

export type DurableLoanReference = {
  lender: Address;
  loanId: bigint;
};

export type CompactedLendingHistory = {
  finalizedPositions: LiquidityCheckpoint[];
  durableLoanReferences: DurableLoanReference[];
  volatileTail: LiquidityCheckpoint[];
};

export type BorrowerLoanCandidate = {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  loanId: bigint;
  borrower: Address;
  market: Address;
  aprBps: number;
  totalContributed: bigint;
};

export function liquidityCheckpointTopics({
  lender,
  market,
  aprBps,
}: {
  lender?: Address;
  market?: Address;
  aprBps?: number;
}): readonly (Hex | readonly Hex[] | null)[] {
  return encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "LiquidityCheckpoint",
    args: { lender, market, aprBps },
  });
}

export function borrowerLoanTopics({
  borrower,
  market,
}: {
  borrower?: Address;
  market?: Address;
}): readonly (Hex | readonly Hex[] | null)[] {
  return encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "BorrowerLoanPoolCreated",
    args: { borrower, market },
  });
}

export function decodeLiquidityCheckpoint(log: ValidatedLog): LiquidityCheckpoint {
  const decoded = decodeEventLog({
    abi: ovrfloLendingAbi,
    eventName: "LiquidityCheckpoint",
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  return {
    blockNumber: log.blockNumber,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    lender: decoded.args.lender,
    market: decoded.args.market,
    aprBps: decoded.args.aprBps,
    liquidityId: decoded.args.liquidityId,
    availableLiquidity: decoded.args.availableLiquidity,
    reason: decoded.args.reason,
    referenceId: decoded.args.referenceId,
  };
}

export function decodeBorrowerLoanCandidate(log: ValidatedLog): BorrowerLoanCandidate {
  const decoded = decodeEventLog({
    abi: ovrfloLendingAbi,
    eventName: "BorrowerLoanPoolCreated",
    data: log.data,
    topics: log.topics,
    strict: true,
  });
  return {
    blockNumber: log.blockNumber,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    loanId: decoded.args.loanId,
    borrower: decoded.args.borrower,
    market: decoded.args.market,
    aprBps: decoded.args.aprBps,
    totalContributed: decoded.args.totalContributed,
  };
}

export function projectBorrowerLoans(events: readonly BorrowerLoanCandidate[]): BorrowerLoanCandidate[] {
  const byLoanId = new Map<bigint, BorrowerLoanCandidate>();
  for (const event of [...events].sort(compareEventIdentity)) {
    const existing = byLoanId.get(event.loanId);
    if (
      existing &&
      (!isAddressEqual(existing.borrower, event.borrower) ||
        !isAddressEqual(existing.market, event.market) ||
        existing.aprBps !== event.aprBps ||
        existing.totalContributed !== event.totalContributed)
    ) {
      throw new Error(`Loan ${event.loanId} identity changed`);
    }
    byLoanId.set(event.loanId, event);
  }
  return [...byLoanId.values()].sort((left, right) => compareBigint(left.loanId, right.loanId));
}

export function marketAprKey(market: Address, aprBps: number): string {
  return `${market.toLowerCase()}:${aprBps}`;
}

export function projectLending(
  finalizedCheckpoints: readonly LiquidityCheckpoint[],
  volatileTail: readonly LiquidityCheckpoint[],
  completeThrough: BlockIdentity,
  durableLoanReferences: readonly DurableLoanReference[] = [],
): LendingProjection {
  const positions = new Map<bigint, ProjectedLiquidityPosition>();
  const loanIdsByLenderSet = new Map<string, Set<bigint>>();
  for (const reference of durableLoanReferences) {
    const key = reference.lender.toLowerCase();
    const loanIds = loanIdsByLenderSet.get(key) ?? new Set<bigint>();
    loanIds.add(reference.loanId);
    loanIdsByLenderSet.set(key, loanIds);
  }
  const checkpoints = [...finalizedCheckpoints, ...volatileTail].sort(compareCheckpoints);

  for (const checkpoint of checkpoints) {
    validateCheckpoint(checkpoint);
    const existing = positions.get(checkpoint.liquidityId);
    if (
      existing &&
      (!isAddressEqual(existing.lender, checkpoint.lender) ||
        !isAddressEqual(existing.market, checkpoint.market) ||
        existing.aprBps !== checkpoint.aprBps)
    ) {
      throw new Error(`Liquidity ${checkpoint.liquidityId} identity changed`);
    }
    positions.set(checkpoint.liquidityId, {
      id: checkpoint.liquidityId,
      lender: checkpoint.lender,
      market: checkpoint.market,
      aprBps: checkpoint.aprBps,
      availableLiquidity: checkpoint.availableLiquidity,
    });
    if (checkpoint.reason === LIQUIDITY_REASON_V1_LOAN_CONSUMPTION) {
      const key = checkpoint.lender.toLowerCase();
      const loanIds = loanIdsByLenderSet.get(key) ?? new Set<bigint>();
      loanIds.add(checkpoint.referenceId);
      loanIdsByLenderSet.set(key, loanIds);
    }
  }

  const activeByMarketApr = new Map<string, bigint[]>();
  for (const position of positions.values()) {
    const key = marketAprKey(position.market, position.aprBps);
    const ids = activeByMarketApr.get(key) ?? [];
    if (position.availableLiquidity > 0n) ids.push(position.id);
    activeByMarketApr.set(key, ids);
  }
  for (const ids of activeByMarketApr.values()) ids.sort(compareBigint);

  const loanIdsByLender = new Map<string, bigint[]>();
  for (const [lender, ids] of loanIdsByLenderSet) {
    loanIdsByLender.set(lender, [...ids].sort(compareBigint));
  }
  return { positions, activeByMarketApr, loanIdsByLender, completeThrough };
}

export function compactLendingHistory(
  checkpoints: readonly LiquidityCheckpoint[],
  finalizedThrough: bigint,
  priorDurableLoanReferences: readonly DurableLoanReference[] = [],
): CompactedLendingHistory {
  const finalizedPositions = new Map<bigint, LiquidityCheckpoint>();
  const durableReferences = new Map<string, DurableLoanReference>();
  for (const reference of priorDurableLoanReferences) {
    durableReferences.set(`${reference.lender.toLowerCase()}:${reference.loanId}`, reference);
  }
  const volatileTail: LiquidityCheckpoint[] = [];
  for (const checkpoint of [...checkpoints].sort(compareCheckpoints)) {
    if (checkpoint.blockNumber > finalizedThrough) {
      volatileTail.push(checkpoint);
      continue;
    }
    finalizedPositions.set(checkpoint.liquidityId, checkpoint);
    if (checkpoint.reason === LIQUIDITY_REASON_V1_LOAN_CONSUMPTION) {
      durableReferences.set(`${checkpoint.lender.toLowerCase()}:${checkpoint.referenceId}`, {
        lender: checkpoint.lender,
        loanId: checkpoint.referenceId,
      });
    }
  }
  return {
    finalizedPositions: [...finalizedPositions.values()].sort(compareCheckpoints),
    durableLoanReferences: [...durableReferences.values()].sort(
      (left, right) =>
        compareBigint(left.loanId, right.loanId) ||
        left.lender.toLowerCase().localeCompare(right.lender.toLowerCase()),
    ),
    volatileTail,
  };
}

export type ConservationResult =
  | { status: "conserved"; publicDepth: bigint; aggregateDepth: bigint; block: BlockIdentity }
  | {
      status: "mismatch";
      projectedDepth: bigint;
      aggregateDepth: bigint;
      block: BlockIdentity;
    }
  | {
      status: "block-mismatch";
      projectedBlock: BlockIdentity;
      aggregateBlock: BlockIdentity;
    };

export function conserveMarketApr(
  projection: LendingProjection,
  market: Address,
  aprBps: number,
  aggregateDepth: bigint,
  aggregateBlock: BlockIdentity,
): ConservationResult {
  if (
    projection.completeThrough.number !== aggregateBlock.number ||
    projection.completeThrough.hash.toLowerCase() !== aggregateBlock.hash.toLowerCase()
  ) {
    return {
      status: "block-mismatch",
      projectedBlock: projection.completeThrough,
      aggregateBlock,
    };
  }
  const projectedDepth = [...projection.positions.values()]
    .filter(
      (position) =>
        isAddressEqual(position.market, market) && position.aprBps === aprBps,
    )
    .reduce((sum, position) => sum + position.availableLiquidity, 0n);
  if (projectedDepth !== aggregateDepth) {
    return { status: "mismatch", projectedDepth, aggregateDepth, block: aggregateBlock };
  }
  return { status: "conserved", publicDepth: projectedDepth, aggregateDepth, block: aggregateBlock };
}

type CandidateProjection = {
  candidateIds: readonly bigint[];
  completeThrough: BlockIdentity;
};

export function compareClaimAllCandidates(primary: CandidateProjection, verifier: CandidateProjection) {
  if (
    primary.completeThrough.number !== verifier.completeThrough.number ||
    primary.completeThrough.hash.toLowerCase() !== verifier.completeThrough.hash.toLowerCase()
  ) {
    return {
      status: "block-mismatch" as const,
      guarantee: "all-discovered" as const,
      primaryBlock: primary.completeThrough,
      verifierBlock: verifier.completeThrough,
    };
  }
  const primaryIds = sortedUnique(primary.candidateIds);
  const verifierIds = sortedUnique(verifier.candidateIds);
  const primarySet = new Set(primaryIds);
  const verifierSet = new Set(verifierIds);
  const primaryOnly = primaryIds.filter((id) => !verifierSet.has(id));
  const verifierOnly = verifierIds.filter((id) => !primarySet.has(id));
  if (primaryOnly.length > 0 || verifierOnly.length > 0) {
    return {
      status: "disagreement" as const,
      guarantee: "all-discovered" as const,
      primaryOnly,
      verifierOnly,
    };
  }
  return {
    status: "agreement" as const,
    guarantee: "corroborated-all-discovered" as const,
    candidateIds: primaryIds,
  };
}

function validateCheckpoint(checkpoint: LiquidityCheckpoint): void {
  if (checkpoint.liquidityId === 0n) throw new Error("Liquidity checkpoint id is zero");
  if (isAddressEqual(checkpoint.lender, ZERO_ADDRESS)) {
    throw new Error("Liquidity checkpoint lender is zero");
  }
  if (isAddressEqual(checkpoint.market, ZERO_ADDRESS)) {
    throw new Error("Liquidity checkpoint market is zero");
  }
  const referenceRequired =
    checkpoint.reason === LIQUIDITY_REASON_V1_STREAM_SALE ||
    checkpoint.reason === LIQUIDITY_REASON_V1_LOAN_CONSUMPTION;
  const referenceForbidden =
    checkpoint.reason === LIQUIDITY_REASON_V1_SUPPLY ||
    checkpoint.reason === LIQUIDITY_REASON_V1_WITHDRAWAL;
  if (referenceRequired && checkpoint.referenceId === 0n) throw new Error("Checkpoint reference is required");
  if (referenceForbidden && checkpoint.referenceId !== 0n) throw new Error("Checkpoint reference must be zero");
  if (!referenceRequired && !referenceForbidden) throw new Error("Unknown liquidity checkpoint reason");
}

function compareCheckpoints(left: LiquidityCheckpoint, right: LiquidityCheckpoint): number {
  return (
    compareBigint(left.blockNumber, right.blockNumber) ||
    left.transactionIndex - right.transactionIndex ||
    left.logIndex - right.logIndex
  );
}

function compareEventIdentity(
  left: Pick<LiquidityCheckpoint, "blockNumber" | "transactionIndex" | "logIndex">,
  right: Pick<LiquidityCheckpoint, "blockNumber" | "transactionIndex" | "logIndex">,
): number {
  return (
    compareBigint(left.blockNumber, right.blockNumber) ||
    left.transactionIndex - right.transactionIndex ||
    left.logIndex - right.logIndex
  );
}

function sortedUnique(values: readonly bigint[]): bigint[] {
  return [...new Set(values)].sort(compareBigint);
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
