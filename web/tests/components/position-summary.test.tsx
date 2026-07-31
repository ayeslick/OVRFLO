import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const userA = testAddress(0xa11);

vi.mock("@/hooks/useIndexerSync", () => ({
  useIndexerSync: () => ({ syncedBlock: 100n, headBlock: 100n, lagBlocks: 0n, lagging: false }),
}));
vi.mock("wagmi", () => ({
  useBlockNumber: () => ({ data: 100n }),
  useConnection: () => ({ status: "connected", addresses: [userA], chainId: 1 }),
  useSwitchChain: () => ({ switchChain: () => {}, isPending: false, error: null }),
  useReadContract: () => ({ data: undefined }),
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
}));

type PerLending = {
  liquidity: unknown[];
  pools: unknown[];
  loans: unknown[];
  error: Error | null;
  isLoading: boolean;
};

const perLending: Record<string, PerLending> = {};

function entry(lending: Address): PerLending {
  const key = lending.toLowerCase();
  perLending[key] ??= { liquidity: [], pools: [], loans: [], error: null, isLoading: false };
  return perLending[key];
}

vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: (lending: Address) => ({
    liquidity: entry(lending).liquidity,
    tooLarge: false,
    isLoading: entry(lending).isLoading,
    error: entry(lending).error,
  }),
}));
vi.mock("@/hooks/useLoanBook", () => ({
  useLoanBook: (lending: Address) => ({
    pools: entry(lending).pools,
    loans: entry(lending).loans,
    tooLarge: false,
    isLoading: entry(lending).isLoading,
    error: entry(lending).error,
  }),
}));

const heldStreams = { streams: [] as unknown[] };
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({ streams: heldStreams.streams, isLoading: false, error: null }),
}));

const queueState = {
  startedPlans: [] as unknown[],
  rows: [] as unknown[],
};
vi.mock("@/hooks/useTxQueue", () => ({
  useTxQueue: () => ({
    rows: queueState.rows,
    statusOf: () => "pending",
    start: vi.fn((plan) => queueState.startedPlans.push(plan)),
    resume: vi.fn(),
    running: false,
    paused: false,
    failed: false,
    error: null,
    inFlight: false,
    done: false,
  }),
}));

import { PositionSummary } from "@/components/PositionSummary";

const lendingA = testAddress(0x51);
const lendingB = testAddress(0x52);

function makeMarket(overrides: Partial<MarketInfo> = {}): MarketInfo {
  return {
    vault: testAddress(1),
    treasury: testAddress(2),
    underlying: testAddress(3),
    ovrfloToken: testAddress(4),
    lending: lendingA,
    market: testAddress(6),
    twapDurationFixed: 900,
    feeBps: 25,
    expiryCached: 99999999999n,
    ptToken: testAddress(7),
    oracle: testAddress(8),
    ...overrides,
  };
}

const marketA = makeMarket();
const marketB = makeMarket({
  vault: testAddress(11),
  underlying: testAddress(13),
  ovrfloToken: testAddress(14),
  market: testAddress(16),
  lending: lendingB,
});

const symbols = {
  [marketA.underlying.toLowerCase()]: "TESTA",
  [marketA.ovrfloToken.toLowerCase()]: "ovrfloTESTA",
  [marketB.underlying.toLowerCase()]: "TESTB",
  [marketB.ovrfloToken.toLowerCase()]: "ovrfloTESTB",
};

beforeEach(() => {
  for (const key of Object.keys(perLending)) delete perLending[key];
  heldStreams.streams = [];
  queueState.startedPlans = [];
  queueState.rows = [];
});

function liquidityPosition(lending: Address, market: Address, amount: bigint) {
  entry(lending).liquidity = [
    { id: 1n, lender: userA, market, aprBps: 1000, availableLiquidity: amount },
  ];
}

