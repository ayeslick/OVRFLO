import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { NoStream, SelectStream } from "@/components/borrow/SelectStream";
import { StreamContext } from "@/components/borrow/StreamContext";
import { AmountStep } from "@/components/borrow/AmountStep";
import { PoolBand } from "@/components/borrow/PoolBand";
import { RateStep } from "@/components/borrow/RateStep";
import { BorrowFacts } from "@/components/borrow/Facts";
import { ReviewHandoff } from "@/components/borrow/ReviewHandoff";
import { quoteBorrow, snapshotQuote, streamDerivedCap } from "@/components/borrow/quote";
import type { HydratedStream } from "@/hooks/useStreams";
import { tickWindow, shapeLadder } from "@/lib/ladder";
import { YEAR_SECONDS } from "@/lib/lending-math";
import { belowMinimumCopy } from "@/lib/errors";
import { coverDate } from "@/lib/payoff";

const USER = "0x0000000000000000000000000000000000000a11" as Address;
const VAULT = "0x0000000000000000000000000000000000000b22" as Address;
const TOKEN = "0x0000000000000000000000000000000000000c33" as Address;
const MARKET = "0x0000000000000000000000000000000000000d44" as Address;
const LENDING = "0x0000000000000000000000000000000000000e55" as Address;
const ETHER = 10n ** 18n;
const NOW = 1_700_000_000n;
const END = NOW + YEAR_SECONDS;

function stream(id = 441n, remaining = 10n * ETHER): HydratedStream {
  return {
    streamId: id,
    owner: USER,
    sender: VAULT,
    asset: TOKEN,
    schedule: {
      start: NOW,
      end: END,
      deposited: remaining,
      withdrawn: 0n,
      refunded: 0n,
      cliffTime: NOW,
      isCancelable: false,
    },
    withdrawable: 0n,
    remaining,
    renderEligible: true,
    borrowRouteEligible: true,
    vault: VAULT,
    market: MARKET,
  };
}

const QUOTE = quoteBorrow({
  remaining: 10n * ETHER,
  aprBps: 500,
  ttmSeconds: YEAR_SECONDS,
  feeBps: 40,
  target: 4n * ETHER,
  depth: 12n * ETHER,
});

const COVER = coverDate(
  { start: NOW, end: END, deposited: 10n * ETHER, withdrawn: 0n, refunded: 0n },
  QUOTE.obligation,
  NOW,
);

