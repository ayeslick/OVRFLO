"use client";

import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { formatCoverDate, formatTokenAmount } from "@/lib/format";
import type { CoverDate } from "@/lib/payoff";
import type { BorrowQuote } from "./quote";
import "./borrow.css";

export function BorrowFacts({
  quote,
  underlyingSymbol,
  ovrfloSymbol,
  cover,
  feeOpen,
  onToggleFee,
}: {
  quote: BorrowQuote;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  cover: CoverDate;
  feeOpen: boolean;
  onToggleFee: () => void;
}) {
  return (
    <div data-ui="UI-BORROW-FACTS" data-state={quote.fill > 0n ? "ready" : "idle"}>
      <div className="kit-hero">
        <span className="kit-hero-kicker">YOU RECEIVE</span>
        <div className="borrow-you-receive">
          {formatTokenAmount(quote.net, underlyingSymbol)}
        </div>
      </div>
      <div className="borrow-facts">
        <div className="borrow-fact">
          <span>GROSS</span>
          <span>{formatTokenAmount(quote.fill, underlyingSymbol)}</span>
        </div>
        <div className="borrow-fact">
          <span>OBLIGATION</span>
          <span>{formatTokenAmount(quote.obligation, ovrfloSymbol)}</span>
        </div>
        <div className="borrow-fact">
          <span>RESIDUAL STREAM</span>
          <span>{formatTokenAmount(quote.residual, ovrfloSymbol)}</span>
        </div>
        <div className="borrow-fact">
          <span>COVER DATE</span>
          <span>{coverLabel(cover)}</span>
        </div>
      </div>
      {quote.saleEquivalent ? <SaleEquivalence /> : null}
      {quote.partial ? <PartialFillWarning /> : null}
      <DisclosureRow id="borrow-fee" label="FEE FROM PROCEEDS" open={feeOpen} onToggle={onToggleFee}>
        {formatTokenAmount(quote.feeAmount, underlyingSymbol)} deducted from proceeds. The fee is
        not pulled from the wallet and needs no ERC-20 approval.
      </DisclosureRow>
    </div>
  );
}

export function SaleEquivalence() {
  return (
    <p className="borrow-notice" data-kind="sale" data-ui="UI-BORROW-SALE-EQUIVALENCE">
      The stream repays the loan entirely and no residual returns.
    </p>
  );
}

export function PartialFillWarning() {
  return (
    <p className="borrow-notice" data-ui="UI-BORROW-PARTIAL-FILL" data-state="warning">
      This tick&apos;s resting liquidity is smaller than the target. Signing uses the actual fill,
      not the typed amount.
    </p>
  );
}

export function coverLabel(cover: CoverDate): string {
  if (cover.status === "covered") return "COVERED";
  if (cover.status === "uncovered") return "UNCOVERED";
  return formatCoverDate(cover.at);
}
