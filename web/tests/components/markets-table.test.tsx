import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const walletState = { address: testAddress(0xa11) as Address | undefined };

vi.mock("@/hooks/useIndexerSync", () => ({
  useIndexerSync: () => ({ syncedBlock: 100n, headBlock: 100n, lagBlocks: 0n, lagging: false }),
}));
vi.mock("wagmi", () => ({
  useBlockNumber: () => ({ data: 100n }),
  useConnection: () => ({
    status: walletState.address ? "connected" : "disconnected",
    addresses: walletState.address ? [walletState.address] : [],
    chainId: 1,
  }),
  useSwitchChain: () => ({ switchChain: () => {}, isPending: false, error: null }),
  useReadContract: () => ({ data: undefined }),
  useReadContracts: () => ({ data: [], isLoading: false, error: null }),
}));

const hookData = {
  liquidity: [] as unknown[],
  streams: [] as unknown[],
  liquidityLoading: false,
  lendingLoading: false,
};

vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({
    liquidity: hookData.liquidity,
    tooLarge: false,
    isLoading: hookData.liquidityLoading,
    error: null,
  }),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({ streams: hookData.streams, isLoading: false, error: null }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: { aprMinBps: 1000, aprMaxBps: 1200, feeBps: 40, nextLiquidityId: 1n, nextLoanId: 1n, nextSaleListingId: 1n },
    isLoading: hookData.lendingLoading,
    error: null,
  }),
}));
vi.mock("@/components/PositionList", () => ({
  PositionList: () => <div data-testid="position-list" />,
}));

import { MarketsTable } from "@/components/MarketsTable";

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
const marketB = makeMarket({ vault: testAddress(11), ovrfloToken: testAddress(14), market: testAddress(16) });

const symbols = {
  [market.underlying.toLowerCase()]: "TESTA",
  [market.ovrfloToken.toLowerCase()]: "ovrfloTESTA",
  [marketB.ovrfloToken.toLowerCase()]: "ovrfloTESTB",
};

function renderTable(props: Partial<Parameters<typeof MarketsTable>[0]> = {}) {
  const onMode = vi.fn();
  function Wrapper() {
    const [selected, setSelected] = useState<MarketInfo | null>(null);
    return (
      <MarketsTable
        markets={[market, marketB]}
        symbols={symbols}
        user={walletState.address}
        selected={selected}
        onSelect={setSelected}
        onMode={onMode}
        {...props}
      />
    );
  }
  const utils = render(<Wrapper />);
  return { ...utils, onMode };
}

beforeEach(() => {
  walletState.address = testAddress(0xa11);
  hookData.liquidity = [];
  hookData.streams = [];
  hookData.liquidityLoading = false;
  hookData.lendingLoading = false;
});

const WAD = 10n ** 18n;

// Passes isSeriesMatchedStream against `market` — the borrower is otherwise
// eligible, so liquidity is the only thing left gating BORROW.
function eligibleStream() {
  return {
    streamId: 1n,
    recipient: walletState.address,
    sender: market.vault,
    asset: market.ovrfloToken,
    endTime: market.expiryCached,
    canceled: false,
    depleted: false,
    deposited: 100n * WAD,
    withdrawn: 40n * WAD,
    withdrawable: 10n * WAD,
  };
}

function otherLenderLiquidity() {
  return {
    id: 1n,
    lender: testAddress(0xbb),
    market: market.market,
    aprBps: 1000,
    availableLiquidity: 50n * WAD,
  };
}

describe("row expansion (R6)", () => {
  it("expands on row click, swaps on second row, collapses on re-click, toggling aria-expanded", () => {
    renderTable();
    const [toggleA, toggleB] = screen.getAllByRole("button", { name: /ovrfloTEST/ });
    expect(toggleA).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggleA);
    expect(toggleA).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: /ovrfloTESTA market detail/ })).toBeInTheDocument();

    fireEvent.click(toggleB);
    expect(toggleA).toHaveAttribute("aria-expanded", "false");
    expect(toggleB).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("region", { name: /ovrfloTESTA market detail/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /ovrfloTESTB market detail/ })).toBeInTheDocument();

    fireEvent.click(toggleB);
    expect(toggleB).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("keeps the row itself out of the tab order (button is the focus target)", () => {
    renderTable();
    const rows = screen.getAllByRole("row");
    for (const row of rows) {
      expect(row).not.toHaveAttribute("tabindex");
    }
  });
});

