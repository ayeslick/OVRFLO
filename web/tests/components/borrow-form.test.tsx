import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address } from "viem";
import type { LiquidityPosition, MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const WAD = 10n ** 18n;
const walletState = { address: testAddress(0xa11) as Address | undefined };

type ReadCall = { functionName?: string; args?: unknown[]; enabled?: boolean };

const readState = {
  grossPrice: 1_000n * WAD,
  fillQuote: [1_000n * WAD, 40n * WAD, 1n * WAD, 29n * WAD, 60n * WAD] as unknown,
  quoteError: null as Error | null,
  quoteLoading: false,
  quoteFetching: false,
  calls: [] as ReadCall[],
};

vi.mock("@/hooks/useIndexerSync", () => ({
  useIndexerSync: () => ({ syncedBlock: 100n, headBlock: 100n, lagBlocks: 0n, lagging: false }),
}));
vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: walletState.address ? "connected" : "disconnected",
    addresses: walletState.address ? [walletState.address] : [],
    chainId: 1,
  }),
  useSwitchChain: () => ({ switchChain: () => {}, isPending: false, error: null }),
  useReadContract: (config?: { functionName?: string; args?: unknown[]; query?: { enabled?: boolean } }) => {
    readState.calls.push({ functionName: config?.functionName, args: config?.args, enabled: config?.query?.enabled });
    switch (config?.functionName) {
      case "quote":
        if (config.args?.[3] === 0n) {
          return {
            data: [readState.grossPrice, 0n, 0n, 0n, 0n],
            error: readState.quoteError,
            isLoading: readState.quoteLoading,
            isFetching: readState.quoteFetching,
          };
        }
        return {
          data: readState.fillQuote,
          error: readState.quoteError,
          isLoading: readState.quoteLoading,
          isFetching: readState.quoteFetching,
        };
      case "getRecipient":
        return { data: walletState.address, error: null };
      case "isApprovedForAll":
        return { data: true, error: null };
      default:
        return { data: undefined, error: null };
    }
  },
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
}));

type WriteFlowState = {
  writeContract: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  hash: undefined;
  receipt?: { logs: unknown[] };
  isSigning: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  error: Error | null;
};

function flow(overrides: Partial<WriteFlowState> = {}): WriteFlowState {
  return {
    writeContract: vi.fn(),
    reset: vi.fn(),
    hash: undefined,
    receipt: undefined,
    isSigning: false,
    isConfirming: false,
    isConfirmed: false,
    error: null,
    ...overrides,
  };
}

// BorrowForm calls useWriteFlow twice per render: approveTx first, actionTx second.
const writeFlows = { approve: flow(), action: flow(), calls: 0 };

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => (writeFlows.calls++ % 2 === 0 ? writeFlows.approve : writeFlows.action),
}));

const hookData = {
  liquidity: [] as LiquidityPosition[],
  tooLarge: false,
  liquidityError: null as Error | null,
  lendingError: null as Error | null,
  streams: [] as unknown[],
  streamsError: null as Error | null,
  streamsStale: false,
  lendingParams: {
    aprMinBps: 1000,
    aprMaxBps: 1200,
    feeBps: 40,
    nextLiquidityId: 5n,
    nextLoanId: 1n,
    nextSaleListingId: 1n,
    maxRouteIds: 128,
  },
};

vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({
    liquidity: hookData.liquidity,
    outcome: {
      status: "ready",
      data: {
        aggregateByApr: hookData.liquidity.reduce((depth, position) => {
          depth.set(
            position.aprBps,
            (depth.get(position.aprBps) ?? 0n) + position.availableLiquidity,
          );
          return depth;
        }, new Map<number, bigint>()),
      },
    },
    tooLarge: hookData.tooLarge,
    isLoading: false,
    error: hookData.liquidityError,
  }),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({
    streams: hookData.streams,
    isLoading: false,
    error: hookData.streamsError,
    stale: hookData.streamsStale,
    unavailable: Boolean(hookData.streamsError && !hookData.streamsStale),
  }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: hookData.lendingParams,
    isLoading: false,
    error: hookData.lendingError,
  }),
}));

