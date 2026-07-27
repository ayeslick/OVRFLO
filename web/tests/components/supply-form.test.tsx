import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { LiquidityPosition, MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const WAD = 10n ** 18n;
const walletState = { address: testAddress(0xa11) as Address | undefined };

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: walletState.address ? "connected" : "disconnected",
    addresses: walletState.address ? [walletState.address] : [],
  }),
  useReadContract: (config?: { functionName?: string }) => {
    switch (config?.functionName) {
      case "allowance":
        return { data: 1_000_000n * WAD, error: null };
      case "balanceOf":
        return { data: 1_000_000n * WAD, error: null };
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
  receipt?: undefined;
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

// SupplyForm calls useWriteFlow twice per render: approveTx first, actionTx second.
const writeFlows = { approve: flow(), action: flow(), calls: 0 };

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => (writeFlows.calls++ % 2 === 0 ? writeFlows.approve : writeFlows.action),
}));

const hookData = {
  liquidity: [] as LiquidityPosition[],
  tooLarge: false,
  aprMinBps: 1000,
  aprMaxBps: 1200,
};

vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({
    liquidity: hookData.liquidity,
    tooLarge: hookData.tooLarge,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({ streams: [], isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: {
      aprMinBps: hookData.aprMinBps,
      aprMaxBps: hookData.aprMaxBps,
      feeBps: 40,
      nextLiquidityId: 5n,
      nextLoanId: 1n,
      nextSaleListingId: 1n,
    },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/lib/invalidate", () => ({
  invalidateAllOnChainReads: vi.fn(),
  scheduleHeldStreamsRetry: () => () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({}),
}));

import { FormBody } from "@/components/ActionModal";

const FUTURE = 99_999_999_999n;

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
const symbols = { [market.underlying.toLowerCase()]: "TESTA" };

const LENDER = testAddress(0xbbb);

function position(id: number, aprBps: number, availableWad: bigint, lender = LENDER): LiquidityPosition {
  return { id: BigInt(id), lender, market: market.market, aprBps, availableLiquidity: availableWad * WAD };
}

function renderSupply(targetMarket = market) {
  return render(
    <FormBody
      action={{ type: "supply" }}
      market={targetMarket}
      user={walletState.address}
      symbols={symbols}
      accent="gold"
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  walletState.address = testAddress(0xa11);
  hookData.liquidity = [position(1, 1000, 30n), position(2, 1100, 5n, walletState.address)];
  hookData.tooLarge = false;
  hookData.aprMinBps = 1000;
  hookData.aprMaxBps = 1200;
  writeFlows.approve = flow();
  writeFlows.action = flow();
  writeFlows.calls = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SupplyForm ladder", () => {
  it("renders every in-bounds rate with lender return and waiting liquidity including own", () => {
    renderSupply();
    const rows = screen.getAllByRole("radio");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("10.00%");
    expect(rows[0]).toHaveTextContent("WAITING 30.00 TESTA");
    // The lender's own 5 TESTA at 11% counts toward waiting liquidity.
    expect(rows[1]).toHaveTextContent("11.00%");
    expect(rows[1]).toHaveTextContent("WAITING 5.00 TESTA");
    expect(rows[2]).toHaveTextContent("12.00%");
    expect(rows[2]).toHaveTextContent("WAITING 0.00 TESTA");
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
  });

  it("feeds the selected rate into the supply transaction", () => {
    renderSupply();
    fireEvent.click(screen.getAllByRole("radio")[2]);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "SUPPLY @ 12.00%" }));
    expect(writeFlows.action.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "supplyLiquidity",
        args: [market.market, 1200, 10n * WAD],
      }),
    );
  });

  it("handles a single-rate market as a one-row ladder", () => {
    hookData.aprMinBps = 1000;
    hookData.aprMaxBps = 1000;
    hookData.liquidity = [position(1, 1000, 30n)];
    renderSupply();
    const rows = screen.getAllByRole("radio");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    expect(screen.getByRole("button", { name: "SUPPLY @ 10.00%" })).toBeEnabled();
  });

  it("shows a per-rate demand placeholder until the indexer pipeline lands", () => {
    renderSupply();
    expect(screen.getByText("DEMAND (30D) AT 10.00% — NO DATA YET")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.getByText("DEMAND (30D) AT 11.00% — NO DATA YET")).toBeInTheDocument();
  });
});

describe("SupplyForm maturity", () => {
  it("disables supply with a reason when the market is already matured at open", () => {
    renderSupply(makeMarket({ expiryCached: 1n }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    expect(screen.getByText("MARKET MATURED — SUPPLY CLOSED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SUPPLY @/ })).toBeDisabled();
  });

  it("re-checks maturity while the panel is open and closes supply when it is crossed", () => {
    vi.useFakeTimers();
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    renderSupply(makeMarket({ expiryCached: nowSeconds + 10n }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1" } });
    expect(screen.queryByText("MARKET MATURED — SUPPLY CLOSED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SUPPLY @/ })).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.getByText("MARKET MATURED — SUPPLY CLOSED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SUPPLY @/ })).toBeDisabled();
  });
});