describe("expanded content states (R7/R8/R27)", () => {
  it("disconnected: no balances, all mode buttons disabled with CONNECT WALLET", () => {
    walletState.address = undefined;
    renderTable({ user: undefined });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.queryByText("BALANCES")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SUPPLY" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "DEPOSIT PT" })).toBeDisabled();
    expect(screen.getAllByText("CONNECT WALLET").length).toBe(3);
  });

  it("matured market: DEPOSIT hidden, SUPPLY/BORROW disabled MARKET MATURED, verb is CLAIM PT", () => {
    const matured = makeMarket({ expiryCached: PAST });
    renderTable({ markets: [matured] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.queryByRole("button", { name: "DEPOSIT PT" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SUPPLY" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getAllByText("MARKET MATURED").length).toBe(2);
    expect(screen.getByRole("button", { name: "CLAIM PT" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "UNWRAP" })).not.toBeInTheDocument();
  });

  it("no lending deployed: SUPPLY/BORROW disabled with LENDING NOT DEPLOYED", () => {
    const noLending = makeMarket({ lending: null });
    renderTable({ markets: [noLending] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "SUPPLY" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getAllByText("LENDING NOT DEPLOYED").length).toBe(2);
  });

  it("eligible stream but empty ladder: BORROW disabled with NO LIQUIDITY POSTED AT ANY RATE", () => {
    hookData.streams = [eligibleStream()];
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getByText("NO LIQUIDITY POSTED AT ANY RATE")).toBeInTheDocument();
  });

  it("eligible stream and non-self liquidity at a tick: BORROW enabled with no caption", () => {
    hookData.streams = [eligibleStream()];
    hookData.liquidity = [otherLenderLiquidity()];
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "BORROW" })).toBeEnabled();
    expect(screen.queryByText("NO LIQUIDITY POSTED AT ANY RATE")).not.toBeInTheDocument();
  });

  it("self-owned liquidity only: still NO LIQUIDITY POSTED AT ANY RATE (cannot borrow against own supply)", () => {
    hookData.streams = [eligibleStream()];
    hookData.liquidity = [{ ...otherLenderLiquidity(), lender: walletState.address }];
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getByText("NO LIQUIDITY POSTED AT ANY RATE")).toBeInTheDocument();
  });

  it("liquidity read still loading: BORROW disabled but does not yet claim no liquidity", () => {
    hookData.streams = [eligibleStream()];
    hookData.liquidityLoading = true;
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.queryByText("NO LIQUIDITY POSTED AT ANY RATE")).not.toBeInTheDocument();
  });

  it("lending params still loading: BORROW disabled but does not yet claim no liquidity", () => {
    hookData.streams = [eligibleStream()];
    hookData.lendingLoading = true;
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.queryByText("NO LIQUIDITY POSTED AT ANY RATE")).not.toBeInTheDocument();
  });

  it("no eligible streams outranks the no-liquidity caption", () => {
    hookData.streams = [];
    hookData.liquidity = [];
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getByText("NO STREAMS AVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("NO LIQUIDITY POSTED AT ANY RATE")).not.toBeInTheDocument();
  });

  it("WRAP lives behind the ADVANCED disclosure, collapsed by default", () => {
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);
    expect(screen.queryByRole("button", { name: "WRAP" })).not.toBeInTheDocument();
    const advanced = screen.getByRole("button", { name: /ADVANCED/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "WRAP" })).toBeInTheDocument();
  });
});

describe("RATES column (R5)", () => {
  it("renders a dash when the market has no liquidity at any tick", () => {
    renderTable({ markets: [market] });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the tick range in both lenses when liquidity exists", () => {
    hookData.liquidity = [
      { id: 1n, lender: testAddress(0xff), market: market.market, aprBps: 1000, availableLiquidity: 10n ** 18n },
      { id: 2n, lender: testAddress(0xff), market: market.market, aprBps: 1200, availableLiquidity: 10n ** 18n },
    ];
    renderTable({ markets: [market] });
    expect(screen.getByText(/10\.00%–12\.00% APR/)).toBeInTheDocument();
    expect(screen.getByText(/↑/)).toBeInTheDocument();
  });
});

// R23/M-11 — the expanded detail used to render as a <tr> inside the markets
// table, inheriting `table { min-width: 760px }`, so every position card and
// action button sat in a 760px layout box and overflowed on mobile.
describe("expanded detail escapes the table's width floor (R23)", () => {
  it("renders the detail outside the table element", () => {
    renderTable({ markets: [market] });
    fireEvent.click(screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0]);

    const region = screen.getByRole("region", { name: /ovrfloTESTA market detail/ });
    // The assertion that matters: no table ancestor, so no min-width to inherit.
    expect(region.closest("table")).toBeNull();
  });

  it("still collapses when the row is toggled off", () => {
    renderTable({ markets: [market] });
    const toggle = screen.getAllByRole("button", { name: /ovrfloTESTA/ })[0];

    fireEvent.click(toggle);
    expect(screen.getByRole("region", { name: /ovrfloTESTA market detail/ })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: /ovrfloTESTA market detail/ })).not.toBeInTheDocument();
  });

  it("swaps to the other market's detail rather than showing both", () => {
    renderTable();
    const [toggleA, toggleB] = screen.getAllByRole("button", { name: /ovrfloTEST/ });

    fireEvent.click(toggleA);
    fireEvent.click(toggleB);

    expect(screen.queryByRole("region", { name: /ovrfloTESTA market detail/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /ovrfloTESTB market detail/ })).toBeInTheDocument();
  });
});

// R25/L-2 — the vault list capped at 100 with no disclosure at all, unlike the
// 500-id scans which at least warned. Markets past the hundredth vanished.
describe("truncation disclosure (R25)", () => {
  it("discloses truncation when the vault list is capped", () => {
    renderTable({ truncated: true });
    expect(screen.getByText("SHOWING FIRST 100 VAULTS AND MARKETS PER VAULT — DATA TRUNCATED")).toBeInTheDocument();
  });

  it("says nothing when the list is complete", () => {
    renderTable({ truncated: false });
    expect(screen.queryByText(/SHOWING FIRST/)).not.toBeInTheDocument();
  });

  it("uses the same sentence shape as the other capped lists", () => {
    // The point of the shared component: a reader who has seen one truncation
    // notice recognises the next one.
    renderTable({ truncated: true });
    expect(screen.getByText(/^SHOWING FIRST \d+ [\w ]+ — /)).toBeInTheDocument();
  });
});