const invalidateSpy = vi.fn();
vi.mock("@/lib/invalidate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invalidate")>()),
  invalidateAllOnChainReads: (...args: unknown[]) => invalidateSpy(...args),
  scheduleHeldStreamsRetry: () => () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

type DemandRow = { aprBps: number; count: number; amount: bigint };
const demandState = {
  status: "ok" as "loading" | "ok" | "unavailable",
  demand: [] as DemandRow[],
  peak: 0n,
};
vi.mock("@/hooks/useBorrowDemand", () => ({
  useBorrowDemand: () => demandState,
}));

import { FormBody } from "@/components/ActionModal";
import { ovrfloLendingAbi } from "@/lib/generated";

const FUTURE = 99_999_999_999n;
const PAST = 1n;

function makeMarket(overrides: Partial<MarketInfo> = {}): MarketInfo {
  return {
    vault: testAddress(1),
    treasury: testAddress(2),
    underlying: testAddress(3),
    ovrfloToken: testAddress(4),
    lending: testAddress(5),
    market: testAddress(6),
    twapDurationFixed: 900,
    feeBps: 25,
    expiryCached: FUTURE,
    ptToken: testAddress(7),
    oracle: testAddress(8),
    ...overrides,
  };
}

const market = makeMarket();
const symbols = {
  [market.underlying.toLowerCase()]: "TESTA",
  [market.ovrfloToken.toLowerCase()]: "ovrfloTESTA",
};

const LENDER = testAddress(0xbbb);

function position(id: number, aprBps: number, availableWad: bigint, lender = LENDER): LiquidityPosition {
  return { id: BigInt(id), lender, market: market.market, aprBps, availableLiquidity: availableWad * WAD };
}

function renderBorrow(targetMarket = market) {
  return render(
    <FormBody
      action={{ type: "borrow", streamId: 42n }}
      market={targetMarket}
      user={walletState.address}
      symbols={symbols}
      accent="cyan"
      onClose={vi.fn()}
    />,
  );
}

function enterAmount(value: string) {
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value } });
}

beforeEach(() => {
  walletState.address = testAddress(0xa11);
  hookData.liquidity = [position(1, 1000, 30n), position(2, 1100, 100n)];
  hookData.tooLarge = false;
  readState.grossPrice = 1_000n * WAD;
  readState.quoteError = null;
  readState.quoteLoading = false;
  readState.quoteFetching = false;
  readState.calls = [];
  writeFlows.approve = flow();
  writeFlows.action = flow();
  writeFlows.calls = 0;
  invalidateSpy.mockClear();
  demandState.status = "ok";
  demandState.demand = [];
  demandState.peak = 0n;
  hookData.liquidityError = null;
  hookData.lendingError = null;
  hookData.streamsError = null;
  hookData.streamsStale = false;
  hookData.lendingParams = {
    aprMinBps: 1000,
    aprMaxBps: 1200,
    feeBps: 40,
    nextLiquidityId: 5n,
    nextLoanId: 1n,
    nextSaleListingId: 1n,
    maxRouteIds: 128,
  };
});

