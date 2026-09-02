import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { WatchApp } from "@/components/watch/WatchApp";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { HydratedStream } from "@/hooks/useStreams";
import { loadingOutcome, readFailure, readyOutcome, unavailableOutcome } from "@/lib/read-outcome";
import { writeWatchSearch } from "@/lib/watch-url";
import { idlePager } from "../inventory/fixtures";

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const MARKET = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x3333333333333333333333333333333333333333" as Address;
const VAULT = "0x2222222222222222222222222222222222222222" as Address;
const LENDING = "0x4444444444444444444444444444444444444444" as Address;
const LENDING_B = "0x5555555555555555555555555555555555555555" as Address;
const MARKET_B = "0x6666666666666666666666666666666666666666" as Address;
const TOKEN_B = "0x7777777777777777777777777777777777777777" as Address;
const NOW = 1_800_000_000n;
const SCALE = 10n ** 18n;

const fx = vi.hoisted(() => ({
  connected: false as boolean,
  lenderStatus: "ready" as "ready" | "loading" | "unavailable",
  borrowerStatus: "ready" as "ready" | "loading" | "unavailable",
  streamStatus: "ready" as "ready" | "loading" | "unavailable",
  positions: [] as LenderPositionRow[],
  loans: [] as BorrowerLoanRow[],
  streams: [] as HydratedStream[],
  signingAllowed: true,
  freshnessKind: "synced" as "synced" | "degraded" | "unavailable",
  streamUpdatedAt: 0,
  borrowerUpdatedAt: 0,
  ovrflosStatus: "ready" as "ready" | "loading" | "unavailable",
  marketsStatus: "ready" as "ready" | "loading" | "unavailable",
  markets: [] as {
    vault: Address;
    treasury: Address;
    underlying: Address;
    ovrfloToken: Address;
    reserve: Address;
    lending: Address;
    retiredLendings: readonly Address[];
    market: Address;
    twapDurationFixed: number;
    feeBps: number;
    expiryCached: bigint;
    ptToken: Address;
    oracle: Address;
  }[],
  advancePin: async () => undefined as void,
}));

