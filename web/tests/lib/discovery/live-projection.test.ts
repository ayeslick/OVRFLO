import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { ovrfloLendingAbi } from "@/lib/abis";
import {
  discoverAccountLoanBook,
  discoverClaimAllRegistry,
  discoverMarketLiquidity,
  type ProjectionReadClient,
} from "@/lib/discovery/live-projection";
import type { HeadSnapshot } from "@/lib/discovery/log-scanner";

const LENDING = address(0x11);
const MARKET = address(0x22);
const LENDER = address(0x33);
const BORROWER = address(0x44);
const FACTORY = address(0x55);
const VAULT_A = address(0x56);
const VAULT_B = address(0x57);
const snapshot: HeadSnapshot = {
  finalized: { number: 9n, hash: hash(9) },
  latest: { number: 10n, hash: hash(10) },
};

function address(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

function hash(value: number | bigint): Hex {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}` as Hex;
}

function checkpointLog(id: bigint, availableLiquidity = 1n): Log {
  return {
    address: LENDING,
    blockNumber: 10n,
    blockHash: snapshot.latest.hash,
    transactionHash: hash(10_000n + id),
    transactionIndex: Number(id - 1n),
    logIndex: 0,
    topics: encodeEventTopics({
      abi: ovrfloLendingAbi,
      eventName: "LiquidityCheckpoint",
      args: { lender: LENDER, market: MARKET, aprBps: 1_000 },
    }),
    data: encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint128" },
        { type: "uint8" },
        { type: "uint256" },
      ],
      [id, availableLiquidity, 1, 0n],
    ),
    removed: false,
  } as Log;
}

function borrowerLoanLog(id: bigint): Log {
  return {
    address: LENDING,
    blockNumber: 10n,
    blockHash: snapshot.latest.hash,
    transactionHash: hash(20_000n + id),
    transactionIndex: Number(id - 1n),
    logIndex: 0,
    topics: encodeEventTopics({
      abi: ovrfloLendingAbi,
      eventName: "BorrowerLoanPoolCreated",
      args: { loanId: id, borrower: BORROWER, market: MARKET },
    }),
    data: encodeAbiParameters(
      [{ type: "uint16" }, { type: "uint128" }],
      [1_000, 1n],
    ),
    removed: false,
  } as Log;
}

function client(
  count: number,
  overrides: {
    aggregateDepth?: bigint;
    directAmount?: (id: bigint) => bigint;
  } = {},
): ProjectionReadClient {
  const logs = Array.from({ length: count }, (_, index) =>
    checkpointLog(BigInt(index + 1)),
  );
  const aggregateDepth = overrides.aggregateDepth ?? BigInt(count);
  return {
    getBlock: vi.fn(async ({ blockTag, blockNumber }) => {
      const number =
        blockNumber ??
        (blockTag === "finalized"
          ? snapshot.finalized.number
          : snapshot.latest.number);
      return { number, hash: hash(number), timestamp: number * 12n };
    }),
    getLogs: vi.fn(async () => logs),
    readContract: vi.fn(async (request) => {
      if (request.functionName === "liquidityPositions") {
        const id = request.args?.[0] as bigint;
        return [
          LENDER,
          MARKET,
          1_000,
          overrides.directAmount?.(id) ?? 1n,
        ];
      }
      if (request.functionName === "marketAvailableLiquidity") {
        return aggregateDepth;
      }
      if (request.functionName === "marketAprAvailableLiquidity") {
        return aggregateDepth;
      }
      throw new Error(`Unhandled ${request.functionName}`);
    }),
  };
}

function accountClient(count: number): ProjectionReadClient {
  const borrowerLogs = Array.from({ length: count }, (_, index) =>
    borrowerLoanLog(BigInt(index + 1)),
  );
  const borrowerTopic = encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "BorrowerLoanPoolCreated",
  })[0];
  return {
    getBlock: vi.fn(async ({ blockTag, blockNumber }) => {
      const number =
        blockNumber ??
        (blockTag === "finalized"
          ? snapshot.finalized.number
          : snapshot.latest.number);
      return { number, hash: hash(number), timestamp: number * 12n };
    }),
    getLogs: vi.fn(async ({ topics }) =>
      topics[0] === borrowerTopic ? borrowerLogs : [],
    ),
    readContract: vi.fn(async (request) => {
      const id = request.args?.[0] as bigint;
      if (request.functionName === "loanPools") {
        return [BORROWER, 1_000, MARKET, 1n];
      }
      if (request.functionName === "loans") {
        return [BORROWER, id, 1n, 0n, 0n, false];
      }
      if (
        request.functionName === "loanPoolContributions" ||
        request.functionName === "loanPoolReceived" ||
        request.functionName === "withdrawableAmountOf"
      ) {
        return 0n;
      }
      throw new Error(`Unhandled ${request.functionName}`);
    }),
  };
}

describe("discoverMarketLiquidity", () => {
  it("proves 650 projected positions against uncapped aggregate truth and direct hydration", async () => {
    const outcome = await discoverMarketLiquidity({
      client: client(650),
      lending: LENDING,
      market: MARKET,
      fromBlock: 1n,
      snapshot,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data.positions).toHaveLength(650);
    expect(outcome.data.positions.at(-1)?.id).toBe(650n);
    expect(outcome.data.aggregateDepth).toBe(650n);
    expect(outcome.data.aggregateByApr.get(1_000)).toBe(650n);
    expect(outcome.data.ledger.attempts).toHaveLength(1);
  });

  it("fails closed when aggregate storage and the event projection disagree", async () => {
    const outcome = await discoverMarketLiquidity({
      client: client(650, { aggregateDepth: 649n }),
      lending: LENDING,
      market: MARKET,
      fromBlock: 1n,
      snapshot,
    });

    expect(outcome.status).toBe("unavailable");
    expect(outcome.failures[0]?.message).toMatch(/aggregate/i);
  });

  it("fails closed when any projected ID disagrees with direct hydration", async () => {
    const outcome = await discoverMarketLiquidity({
      client: client(650, {
        directAmount: (id) => (id === 501n ? 0n : 1n),
      }),
      lending: LENDING,
      market: MARKET,
      fromBlock: 1n,
      snapshot,
    });

    expect(outcome.status).toBe("unavailable");
    expect(outcome.failures[0]?.entityId).toBe("501");
  });

  it("fails closed before scanning when a provider disagrees with the pinned head", async () => {
    const projectionClient = client(1);
    vi.mocked(projectionClient.getBlock).mockResolvedValue({
      number: snapshot.latest.number,
      hash: hash(999),
      timestamp: 1n,
    });

    const outcome = await discoverMarketLiquidity({
      client: projectionClient,
      lending: LENDING,
      market: MARKET,
      fromBlock: 1n,
      snapshot,
    });

    expect(outcome.status).toBe("unavailable");
    expect(outcome.failures[0]?.message).toMatch(/pinned latest block/i);
    expect(projectionClient.getLogs).not.toHaveBeenCalled();
  });

  it("stops scheduling hydration chunks after cancellation", async () => {
    const abort = new AbortController();
    const projectionClient = client(250, {
      directAmount: (id) => {
        if (id === 100n) abort.abort();
        return 1n;
      },
    });

    const outcome = await discoverMarketLiquidity({
      client: projectionClient,
      lending: LENDING,
      market: MARKET,
      fromBlock: 1n,
      snapshot,
      signal: abort.signal,
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.failures[0]?.code).toBe("cancelled");
    expect(
      vi.mocked(projectionClient.readContract).mock.calls.filter(
        ([request]) => request.functionName === "liquidityPositions",
      ),
    ).toHaveLength(100);
  });
});

describe("discoverClaimAllRegistry", () => {
  it("directly hydrates the complete pinned factory registry and lending scope", async () => {
    const projectionClient: ProjectionReadClient = {
      getBlock: vi.fn(async ({ blockNumber }) => ({
        number: blockNumber ?? snapshot.latest.number,
        hash: hash(blockNumber ?? snapshot.latest.number),
        timestamp: 1n,
      })),
      getLogs: vi.fn(async () => []),
      readContract: vi.fn(async (request) => {
        if (request.functionName === "ovrfloCount") return 2n;
        if (request.functionName === "ovrflos") {
          return request.args?.[0] === 0n ? VAULT_A : VAULT_B;
        }
        if (request.functionName === "ovrfloToLending") {
          return request.args?.[0] === VAULT_A ? LENDING : address(0);
        }
        throw new Error(`Unhandled ${request.functionName}`);
      }),
    };

    const outcome = await discoverClaimAllRegistry({
      client: projectionClient,
      factory: FACTORY,
      snapshot,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data).toEqual({
      entries: [
        { vault: VAULT_A, lending: LENDING },
        { vault: VAULT_B, lending: null },
      ],
      vaults: [VAULT_A, VAULT_B],
      lendings: [LENDING],
    });
    expect(projectionClient.readContract).toHaveBeenCalledTimes(5);
    expect(
      vi.mocked(projectionClient.readContract).mock.calls.every(
        ([request]) => request.blockNumber === snapshot.latest.number,
      ),
    ).toBe(true);
  });
});

describe("discoverAccountLoanBook", () => {
  it("projects and directly hydrates 650 borrower loans without the retired cap", async () => {
    const outcome = await discoverAccountLoanBook({
      client: accountClient(650),
      lending: LENDING,
      account: BORROWER,
      fromBlock: 1n,
      snapshot,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") return;
    expect(outcome.data.borrowerLoans).toHaveLength(650);
    expect(outcome.data.loans).toHaveLength(650);
    expect(outcome.data.loans[0]?.loan.id).toBe(650n);
    expect(outcome.data.loans.at(-1)?.loan.id).toBe(1n);
  });
});
