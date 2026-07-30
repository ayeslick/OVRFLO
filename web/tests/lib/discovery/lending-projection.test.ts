import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  compareClaimAllCandidates,
  compactLendingHistory,
  conserveMarketApr,
  borrowerLoanTopics,
  liquidityCheckpointTopics,
  projectBorrowerLoans,
  projectLending,
  type BorrowerLoanCandidate,
  type LiquidityCheckpoint,
} from "@/lib/discovery/lending-projection";

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

function hash(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

const MARKET = address(0xaa);
const LENDER = address(0x11);

function checkpoint(overrides: Partial<LiquidityCheckpoint> = {}): LiquidityCheckpoint {
  return {
    blockNumber: 1n,
    transactionIndex: 0,
    logIndex: 0,
    lender: LENDER,
    market: MARKET,
    aprBps: 1000,
    liquidityId: 1n,
    availableLiquidity: 100n,
    reason: 1,
    referenceId: 0n,
    ...overrides,
  };
}

function borrowerLoan(overrides: Partial<BorrowerLoanCandidate> = {}): BorrowerLoanCandidate {
  return {
    blockNumber: 1n,
    transactionIndex: 0,
    logIndex: 0,
    loanId: 1n,
    borrower: LENDER,
    market: MARKET,
    aprBps: 1000,
    totalContributed: 100n,
    ...overrides,
  };
}

describe("projectLending", () => {
  it("reduces absolute checkpoints while preserving durable loan references after availability reaches zero", () => {
    const projection = projectLending(
      [
        checkpoint(),
        checkpoint({ blockNumber: 2n, availableLiquidity: 40n, reason: 4, referenceId: 77n }),
        checkpoint({ blockNumber: 3n, availableLiquidity: 0n, reason: 4, referenceId: 78n }),
      ],
      [],
      { number: 3n, hash: hash(3) },
    );

    expect(projection.positions.get(1n)?.availableLiquidity).toBe(0n);
    expect(projection.activeByMarketApr.get(`${MARKET.toLowerCase()}:1000`)).toEqual([]);
    expect(projection.loanIdsByLender.get(LENDER.toLowerCase())).toEqual([77n, 78n]);
  });

  it("replaces rather than merges the volatile tail", () => {
    const finalized = [checkpoint({ availableLiquidity: 100n })];
    const oldTail = [checkpoint({ blockNumber: 2n, availableLiquidity: 0n, reason: 2 })];
    const newTail = [checkpoint({ blockNumber: 2n, availableLiquidity: 60n, reason: 3, referenceId: 9n })];

    expect(projectLending(finalized, oldTail, { number: 2n, hash: hash(2) }).positions.get(1n)?.availableLiquidity).toBe(0n);
    expect(projectLending(finalized, newTail, { number: 2n, hash: hash(22) }).positions.get(1n)?.availableLiquidity).toBe(60n);
  });

  it("compacts finalized position state without erasing durable loan references", () => {
    const compacted = compactLendingHistory(
      [
        checkpoint(),
        checkpoint({ blockNumber: 2n, availableLiquidity: 40n, reason: 4, referenceId: 77n }),
        checkpoint({ blockNumber: 3n, availableLiquidity: 0n, reason: 4, referenceId: 78n }),
        checkpoint({ blockNumber: 4n, availableLiquidity: 20n, reason: 3, referenceId: 9n }),
      ],
      3n,
    );
    expect(compacted.finalizedPositions).toHaveLength(1);
    expect(compacted.finalizedPositions[0].availableLiquidity).toBe(0n);
    expect(compacted.durableLoanReferences.map((reference) => reference.loanId)).toEqual([77n, 78n]);
    expect(compacted.volatileTail).toHaveLength(1);

    const projection = projectLending(
      compacted.finalizedPositions,
      compacted.volatileTail,
      { number: 4n, hash: hash(4) },
      compacted.durableLoanReferences,
    );
    expect(projection.loanIdsByLender.get(LENDER.toLowerCase())).toEqual([77n, 78n]);
    expect(projection.positions.get(1n)?.availableLiquidity).toBe(20n);
  });

  it("retains durable loan references across repeated compaction cycles", () => {
    const first = compactLendingHistory(
      [
        checkpoint({ blockNumber: 1n, availableLiquidity: 40n, reason: 4, referenceId: 77n }),
        checkpoint({ blockNumber: 2n, availableLiquidity: 30n, reason: 3, referenceId: 8n }),
        checkpoint({ blockNumber: 3n, availableLiquidity: 20n, reason: 3, referenceId: 9n }),
      ],
      2n,
    );
    const second = compactLendingHistory(
      [...first.finalizedPositions, ...first.volatileTail],
      3n,
      first.durableLoanReferences,
    );

    expect(second.durableLoanReferences).toEqual([{ lender: LENDER, loanId: 77n }]);
    expect(second.finalizedPositions).toHaveLength(1);
    expect(second.finalizedPositions[0].availableLiquidity).toBe(20n);
  });

  it("rejects identity changes for an existing liquidity id", () => {
    expect(() =>
      projectLending(
        [checkpoint(), checkpoint({ blockNumber: 2n, lender: address(0x22), availableLiquidity: 50n, reason: 3, referenceId: 9n })],
        [],
        { number: 2n, hash: hash(2) },
      ),
    ).toThrow(/identity/i);
  });
});

describe("projectBorrowerLoans", () => {
  it("selects the last event from unsorted input and sorts output by loan id", () => {
    const result = projectBorrowerLoans([
      borrowerLoan({ loanId: 2n, blockNumber: 4n, logIndex: 1 }),
      borrowerLoan({ loanId: 1n, blockNumber: 3n, logIndex: 1 }),
      borrowerLoan({ loanId: 2n, blockNumber: 2n, logIndex: 1 }),
      borrowerLoan({ loanId: 1n, blockNumber: 4n, logIndex: 2 }),
    ]);

    expect(result.map((loan) => loan.loanId)).toEqual([1n, 2n]);
    expect(result.map((loan) => [loan.blockNumber, loan.logIndex])).toEqual([
      [4n, 2],
      [4n, 1],
    ]);
  });

  it.each([
    ["borrower", { borrower: address(0x22) }],
    ["market", { market: address(0xbb) }],
    ["APR", { aprBps: 1200 }],
    ["total contribution", { totalContributed: 101n }],
  ])("rejects %s identity mutation for the same loan id", (_label, mutation) => {
    expect(() =>
      projectBorrowerLoans([
        borrowerLoan(),
        borrowerLoan({ blockNumber: 2n, ...mutation }),
      ]),
    ).toThrow(/identity changed/i);
  });
});

describe("intent-scoped filters", () => {
  it("builds indexed market/APR and lender checkpoint topics", () => {
    const marketApr = liquidityCheckpointTopics({ market: MARKET, aprBps: 1000 });
    const lender = liquidityCheckpointTopics({ lender: LENDER });
    expect(marketApr).toHaveLength(4);
    expect(marketApr[1]).toBeNull();
    expect(marketApr[2]).not.toBeNull();
    expect(marketApr[3]).not.toBeNull();
    expect(lender[1]).not.toBeNull();
  });

  it("builds borrower and market filters for loan/demand scopes", () => {
    const borrower = borrowerLoanTopics({ borrower: LENDER });
    const demand = borrowerLoanTopics({ market: MARKET });
    expect(borrower).toHaveLength(4);
    expect(borrower[2]).not.toBeNull();
    expect(demand).toHaveLength(4);
    expect(demand[3]).not.toBeNull();
  });
});

describe("conserveMarketApr", () => {
  it("allows routing only when projection and aggregate conserve at the same captured block", () => {
    const projection = projectLending(
      [checkpoint(), checkpoint({ liquidityId: 2n, logIndex: 1, lender: address(0x22), availableLiquidity: 50n })],
      [],
      { number: 5n, hash: hash(5) },
    );
    expect(conserveMarketApr(projection, MARKET, 1000, 150n, { number: 5n, hash: hash(5) })).toMatchObject({
      status: "conserved",
      publicDepth: 150n,
    });
  });

  it("blocks routing on omitted, duplicated, or block-misaligned data instead of returning empty depth", () => {
    const projection = projectLending([checkpoint()], [], { number: 5n, hash: hash(5) });
    expect(conserveMarketApr(projection, MARKET, 1000, 150n, { number: 5n, hash: hash(5) }).status).toBe("mismatch");
    expect(conserveMarketApr(projection, MARKET, 1000, 100n, { number: 6n, hash: hash(6) }).status).toBe("block-mismatch");
  });
});

describe("compareClaimAllCandidates", () => {
  const complete = {
    candidateIds: [1n, 2n],
    completeThrough: { number: 9n, hash: hash(9) },
  };

  it("disagrees when one independent transport omits history", () => {
    expect(compareClaimAllCandidates(complete, { ...complete, candidateIds: [1n] })).toEqual({
      status: "disagreement",
      guarantee: "all-discovered",
      primaryOnly: [2n],
      verifierOnly: [],
    });
  });

  it("never upgrades agreement beyond corroborated all-discovered", () => {
    expect(compareClaimAllCandidates(complete, { ...complete, candidateIds: [2n, 1n] })).toEqual({
      status: "agreement",
      guarantee: "corroborated-all-discovered",
      candidateIds: [1n, 2n],
    });
  });

  it("rejects independently complete projections captured at different block identities", () => {
    expect(compareClaimAllCandidates(complete, { ...complete, completeThrough: { number: 9n, hash: hash(99) } }).status).toBe(
      "block-mismatch",
    );
  });
});
