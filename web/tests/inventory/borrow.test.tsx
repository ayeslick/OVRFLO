import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AmountStep } from "@/components/borrow/AmountStep";
import { NoStream, SelectStream } from "@/components/borrow/SelectStream";
import { StreamContext } from "@/components/borrow/StreamContext";
import { RateStep } from "@/components/borrow/RateStep";
import { PoolBand } from "@/components/borrow/PoolBand";
import { ReviewHandoff } from "@/components/borrow/ReviewHandoff";
import { quoteBorrow, snapshotQuote } from "@/components/borrow/quote";
import { tickWindow, shapeLadder } from "@/lib/ladder";
import { YEAR_SECONDS } from "@/lib/lending-math";
import { coverDate } from "@/lib/payoff";
import {
  eligibleStream,
  LENDING,
  noop,
  SCALE,
  stubViewport,
  TRANSACTING_WIDTHS,
  UNDERLYING,
  SYMBOL,
} from "./fixtures";

const ETHER = SCALE;
const NOW = 1_700_000_000n;
const END = NOW + YEAR_SECONDS;
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
const FROZEN = snapshotQuote(QUOTE, 500);

const noopWrite = {
  onAcknowledge: noop,
  onApprove: noop,
  onBorrow: noop,
  onRelatch: noop,
  onViewLoan: noop,
};

describe.each(TRANSACTING_WIDTHS)("inventory — borrow topology at %ipx", (width) => {
  beforeEach(() => stubViewport(width));

  it("3 BORROW.SELECT_STREAM — eligible list; loading ≠ empty ≠ unavailable", () => {
    const { rerender } = render(
      <SelectStream
        state="loading"
        streams={[]}
        selectedId={null}
        ovrfloSymbol={SYMBOL}
        onSelect={noop}
      />,
    );
    expect(screen.getByText("LOADING STREAMS")).toHaveAttribute("data-state", "loading");
    rerender(
      <SelectStream
        state="unavailable"
        streams={[]}
        selectedId={null}
        ovrfloSymbol={SYMBOL}
        onSelect={noop}
      />,
    );
    expect(screen.getByText("STREAM DISCOVERY UNAVAILABLE")).toHaveAttribute("data-state", "unavailable");
    rerender(
      <SelectStream
        state="ready"
        streams={[eligibleStream()]}
        selectedId={null}
        ovrfloSymbol={SYMBOL}
        onSelect={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /STREAM #441/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("BORROW AMOUNT")).not.toBeInTheDocument();
  });

  it("3 BORROW.SELECT_STREAM empty — guided handoff, no disabled form", () => {
    render(<NoStream />);
    expect(screen.getByText("Borrow needs a stream")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CREATE A STREAM" })).toHaveAttribute("href", "/assets");
    expect(screen.queryByLabelText("BORROW AMOUNT")).not.toBeInTheDocument();
  });

  it("4 BORROW.ENTER_AMOUNT + SELECT_RATE — CHANGE STREAM, depth, no wallet MAX", () => {
    const model = shapeLadder([
      { aprBps: 475, availableUnits: 9_240_000n },
      { aprBps: 500, availableUnits: 12_400_000n },
      { aprBps: 525, availableUnits: 7_810_000n },
    ]);
    const window = tickWindow(model, 500, { aprMin: 400, aprMax: 800 });
    render(
      <>
        <StreamContext stream={eligibleStream()} ovrfloSymbol={SYMBOL} onChange={noop} />
        <AmountStep value="4" unit={UNDERLYING} onChange={noop} onMax={noop} />
        <RateStep
          windowState="ready"
          window={window}
          selectedAprBps={500}
          underlyingSymbol={UNDERLYING}
          allRatesOpen={false}
          ladder={model}
          onSelect={noop}
          onStep={noop}
          onOpenAllRates={noop}
          onCloseAllRates={noop}
        />
        <PoolBand draw={4n * ETHER} depth={12n * ETHER} unit={UNDERLYING} state="ready" />
      </>,
    );
    expect(screen.getByRole("button", { name: "← CHANGE STREAM" })).toBeInTheDocument();
    expect(screen.getByLabelText("BORROW AMOUNT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MAX" })).toBeInTheDocument();
    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ALL RATES" })).toBeInTheDocument();
  });

  it("5 BORROW.REVIEW — frozen quote, cover dates before signature, receipts", () => {
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={FROZEN}
        drifted={false}
        checkpoint="review"
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
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
        {...noopWrite}
      />,
    );
    expect(screen.getByText("REVIEW BORROW")).toBeInTheDocument();
    expect(screen.getByText("SETTLEMENT")).toBeInTheDocument();
    expect(screen.getByText("ACTION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("CURRENT COVER")).toBeInTheDocument();
    expect(screen.getByText("AFTER FULL REPAY")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "BORROW" })).not.toBeInTheDocument();
  });

  it("6 BORROW.APPROVE_STREAM — PERMISSION RECEIPT current; CONFIRMED reserved", () => {
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={FROZEN}
        drifted={false}
        checkpoint="approve"
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
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
        {...noopWrite}
      />,
    );
    expect(screen.getByText("PERMISSION RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("SINGLE STREAM")).toBeInTheDocument();
    expect(screen.getByText("MATCH EXACT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "APPROVE STREAM" })).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "BORROW" })).not.toBeInTheDocument();
  });

  it("7 BORROW.SIGN — BORROW armed; permission skipped when already approved", () => {
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={FROZEN}
        drifted={false}
        checkpoint="sign"
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
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
        {...noopWrite}
      />,
    );
    expect(screen.getByRole("button", { name: "BORROW" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "APPROVE STREAM" })).not.toBeInTheDocument();
    expect(screen.queryByText("PERMISSION RECEIPT")).not.toBeInTheDocument();
  });

  it("8 BORROW.CONFIRMED — loan identity; VIEW LOAN; no second BORROW", () => {
    render(
      <ReviewHandoff
        quote={QUOTE}
        frozen={FROZEN}
        drifted={false}
        checkpoint="confirmed"
        underlyingSymbol={UNDERLYING}
        ovrfloSymbol={SYMBOL}
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
        {...noopWrite}
      />,
    );
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VIEW LOAN" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "BORROW" })).not.toBeInTheDocument();
    expect(document.querySelector('[data-kind="action"]')).toHaveAttribute("data-state", "confirmed");
  });
});
