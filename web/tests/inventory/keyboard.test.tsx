import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AmountStep as BorrowAmount } from "@/components/borrow/AmountStep";
import { ReviewHandoff as BorrowReview } from "@/components/borrow/ReviewHandoff";
import { quoteBorrow, snapshotQuote } from "@/components/borrow/quote";
import { AmountStep as SupplyAmount } from "@/components/supply/AmountStep";
import { ReviewHandoff as SupplyReview } from "@/components/supply/ReviewHandoff";
import type { SupplySnapshot } from "@/components/supply/helpers";
import { coverDate } from "@/lib/payoff";
import { YEAR_SECONDS } from "@/lib/lending-math";
import { EXPIRY, LENDING, SCALE, SYMBOL, UNDERLYING, noop, stubViewport } from "./fixtures";

const ETHER = SCALE;
const NOW = 1_700_000_000n;
const FROZEN: SupplySnapshot = {
  amount: 2n * ETHER,
  aprBps: 500,
  ahead: ETHER,
  aprMinBps: 400,
  aprMaxBps: 800,
  spacing: 100,
};
const QUOTE = quoteBorrow({
  remaining: 10n * ETHER,
  aprBps: 500,
  ttmSeconds: YEAR_SECONDS,
  feeBps: 40,
  target: 4n * ETHER,
  depth: 12n * ETHER,
});
const COVER = coverDate(
  { start: NOW, end: NOW + YEAR_SECONDS, deposited: 10n * ETHER, withdrawn: 0n, refunded: 0n },
  QUOTE.obligation,
  NOW,
);
const BORROW_FROZEN = snapshotQuote(QUOTE, 500);
const noopSupply = {
  onAcknowledge: noop,
  onApprove: noop,
  onSupply: noop,
  onRelatch: noop,
  onViewPosition: noop,
};
const noopBorrow = {
  onAcknowledge: noop,
  onApprove: noop,
  onBorrow: noop,
  onRelatch: noop,
  onViewLoan: noop,
};

describe("inventory — keyboard-only write primaries", () => {
  it("amount fields accept Enter; supply and borrow sign buttons stay in tab order at 360px", () => {
    stubViewport(360);

    const { unmount: unmountSupplyAmount } = render(
      <SupplyAmount value="1" unit={UNDERLYING} onChange={noop} onMax={noop} />,
    );
    fireEvent.keyDown(screen.getByLabelText("SUPPLY AMOUNT"), { key: "Enter" });
    unmountSupplyAmount();

    const { unmount: unmountBorrowAmount } = render(
      <BorrowAmount value="1" unit={UNDERLYING} onChange={noop} onMax={noop} />,
    );
    fireEvent.keyDown(screen.getByLabelText("BORROW AMOUNT"), { key: "Enter" });
    unmountBorrowAmount();

    render(
      <SupplyReview
        frozen={FROZEN}
        live={FROZEN}
        drifted={false}
        checkpoint="sign"
        underlyingSymbol={UNDERLYING}
        expiry={EXPIRY}
        operator={LENDING}
        tokenApproved
        acknowledged
        approveBusy={false}
        approveCooldown={false}
        clearing={false}
        supplyBusy={false}
        {...noopSupply}
      />,
    );
    const supply = screen.getByRole("button", { name: "SUPPLY" });
    expect(supply).toBeEnabled();
    expect(supply).not.toHaveAttribute("tabIndex", "-1");

    render(
      <BorrowReview
        quote={QUOTE}
        frozen={BORROW_FROZEN}
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
        {...noopBorrow}
      />,
    );
    const borrow = screen.getByRole("button", { name: "BORROW" });
    expect(borrow).toBeEnabled();
    expect(borrow).not.toHaveAttribute("tabIndex", "-1");
  });
});
