"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { useLoanBook } from "@/hooks/useLoanBook";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";
import { formatBpsPct, loanOutstanding } from "@/lib/lending-math";
import { canCloseLoan, isSeriesMatchedStream } from "@/lib/modal-logic";
import {
  loanCardState,
  marketBorrowTeaserBps,
  obligationPct,
  selectForMarket,
  selectLiquidityForLender,
  streamedPct,
} from "@/lib/positions";
import type { ActiveAction, HeldStream, Loan, LoanPool, MarketInfo } from "@/lib/types";
import { TruncationNotice } from "./TruncationNotice";

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
  const loanBook = useLoanBook(market.lending, user);
  const streams = useHeldStreams(user);
  const nowSeconds = useNowSeconds(true);

  const normalizedUser = user?.toLowerCase();
  const userLiquidity = selectLiquidityForLender(liquidity.liquidity, market.market, normalizedUser);
  const userPools = selectForMarket(loanBook.pools, market.market);
  const userLoans = selectForMarket(loanBook.loans, market.market);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const isLoading = liquidity.isLoading || loanBook.isLoading || streams.isLoading;

  // liquidity + loanBook are plain on-chain reads; streams comes from the
  // Ponder indexer (lib/ponder.ts) and can error independently — each source
  // degrades on its own so an indexer hiccup can't hide on-chain positions
  // (e.g. a just-created LIQUIDITY position) behind a blanket error message.
  const onChainError = Boolean(liquidity.error || loanBook.error);
  const streamsError = Boolean(streams.error);

  if (isLoading) {
    return <div className="empty mono">LOADING</div>;
  }

  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  // Borrow teaser: priced at the best liquid tick, excluding the user's own
  // supply (they can never borrow against it).
  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;
  const teaserBps = marketBorrowTeaserBps({
    liquidity: liquidity.liquidity,
    market: market.market,
    aprMinBps: lending.params.aprMinBps,
    aprMaxBps: lending.params.aprMaxBps,
    feeBps: lending.params.feeBps,
    ttmSeconds,
    matured,
    self: user,
  });

  // R26: enumeration hooks scan the OLDEST 500 ids; degrade visibly, never silently.
  const tooLarge = liquidity.tooLarge || loanBook.tooLarge;
  const allEnumeratedEmpty =
    liquidity.tooLarge && liquidity.liquidity.every((position) => position.availableLiquidity === 0n);
  const truncationDetail = allEnumeratedEmpty
    ? "ACTIVE LIQUIDITY MAY EXIST BEYOND SCAN RANGE"
    : undefined;

  // Each group only reports positions when its own source is error-free —
  // an indexer error must not read as "no positions" any more than it should
  // read as "no on-chain positions either."
  const hasLending = !onChainError && (userLiquidity.length > 0 || userPools.length > 0);
  const hasBorrowing = !onChainError && userLoans.length > 0;
  const hasStreams = !streamsError && eligibleStreams.length > 0;

  if (!onChainError && !streamsError && !hasLending && !hasBorrowing && !hasStreams) {
    return null;
  }

  return (
    <div className="position-list">
      {!onChainError && tooLarge ? <TruncationNotice limit={500} noun="IDS" detail={truncationDetail} /> : null}
      {onChainError ? (
        <div className="position-group">
          <div className="empty mono status-negative">UNABLE TO LOAD LENDING POSITIONS</div>
        </div>
      ) : (
        <>
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
        </>
      )}

      {streamsError ? (
        <div className="position-group">
          <div className="label mono">STREAMS</div>
          <div className="empty mono status-negative">UNABLE TO LOAD STREAMS</div>
        </div>
      ) : hasStreams ? (
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
            {/* Distinct accessible name from the market-row-detail's own
                "BORROW" button (MarketRowDetail.tsx) — both can be on screen
                at once (this card renders once a stream is eligible,
                independent of whether any liquidity has been posted yet),
                and an identical name on two buttons is ambiguous for
                assistive tech and test locators alike. */}
            <button className="button button-cyan mono" type="button" disabled>
              BORROW STREAM {formatId(stream.streamId)}
            </button>
            <span className="label mono">NO LIQUIDITY</span>
          </span>
        )}
      </div>
    </div>
  );
}
