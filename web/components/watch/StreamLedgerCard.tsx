"use client";

import { formatMaturityDate, formatTruncatedDecimal } from "@/lib/format";
import {
  LEDGER_BAR_SEGMENTS,
  type LedgerCardSnapshot,
} from "@/lib/ledger-card";
import "./watch.css";

export function StreamLedgerCard({
  streamId,
  symbol,
  endTime,
  snapshot,
}: {
  streamId: bigint;
  symbol: string;
  endTime: bigint;
  snapshot: LedgerCardSnapshot;
}) {
  const cells = Array.from({ length: LEDGER_BAR_SEGMENTS }, (_, index) => {
    const on = index < snapshot.filledSegments;
    const gold =
      snapshot.status === "streaming" && on && index === snapshot.filledSegments - 1;
    return { on, gold };
  });
  const fillWidthPct = (snapshot.filledSegments / LEDGER_BAR_SEGMENTS) * 100;
  const streamedText = `${formatTruncatedDecimal(snapshot.streamed, 18, 3)} ${symbol}`;
  const remainingText = `${formatTruncatedDecimal(snapshot.remainingUnstreamed, 18, 3)} ${symbol}`;
  const rateText =
    snapshot.ratePerDay === 0n
      ? "0 / day"
      : `${formatTruncatedDecimal(snapshot.ratePerDay, 18, 4)} / day`;
  const endText = formatMaturityDate(endTime).toUpperCase();

  return (
    <article
      className="watch-ledger-card"
      data-ui="UI-WATCH-LEDGER-CARD"
      data-status={snapshot.status}
      data-cache-key={snapshot.cacheKey}
      aria-label={`Stream ${streamId.toString()} ${snapshot.statusLabel} card`}
    >
      <div className="watch-ledger-head">
        <span>OVRFLO Streams</span>
        <span>ID {streamId.toString()}</span>
      </div>
      <div className={`watch-ledger-status is-${snapshot.status}`}>{snapshot.statusLabel}</div>
      <div className="watch-ledger-bar-meta">
        <span>Progress</span>
        <span className="watch-ledger-pct">{snapshot.percentLabel}</span>
      </div>
      <div
        className={snapshot.bandLive ? "watch-ledger-bar is-live" : "watch-ledger-bar"}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(snapshot.percent)}
        aria-valuetext={`${streamedText} streamed, ${remainingText} remaining`}
      >
        {snapshot.bandLive ? (
          <span
            className="watch-ledger-bar-flow"
            aria-hidden="true"
            style={{ width: `${fillWidthPct}%` }}
          />
        ) : null}
        {cells.map((cell, index) => (
          <span
            key={index}
            className={
              cell.gold ? "watch-ledger-cell on gold" : cell.on ? "watch-ledger-cell on" : "watch-ledger-cell"
            }
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="watch-ledger-rows">
        <LedgerRow label="Streamed" value={streamedText} />
        <LedgerRow label="Remaining" value={remainingText} />
        <LedgerRow label="Rate" value={rateText} />
        {snapshot.status === "depleted" ? (
          <LedgerRow
            label="Withdrawn"
            value={`${formatTruncatedDecimal(snapshot.withdrawn, 18, 3)} ${symbol}`}
          />
        ) : (
          <LedgerRow label="Days left" value={String(snapshot.daysLeft)} />
        )}
        <LedgerRow label="End" value={endText} />
        <LedgerRow label="Asset" value={symbol} />
      </div>
      <div className="watch-ledger-foot">
        <span>OVRFLO Stream</span>
        <span>Linear lockup</span>
      </div>
    </article>
  );
}

function LedgerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="watch-ledger-row">
      <span className="watch-ledger-lbl">{label}</span>
      <span className="watch-ledger-val">{value}</span>
    </div>
  );
}