describe("SelectStream", () => {
  it("renders the guided handoff when there is no eligible stream", () => {
    render(<NoStream />);
    expect(screen.getByText("Borrow needs a stream")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CREATE A STREAM" })).toHaveAttribute("href", "/assets");
    expect(screen.getByRole("link", { name: "GUIDED FIRST RUN" })).toHaveAttribute("href", "/");
    expect(screen.queryByLabelText("BORROW AMOUNT")).not.toBeInTheDocument();
  });

  it("keeps loading, unavailable, and ready distinct", () => {
    const { rerender } = render(
      <SelectStream state="loading" streams={[]} selectedId={null} ovrfloSymbol="ovrfloWSTETH" onSelect={() => undefined} />,
    );
    expect(screen.getByText("LOADING STREAMS")).toHaveAttribute("data-state", "loading");
    rerender(
      <SelectStream state="unavailable" streams={[]} selectedId={null} ovrfloSymbol="ovrfloWSTETH" onSelect={() => undefined} />,
    );
    expect(screen.getByText("STREAM DISCOVERY UNAVAILABLE")).toHaveAttribute("data-state", "unavailable");
  });

  it("lists eligible streams and selects one", () => {
    const chosen: bigint[] = [];
    render(
      <SelectStream
        state="ready"
        streams={[stream()]}
        selectedId={null}
        ovrfloSymbol="ovrfloWSTETH"
        onSelect={(id) => chosen.push(id)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /STREAM #441/ }));
    expect(chosen).toEqual([441n]);
  });
});

describe("StreamContext and amount", () => {
  it("exposes CHANGE STREAM and a balance-independent MAX", () => {
    const maxed: string[] = [];
    render(
      <>
        <StreamContext stream={stream()} ovrfloSymbol="ovrfloWSTETH" onChange={() => undefined} />
        <AmountStep value="" unit="wstETH" onChange={() => undefined} onMax={() => maxed.push("max")} />
      </>,
    );
    expect(screen.getByRole("button", { name: "← CHANGE STREAM" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(maxed).toEqual(["max"]);
    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
  });
});

describe("Rate window and pool band", () => {
  it("shows depth on chips and flags a partial fill", () => {
    const model = shapeLadder([
      { aprBps: 475, availableUnits: 9_240_000n },
      { aprBps: 500, availableUnits: 12_400_000n },
      { aprBps: 525, availableUnits: 7_810_000n },
    ]);
    const window = tickWindow(model, 500, { aprMin: 400, aprMax: 800 });
    render(
      <>
        <RateStep
          windowState="ready"
          window={window}
          selectedAprBps={500}
          underlyingSymbol="wstETH"
          allRatesOpen={false}
          ladder={model}
          onSelect={() => undefined}
          onStep={() => undefined}
          onOpenAllRates={() => undefined}
          onCloseAllRates={() => undefined}
        />
        <PoolBand draw={20n * ETHER} depth={12n * ETHER} unit="wstETH" state="partial" />
      </>,
    );
    expect(screen.getByText("Lower rate, deeper pool — depth is not a guaranteed fill.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ALL RATES" })).toBeInTheDocument();
    expect(document.querySelector('[data-ui="UI-BORROW-POOL-BAND"]')).toHaveAttribute("data-state", "partial");
  });

  it("names live ticks when the selected tick is empty", () => {
    const model = shapeLadder([
      { aprBps: 500, availableUnits: 0n },
      { aprBps: 600, availableUnits: 8_000_000n },
    ]);
    const window = tickWindow(model, 500, { aprMin: 500, aprMax: 600 });
    render(
      <RateStep
        windowState="ready"
        window={window}
        selectedAprBps={500}
        underlyingSymbol="wstETH"
        allRatesOpen={false}
        ladder={model}
        emptyTickCopy="NO DEPTH AT 5.00%. LIVE TICKS: 6.00%"
        onSelect={() => undefined}
        onStep={() => undefined}
        onOpenAllRates={() => undefined}
        onCloseAllRates={() => undefined}
      />,
    );
    expect(screen.getByText(/NO DEPTH AT 5\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/LIVE TICKS: 6\.00%/)).toBeInTheDocument();
  });
});

describe("Facts and review", () => {
  it("leads with gold YOU RECEIVE and states fee-from-proceeds", () => {
    render(
      <BorrowFacts
        quote={QUOTE}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        cover={COVER}
        feeOpen
        onToggleFee={() => undefined}
      />,
    );
    expect(screen.getByText("YOU RECEIVE")).toBeInTheDocument();
    expect(screen.getByText(/deducted from proceeds/i)).toBeInTheDocument();
    expect(screen.getByText(/needs no ERC-20 approval/i)).toBeInTheDocument();
  });

  it("does not claim sale equivalence for a UNIT-clamped max that leaves residual", () => {
    const remaining = 123_456_789_012_345_678_901n;
    const clamped = quoteBorrow({
      remaining,
      aprBps: 1000,
      ttmSeconds: YEAR_SECONDS,
      feeBps: 40,
      target: streamDerivedCap(remaining, 1000, YEAR_SECONDS),
      depth: 10n ** 30n,
    });
    expect(clamped.saleEquivalent).toBe(false);
    render(
      <BorrowFacts
        quote={clamped}
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        cover={COVER}
        feeOpen={false}
        onToggleFee={() => undefined}
      />,
    );
    expect(screen.queryByText(/repays the loan entirely/)).not.toBeInTheDocument();
    expect(screen.getByText("RESIDUAL STREAM")).toBeInTheDocument();
  });

  it("freezes signing on quote drift with a visible diff", () => {
    const frozen = snapshotQuote(QUOTE, 500);
    const live = { ...QUOTE, net: QUOTE.net - ETHER, depth: QUOTE.depth - ETHER };
    render(
      <ReviewHandoff
        quote={live}
        frozen={frozen}
        drifted
        checkpoint="sign"
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        aprBps={500}
        streamId={441n}
        operator={LENDING}
        cover={COVER}
        repayCurrent={COVER}
        repayNext={{ status: "covered", at: NOW }}
        acknowledged
        streamApproved
        approveBusy={false}
        borrowBusy={false}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onBorrow={() => undefined}
        onRelatch={() => undefined}
        onViewLoan={() => undefined}
      />,
    );
    expect(screen.getByText("QUOTE UPDATED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BORROW" })).toBeDisabled();
    expect(screen.getByText("QUOTE UPDATED — REVIEW AGAIN")).toBeInTheDocument();
  });

  it("names NFT asset, operator, and SINGLE STREAM scope on the permission receipt", () => {
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={snapshotQuote(QUOTE, 500)}
        drifted={false}
        checkpoint="approve"
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        aprBps={500}
        streamId={441n}
        operator={LENDING}
        cover={COVER}
        repayCurrent={COVER}
        repayNext={{ status: "covered", at: NOW }}
        acknowledged
        streamApproved={false}
        approveBusy={false}
        borrowBusy={false}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onBorrow={() => undefined}
        onRelatch={() => undefined}
        onViewLoan={() => undefined}
      />,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("Sablier stream NFT")).toBeInTheDocument();
    expect(screen.getByText("SINGLE STREAM")).toBeInTheDocument();
    expect(screen.getByText("MATCH EXACT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "APPROVE STREAM" })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
  });

  it("shows current and post-repay cover dates (AE6)", () => {
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={snapshotQuote(QUOTE, 500)}
        drifted={false}
        checkpoint="sign"
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        aprBps={500}
        streamId={441n}
        operator={LENDING}
        cover={COVER}
        repayCurrent={{ status: "projected", at: END }}
        repayNext={{ status: "covered", at: NOW }}
        acknowledged
        streamApproved
        approveBusy={false}
        borrowBusy={false}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onBorrow={() => undefined}
        onRelatch={() => undefined}
        onViewLoan={() => undefined}
      />,
    );
    expect(screen.getByText("CURRENT COVER")).toBeInTheDocument();
    expect(screen.getByText("AFTER FULL REPAY")).toBeInTheDocument();
    expect(screen.getByText("COVERED")).toBeInTheDocument();
  });

  it("puts loan identity, net, obligation, and cover date on the confirmed receipt", () => {
    const onView: bigint[] = [];
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={snapshotQuote(QUOTE, 500)}
        drifted={false}
        checkpoint="confirmed"
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        aprBps={500}
        streamId={441n}
        operator={LENDING}
        cover={COVER}
        repayCurrent={COVER}
        repayNext={{ status: "covered", at: NOW }}
        acknowledged
        streamApproved
        approveBusy={false}
        borrowBusy={false}
        loanId={12n}
        actualNet={QUOTE.net}
        actualObligation={QUOTE.obligation}
        confirmedCover={{ status: "projected", at: END }}
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onBorrow={() => undefined}
        onRelatch={() => undefined}
        onViewLoan={(id) => onView.push(id)}
      />,
    );
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getAllByText("NET").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OBLIGATION").length).toBeGreaterThan(0);
    expect(screen.getByText("COVER")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "VIEW LOAN" }));
    expect(onView).toEqual([12n]);
  });

  it("renders BelowMinimum fill-floor vs stream-face copy", () => {
    expect(belowMinimumCopy("fill-floor")).toMatch(/resting liquidity/i);
    expect(belowMinimumCopy("stream-face")).toMatch(/remaining value is below the minimum/i);
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={snapshotQuote(QUOTE, 500)}
        drifted={false}
        checkpoint="sign"
        underlyingSymbol="wstETH"
        ovrfloSymbol="ovrfloWSTETH"
        aprBps={500}
        streamId={441n}
        operator={LENDING}
        cover={COVER}
        repayCurrent={COVER}
        repayNext={{ status: "covered", at: NOW }}
        acknowledged
        streamApproved
        approveBusy={false}
        borrowBusy={false}
        errorCopy={belowMinimumCopy("fill-floor")}
        recoveryLabel="Pick a different rate"
        onAcknowledge={() => undefined}
        onApprove={() => undefined}
        onBorrow={() => undefined}
        onRelatch={() => undefined}
        onRecovery={() => undefined}
        onViewLoan={() => undefined}
      />,
    );
    expect(screen.getByText(/resting liquidity/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick a different rate" })).toBeInTheDocument();
  });
});
