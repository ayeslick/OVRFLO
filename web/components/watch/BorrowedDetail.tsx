"use client";

import { useState } from "react";
import type { Address } from "viem";
import { ActionButton } from "@/components/kit/ActionButton";
import { Amount } from "@/components/kit/Amount";
import { Ribbon } from "@/components/kit/Ribbon";
import { RollingNumber } from "@/components/kit/RollingNumber";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import { formatCoverDate, formatTruncatedDecimal } from "@/lib/format";
import type { Freshness } from "@/lib/freshness";
import type { StreamSchedule } from "@/lib/payoff";
import type { MarketInfo } from "@/lib/types";
import {
  borrowedRowState,
  displayedOutstanding,
  fraction01,
  loanCoverAt,
  loanOutstanding,
} from "@/lib/watch-rows";
import { freshnessCaption } from "./SuppliedDetail";
import { WatchWrite } from "./WatchWrite";
import "./watch.css";

export function BorrowedDetail({
  loan,
  symbol,
  market,
  lending,
  nowSeconds,
  nowMs,
  lastReadAt,
  schedule,
  withdrawable,
  freshness,
  signingAllowed,
  usdMode,
  usdAvailable,
  usdText,
  onSelectStream,
}: {
  loan: BorrowerLoanRow;
  symbol: string;
  market: MarketInfo | null;
  lending: Address | null;
  nowSeconds: bigint;
  nowMs: number;
  lastReadAt: bigint;
  schedule?: StreamSchedule;
  withdrawable?: bigint;
  freshness: Freshness;
  signingAllowed: boolean;
  usdMode: "token" | "usd";
  usdAvailable: boolean;
  usdText?: string;
  onSelectStream: (streamId: bigint) => void;
}) {
  const [write, setWrite] = useState<"repay" | "close" | null>(null);
  const state = borrowedRowState({ loan, withdrawable });
  const closeReady = state === "close-ready";
  const outstanding = displayedOutstanding({
    schedule,
    lastOutstanding: loan.outstanding,
    lastReadAt,
    now: nowSeconds,
    closeReady,
  });
  const coverAt = loanCoverAt(schedule, loanOutstanding(loan), nowSeconds);
  const stale = !signingAllowed;
  const startMs = schedule ? Number(schedule.start) * 1000 : 0;
  const endMs = coverAt ? Number(coverAt) * 1000 : schedule ? Number(schedule.end) * 1000 : nowMs;
  const ribbonState = stale ? "degraded" : closeReady ? "recorded" : "edge";
  const ratePerDay =
    schedule && schedule.end > schedule.start
      ? (schedule.deposited * 86_400n) / (schedule.end - schedule.start)
      : 0n;

  return (
    <article data-region="borrowed-detail" data-state={state}>
      <div className="kit-hero">
        <span className="kit-hero-kicker">OUTSTANDING</span>
        <RollingNumber
          value={outstanding}
          schedule={
            schedule && !closeReady
              ? {
                  startMs: Number(lastReadAt) * 1000,
                  endMs,
                  startAmount: loan.outstanding,
                  endAmount: 0n,
                }
              : undefined
          }
          ticking={!closeReady}
          nowMs={nowMs}
          displayDecimals={8}
        />
        {usdMode === "usd" ? (
          <Amount
            token={formatTruncatedDecimal(outstanding, 18, 8)}
            symbol={symbol}
            usd={usdText}
            usdAvailable={usdAvailable}
            mode="usd"
          />
        ) : (
          <span className="watch-hero-meta">
            {symbol}
            {coverAt ? ` · ${formatCoverDate(coverAt).toUpperCase()}` : ""}
            {ratePerDay > 0n ? ` · −${formatTruncatedDecimal(ratePerDay, 18, 5)} / DAY` : ""}
          </span>
        )}
      </div>

      {write && lending && market ? (
        <WatchWrite
          kind={write}
          lending={lending}
          market={market}
          loanId={loan.id}
          outstanding={loan.outstanding}
          withdrawable={withdrawable}
          symbol={symbol}
          signingAllowed={signingAllowed}
          onClose={() => setWrite(null)}
        />
      ) : (
        <div className="watch-actions">
          {loan.outstanding > 0n ? (
            stale ? (
              <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
                REPAY
              </ActionButton>
            ) : (
              <ActionButton onClick={() => setWrite("repay")}>REPAY</ActionButton>
            )
          ) : null}
          {closeReady ? (
            stale ? (
              <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
                CLOSE FROM STREAM
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={() => setWrite("close")}>
                CLOSE FROM STREAM
              </ActionButton>
            )
          ) : null}
        </div>
      )}

      <Ribbon
        state={ribbonState}
        startMs={startMs}
        endMs={endMs}
        nowMs={nowMs}
        progress={closeReady ? 1 : fraction01(loan.drawn + loan.repaid, loan.obligation)}
        valueText={`${formatTruncatedDecimal(outstanding, 18, 8)} ${symbol} outstanding`}
        originLabel="OPENED"
        terminalLabel={coverAt ? formatCoverDate(coverAt).toUpperCase() : "TERMINAL"}
      />

      <dl className="watch-facts">
        <Fact label="NET PROCEEDS" value={`${formatTruncatedDecimal(loan.drawn, 18, 5)} ${symbol}`} />
        <Fact label="OBLIGATION" value={`${formatTruncatedDecimal(loan.obligation, 18, 5)} ${symbol}`} />
        <Fact label="RECOVERED" value={`${formatTruncatedDecimal(loan.drawn + loan.repaid, 18, 5)} ${symbol}`} />
        <Fact label="OUTSTANDING" value={`${formatTruncatedDecimal(outstanding, 18, 5)} ${symbol}`} />
        <Fact label="PLEDGED STREAM" value={`#${loan.streamId.toString()}`} />
        {coverAt ? <Fact label="DONE DATE" value={formatCoverDate(coverAt).toUpperCase()} /> : null}
      </dl>
      <p className="watch-freshness">{freshnessCaption(freshness)}</p>
      <button type="button" className="watch-back" onClick={() => onSelectStream(loan.streamId)}>
        STREAM #{loan.streamId.toString()}
      </button>
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
