import { describe, expect, it } from "vitest";
import type { Address, Log } from "viem";
import {
  discoverPortfolioLogCandidates,
  divideLogRanges,
  mergeCandidateIds,
  mergeMarketCandidates,
  sortActivityNewestFirst,
  type PortfolioLogClient,
} from "@/lib/discovery/portfolio-log-candidates";

const ACCOUNT = "0x00000000000000000000000000000000000000a1" as Address;
const LOCKUP = "0x0000000000000000000000000000000000000e55" as Address;
const VAULT = "0x0000000000000000000000000000000000000b01" as Address;
const LENDING = "0x0000000000000000000000000000000000000c02" as Address;
const LENDING_B = "0x0000000000000000000000000000000000000c03" as Address;

function logWith(args: Record<string, bigint>, address: Address = LOCKUP): Log {
  return {
    address,
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: 1n,
    data: "0x",
    logIndex: 0,
    transactionHash: `0x${"22".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
    topics: [],
    args,
  } as Log & { args: Record<string, bigint> };
}

describe("divideLogRanges", () => {
  it("splits an oversized range into maxBlockRange chunks", () => {
    expect(divideLogRanges(0n, 25_000n, 10_000)).toEqual([
      { fromBlock: 0n, toBlock: 9_999n },
      { fromBlock: 10_000n, toBlock: 19_999n },
      { fromBlock: 20_000n, toBlock: 25_000n },
    ]);
  });
});

describe("mergeCandidateIds", () => {
  it("drops zeros, deduplicates, and sorts", () => {
    expect(mergeCandidateIds([[3n, 1n, 0n], [1n, 2n]])).toEqual([1n, 2n, 3n]);
  });
});

describe("mergeMarketCandidates", () => {
  it("keeps the same id on two lending contracts as distinct candidates", () => {
    expect(
      mergeMarketCandidates([
        [
          { lending: LENDING, id: 1n },
          { lending: LENDING, id: 1n },
          { lending: LENDING, id: 0n },
        ],
        [{ lending: LENDING_B, id: 1n }],
      ]),
    ).toEqual([
      { lending: LENDING, id: 1n },
      { lending: LENDING_B, id: 1n },
    ]);
  });
});

describe("discoverPortfolioLogCandidates", () => {
  it("divides an oversized range and merges without duplicate or missing ids", async () => {
    const queries: Array<{ fromBlock: bigint; toBlock: bigint; field?: string }> = [];
    const client: PortfolioLogClient = {
      async getLogs(query) {
        queries.push({
          fromBlock: query.fromBlock,
          toBlock: query.toBlock,
          field: query.args ? Object.keys(query.args)[0] : undefined,
        });
        if (query.args && "to" in query.args && query.fromBlock === 0n) {
          return [logWith({ tokenId: 1n }), logWith({ tokenId: 2n })];
        }
        if (query.args && "to" in query.args && query.fromBlock === 10_000n) {
          return [logWith({ tokenId: 2n }), logWith({ tokenId: 3n })];
        }
        return [];
      },
    };

    const outcome = await discoverPortfolioLogCandidates(client, {
      account: ACCOUNT,
      lockup: LOCKUP,
      vaults: [VAULT],
      lendings: [LENDING],
      fromBlock: 0n,
      toBlock: 15_000n,
      maxBlockRange: 10_000,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.complete).toBe(true);
    expect(outcome.data.streamIds).toEqual([1n, 2n, 3n]);
    expect(outcome.data.loans).toEqual([]);
    expect(outcome.data.positions).toEqual([]);
    const toQueries = queries.filter((row) => row.field === "to");
    expect(toQueries).toEqual([
      { fromBlock: 0n, toBlock: 9_999n, field: "to" },
      { fromBlock: 10_000n, toBlock: 15_000n, field: "to" },
    ]);
  });

  it("returns partial portfolio output when one range fails", async () => {
    const client: PortfolioLogClient = {
      async getLogs(query) {
        if (query.fromBlock >= 10_000n) {
          throw new Error("provider failed mid-range");
        }
        if (query.args && "to" in query.args) return [logWith({ tokenId: 7n })];
        return [];
      },
    };

    const outcome = await discoverPortfolioLogCandidates(client, {
      account: ACCOUNT,
      lockup: LOCKUP,
      vaults: [],
      lendings: [],
      fromBlock: 0n,
      toBlock: 15_000n,
      maxBlockRange: 10_000,
    });

    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.complete).toBe(false);
    expect(outcome.data.streamIds).toEqual([7n]);
    expect(outcome.failures[0]?.message).toMatch(/mid-range/);
  });

  it("keeps the same loan id on two lending contracts as distinct candidates", async () => {
    const client: PortfolioLogClient = {
      async getLogs(query) {
        if (query.args && "borrower" in query.args) {
          return [logWith({ loanId: 1n }, LENDING), logWith({ loanId: 1n }, LENDING_B)];
        }
        if (query.args && "lender" in query.args) {
          return [logWith({ positionId: 9n }, LENDING), logWith({ positionId: 9n }, LENDING_B)];
        }
        return [];
      },
    };

    const outcome = await discoverPortfolioLogCandidates(client, {
      account: ACCOUNT,
      lockup: LOCKUP,
      vaults: [],
      lendings: [LENDING, LENDING_B],
      fromBlock: 0n,
      toBlock: 10n,
      maxBlockRange: 10_000,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.loans).toEqual([
      { lending: LENDING, id: 1n },
      { lending: LENDING_B, id: 1n },
    ]);
    expect(outcome.data.positions).toEqual([
      { lending: LENDING, id: 9n },
      { lending: LENDING_B, id: 9n },
    ]);
    expect(outcome.data.activity.map((row) => row.kind)).toEqual([
      "borrowed",
      "borrowed",
      "supplied",
      "supplied",
    ]);
  });

  it("lists activity newest-first and never treats a missing page as empty", async () => {
    expect(
      sortActivityNewestFirst([
        {
          kind: "supplied",
          blockNumber: 1n,
          logIndex: 2,
          transactionHash: `0x${"22".repeat(32)}`,
          id: 1n,
          address: LENDING,
        },
        {
          kind: "borrowed",
          blockNumber: 3n,
          logIndex: 0,
          transactionHash: `0x${"22".repeat(32)}`,
          id: 2n,
          address: LENDING,
        },
        {
          kind: "deposited",
          blockNumber: 3n,
          logIndex: 4,
          transactionHash: `0x${"22".repeat(32)}`,
          id: 9n,
          address: VAULT,
        },
      ]).map((row) => row.kind),
    ).toEqual(["deposited", "borrowed", "supplied"]);
  });
});
