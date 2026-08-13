"use client";

import { useState } from "react";
import type { Address } from "viem";
import { ActionButton } from "@/components/kit/ActionButton";
import { Amount } from "@/components/kit/Amount";
import { CapitalBand } from "@/components/kit/CapitalBand";
import { Ribbon } from "@/components/kit/Ribbon";
import { RollingNumber } from "@/components/kit/RollingNumber";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import { formatAprBps, formatAsOf, formatMaturityDate, formatTruncatedDecimal } from "@/lib/format";
import type { Freshness } from "@/lib/freshness";
import type { MarketInfo } from "@/lib/types";
import {
  fraction01,
  positionClaimable,
  positionFilled,
  suppliedMatchState,
} from "@/lib/watch-rows";
import { WatchWrite } from "./WatchWrite";
import "./watch.css";

export function SuppliedDetail({
  position,
  symbol,
  market,
  lending,
  nowMs,
  freshness,
  signingAllowed,
  usdMode,
  usdAvailable,
  usdText,
}: {
  position: LenderPositionRow;
  symbol: string;
  market: MarketInfo | null;
  lending: Address | null;
  nowMs: number;
  freshness: Freshness;
  signingAllowed: boolean;
  usdMode: "token" | "usd";
  usdAvailable: boolean;
  usdText?: string;
}) {
  const [write, setWrite] = useState<"claim" | "withdraw" | null>(null);
  const filled = positionFilled(position);
  const unfilled = position.availableLiquidity;
  const supplied = filled + unfilled;
  const claimable = positionClaimable(position);
  const match = suppliedMatchState(filled, unfilled);
  const resting = match === "resting";
  const stale = !signingAllowed;
  const ribbonState = stale ? "degraded" : resting ? "inert" : "edge";

  return (
    <article data-ui="UI-WATCH-SUPPLIED-DETAIL" data-region="supplied-detail" data-state={match}>
      {filled > 0n ? (
        <div className="kit-hero">
          <span className="kit-hero-kicker">YOUR EARNINGS</span>
          <RollingNumber
            value={claimable}
            ticking
            accent="gold"
            displayDecimals={8}
            nowMs={nowMs}
          />
          {usdMode === "usd" ? (
            <Amount
              token={formatTruncatedDecimal(claimable, 18, 8)}
              symbol={symbol}
              usd={usdText}
              usdAvailable={usdAvailable}
              mode="usd"
            />
          ) : (
            <span className="watch-hero-meta">{symbol}</span>
          )}
        </div>
      ) : null}

      {write && lending && market ? (
        <WatchWrite
          kind={write}
          lending={lending}
          market={market}
          positionId={position.id}
          claimPairs={position.pairs}
          claimable={claimable}
          unfilled={unfilled}
          symbol={symbol}
          signingAllowed={signingAllowed}
          onClose={() => setWrite(null)}
        />
      ) : (
        <div className="watch-actions">
          {claimable > 0n ? (
            stale ? (
              <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
                {`CLAIM ${formatTruncatedDecimal(claimable, 18, 5)} ${symbol}`}
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={() => setWrite("claim")}>
                {`CLAIM ${formatTruncatedDecimal(claimable, 18, 5)} ${symbol}`}
              </ActionButton>
            )
          ) : null}
          {unfilled > 0n ? (
            stale ? (
              <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
                WITHDRAW UNFILLED
              </ActionButton>
            ) : (
              <ActionButton onClick={() => setWrite("withdraw")}>WITHDRAW UNFILLED</ActionButton>
            )
          ) : null}
        </div>
      )}

      <Ribbon
        state={ribbonState}
        progress={resting ? 0 : fraction01(filled, supplied)}
        valueText={`${formatTruncatedDecimal(claimable, 18, 8)} ${symbol}`}
        originLabel="ORIGIN"
        terminalLabel={market ? formatMaturityDate(market.expiryCached).toUpperCase() : "TERMINAL"}
      />
      <CapitalBand
        state={resting ? "resting" : stale ? "degraded" : "segmented"}
        valueText={`${formatTruncatedDecimal(filled, 18, 5)} filled / ${formatTruncatedDecimal(unfilled, 18, 5)} ${symbol} unfilled`}
        segments={capitalSegments(position, filled, unfilled, supplied)}
      />

      <dl className="watch-facts">
        <Fact label="SUPPLIED" value={`${formatTruncatedDecimal(supplied, 18, 5)} ${symbol}`} />
        <Fact label="FILLED" value={`${formatTruncatedDecimal(filled, 18, 5)} ${symbol}`} />
        <Fact label="UNFILLED" value={`${formatTruncatedDecimal(unfilled, 18, 5)} ${symbol}`} />
        <Fact label="CLAIMABLE" value={`${formatTruncatedDecimal(claimable, 18, 5)} ${symbol}`} />
        <Fact label="APR" value={formatAprBps(position.aprBps)} />
        {market ? <Fact label="MATURITY" value={formatMaturityDate(market.expiryCached).toUpperCase()} /> : null}
      </dl>
      <p className="watch-freshness">{freshnessCaption(freshness)}</p>
    </article>
  );
}

function capitalSegments(
  position: LenderPositionRow,
  filled: bigint,
  unfilled: bigint,
  supplied: bigint,
) {
  if (supplied <= 0n) return [{ id: "u", fraction: 1, kind: "unfilled" as const }];
  if (filled === 0n) return [{ id: "u", fraction: 1, kind: "unfilled" as const }];
  const fromPairs = position.pairs.filter((pair) => pair.contribution > 0n);
  if (fromPairs.length > 0) {
    return [
      ...fromPairs.map((pair, index) => ({
        id: pair.loanId.toString(),
        fraction: fraction01(pair.contribution, supplied),
        kind: "filled" as const,
        divider: index > 0,
      })),
      ...(unfilled > 0n
        ? [{ id: "u", fraction: fraction01(unfilled, supplied), kind: "unfilled" as const, divider: true }]
        : []),
    ];
  }
  return [
    { id: "f", fraction: fraction01(filled, supplied), kind: "filled" as const },
    ...(unfilled > 0n
      ? [{ id: "u", fraction: fraction01(unfilled, supplied), kind: "unfilled" as const, divider: true }]
      : []),
  ];
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="watch-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function freshnessCaption(freshness: Freshness) {
  if (freshness.asOf === null) return "EVENTS UNAVAILABLE";
  const base = formatAsOf(freshness.asOf);
  if (freshness.kind === "degraded") return `DEGRADED — ${base}`;
  return base;
}
