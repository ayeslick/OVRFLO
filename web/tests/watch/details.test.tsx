import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BorrowedDetail } from "@/components/watch/BorrowedDetail";
import { ClosedLoanDetail } from "@/components/watch/ClosedLoanDetail";
import { StreamDetail } from "@/components/watch/StreamDetail";
import { SuppliedDetail } from "@/components/watch/SuppliedDetail";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { HydratedStream } from "@/hooks/useStreams";
import type { Freshness } from "@/lib/freshness";
import type { MarketInfo } from "@/lib/types";

const SCALE = 10n ** 18n;
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const MARKET = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x3333333333333333333333333333333333333333" as const;
const LENDING = "0x4444444444444444444444444444444444444444" as const;
const NOW = 1_800_000_000n;
const NOW_MS = Number(NOW) * 1000;

const synced: Freshness = { kind: "synced", asOf: NOW };
const degraded: Freshness = { kind: "degraded", asOf: NOW };

const market: MarketInfo = {
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
};

const position: LenderPositionRow = {
  id: 26n,
  lender: ACCOUNT,
  market: MARKET,
  aprBps: 500,
  availableLiquidity: 19n * 10n ** 17n,
  intervalStart: 0n,
  intervalEnd: 31n * 10n ** 17n,
  pairs: [{ loanId: 1n, contribution: 31n * 10n ** 17n, claimable: 12n * 10n ** 16n }],
  pairsTruncated: false,
};

const activeLoan: BorrowerLoanRow = {
  id: 12n,
  borrower: ACCOUNT,
  streamId: 440n,
  obligation: 2n * SCALE,
  drawn: SCALE,
  repaid: 0n,
  closed: false,
  outstanding: SCALE,
};

vi.mock("@/hooks/useWriteFlow", () => ({
  useWriteFlow: () => ({
    writeContract: vi.fn(),
    reset: vi.fn(),
    isSigning: false,
    isConfirming: false,
    isConfirmed: false,
    isReverted: false,
    isInFlight: false,
    error: null,
    hash: undefined,
  }),
}));

vi.mock("@/hooks/useWatchBalances", () => ({
  useWatchBalances: () => ({
    wrapReserve: { status: "ready", value: 10n * 10n ** 18n },
    walletOvrflo: { status: "ready", value: 10n * 10n ** 18n },
    walletUnderlying: { status: "ready", value: 10n * 10n ** 18n },
    ovrfloAllowance: { status: "ready", value: 10n * 10n ** 18n },
    matured: false,
  }),
}));

vi.mock("@/hooks/useAcknowledgment", () => ({
  useAcknowledgment: () => ({ acknowledged: true, ready: true, acknowledge: vi.fn() }),
}));

vi.mock("@/hooks/useChainGuard", () => ({
  useChainGuard: () => ({
    wrongChain: false,
    connectedChainId: 1,
    expectedChainId: 1,
    switchChain: vi.fn(),
    isSwitching: false,
    switchError: null,
  }),
}));

describe("watch details", () => {
  it("leads supplied detail with earnings then CLAIM", () => {
    render(
      <SuppliedDetail
        position={position}
        symbol="ovrfloTEST"
        market={market}
        lending={LENDING}
        nowMs={NOW_MS}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
      />,
    );
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-region", "supplied-detail");
    expect(screen.getByText("YOUR EARNINGS")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CLAIM / })).toBeInTheDocument();
  });

  it("launches claim in place with SETTLEMENT trace", () => {
    render(
      <SuppliedDetail
        position={position}
        symbol="ovrfloTEST"
        market={market}
        lending={LENDING}
        nowMs={NOW_MS}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /CLAIM / }));
    expect(screen.getByText("SETTLEMENT")).toBeInTheDocument();
    expect(screen.getByText("ACTION RECEIPT")).toBeInTheDocument();
  });

  it("keeps heroes ticking and disables signing on RPC blackout (AE1)", () => {
    render(
      <BorrowedDetail
        loan={activeLoan}
        symbol="ovrfloTEST"
        market={market}
        lending={LENDING}
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        schedule={{
          start: NOW - 30n * 86_400n,
          end: NOW + 150n * 86_400n,
          deposited: 2n * SCALE,
          withdrawn: 0n,
          refunded: 0n,
        }}
        withdrawable={SCALE / 10n}
        freshness={degraded}
        signingAllowed={false}
        usdMode="token"
        usdAvailable={false}
        onSelectStream={() => undefined}
      />,
    );
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText(/DEGRADED/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "REPAY" })).toBeDisabled();
    expect(screen.getByText("EVENTS STALE — SIGNING DISABLED")).toBeInTheDocument();
  });

  it("enables CLOSE FROM STREAM when covered (AE4)", () => {
    render(
      <BorrowedDetail
        loan={{ ...activeLoan, outstanding: SCALE / 1000n }}
        symbol="ovrfloTEST"
        market={market}
        lending={LENDING}
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        schedule={{
          start: NOW - 30n * 86_400n,
          end: NOW + 150n * 86_400n,
          deposited: 2n * SCALE,
          withdrawn: 0n,
          refunded: 0n,
        }}
        withdrawable={SCALE}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectStream={() => undefined}
      />,
    );
    expect(screen.getByRole("article")).toHaveAttribute("data-state", "close-ready");
    expect(screen.getByRole("button", { name: "CLOSE FROM STREAM" })).toBeEnabled();
  });

  it("renders settled detail with returned stream identity", () => {
    const onSelectStream = vi.fn();
    render(
      <ClosedLoanDetail
        loan={{ ...activeLoan, id: 3n, closed: true, outstanding: 0n, streamId: 441n }}
        symbol="ovrfloTEST"
        freshness={synced}
        onSelectStream={onSelectStream}
      />,
    );
    expect(screen.getByText("SETTLED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /RETURNED STREAM #441/ }));
    expect(onSelectStream).toHaveBeenCalledWith(441n);
  });

  it("offers borrow against an eligible stream", () => {
    const stream: HydratedStream = {
      streamId: 441n,
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
    };
    render(
      <StreamDetail
        stream={stream}
        symbol="ovrfloTEST"
        nowSeconds={NOW}
        nowMs={NOW_MS}
        lastReadAt={NOW}
        freshness={synced}
        signingAllowed
        usdMode="token"
        usdAvailable={false}
        onSelectLoan={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "BORROW AGAINST THIS STREAM" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /card/i })).toHaveAttribute("data-ui", "UI-WATCH-LEDGER-CARD");
  });
});
