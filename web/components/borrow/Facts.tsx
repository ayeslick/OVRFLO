"use client";

import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { formatCoverDate, formatTokenAmount } from "@/lib/format";
import type { CoverDate } from "@/lib/payoff";
import type { BorrowQuote } from "./quote";
import "./borrow.css";

const DASH = "—";

export function BorrowFacts({
  quote,
  stale = false,
  dashes = false,
  underlyingSymbol,
  ovrfloSymbol,
  cover,
  feeOpen,
  onToggleFee,
}: {
  quote: BorrowQuote | null;
  stale?: boolean;
  dashes?: boolean;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  cover: CoverDate;
  feeOpen: boolean;
  onToggleFee: () => void;
}) {
  const figure = (value: bigint | undefined) =>
    dashes || value === undefined ? DASH : formatTokenAmount(value, underlyingSymbol);
  const ovrfloFigure = (value: bigint | undefined) =>
    dashes || value === undefined ? DASH : formatTokenAmount(value, ovrfloSymbol);
  return (
    <div
      data-ui="UI-BORROW-FACTS"
      data-state={dashes ? "idle" : quote && quote.fill > 0n ? "ready" : "idle"}
      data-stale={stale ? "true" : "false"}
    >
      <div className="kit-hero">
        <span className="kit-hero-kicker">YOU RECEIVE</span>
        <div className="borrow-you-receive" data-stale={stale ? "true" : "false"}>
          {dashes ? DASH : formatTokenAmount(quote?.net ?? 0n, underlyingSymbol)}
        </div>
      </div>
      <div className="borrow-facts" data-stale={stale ? "true" : "false"}>
        <div className="borrow-fact">
          <span>GROSS</span>
          <span>{figure(quote?.fill)}</span>
        </div>
        <div className="borrow-fact">
          <span>OBLIGATION</span>
          <span>{ovrfloFigure(quote?.obligation)}</span>
        </div>
        <div className="borrow-fact">
          <span>RESIDUAL STREAM</span>
          <span>{ovrfloFigure(quote?.residual)}</span>
        </div>
        <div className="borrow-fact">
          <span>COVER DATE</span>
          <span>{dashes ? DASH : coverLabel(cover)}</span>
        </div>
      </div>
      {quote?.saleEquivalent ? <SaleEquivalence /> : null}
      {quote?.partial ? <PartialFillWarning /> : null}
      <DisclosureRow id="borrow-fee" label="FEE FROM PROCEEDS" open={feeOpen} onToggle={onToggleFee}>
        {dashes ? DASH : formatTokenAmount(quote?.feeAmount ?? 0n, underlyingSymbol)} deducted from
        proceeds. The fee is not pulled from the wallet and needs no ERC-20 approval.
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
