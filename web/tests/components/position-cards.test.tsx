import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { HeldStream, LiquidityPosition, MarketInfo } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const WAD = 10n ** 18n;
const USER = testAddress(0xa11);
const OTHER_LENDER = testAddress(0xbbb);

type LoanEntry = {
  loan: { id: bigint; borrower: Address; streamId: bigint; obligation: bigint; drawn: bigint; repaid: bigint; closed: boolean };
  pool: { id: bigint; borrower: Address; aprBps: number; market: Address; totalContributed: bigint };
  withdrawable: bigint;
};

const hookData = {
  liquidity: [] as LiquidityPosition[],
  tooLarge: false,
  pools: [] as unknown[],
  loans: [] as LoanEntry[],
  streams: [] as HeldStream[],
  liquidityError: null as Error | null,
  loanBookError: null as Error | null,
  streamsError: null as Error | null,
  streamsStale: false,
  indexerLagBlocks: 0,
};

vi.mock("@/hooks/useLendingLiquidity", () => ({
  useLendingLiquidity: () => ({
    liquidity: hookData.liquidity,
    tooLarge: hookData.tooLarge,
    isLoading: false,
    error: hookData.liquidityError,
  }),
}));
vi.mock("@/hooks/useLoanBook", () => ({
  useLoanBook: () => ({
    pools: hookData.pools,
    loans: hookData.loans,
    tooLarge: false,
    isLoading: false,
    error: hookData.loanBookError,
  }),
}));
vi.mock("@/hooks/useHeldStreams", () => ({
  useHeldStreams: () => ({
    streams: hookData.streams,
    isLoading: false,
    error: hookData.streamsError,
    stale: hookData.streamsStale ?? false,
    unavailable: Boolean(hookData.streamsError) && !hookData.streamsStale,
  }),
}));
vi.mock("@/hooks/useIndexerSync", () => ({
  useIndexerSync: () => ({
    syncedBlock: 100n,
    headBlock: 100n + BigInt(hookData.indexerLagBlocks),
    lagBlocks: BigInt(hookData.indexerLagBlocks),
    lagging: hookData.indexerLagBlocks > 5,
  }),
}));
vi.mock("@/hooks/useLending", () => ({
  useLending: () => ({
    params: { aprMinBps: 1000, aprMaxBps: 1200, feeBps: 0, nextLiquidityId: 5n, nextLoanId: 5n, nextSaleListingId: 1n },
    isLoading: false,
    error: null,
  }),
}));

import { PositionList } from "@/components/PositionList";

const FUTURE = 99_999_999_999n;

const market: MarketInfo = {
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
};

const symbols = {
  [market.underlying.toLowerCase()]: "TESTA",
  [market.ovrfloToken.toLowerCase()]: "ovrfloTESTA",
};

function position(id: number, aprBps: number, availableWad: bigint, lender: Address): LiquidityPosition {
  return { id: BigInt(id), lender, market: market.market, aprBps, availableLiquidity: availableWad * WAD };
}

function stream(id: number, overrides: Partial<HeldStream> = {}): HeldStream {
  return {
    streamId: BigInt(id),
    recipient: USER,
    sender: market.vault,
    asset: market.ovrfloToken,
    endTime: market.expiryCached,
    canceled: false,
    depleted: false,
    deposited: 100n * WAD,
    withdrawn: 40n * WAD,
    withdrawable: 10n * WAD,
    ...overrides,
  };
}

function loanEntry(
  id: number,
  overrides: Partial<LoanEntry["loan"]> = {},
  withdrawable = 0n,
): LoanEntry {
  return {
    loan: {
      id: BigInt(id),
      borrower: USER,
      streamId: 9n,
      obligation: 100n * WAD,
      drawn: 20n * WAD,
      repaid: 0n,
      closed: false,
      ...overrides,
    },
    pool: { id: BigInt(id), borrower: USER, aprBps: 1000, market: market.market, totalContributed: 80n * WAD },
    withdrawable,
  };
}

function renderList() {
  const onAction = vi.fn();
  render(<PositionList market={market} user={USER} symbols={symbols} onAction={onAction} />);
  return onAction;
}

beforeEach(() => {
  hookData.liquidity = [];
  hookData.tooLarge = false;
  hookData.pools = [];
  hookData.loans = [];
  hookData.streams = [];
  hookData.liquidityError = null;
  hookData.loanBookError = null;
  hookData.streamsError = null;
  hookData.streamsStale = false;
  hookData.indexerLagBlocks = 0;
});

