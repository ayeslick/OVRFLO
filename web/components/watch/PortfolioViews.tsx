"use client";

import type { ReactNode } from "react";
import type { PortfolioType } from "@/lib/parse";
import { formatTruncatedDecimal } from "@/lib/format";
import { KD7_RETIRED_MARKET_COPY } from "@/lib/named-surface-state";
import type { UnderlyingTotal } from "@/lib/portfolio-status";

export function PortfolioEmpty() {
  return (
    <section className="default-hub" data-ui="UI-WATCH-EMPTY">
      <header className="default-hub-welcome">
        <h2>Your OVRFLO</h2>
      </header>
      <p>No positions yet. Create a Self-Repaying Loan or a Fixed Return.</p>
      <a className="kit-card kit-type-card" href="/create/" data-ui="UI-WATCH-EMPTY-CREATE">
        <h3>Create</h3>
        <p>Open the type chooser.</p>
      </a>
    </section>
  );
}

export function PortfolioIncomplete({
  children,
  streamsDegraded,
}: {
  children?: ReactNode;
  streamsDegraded?: ReactNode;
}) {
  return (
    <section className="watch-portfolio" data-ui="UI-WATCH-INCOMPLETE">
      <header className="default-hub-welcome">
        <h2>Your OVRFLO</h2>
      </header>
      <p className="watch-kicker">INCOMPLETE</p>
      <p>Discovery is still running. Confirmed cards stay visible. This count is not a route.</p>
      {streamsDegraded}
      {children}
    </section>
  );
}

export function PortfolioHub({
  loanCount,
  fixedCount,
  onOpenCollection,
}: {
  loanCount: number;
  fixedCount: number;
  onOpenCollection: (type: PortfolioType) => void;
}) {
  return (
    <section className="default-hub" data-ui="UI-WATCH-HUB">
      <header className="default-hub-welcome">
        <h2>Your OVRFLO</h2>
      </header>
      <div className="default-hub-types">
        <button
          type="button"
          className="kit-card kit-type-card"
          data-type="loan"
          onClick={() => onOpenCollection("loan")}
        >
          <span className="kit-medallion" data-identity="loan" aria-hidden="true" />
          <h3>Self-Repaying Loans</h3>
          <p>{loanCount} position{loanCount === 1 ? "" : "s"}</p>
          <span>View all</span>
        </button>
        <button
          type="button"
          className="kit-card kit-type-card"
          data-type="fixed"
          onClick={() => onOpenCollection("fixed")}
        >
          <span className="kit-medallion" data-identity="fixed" aria-hidden="true" />
          <h3>Fixed Returns</h3>
          <p>{fixedCount} position{fixedCount === 1 ? "" : "s"}</p>
          <span>View all</span>
        </button>
      </div>
    </section>
  );
}

export function CollectionTotals({ totals }: { totals: readonly UnderlyingTotal[] }) {
  if (totals.length === 0) return null;
  return (
    <ul className="watch-collection-totals" data-ui="UI-WATCH-COLLECTION-TOTALS">
      {totals.map((row) => (
        <li key={`${row.underlying}:${row.symbol}`}>
          {row.count} · {formatTruncatedDecimal(row.amount, 18, 5)} {row.symbol}
        </li>
      ))}
    </ul>
  );
}

export function RetiredMarketMarker() {
  return (
    <p className="watch-retired" data-ui="UI-WATCH-RETIRED" data-named-state="retired-market">
      {KD7_RETIRED_MARKET_COPY}
    </p>
  );
}