vi.mock("wagmi", () => ({
  useConnection: () => ({
    status: fx.connected ? "connected" : "disconnected",
    addresses: fx.connected ? [ACCOUNT] : undefined,
    chainId: 1,
  }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useReadContracts: () => ({ data: undefined, isLoading: false }),
  useBlock: () => ({ data: { timestamp: NOW } }),
  useSwitchChain: () => ({
    switchChain: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: vi.fn() }),
}));

vi.mock("wallet-runtime", () => ({
  WalletButton: () => (
    <button type="button">CONNECT WALLET</button>
  ),
  ensureWalletKit: () => undefined,
  walletConfig: {},
}));

vi.mock("@/hooks/useClock", () => ({
  useClockHydrationSafe: () => ({ localNow: NOW, skew: 0n, adjustedNow: NOW }),
  useClock: () => ({ localNow: NOW, skew: 0n, adjustedNow: NOW }),
}));

vi.mock("@/hooks/useOvrflos", () => ({
  useOvrflos: () => {
    if (fx.ovrflosStatus === "unavailable") {
      return {
        status: "unavailable" as const,
        bootstrap: {
          status: "unavailable" as const,
          failures: [{ code: "no_code" as const, message: "Factory has no bytecode" }],
        },
        isLoading: false,
        tooLarge: false,
        error: new Error("Factory has no bytecode"),
      };
    }
    if (fx.ovrflosStatus === "loading") {
      return {
        status: "loading" as const,
        bootstrap: { status: "loading" as const },
        isLoading: true,
        tooLarge: false,
        error: null,
      };
    }
    return {
      status: "ready" as const,
      bootstrap: {
        status: "ready" as const,
        factory: VAULT,
        stream: LENDING,
        vaults: [],
        blockNumber: 1n,
      },
      vaults: [],
      stream: LENDING,
      isLoading: false,
      tooLarge: false,
      error: null,
    };
  },
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => ({
    markets: fx.markets.length > 0
      ? fx.markets
      : [
          {
            vault: VAULT,
            treasury: VAULT,
            underlying: TOKEN,
            ovrfloToken: TOKEN,
            reserve: TOKEN,
            lending: LENDING,
            retiredLendings: [],
            market: MARKET,
            twapDurationFixed: 900,
            feeBps: 50,
            expiryCached: NOW + 150n * 86_400n,
            ptToken: TOKEN,
            oracle: TOKEN,
          },
        ],
    status: fx.marketsStatus,
    isLoading: fx.marketsStatus === "loading",
    error: fx.marketsStatus === "unavailable" ? new Error("markets down") : null,
    tooLarge: false,
  }),
}));

vi.mock("@/hooks/useMarketSymbols", () => ({
  useMarketSymbols: () => ({ [TOKEN.toLowerCase()]: "ovrfloTEST" }),
  symbolFor: () => "ovrfloTEST",
}));

vi.mock("@/hooks/useLenderBook", () => ({
  useLenderBook: () => {
    const rows = { positions: fx.positions };
    const renderCount = fx.positions.length;
    const fields = {
      sourceCount: BigInt(renderCount),
      renderCount,
      complete: fx.lenderStatus === "ready",
      confirmedEmpty: fx.lenderStatus === "ready" && renderCount === 0,
    };
    if (fx.lenderStatus === "loading") return { ...loadingOutcome({ ...rows, ...fields }), ...idlePager };
    if (fx.lenderStatus === "unavailable") {
      return {
        ...unavailableOutcome([readFailure("useLenderBook", "transport", "down")], {}, { ...rows, ...fields }),
        ...idlePager,
      };
    }
    return { ...readyOutcome({ ...rows, ...fields }), ...idlePager };
  },
}));

vi.mock("@/hooks/useBorrowerBook", () => ({
  useBorrowerBook: () => {
    const meta = fx.borrowerUpdatedAt > 0 ? { dataUpdatedAt: fx.borrowerUpdatedAt } : {};
    const rows = { loans: fx.loans };
    const renderCount = fx.loans.length;
    const fields = {
      sourceCount: BigInt(renderCount),
      renderCount,
      complete: fx.borrowerStatus === "ready",
      confirmedEmpty: fx.borrowerStatus === "ready" && renderCount === 0,
    };
    if (fx.borrowerStatus === "loading") {
      return { ...loadingOutcome({ ...rows, ...fields }, meta), ...idlePager };
    }
    if (fx.borrowerStatus === "unavailable") {
      return {
        ...unavailableOutcome(
          [readFailure("useBorrowerBook", "transport", "down")],
          meta,
          { ...rows, ...fields },
        ),
        ...idlePager,
      };
    }
    return { ...readyOutcome({ ...rows, ...fields }, meta), ...idlePager };
  },
}));

vi.mock("@/hooks/useStreams", () => ({
  useStreams: () => {
    const meta = fx.streamUpdatedAt > 0 ? { dataUpdatedAt: fx.streamUpdatedAt } : {};
    const rows = { streams: fx.streams };
    const renderCount = fx.streams.length;
    const fields = {
      sourceCount: BigInt(renderCount),
      renderCount,
      complete: fx.streamStatus === "ready",
      confirmedEmpty: fx.streamStatus === "ready" && renderCount === 0,
    };
    if (fx.streamStatus === "loading") {
      return {
        ...loadingOutcome({ ...rows, ...fields }, meta),
        ...idlePager,
        advancePin: () => fx.advancePin(),
      };
    }
    if (fx.streamStatus === "unavailable") {
      const failure = [readFailure("useStreams", "transport", "could-not-ask")];
      return {
        ...unavailableOutcome(failure, meta, { ...rows, ...fields }),
        ...idlePager,
        advancePin: () => fx.advancePin(),
      };
    }
    return {
      ...readyOutcome({ ...rows, ...fields }, meta),
      ...idlePager,
      advancePin: () => fx.advancePin(),
    };
  },
}));

vi.mock("@/hooks/useUsdPrice", () => ({
  useUsdPrice: () =>
    unavailableOutcome([readFailure("useUsdPrice", "transport", "usd down")]),
}));

vi.mock("@/hooks/useFreshness", () => ({
  useFreshness: () => ({
    freshness: { kind: fx.freshnessKind, asOf: NOW },
    signingAllowed: fx.signingAllowed,
  }),
  sourceFromOutcome: () => ({ status: "success" }),
}));

vi.mock("@/components/watch/useLoanStreams", () => ({
  useLoanStreams: () => new Map(),
}));

function stubViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
  };
}

