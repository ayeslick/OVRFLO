"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLenderPools } from "@/hooks/useLenderPools";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";
import { aprChoices, formatBpsPct, loanOutstanding } from "@/lib/lending-math";
import { canCloseLoan, isSeriesMatchedStream } from "@/lib/modal-logic";
import { borrowTeaserBps, loanCardState, obligationPct, streamedPct } from "@/lib/positions";
import { buildLadder } from "@/lib/router";
import type { ActiveAction, HeldStream, Loan, LoanPool, MarketInfo } from "@/lib/types";

type Props = {
  market: MarketInfo;
  user?: Address;
  symbols: SymbolMap;
  onAction: (action: ActiveAction) => void;
};

// Fill color follows DESIGN.md §6: gold for the lend/claim side (streams),
// cyan for the borrow side (loan repayment).
function ProgressBar({ pct, label, tone }: { pct: number; label: string; tone: "gold" | "cyan" }) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={tone === "cyan" ? "progress-fill progress-fill-cyan" : "progress-fill"} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PositionList({ market, user, symbols, onAction }: Props) {
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const lenderPools = useLenderPools(market.lending, user);
  const borrowerLoans = useBorrowerLoans(market.lending, user);
  const streams = useHeldStreams(user);
  const nowSeconds = useNowSeconds();

  const normalizedUser = user?.toLowerCase();
  const userLiquidity = liquidity.liquidity.filter(
    (position) =>
      position.market.toLowerCase() === market.market.toLowerCase() &&
      Boolean(normalizedUser) &&
      position.lender.toLowerCase() === normalizedUser,
  );
  const userPools = lenderPools.pools.filter(
    ({ pool }) => pool.market.toLowerCase() === market.market.toLowerCase(),
  );
  const userLoans = borrowerLoans.loans.filter(
    ({ pool }) => pool.market.toLowerCase() === market.market.toLowerCase(),
  );
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const isLoading =
    liquidity.isLoading || lenderPools.isLoading || borrowerLoans.isLoading || streams.isLoading;
  const hasError =
    liquidity.error || lenderPools.error || borrowerLoans.error || streams.error;

  if (isLoading) {
    return <div className="empty mono">LOADING</div>;
  }

  if (hasError) {
    return (
      <div className="empty mono status-negative">
        UNABLE TO LOAD POSITIONS
      </div>
    );
  }

  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  // Borrow teaser: priced at the best liquid tick, excluding the user's own
  // supply (they can never borrow against it).
  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;
  const ticks =
    lending.params.aprMaxBps > 0 ? aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps) : [];
  const ladder = buildLadder(liquidity.liquidity, market.market, ticks, user);
  const teaserBps = matured ? null : borrowTeaserBps(ladder, ttmSeconds, lending.params.feeBps);

  // R26: enumeration hooks scan the OLDEST 500 ids; degrade visibly, never silently.
  const tooLarge = liquidity.tooLarge || lenderPools.tooLarge || borrowerLoans.tooLarge;
  const allEnumeratedEmpty =
    liquidity.tooLarge && liquidity.liquidity.every((position) => position.availableLiquidity === 0n);
  const truncationCopy = allEnumeratedEmpty
    ? "SHOWING FIRST 500 — ACTIVE LIQUIDITY MAY EXIST BEYOND SCAN RANGE"
    : "SHOWING FIRST 500 — DATA TRUNCATED";

  const hasLending = userLiquidity.length > 0 || userPools.length > 0;
  const hasBorrowing = userLoans.length > 0;
  const hasStreams = eligibleStreams.length > 0;

  if (!hasLending && !hasBorrowing && !hasStreams) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {tooLarge ? <div className="label mono">{truncationCopy}</div> : null}
      {hasLending ? (
        <div className="position-group">
          <div className="label mono">LENDING</div>
          <div className="position-cards">
            {userLiquidity.map((position) => (
              <div className="position-card" key={`liquidity-${position.id}`}>
                <div className="card-head mono">
                  <span>LIQUIDITY {formatId(position.id)}</span>
                  <span className="card-badge">EARNING {formatAprBps(position.aprBps)}</span>
                </div>
                <div className="mono">IDLE {formatTokenAmount(position.availableLiquidity, underlyingSymbol)}</div>
                <div className="card-actions">
                  <button
                    className="button button-gold mono"
                    type="button"
                    onClick={() => onAction({ type: "withdraw", positionId: position.id })}
                  >
                    WITHDRAW
                  </button>
                  <button
                    className="button button-gold mono"
                    type="button"
                    disabled={position.availableLiquidity === 0n}
                    onClick={() => onAction({ type: "adjust_rate", positionId: position.id })}
                  >
                    ADJUST RATE
                  </button>
                </div>
              </div>
            ))}
            {userPools.map((pool) => (
              <div className="position-card" key={`pool-${pool.pool.id}`}>
                <div className="card-head mono">
                  <span>POOL {formatId(pool.pool.id)}</span>
                  <span className="card-badge">EARNING {formatAprBps(pool.pool.aprBps)}</span>
                </div>
                <div className="mono">CLAIMABLE {formatTokenAmount(pool.claimable, ovrfloSymbol)}</div>
                {/* Spec edge state: lender-side note on _claimFair deficit
                    harvesting — shown only when there is something to claim. */}
                {pool.claimable > 0n ? (
                  <div className="label mono">SHORTFALLS HARVEST FROM THE LOAN STREAM ON CLAIM</div>
                ) : null}
                <div className="card-actions">
                  <button
                    className="button button-gold mono"
                    type="button"
                    disabled={pool.claimable === 0n}
                    onClick={() => onAction({ type: "claim_share", positionId: pool.pool.id })}
                  >
                    CLAIM SHARE
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasBorrowing ? (
        <div className="position-group">
          <div className="label mono">BORROWING</div>
          <div className="position-cards">
            {userLoans.map(({ loan, pool, withdrawable }) => (
              <LoanCard
                key={`loan-${loan.id}`}
                loan={loan}
                pool={pool}
                withdrawable={withdrawable}
                ovrfloSymbol={ovrfloSymbol}
                onAction={onAction}
              />
            ))}
          </div>
        </div>
      ) : null}

      {hasStreams ? (
        <div className="position-group">
          <div className="label mono">STREAMS</div>
          <div className="position-cards">
            {eligibleStreams.map((stream) => (
              <StreamCard
                key={`stream-${stream.streamId}`}
                stream={stream}
                teaserBps={teaserBps}
                ovrfloSymbol={ovrfloSymbol}
                onAction={onAction}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Three distinct states (ticket 08): actively self-repaying (no primary action,
// repay behind ADVANCED), obligation met but stream still returning (residual),
// and settled (dimmed, badged). CLOSE renders only when it can succeed.
function LoanCard({
  loan,
  pool,
  withdrawable,
  ovrfloSymbol,
  onAction,
}: {
  loan: Loan;
  pool: LoanPool;
  withdrawable: bigint;
  ovrfloSymbol: string;
  onAction: (action: ActiveAction) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const state = loanCardState(loan);
  const outstanding = loanOutstanding(loan);
  const pct = obligationPct(loan);
  const closable = canCloseLoan({ loan, withdrawable });
  const badge =
    state === "repaying" ? "SELF-REPAYING" : state === "residual" ? "RESIDUAL RETURNING" : "SETTLED";

  return (
    <div className={`position-card ${state === "settled" ? "card-dimmed" : ""}`}>
      <div className="card-head mono">
        <span>
          LOAN {formatId(loan.id)} @ {formatAprBps(pool.aprBps)}
        </span>
        <span className="card-badge">{badge}</span>
      </div>
      <ProgressBar pct={pct} label={`Loan ${loan.id} repayment progress`} tone="cyan" />
      <div className="mono">
        {state === "repaying"
          ? `OUTSTANDING ${formatTokenAmount(outstanding, ovrfloSymbol)}`
          : state === "residual"
            ? "OBLIGATION MET — STREAM RESIDUAL RETURNS ON CLOSE"
            : "SETTLED"}
      </div>
      {state !== "settled" ? (
        <div className="card-actions">
          {closable ? (
            <button
              className="button button-cyan mono"
              type="button"
              onClick={() => onAction({ type: "close", loanId: loan.id })}
            >
              CLOSE
            </button>
          ) : null}
          {state === "repaying" ? (
            <>
              <button
                className="advanced-toggle label mono"
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                ADVANCED {advancedOpen ? "▾" : "▸"}
              </button>
              {advancedOpen ? (
                <button
                  className="button button-cyan mono"
                  type="button"
                  onClick={() => onAction({ type: "repay", loanId: loan.id })}
                >
                  REPAY EARLY
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StreamCard({
  stream,
  teaserBps,
  ovrfloSymbol,
  onAction,
}: {
  stream: HeldStream;
  teaserBps: bigint | null;
  ovrfloSymbol: string;
  onAction: (action: ActiveAction) => void;
}) {
  const pct = streamedPct(stream);
  return (
    <div className="position-card">
      <div className="card-head mono">
        <span>STREAM {formatId(stream.streamId)}</span>
        <span className="card-badge">{pct}% STREAMED</span>
      </div>
      <ProgressBar pct={pct} label={`Stream ${stream.streamId} progress`} tone="gold" />
      <div className="mono">CLAIMABLE {formatTokenAmount(stream.withdrawable, ovrfloSymbol)}</div>
      <div className="card-actions">
        <button
          className="button button-gold mono"
          type="button"
          disabled={stream.withdrawable === 0n}
          onClick={() => onAction({ type: "claim_stream", streamId: stream.streamId })}
        >
          CLAIM
        </button>
        {teaserBps !== null ? (
          <button
            className="button button-cyan mono"
            type="button"
            onClick={() => onAction({ type: "borrow", streamId: stream.streamId })}
          >
            BORROW ~{formatBpsPct(teaserBps)} UPFRONT
          </button>
        ) : (
          <span className="action-with-caption">
            <button className="button button-cyan mono" type="button" disabled>
              BORROW
            </button>
            <span className="label mono">NO LIQUIDITY</span>
          </span>
        )}
      </div>
    </div>
  );
}
