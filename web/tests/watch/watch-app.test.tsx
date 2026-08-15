import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { WatchApp } from "@/components/watch/WatchApp";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import { loadingOutcome, readFailure, readyOutcome, unavailableOutcome } from "@/lib/read-outcome";
import { writeWatchSearch } from "@/lib/watch-url";

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const MARKET = "0x1111111111111111111111111111111111111111" as Address;
const TOKEN = "0x3333333333333333333333333333333333333333" as Address;
const VAULT = "0x2222222222222222222222222222222222222222" as Address;
const LENDING = "0x4444444444444444444444444444444444444444" as Address;
const NOW = 1_800_000_000n;
const SCALE = 10n ** 18n;

const fx = vi.hoisted(() => ({
  connected: false as boolean,
  lenderStatus: "ready" as "ready" | "loading" | "unavailable",
  borrowerStatus: "ready" as "ready" | "loading" | "unavailable",
  streamStatus: "ready" as "ready" | "loading" | "unavailable",
  positions: [] as LenderPositionRow[],
  loans: [] as BorrowerLoanRow[],
  streams: [] as { streamId: bigint }[],
  signingAllowed: true,
  freshnessKind: "synced" as "synced" | "degraded" | "unavailable",
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
  useOvrflos: () => ({ vaults: [], isLoading: false, error: null, tooLarge: false }),
}));

vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => ({
    markets: [
      {
        vault: VAULT,
        treasury: VAULT,
        underlying: TOKEN,
        ovrfloToken: TOKEN,
        lending: LENDING,
        market: MARKET,
        twapDurationFixed: 900,
        feeBps: 50,
        expiryCached: NOW + 150n * 86_400n,
        ptToken: TOKEN,
        oracle: TOKEN,
      },
    ],
    status: "ready",
    isLoading: false,
    error: null,
    tooLarge: false,
  }),
}));

vi.mock("@/hooks/useMarketSymbols", () => ({
  useMarketSymbols: () => ({ [TOKEN.toLowerCase()]: "ovrfloTEST" }),
  symbolFor: () => "ovrfloTEST",
}));

vi.mock("@/hooks/useLenderBook", () => ({
  useLenderBook: () => {
    if (fx.lenderStatus === "loading") return loadingOutcome();
    if (fx.lenderStatus === "unavailable") {
      return unavailableOutcome([readFailure("useLenderBook", "transport", "down")]);
    }
    return readyOutcome({ positions: fx.positions });
  },
}));

vi.mock("@/hooks/useBorrowerBook", () => ({
  useBorrowerBook: () => {
    if (fx.borrowerStatus === "loading") return loadingOutcome();
    if (fx.borrowerStatus === "unavailable") {
      return unavailableOutcome([readFailure("useBorrowerBook", "transport", "down")]);
    }
    return readyOutcome({ loans: fx.loans });
  },
}));

vi.mock("@/hooks/useStreams", () => ({
  useStreams: () => {
    if (fx.streamStatus === "loading") {
      return loadingOutcome({ streams: [] as typeof fx.streams });
    }
    if (fx.streamStatus === "unavailable") {
      const failure = [readFailure("useStreams", "transport", "could-not-ask")];
      return unavailableOutcome(failure);
    }
    return readyOutcome({ streams: fx.streams });
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
  fx.lenderStatus = "ready";
  fx.borrowerStatus = "ready";
  fx.streamStatus = "ready";
  fx.positions = [];
  fx.loans = [];
  fx.streams = [];
  fx.signingAllowed = true;
  fx.freshnessKind = "synced";
  writeWatchSearch({ lens: null, selection: { kind: "none" } }, "replace");
}

describe("watch shell + entry", () => {
  beforeEach(() => {
    resetFx();
    stubViewport(1280);
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
    writeWatchSearch({ lens: "supplied", selection: { kind: "position", id: 26n } }, "replace");
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
});