describe("summary strip (R1/R2/R4)", () => {
  it("renders nothing when there are no positions", () => {
    render(<PositionSummary markets={[marketA]} user={userA} symbols={symbols} />);
    expect(screen.queryByText("YOUR POSITIONS")).not.toBeInTheDocument();
  });

  it("renders nothing when disconnected even with markets", () => {
    render(<PositionSummary markets={[marketA]} user={undefined} symbols={symbols} />);
    expect(screen.queryByText("YOUR POSITIONS")).not.toBeInTheDocument();
  });

  it("groups amounts per symbol and never sums across tokens", () => {
    liquidityPosition(lendingA, marketA.market, 5n * 10n ** 18n);
    liquidityPosition(lendingB, marketB.market, 7n * 10n ** 18n);
    render(<PositionSummary markets={[marketA, marketB]} user={userA} symbols={symbols} />);
    expect(screen.getByText(/5\.00 TESTA/)).toBeInTheDocument();
    expect(screen.getByText(/7\.00 TESTB/)).toBeInTheDocument();
    expect(screen.queryByText(/12\.00/)).not.toBeInTheDocument();
  });

  it("weights loan progress by obligation", () => {
    entry(lendingA).loans = [
      {
        loan: { id: 1n, borrower: userA, streamId: 1n, obligation: 100n, drawn: 50n, repaid: 0n, closed: false },
        pool: { id: 1n, borrower: userA, aprBps: 1000, market: marketA.market, totalContributed: 100n },
        withdrawable: 0n,
      },
      {
        loan: { id: 2n, borrower: userA, streamId: 2n, obligation: 100n, drawn: 90n, repaid: 9n, closed: false },
        pool: { id: 2n, borrower: userA, aprBps: 1000, market: marketA.market, totalContributed: 100n },
        withdrawable: 0n,
      },
    ];
    render(<PositionSummary markets={[marketA]} user={userA} symbols={symbols} />);
    // (50 + 99) / 200 = 74%
    expect(screen.getByText("2 REPAYING · 74%")).toBeInTheDocument();
  });

  it("omits CLAIM ALL when positions exist but nothing is claimable", () => {
    liquidityPosition(lendingA, marketA.market, 5n * 10n ** 18n);
    render(<PositionSummary markets={[marketA]} user={userA} symbols={symbols} />);
    expect(screen.queryByRole("button", { name: "CLAIM ALL" })).not.toBeInTheDocument();
  });

  it("renders a dash for an errored market's symbol without stalling the other market (R33)", () => {
    liquidityPosition(lendingA, marketA.market, 5n * 10n ** 18n);
    entry(lendingB).error = new Error("rpc down");
    // marketB has an error; give marketA a real value
    render(<PositionSummary markets={[marketA, marketB]} user={userA} symbols={symbols} />);
    expect(screen.getByText(/5\.00 TESTA/)).toBeInTheDocument();
    const supplied = screen.getByText("SUPPLIED").parentElement!;
    expect(supplied.textContent).toContain("—");
  });
});

describe("claim-all modal (R3)", () => {
  it("opens on CLAIM ALL and does not start signing until CONFIRM QUEUE", () => {
    entry(lendingA).pools = [
      {
        pool: { id: 3n, borrower: testAddress(0xb), aprBps: 1000, market: marketA.market, totalContributed: 100n },
        loan: { id: 3n, borrower: testAddress(0xb), streamId: 5n, obligation: 100n, drawn: 0n, repaid: 0n, closed: false },
        contribution: 50n,
        received: 0n,
        proceeds: 10n,
        withdrawable: 20n,
        claimable: 10n,
      },
    ];
    render(<PositionSummary markets={[marketA]} user={userA} symbols={symbols} />);
    fireEvent.click(screen.getByRole("button", { name: "CLAIM ALL" }));
    expect(screen.getByRole("dialog", { name: "Claim all" })).toBeInTheDocument();
    expect(screen.getByText(/CLAIM 1 POOL SHARE/)).toBeInTheDocument();
    expect(queueState.startedPlans).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "CONFIRM QUEUE" }));
    expect(queueState.startedPlans).toHaveLength(1);
  });
});
