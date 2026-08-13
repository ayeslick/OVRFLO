"use client";

import { formatMaturityDate } from "@/lib/format";
import "./supply.css";

export function MarketContext({
  underlyingSymbol,
  expiry,
  onChange,
}: {
  underlyingSymbol: string;
  expiry: bigint;
  onChange: () => void;
}) {
  return (
    <div data-ui="UI-SUPPLY-SELECT-MARKET" data-state="selected">
      <button type="button" className="supply-change" onClick={onChange}>
        ← CHANGE MARKET
      </button>
      <div className="supply-market-meta">
        <span>{underlyingSymbol}</span>
        <span>MATURITY {formatMaturityDate(expiry)}</span>
      </div>
    </div>
  );
}