describe("BorrowForm ladder", () => {
  it("lists liquid ticks, marks the lowest as best, and selects it by default", () => {
    renderBorrow();
    const rows = screen.getAllByRole("radio");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("10.00%");
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    expect(rows[0]).toHaveTextContent("BEST");
    expect(rows[1]).toHaveTextContent("11.00%");
    expect(rows[1]).toHaveAttribute("aria-checked", "false");
  });

  it("keeps projected liquidity at an old tick routable after posting bounds move", () => {
    hookData.lendingParams = {
      ...hookData.lendingParams,
      aprMinBps: 1100,
      aprMaxBps: 1200,
    };
    hookData.liquidity = [position(1, 1000, 30n)];
    renderBorrow();

    const oldTick = screen.getByRole("radio", { name: /10\.00%/ });
    expect(oldTick).toHaveAttribute("aria-checked", "true");
    enterAmount("10");
    expect(
      readState.calls.some(
        (call) =>
          call.functionName === "quote" &&
          call.args?.[2] === 1000 &&
          call.args?.[3] === 10n * WAD,
      ),
    ).toBe(true);
  });

  it("shows the own-supply footnote when the user has liquidity here", () => {
    hookData.liquidity = [...hookData.liquidity, position(3, 1200, 5n, walletState.address)];
    renderBorrow();
    expect(screen.getByText(/YOUR OWN SUPPLY IS EXCLUDED/)).toBeInTheDocument();
    // Own-only depth never renders as a borrowable tick.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("does not render the retired capped-enumeration warning", () => {
    hookData.tooLarge = true;
    renderBorrow();
    expect(screen.queryByText(/SHOWING FIRST 500/)).not.toBeInTheDocument();
  });

  it("shows an empty state when no tick has liquidity", () => {
    hookData.liquidity = [];
    renderBorrow();
    expect(screen.getByText("NO LIQUIDITY POSTED AT ANY RATE")).toBeInTheDocument();
    // Reachable indexer with an empty window reads as honest zero.
    expect(screen.getByText("NO LOANS IN 30 DAYS")).toBeInTheDocument();
  });

  it("shows recent per-rate demand in the empty-ladder state", () => {
    hookData.liquidity = [];
    demandState.demand = [{ aprBps: 1000, count: 2, amount: 80n * WAD }];
    demandState.peak = 80n * WAD;
    renderBorrow();
    expect(screen.getByText(/RECENT DEMAND 10\.00% — 2 LOANS \/ 80\.00 TESTA \(30D\)/)).toBeInTheDocument();
  });

  it("keeps the unreachable-indexer state distinct in the empty-ladder state", () => {
    hookData.liquidity = [];
    demandState.status = "unavailable";
    renderBorrow();
    expect(screen.getByText("DEMAND DATA UNAVAILABLE — INDEXER UNREACHABLE")).toBeInTheDocument();
    expect(screen.queryByText("NO LOANS IN 30 DAYS")).not.toBeInTheDocument();
  });
});

describe("BorrowForm partial fills", () => {
  it("quotes a partial fill and hides the alternative behind an explicit click", () => {
    renderBorrow();
    enterAmount("90");
    expect(screen.getByRole("status")).toHaveAttribute("data-borrow-outcome", "partial");
    expect(screen.getByText(/PARTIAL FILL — 30\.00 TESTA OF 90\.00 TESTA/)).toBeInTheDocument();
    expect(screen.queryByText(/SWITCH TO/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("SHOW OTHER OPTIONS"));
    const switchButton = screen.getByText(/SWITCH TO 11\.00% — COVERS FULL AMOUNT/);
    fireEvent.click(switchButton);
    const rows = screen.getAllByRole("radio");
    expect(rows[1]).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/PARTIAL FILL/)).not.toBeInTheDocument();
  });

  it("offers no alternative when nothing covers the amount", () => {
    renderBorrow();
    enterAmount("900");
    expect(screen.getByText(/PARTIAL FILL/)).toBeInTheDocument();
    expect(screen.queryByText("SHOW OTHER OPTIONS")).not.toBeInTheDocument();
  });
});

