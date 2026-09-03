"use client";

import { ActionButton } from "@/components/kit/ActionButton";
import { Amount } from "@/components/kit/Amount";
import { Ribbon } from "@/components/kit/Ribbon";
import { RollingNumber } from "@/components/kit/RollingNumber";
import type { HydratedStream } from "@/hooks/useStreams";
import { formatMaturityDate, formatTruncatedDecimal } from "@/lib/format";
import type { Freshness } from "@/lib/freshness";
import { buildLedgerCardSnapshot } from "@/lib/ledger-card";
import { interpolateStreamed } from "@/lib/payoff";
import { streamRowState } from "@/lib/watch-rows";
import { SurfaceHeading } from "@/components/kit/SurfaceHeading";
import { StreamLedgerCard } from "./StreamLedgerCard";
import { freshnessCaption } from "./SuppliedDetail";
import "./watch.css";

export function StreamDetail({
  stream,
  symbol,
  pledgedLoanId,
  nowSeconds,
  nowMs,
  lastReadAt,
  freshness,
  signingAllowed,
  usdMode,
  usdAvailable,
  usdText,
  onSelectLoan,
}: {
  stream: HydratedStream;
  symbol: string;
  pledgedLoanId?: bigint;
  nowSeconds: bigint;
  nowMs: number;
  /** Last successful hydration time — card bar snapshot only (R14). */
  lastReadAt: bigint;
  freshness: Freshness;
  signingAllowed: boolean;
  usdMode: "token" | "usd";
  usdAvailable: boolean;
  usdText?: string;
  onSelectLoan: (loanId: bigint) => void;
}) {
  const pledged = pledgedLoanId !== undefined;
  const state = streamRowState(stream, pledged);
  const vested = interpolateStreamed(stream.schedule, nowSeconds);
  const remaining = stream.remaining;
  const stale = !signingAllowed;
  const startMs = Number(stream.schedule.start) * 1000;
  const endMs = Number(stream.schedule.end) * 1000;
  const snapshot = buildLedgerCardSnapshot({
    streamId: stream.streamId,
    statusCode: stream.status,
    schedule: stream.schedule,
    asOf: lastReadAt,
  });

  return (
    <article
      data-ui="UI-WATCH-STREAM-DETAIL"
      data-region="stream-detail"
      data-state={state}
      aria-label={`Stream ${stream.streamId.toString()} ${snapshot.statusLabel}`}
    >
      <SurfaceHeading>Stream</SurfaceHeading>
      <div className="kit-hero">
        <span className="kit-hero-kicker">VESTED</span>
        <RollingNumber
          schedule={{
            startMs,
            endMs,
            startAmount: 0n,
            endAmount: stream.schedule.deposited - stream.schedule.refunded,
          }}
          ticking
          nowMs={nowMs}
          displayDecimals={8}
        />
        {usdMode === "usd" ? (
          <Amount
            token={formatTruncatedDecimal(vested, 18, 8)}
            symbol={symbol}
            usd={usdText}
            usdAvailable={usdAvailable}
            mode="usd"
          />
        ) : (
          <span className="watch-hero-meta">{symbol}</span>
        )}
      </div>

      <div className="watch-actions">
        {state === "eligible" ? (
          stale ? (
            <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
              BORROW AGAINST THIS STREAM
            </ActionButton>
          ) : (
            <ActionButton
              onClick={() => {
                window.location.assign(`/borrow/?stream=${stream.streamId.toString()}`);
              }}
            >
              BORROW AGAINST THIS STREAM
            </ActionButton>
          )
        ) : null}
        {pledged && pledgedLoanId !== undefined ? (
          <ActionButton onClick={() => onSelectLoan(pledgedLoanId)}>
            {`LOAN #${pledgedLoanId.toString()}`}
          </ActionButton>
        ) : null}
      </div>

      <StreamLedgerCard
        key={snapshot.cacheKey}
        streamId={stream.streamId}
        symbol={symbol}
        endTime={stream.schedule.end}
        snapshot={snapshot}
      />

      <Ribbon
        state={stale ? "degraded" : "edge"}
        startMs={startMs}
        endMs={endMs}
        nowMs={nowMs}
        valueText={`${formatTruncatedDecimal(vested, 18, 8)} ${symbol} vested`}
        originLabel="START"
        terminalLabel={formatMaturityDate(stream.schedule.end).toUpperCase()}
      />

      <dl className="watch-facts">
        <Fact label="RELEASED" value={`${formatTruncatedDecimal(vested, 18, 5)} ${symbol}`} />
        <Fact label="REMAINING" value={`${formatTruncatedDecimal(remaining, 18, 5)} ${symbol}`} />
        <Fact label="MATURITY" value={formatMaturityDate(stream.schedule.end).toUpperCase()} />
        <Fact label="TRANSFERABLE" value={pledged ? "NO — PLEDGED" : "YES"} />
        <Fact label="PLEDGED" value={pledged ? "YES" : "NO"} />
      </dl>
      <p className="watch-freshness">{freshnessCaption(freshness)}</p>
    </article>
  );
}

export function StreamClosedDetail({ streamId }: { streamId: bigint }) {
  return (
    <article
      data-ui="UI-WATCH-STREAM-DETAIL"
      data-region="stream-detail"
      data-state="closed"
      aria-label={`Stream ${streamId.toString()} closed`}
    >
      <SurfaceHeading>Stream</SurfaceHeading>
      <p className="watch-kicker">STREAM CLOSED</p>
      <p className="watch-degraded">
        Stream #{streamId.toString()} is no longer held. The NFT was burned or left this wallet.
      </p>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="watch-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
