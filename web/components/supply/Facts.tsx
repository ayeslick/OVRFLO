"use client";

import { formatAprBps, formatMaturityDate, formatTokenAmount } from "@/lib/format";
import "./supply.css";

export function SupplyFacts({
  amount,
  aprBps,
  expiry,
  ahead,
  underlyingSymbol,
}: {
  amount: bigint;
  aprBps: number;
  expiry: bigint;
  ahead: bigint;
  underlyingSymbol: string;
}) {
  return (
    <div data-ui="UI-SUPPLY-FACTS" data-state="ready">
      <div className="supply-facts">
        <div className="supply-fact">
          <span>AMOUNT</span>
          <span>{formatTokenAmount(amount, underlyingSymbol)}</span>
        </div>
        <div className="supply-fact">
          <span>APR</span>
          <span>{formatAprBps(aprBps)}</span>
        </div>
        <div className="supply-fact">
          <span>MATURITY</span>
          <span>{formatMaturityDate(expiry)}</span>
        </div>
        <div className="supply-fact">
          <span>CURRENTLY AHEAD</span>
          <span>{formatTokenAmount(ahead, underlyingSymbol)}</span>
        </div>
        <div className="supply-fact">
          <span>UNFILLED</span>
          <span>Waiting. Withdrawable until filled. No return is promised before match.</span>
        </div>
      </div>
      <p className="supply-notice" data-kind="filled">
        EARNINGS BEGIN ONLY WHEN FILLED. Resting capital does not tick.
      </p>
    </div>
  );
}