function resetFx() {
  fx.connected = false;
  fx.ovrflosStatus = "ready";
  fx.marketsStatus = "ready";
  fx.lenderStatus = "ready";
  fx.borrowerStatus = "ready";
  fx.streamStatus = "ready";
  fx.positions = [];
  fx.loans = [];
  fx.streams = [];
  fx.signingAllowed = true;
  fx.freshnessKind = "synced";
  fx.streamUpdatedAt = 0;
  fx.borrowerUpdatedAt = 0;
  fx.markets = [];
  fx.advancePin = async () => undefined;
  writeWatchSearch({ lens: null, selection: { kind: "none" } }, "replace");
}

describe("watch shell + entry", () => {
  beforeEach(() => {
    resetFx();
    stubViewport(1280);
  });

  it("renders unavailable for a codeless factory, never CHECKING…", async () => {
    fx.connected = true;
    fx.ovrflosStatus = "unavailable";
    fx.marketsStatus = "unavailable";
    fx.lenderStatus = "loading";
    fx.borrowerStatus = "loading";
    fx.streamStatus = "loading";
    render(<WatchApp />);
    expect(screen.getByText("PROTOCOL UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByText("CHECKING…")).not.toBeInTheDocument();
    expect(screen.getByText(/Factory has no bytecode/i)).toBeInTheDocument();
  });

  afterEach(() => {
    resetFx();
  });

  it("shows the disconnected entry without protocol metrics", () => {
    render(<WatchApp />);
    expect(screen.getByRole("heading", { name: "OVRFLO" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CONNECT WALLET" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "BORROW" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SUPPLY" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ASSETS" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "RISK" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/earnings rolling up/i)).toBeInTheDocument();
    expect(screen.queryByText(/TVL/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you have no positions/i)).not.toBeInTheDocument();
  });

  it("renders first-run only when every book is confirmed empty", () => {
    fx.connected = true;
    render(<WatchApp />);
    expect(document.querySelector("[data-control='UI-FIRST-RUN-SURFACE']")).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "SUPPLIED" })).not.toBeInTheDocument();
  });

  it("renders degraded watch, never first-run, when discovery could-not-ask with zero books", () => {
    fx.connected = true;
    fx.streamStatus = "unavailable";
    render(<WatchApp />);
    expect(document.querySelector("[data-control='UI-FIRST-RUN-SURFACE']")).toBeNull();
    expect(screen.getByText(/STREAM DISCOVERY IS UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "STREAMS" })).toBeInTheDocument();
  });

  it("renders the supplied wall for a seeded position at 1280px", () => {
    fx.connected = true;
    fx.positions = [
      {
        id: 26n,
        lending: LENDING,
        lender: ACCOUNT,
        market: MARKET,
        aprBps: 500,
        availableLiquidity: 19n * 10n ** 17n,
        intervalStart: 0n,
        intervalEnd: 31n * 10n ** 17n,
        pairs: [{ loanId: 1n, contribution: 31n * 10n ** 17n, claimable: 12n * 10n ** 16n }],
        pairsTruncated: false,
      },
    ];
    render(<WatchApp />);
    expect(screen.getByRole("tab", { name: "SUPPLIED" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /SUPPLY #26/ })).toBeInTheDocument();
    expect(document.querySelector("[data-control='UI-FIRST-RUN-SURFACE']")).toBeNull();
  });

  it("opens detail in place at 1280px and uses list→detail with return at 360px", () => {
    fx.connected = true;
    fx.positions = [
      {
        id: 26n,
        lending: LENDING,
        lender: ACCOUNT,
        market: MARKET,
        aprBps: 500,
        availableLiquidity: 5n * SCALE,
        intervalStart: 0n,
        intervalEnd: 0n,
        pairs: [],
        pairsTruncated: false,
      },
    ];
    const wide = render(<WatchApp />);
    fireEvent.click(screen.getByRole("button", { name: /SUPPLY #26/ }));
    expect(window.location.search).toMatch(/position=26/);
    expect(screen.getByRole("article")).toHaveAttribute("data-region", "supplied-detail");
    expect(screen.queryByRole("button", { name: "Back to supplied" })).not.toBeInTheDocument();
    wide.unmount();

    stubViewport(360);
    writeWatchSearch({ lens: "supplied", selection: { kind: "position", lending: LENDING, id: 26n } }, "replace");
    render(<WatchApp />);
    expect(screen.getByRole("button", { name: "Back to supplied" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to supplied" }));
    expect(window.location.search).not.toMatch(/position=/);
    expect(window.location.search).toMatch(/lens=supplied/);
  });

  it("does not mark a nav item current on home", () => {
    render(<WatchApp />);
    expect(screen.getByRole("link", { name: "BORROW" })).not.toHaveAttribute("aria-current");
  });

  it("does not paint STREAM CLOSED when an open loan exists for the selected stream", async () => {
    fx.connected = true;
    fx.loans = [
      {
        id: 12n,
        lending: LENDING,
        market: MARKET,
        borrower: ACCOUNT,
        streamId: 5n,
        obligation: SCALE,
        drawn: 0n,
        repaid: 0n,
        closed: false,
        outstanding: SCALE,
      },
    ];
    writeWatchSearch({ lens: "streams", selection: { kind: "stream", id: 5n } }, "replace");
    render(<WatchApp />);
    expect(screen.queryByText("STREAM CLOSED")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.search).toMatch(/loan=12/);
    });
    expect(screen.getByRole("article")).toHaveAttribute("data-region", "borrowed-detail");
  });

  it("paints STREAM CLOSED for a missing stream with no open loan", () => {
    fx.connected = true;
    fx.positions = [
      {
        id: 26n,
        lending: LENDING,
        lender: ACCOUNT,
        market: MARKET,
        aprBps: 500,
        availableLiquidity: 5n * SCALE,
        intervalStart: 0n,
        intervalEnd: 0n,
        pairs: [],
        pairsTruncated: false,
      },
    ];
    writeWatchSearch({ lens: "streams", selection: { kind: "stream", id: 5n } }, "replace");
    render(<WatchApp />);
    expect(screen.getByText("STREAM CLOSED")).toBeInTheDocument();
  });

  it("paints STREAM CLOSED when a complete stream book drops the selected stream", () => {
    fx.connected = true;
    fx.streamStatus = "ready";
    fx.positions = [
      {
        id: 26n,
        lending: LENDING,
        lender: ACCOUNT,
        market: MARKET,
        aprBps: 500,
        availableLiquidity: 5n * SCALE,
        intervalStart: 0n,
        intervalEnd: 0n,
        pairs: [],
        pairsTruncated: false,
      },
    ];
    fx.streams = [
      {
        streamId: 5n,
        owner: ACCOUNT,
        sender: VAULT,
        asset: TOKEN,
        schedule: {
          start: NOW - 10n * 86_400n,
          end: NOW + 80n * 86_400n,
          deposited: SCALE,
          withdrawn: 0n,
          refunded: 0n,
          cliffTime: NOW - 10n * 86_400n,
          isCancelable: false,
        },
        withdrawable: SCALE / 10n,
        remaining: SCALE,
        status: 1,
        renderEligible: true,
        borrowRouteEligible: true,
        vault: VAULT,
        market: MARKET,
      },
    ];
    writeWatchSearch({ lens: "streams", selection: { kind: "stream", id: 5n } }, "replace");
    const { rerender } = render(<WatchApp />);
    expect(document.querySelector("[data-region='stream-detail']")).not.toBeNull();

    fx.streams = [];
    rerender(<WatchApp />);
    expect(screen.getByText("STREAM CLOSED")).toBeInTheDocument();
  });

  it("opens the second market when two lendings share position id 1", () => {
    fx.connected = true;
    fx.markets = [
      {
        vault: VAULT,
        treasury: VAULT,
        underlying: TOKEN,
        ovrfloToken: TOKEN,
        reserve: TOKEN,
        lending: LENDING,
        retiredLendings: [],
        market: MARKET,
        twapDurationFixed: 900,
        feeBps: 50,
        expiryCached: NOW + 150n * 86_400n,
        ptToken: TOKEN,
        oracle: TOKEN,
      },
      {
        vault: VAULT,
        treasury: VAULT,
        underlying: TOKEN_B,
        ovrfloToken: TOKEN_B,
        reserve: TOKEN_B,
        lending: LENDING_B,
        retiredLendings: [],
        market: MARKET_B,
        twapDurationFixed: 900,
        feeBps: 50,
        expiryCached: NOW + 150n * 86_400n,
        ptToken: TOKEN_B,
        oracle: TOKEN_B,
      },
    ];
    fx.positions = [
      {
        id: 1n,
        lending: LENDING,
        lender: ACCOUNT,
        market: MARKET,
        aprBps: 500,
        availableLiquidity: 5n * SCALE,
        intervalStart: 0n,
        intervalEnd: 0n,
        pairs: [],
        pairsTruncated: false,
      },
      {
        id: 1n,
        lending: LENDING_B,
        lender: ACCOUNT,
        market: MARKET_B,
        aprBps: 800,
        availableLiquidity: 2n * SCALE,
        intervalStart: 0n,
        intervalEnd: 0n,
        pairs: [],
        pairsTruncated: false,
      },
    ];
    render(<WatchApp />);
    const rows = screen.getAllByRole("button", { name: /SUPPLY #1/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]!);
    expect(window.location.search).toMatch(new RegExp(`lending=${LENDING_B}`, "i"));
    expect(window.location.search).toMatch(/position=1/);
    expect(rows[0]).toHaveAttribute("data-selected", "false");
    expect(rows[1]).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("article")).toHaveAttribute("data-region", "supplied-detail");
    expect(screen.getByRole("article")).toHaveAttribute("data-state", "resting");
  });

  it("keeps last-known stream rows visible under the degraded caption", () => {
    fx.connected = true;
    fx.streamStatus = "unavailable";
    fx.streams = [
      {
        streamId: 5n,
        owner: ACCOUNT,
        sender: VAULT,
        asset: TOKEN,
        schedule: {
          start: NOW - 10n * 86_400n,
          end: NOW + 80n * 86_400n,
          deposited: SCALE,
          withdrawn: 0n,
          refunded: 0n,
          cliffTime: NOW - 10n * 86_400n,
          isCancelable: false,
        },
        withdrawable: SCALE / 10n,
        remaining: SCALE,
        status: 1,
        renderEligible: true,
        borrowRouteEligible: true,
        vault: VAULT,
        market: MARKET,
      },
    ];
    writeWatchSearch({ lens: "streams", selection: { kind: "none" } }, "replace");
    render(<WatchApp />);
    expect(screen.getByText(/STREAM DISCOVERY IS UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /STREAM #5/ })).toBeInTheDocument();
  });

  it("keeps last-ready stream rows when a failure arrives with an empty book", () => {
    fx.connected = true;
    fx.streams = [
      {
        streamId: 5n,
        owner: ACCOUNT,
        sender: VAULT,
        asset: TOKEN,
        schedule: {
          start: NOW - 10n * 86_400n,
          end: NOW + 80n * 86_400n,
          deposited: SCALE,
          withdrawn: 0n,
          refunded: 0n,
          cliffTime: NOW - 10n * 86_400n,
          isCancelable: false,
        },
        withdrawable: SCALE / 10n,
        remaining: SCALE,
        status: 1,
        renderEligible: true,
        borrowRouteEligible: true,
        vault: VAULT,
        market: MARKET,
      },
    ];
    writeWatchSearch({ lens: "streams", selection: { kind: "none" } }, "replace");
    const { rerender } = render(<WatchApp />);
    expect(screen.getByRole("button", { name: /STREAM #5/ })).toBeInTheDocument();

    fx.streamStatus = "unavailable";
    fx.streams = [];
    rerender(<WatchApp />);
    expect(screen.getByText(/STREAM DISCOVERY IS UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /STREAM #5/ })).toBeInTheDocument();
  });

  it("STALE REFRESH advances the pin and does not only invalidate stream-book", async () => {
    const advancePin = vi.fn(async () => undefined);
    fx.connected = true;
    fx.signingAllowed = false;
    fx.freshnessKind = "degraded";
    fx.advancePin = advancePin;
    fx.positions = [
      {
        id: 26n,
        lending: LENDING,
        lender: ACCOUNT,
        market: MARKET,
        aprBps: 500,
        availableLiquidity: 5n * SCALE,
        intervalStart: 0n,
        intervalEnd: 0n,
        pairs: [],
        pairsTruncated: false,
      },
    ];
    render(<WatchApp />);
    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    expect(advancePin).toHaveBeenCalled();
  });

  it("does not copy an open loan onto the Streams wall", () => {
    fx.connected = true;
    fx.loans = [
      {
        id: 12n,
        lending: LENDING,
        market: MARKET,
        borrower: ACCOUNT,
        streamId: 5n,
        obligation: SCALE,
        drawn: 0n,
        repaid: 0n,
        closed: false,
        outstanding: SCALE,
      },
    ];
    writeWatchSearch({ lens: "borrowed", selection: { kind: "none" } }, "replace");
    render(<WatchApp />);
    expect(screen.getByRole("button", { name: /LOAN #12/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /STREAM #5/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "STREAMS" })).not.toBeInTheDocument();
  });
});