describe("BorrowForm outcome classifier", () => {
  it("announces source-read failures as unavailable instead of true zero", () => {
    hookData.liquidityError = new Error("RPC unavailable");
    renderBorrow();

    expect(screen.getByRole("status")).toHaveAttribute("data-borrow-outcome", "unavailable");
  });

  it("announces quote reads while they are still preparing", () => {
    readState.quoteLoading = true;
    renderBorrow();
    enterAmount("10");

    expect(screen.getByRole("status")).toHaveAttribute("data-borrow-outcome", "preparing");
  });

  it("keeps terminal quote failures in terminal error copy", () => {
    readState.quoteError = new Error("reverted: OVRFLOLending: self-match");
    renderBorrow();
    enterAmount("10");

    expect(document.querySelector('[data-borrow-outcome="unavailable"]')).not.toBeInTheDocument();
    expect(screen.getByText("You cannot borrow from your own liquidity.")).toBeInTheDocument();
  });

  it.each([
    ["true-zero", [] as LiquidityPosition[]],
    ["insufficient", [position(3, 1000, 20n, testAddress(0xa11))]],
  ] as Array<[string, LiquidityPosition[]]>)("distinguishes %s when the ladder has no executable depth", (outcome, liquidity) => {
    hookData.liquidity = liquidity;
    renderBorrow();
    enterAmount("10");

    expect(screen.getByRole("status")).toHaveAttribute("data-borrow-outcome", outcome);
  });
});

describe("BorrowForm slippage", () => {
  it("rejects out-of-range slippage and blocks submission", () => {
    renderBorrow();
    enterAmount("10");
    fireEvent.change(screen.getByLabelText("SLIPPAGE %"), { target: { value: "9" } });
    expect(screen.getByText("SLIPPAGE MUST BE 0.1–5%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
  });
});

describe("BorrowForm maturity gate", () => {
  it("never runs the ladder or router on a matured market", () => {
    renderBorrow(makeMarket({ expiryCached: PAST }));
    expect(screen.getByText("MARKET MATURED — BORROWING CLOSED")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    const enabledOnChain = readState.calls.filter(
      (call) => call.functionName === "quote" && call.enabled,
    );
    expect(enabledOnChain).toHaveLength(0);
  });
});

describe("BorrowForm error handling", () => {
  it("recovers from a liquidity race with a re-quote banner and single re-confirm", () => {
    writeFlows.action = flow({ error: new Error("reverted: OVRFLOLending: liquidity inactive") });
    renderBorrow();
    enterAmount("10");
    expect(screen.getByText(/LIQUIDITY CHANGED SINCE YOUR QUOTE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RE-CONFIRM BORROW" })).toBeEnabled();
    expect(invalidateSpy).toHaveBeenCalled();
    // The race never renders as a dead-end failure.
    expect(screen.queryByText(/transaction failed/i)).not.toBeInTheDocument();
  });

  it("shows a terminal error and disables the action instead of inviting a retry", () => {
    writeFlows.action = flow({ error: new Error("reverted: OVRFLOLending: self-match") });
    renderBorrow();
    enterAmount("10");
    expect(screen.getByText("You cannot borrow from your own liquidity.")).toBeInTheDocument();
    // DESIGN.md §8: never hide an action — disable it and say why.
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "RE-CONFIRM BORROW" })).not.toBeInTheDocument();
    expect(screen.queryByText(/LIQUIDITY CHANGED/)).not.toBeInTheDocument();
  });
});

describe("BorrowForm receipt", () => {
  it("reports the actual received amount from the transaction receipt", () => {
    const topics = encodeEventTopics({
      abi: ovrfloLendingAbi,
      eventName: "BorrowerLoanPoolCreated",
      args: { loanId: 9n, borrower: walletState.address, market: market.market },
    });
    const log = {
      address: market.lending,
      topics,
      data: encodeAbiParameters([{ type: "uint16" }, { type: "uint128" }], [1000, 100n * WAD]),
    };
    writeFlows.action = flow({ isConfirmed: true, receipt: { logs: [log] } });
    renderBorrow();
    // fee 40 bps on 100 -> net 99.60
    expect(screen.getByText(/RECEIVED 99\.60 TESTA/)).toBeInTheDocument();
  });
});
