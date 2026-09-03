"use client";

import type { Address } from "viem";
import { EntityRow } from "@/components/kit/EntityRow";
import { formatMaturityDate, formatTokenAmount } from "@/lib/format";
import "./supply.css";

export type SelectMarketState = "loading" | "ready" | "empty" | "unavailable";

export type SupplyMarketOption = {
  market: Address;
  underlyingSymbol: string;
  expiry: bigint;
  liveTicks: number | null;
  bestDepth: bigint | null;
};

export function SelectMarket({
  state,
  markets,
  selected,
  unavailable,
  onSelect,
  disclosure = "advanced",
}: {
  state: SelectMarketState;
  markets: readonly SupplyMarketOption[];
  selected: Address | null;
  unavailable?: { name: string; reason: "matured-or-inactive" | "tick-config-changed" } | null;
  onSelect: (market: Address) => void;
  disclosure?: "default" | "advanced";
}) {
  const isDefault = disclosure === "default";
  if (state === "loading") {
    return (
      <div data-ui="UI-SUPPLY-SELECT-MARKET" data-state="loading" className="supply-status">
        {isDefault ? "LOADING TERMS" : "LOADING MARKETS"}
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div data-ui="UI-SUPPLY-SELECT-MARKET" data-state="unavailable" className="supply-status">
        {isDefault ? "TERMS UNAVAILABLE" : "MARKET REGISTRY UNAVAILABLE"}
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div data-ui="UI-SUPPLY-SELECT-MARKET" data-state="empty" className="supply-handoff">
        <p className="supply-kicker">{isDefault ? "NO VALID TERM" : "NO MARKETS"}</p>
        <h2 className="supply-title">
          {isDefault ? "No supported term is available" : "No approved active pre-maturity markets"}
        </h2>
        <p className="supply-lede">
          {isDefault
            ? "Fixed Return opens when a supported series can still take capital."
            : "Supply opens when a series is approved and still before maturity."}
        </p>
      </div>
    );
  }

  return (
    <div data-ui="UI-SUPPLY-SELECT-MARKET" data-state={selected ? "selected" : "ready"}>
      <p className="supply-kicker">{isDefault ? "SELECT TERM" : "SELECT MARKET"}</p>
      <h2 className="supply-title">{isDefault ? "Which asset and date?" : "Which PT market and maturity?"}</h2>
      {unavailable ? (
        <MarketUnavailable name={unavailable.name} reason={unavailable.reason} disclosure={disclosure} />
      ) : null}
      <div className="supply-market-list">
        {markets.map((row) => {
          const picked = selected === row.market;
          const ticks = row.liveTicks === null ? "LOADING TICKS" : `${row.liveTicks} LIVE TICKS`;
          const depth =
            row.bestDepth === null
              ? "BEST DEPTH —"
              : `BEST DEPTH ${formatTokenAmount(row.bestDepth, row.underlyingSymbol)}`;
          return (
            <EntityRow
              key={row.market}
              state="eligible"
              selected={picked}
              identity={`${row.underlyingSymbol} · ${formatMaturityDate(row.expiry)}`}
              stateLine={`${ticks} · ${depth}`}
              decisive={row.underlyingSymbol}
              onSelect={() => onSelect(row.market)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function MarketUnavailable({
  name,
  reason,
  disclosure = "advanced",
}: {
  name: string;
  reason: "matured-or-inactive" | "tick-config-changed";
  disclosure?: "default" | "advanced";
}) {
  const copy =
    reason === "tick-config-changed"
      ? `${name} tick configuration changed. Pick a rate again — liquidity was not moved.`
      : disclosure === "default"
        ? `${name} can no longer take supply. The term matured or deactivated.`
        : `${name} can no longer take supply. The market matured or deactivated.`;
  return (
    <div className="supply-notice" data-ui="UI-SUPPLY-MARKET-UNAVAILABLE" data-state={reason} role="status">
      <p>{copy}</p>
    </div>
  );
}