describe("SELL removal", () => {
  it("renders no SELL affordance anywhere", () => {
    hookData.liquidity = [position(1, 1000, 50n, USER), position(2, 1000, 40n, OTHER_LENDER)];
    hookData.loans = [loanEntry(1)];
    hookData.streams = [stream(7)];
    renderList();
    expect(screen.queryByText(/SELL/)).not.toBeInTheDocument();
  });
});

describe("stream cards", () => {
  it("shows streamed progress, claimable amount, and a live borrow teaser into BORROW mode", () => {
    hookData.liquidity = [position(2, 1000, 40n, OTHER_LENDER)];
    hookData.streams = [stream(7)];
    const onAction = renderList();
    expect(screen.getByText("50% STREAMED")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Stream 7 progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("CLAIMABLE 10.00 ovrfloTESTA")).toBeInTheDocument();
    const teaser = screen.getByRole("button", { name: /BORROW ~\d+\.\d% UPFRONT/ });
    fireEvent.click(teaser);
    expect(onAction).toHaveBeenCalledWith({ type: "borrow", streamId: 7n });
  });

  it("disables borrow with a reason when no real liquidity exists (own supply excluded)", () => {
    hookData.liquidity = [position(1, 1000, 50n, USER)];
    hookData.streams = [stream(7)];
    renderList();
    expect(screen.queryByText(/UPFRONT/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BORROW STREAM #7" })).toBeDisabled();
    expect(screen.getByText("NO LIQUIDITY")).toBeInTheDocument();
  });
});

describe("loan cards", () => {
  it("keeps an actively self-repaying loan action-free with repay behind ADVANCED", () => {
    hookData.loans = [loanEntry(1)];
    const onAction = renderList();
    expect(screen.getByText("SELF-REPAYING")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CLOSE" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "REPAY LOAN" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ADVANCED/ }));
    fireEvent.click(screen.getByRole("button", { name: "REPAY LOAN" }));
    expect(onAction).toHaveBeenCalledWith({ type: "repay", loanId: 1n });
  });

  it("shows CLOSE on a repaying loan only when the stream can cover the outstanding", () => {
    hookData.loans = [loanEntry(1, {}, 80n * WAD)];
    renderList();
    expect(screen.getByText("SELF-REPAYING")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLOSE" })).toBeInTheDocument();
  });

  it("distinguishes residual-returning from settled", () => {
    hookData.loans = [
      loanEntry(1, { drawn: 100n * WAD }, 0n),
      loanEntry(2, { closed: true, drawn: 100n * WAD }, 0n),
    ];
    renderList();
    expect(screen.getByText("RESIDUAL RETURNING")).toBeInTheDocument();
    expect(screen.getByText("OBLIGATION MET — STREAM RESIDUAL RETURNS ON CLOSE")).toBeInTheDocument();
    // Badge and body both read SETTLED on the settled card.
    expect(screen.getAllByText("SETTLED")).toHaveLength(2);
    // Residual loans close; settled loans offer nothing.
    expect(screen.getAllByRole("button", { name: "CLOSE" })).toHaveLength(1);
  });
});

describe("pool cards", () => {
  it("explains lender-side deficit harvesting", () => {
    hookData.pools = [
      {
        pool: { id: 1n, borrower: USER, aprBps: 1000, market: market.market, totalContributed: 100n * WAD },
        claimable: 5n * WAD,
      },
    ];
    renderList();
    expect(screen.getByText("SHORTFALLS HARVEST FROM THE LOAN STREAM ON CLAIM")).toBeInTheDocument();
  });
});

describe("liquidity cards", () => {
  it("shows idle amount, earning rate, and the adjust-rate action", () => {
    hookData.liquidity = [position(1, 1100, 50n, USER)];
    const onAction = renderList();
    expect(screen.getByText("EARNING 11.00%")).toBeInTheDocument();
    expect(screen.getByText("IDLE 50.00 TESTA")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ADJUST RATE" }));
    expect(onAction).toHaveBeenCalledWith({ type: "adjust_rate", positionId: 1n });
  });
});

describe("per-source error isolation", () => {
  it("still shows the LIQUIDITY card when the streams (Ponder) source errors", () => {
    hookData.liquidity = [position(1, 1100, 50n, USER)];
    hookData.streamsError = new Error("indexer unreachable");
    renderList();
    expect(screen.getByText("IDLE 50.00 TESTA")).toBeInTheDocument();
    expect(screen.getByText(/STREAM DISCOVERY UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.queryByText("UNABLE TO LOAD LENDING POSITIONS")).not.toBeInTheDocument();
  });

  it("still shows STREAMS when the on-chain (liquidity/loanBook) source errors", () => {
    hookData.streams = [stream(7)];
    hookData.liquidityError = new Error("rpc error");
    renderList();
    expect(screen.getByText("50% STREAMED")).toBeInTheDocument();
    expect(screen.getByText("UNABLE TO LOAD LENDING POSITIONS")).toBeInTheDocument();
    expect(screen.queryByText(/STREAM DISCOVERY UNAVAILABLE/)).not.toBeInTheDocument();
  });

  it("shows both error states when both sources fail", () => {
    hookData.liquidityError = new Error("rpc error");
    hookData.streamsError = new Error("indexer unreachable");
    renderList();
    expect(screen.getByText("UNABLE TO LOAD LENDING POSITIONS")).toBeInTheDocument();
    expect(screen.getByText(/STREAM DISCOVERY UNAVAILABLE/)).toBeInTheDocument();
  });
});

// R43/R44/F1 — the degraded stream view. Three distinct states where there used
// to be one: live, stale-but-usable, and genuinely unavailable.
describe("degraded indexer states (R43/R44)", () => {
  it("Covers AE7. Serves the cached set behind a staleness indicator, with cards still rendered", () => {
    hookData.streams = [stream(7)];
    hookData.streamsError = new Error("indexer unreachable");
    hookData.streamsStale = true;

    renderList();

    expect(screen.getByText(/SHOWING LAST KNOWN STREAMS/)).toBeInTheDocument();
    expect(screen.getByText("50% STREAMED")).toBeInTheDocument();
    // Stale discovery must not read as unavailable — the difference is whether
    // the user can still see and act on what they hold.
    expect(screen.queryByText(/STREAM DISCOVERY UNAVAILABLE/)).not.toBeInTheDocument();
  });

  it("Covers AE7/R45. Liquidity and loans render normally while discovery is down", () => {
    // Those are on-chain reads and never depended on the indexer — this is the
    // regression guard for that, which is what R45 reduces to.
    hookData.liquidity = [position(1, 1100, 50n, USER)];
    hookData.streamsError = new Error("indexer unreachable");

    renderList();

    expect(screen.getByText("IDLE 50.00 TESTA")).toBeInTheDocument();
    expect(screen.queryByText("UNABLE TO LOAD LENDING POSITIONS")).not.toBeInTheDocument();
  });

  it("Covers AE8. With no cached set, names the direct-contract route instead of an empty list", () => {
    hookData.streamsError = new Error("indexer unreachable");
    hookData.streamsStale = false;
  hookData.indexerLagBlocks = 0;

    renderList();

    const notice = screen.getByText(/STREAM DISCOVERY UNAVAILABLE/);
    expect(notice).toBeInTheDocument();
    // The recovery route has to be actionable, not just acknowledged.
    expect(notice.textContent).toMatch(/WITHDRAW DIRECTLY FROM SABLIER/);
    expect(notice.textContent).toMatch(/0x/);
  });

  it("keeps stream actions available while stale, rather than blocking them", () => {
    // Blocking here reproduces the H-5 harm: a user unable to reach their own
    // withdraw path through the app. The contracts validate every action at
    // submission anyway.
    hookData.streams = [stream(7)];
    hookData.streamsError = new Error("indexer unreachable");
    hookData.streamsStale = true;

    renderList();
    const staleButtons = screen
      .getAllByRole("button")
      .map((b) => `${b.textContent}:${(b as HTMLButtonElement).disabled}`)
      .sort();
    cleanup();

    // Compare against the healthy render rather than naming a label: this
    // asserts staleness disables nothing, whatever the card happens to offer.
    hookData.streamsError = null;
    hookData.streamsStale = false;
  hookData.indexerLagBlocks = 0;
    renderList();
    const liveButtons = screen
      .getAllByRole("button")
      .map((b) => `${b.textContent}:${(b as HTMLButtonElement).disabled}`)
      .sort();

    expect(staleButtons).toEqual(liveButtons);
    expect(staleButtons.length).toBeGreaterThan(0);
  });

  it("says nothing about staleness when discovery is healthy", () => {
    hookData.streams = [stream(7)];
    renderList();
    expect(screen.queryByText(/SHOWING LAST KNOWN STREAMS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/STREAM DISCOVERY UNAVAILABLE/)).not.toBeInTheDocument();
  });
});
