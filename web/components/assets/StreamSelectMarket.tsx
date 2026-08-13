"use client";

import { ActionButton } from "@/components/kit/ActionButton";
import { formatMaturityDate } from "@/lib/format";
import type { Address } from "viem";
import "./assets.css";

export type StreamMarketOption = {
  id: Address;
  vault: Address;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  expiry: bigint;
};

export function StreamSelectMarket({
  status,
  markets,
  selected,
  onSelect,
  onContinue,
}: {
  status: "loading" | "ready" | "empty" | "unavailable";
  markets: readonly StreamMarketOption[];
  selected: Address | null;
  onSelect: (id: Address) => void;
  onContinue: () => void;
}) {
  return (
    <section data-control="UI-ASSETS-STREAM-SELECT-MARKET" data-state={status}>
      <span className="assets-bay-kicker">CREATE STREAM</span>
      <h2 className="assets-bay-title">Choose a market</h2>
      {status === "loading" ? <p className="assets-note">CHECKING MARKETS…</p> : null}
      {status === "unavailable" ? (
        <p className="assets-note" role="alert">
          MARKETS UNAVAILABLE
        </p>
      ) : null}
      {status === "empty" ? (
        <p className="assets-note">No approved series is open for deposit.</p>
      ) : null}
      {status === "ready" ? (
        <div className="assets-market-list">
          {markets.map((market) => (
            <button
              key={market.id}
              type="button"
              className="assets-market"
              data-selected={selected === market.id ? "true" : "false"}
              onClick={() => onSelect(market.id)}
            >
              <span className="assets-market-id">
                {market.underlyingSymbol} · {formatMaturityDate(market.expiry)}
              </span>
              <span className="assets-market-meta">
                MINTS {market.ovrfloSymbol === "the market's ovrflo token" ? "THE MARKET'S OVRFLO TOKEN" : market.ovrfloSymbol}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <div className="assets-actions">
          <ActionButton onClick={onContinue}>CONTINUE</ActionButton>
        </div>
      ) : (
        <div className="assets-actions">
          <ActionButton disabled disabledReason="SELECT A MARKET">
            CONTINUE
          </ActionButton>
        </div>
      )}
    </section>
  );
}
