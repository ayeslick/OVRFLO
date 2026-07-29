"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { useLoanBook } from "@/hooks/useLoanBook";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { formatTokenAmount } from "@/lib/format";
import { isLoanOpen } from "@/lib/lending-math";
import { selectForMarket, selectLiquidityForLender } from "@/lib/positions";
import type { MarketInfo } from "@/lib/types";
import { ClaimAllModal, type ClaimAllPool, type ClaimAllStream } from "./ClaimAllModal";

type Props = {
  markets: MarketInfo[];
  user?: Address;
  symbols: SymbolMap;
};

export type MarketAggregate = {
  underlyingSymbol: string;
  ovrfloSymbol: string;
  supplied: bigint;
  suppliedCount: number;
  openLoanCount: number;
  loanSatisfied: bigint;
  loanObligation: bigint;
  pools: ClaimAllPool[];
  status: "loading" | "error" | "ready";
};

// R1 summary strip: four aggregate cells, amounts grouped per token symbol —
// never summed across different tokens, no USD. Renders only when connected
// with at least one position (R4). Its single action is CLAIM ALL (R2).
//
// R31/L-8 — the no-USD choice is a deliberate deviation, recorded rather than
// left implicit. ETHSKILLS /frontend-ux Rule 4 asks for dollar context wherever
// amounts matter, and this app shows none. A price feed is a third-party
// runtime dependency whose staleness is its own hazard: a wrong USD figure next
// to a correct token amount is worse than no USD figure, and every number here
// is already denominated in the asset the user actually holds and acts on. The
// dead CoinGecko CSP origin and NEXT_PUBLIC_PRICE_API_URL that implied a
// half-built price path have been removed rather than left as a placeholder.
export function PositionSummary({ markets, user, symbols }: Props) {
  const streams = useHeldStreams(user);
  const [aggregates, setAggregates] = useState<Record<string, MarketAggregate>>({});
  const [claimAllOpen, setClaimAllOpen] = useState(false);

  const onData = useCallback((key: string, data: MarketAggregate | null) => {
    setAggregates((current) => {
      if (data === null) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: data };
    });
  }, []);

  const lendingMarkets = useMemo(
    () => markets.filter((m): m is MarketInfo & { lending: Address } => m.lending !== null),
    [markets],
  );

  // Per-symbol reductions (R33: a symbol renders "—" until every market
  // reporting under it is ready; one market's error never blocks another's).
  const rows = Object.values(aggregates);
  const suppliedBySymbol = new Map<string, { total: bigint; count: number; settled: boolean }>();
  const claimableBySymbol = new Map<string, { total: bigint; settled: boolean }>();
  let openLoanCount = 0;
  let loanSatisfied = 0n;
  let loanObligation = 0n;
  let loansSettled = true;
  for (const row of rows) {
    const supplied = suppliedBySymbol.get(row.underlyingSymbol) ?? { total: 0n, count: 0, settled: true };
    const claimable = claimableBySymbol.get(row.ovrfloSymbol) ?? { total: 0n, settled: true };
    if (row.status === "ready") {
      supplied.total += row.supplied;
      supplied.count += row.suppliedCount;
      claimable.total += row.pools.reduce((acc, pool) => acc + pool.claimable, 0n);
      openLoanCount += row.openLoanCount;
      loanSatisfied += row.loanSatisfied;
      loanObligation += row.loanObligation;
    } else {
      supplied.settled = false;
      claimable.settled = false;
      loansSettled = false;
    }
    suppliedBySymbol.set(row.underlyingSymbol, supplied);
    claimableBySymbol.set(row.ovrfloSymbol, claimable);
  }

  // Streams aggregate per asset symbol (the asset is the market's ovrfloToken).
  const streamsBySymbol = new Map<string, { count: number; remaining: bigint; withdrawable: bigint }>();
  for (const stream of streams.streams) {
    const symbol = symbolFor(symbols, stream.asset);
    const entry = streamsBySymbol.get(symbol) ?? { count: 0, remaining: 0n, withdrawable: 0n };
    entry.count += 1;
    entry.remaining += stream.deposited - stream.withdrawn;
    entry.withdrawable += stream.withdrawable;
    streamsBySymbol.set(symbol, entry);
  }

  const claimAllPools: ClaimAllPool[] = rows.filter((r) => r.status === "ready").flatMap((r) => r.pools);
  const claimAllStreams: ClaimAllStream[] = streams.streams
    .filter((stream) => stream.withdrawable > 0n)
    .map((stream) => ({ streamId: stream.streamId, withdrawable: stream.withdrawable, asset: stream.asset }));

  const totalClaimable =
    claimAllPools.reduce((acc, pool) => acc + pool.claimable, 0n) +
    claimAllStreams.reduce((acc, stream) => acc + stream.withdrawable, 0n);

  const hasPositions =
    streams.streams.length > 0 ||
    rows.some((r) => r.status !== "ready") ||
    rows.some((r) => r.suppliedCount > 0 || r.openLoanCount > 0 || r.pools.length > 0);

  return (
    <>
      {lendingMarkets.map((market) => (
        <PositionSummaryMarket
          key={`${market.lending}-${market.market}`}
          market={market}
          user={user}
          symbols={symbols}
          onData={onData}
        />
      ))}
      {user && hasPositions ? (
        <section className="section summary-strip" aria-label="Your positions">
          <div className="label mono">YOUR POSITIONS</div>
          <div className="summary-strip-cells">
            <div className="summary-cell">
              <div className="label mono">STREAMS</div>
              {streamsBySymbol.size === 0 ? (
                <div className="mono">—</div>
              ) : (
                [...streamsBySymbol.entries()].map(([symbol, entry]) => (
                  <div className="mono" key={symbol}>
                    {entry.count} · {formatTokenAmount(entry.remaining, symbol)}
                  </div>
                ))
              )}
            </div>
            <div className="summary-cell">
              <div className="label mono">SUPPLIED</div>
              {suppliedBySymbol.size === 0 ? (
                <div className="mono">—</div>
              ) : (
                [...suppliedBySymbol.entries()].map(([symbol, entry]) => (
                  <div className="mono" key={symbol}>
                    {entry.settled ? `${entry.count} · ${formatTokenAmount(entry.total, symbol)}` : "—"}
                  </div>
                ))
              )}
            </div>
            <div className="summary-cell">
              <div className="label mono">LOANS</div>
              <div className="mono">
                {!loansSettled
                  ? "—"
                  : openLoanCount === 0
                    ? "—"
                    : `${openLoanCount} REPAYING · ${((loanSatisfied * 100n) / (loanObligation === 0n ? 1n : loanObligation)).toString()}%`}
              </div>
            </div>
            <div className="summary-cell">
              <div className="label mono">CLAIMABLE</div>
              {claimableBySymbol.size === 0 && streamsBySymbol.size === 0 ? (
                <div className="mono">—</div>
              ) : (
                [...new Set([...claimableBySymbol.keys(), ...streamsBySymbol.keys()])].map((symbol) => {
                  const pools = claimableBySymbol.get(symbol);
                  const streamEntry = streamsBySymbol.get(symbol);
                  if (pools && !pools.settled) return <div className="mono" key={symbol}>—</div>;
                  const total = (pools?.total ?? 0n) + (streamEntry?.withdrawable ?? 0n);
                  return (
                    <div className="mono" key={symbol}>
                      {formatTokenAmount(total, symbol)}
                    </div>
                  );
                })
              )}
            </div>
            <div className="summary-cell action-with-caption">
              <button
                className="button button-gold mono"
                type="button"
                disabled={totalClaimable === 0n}
                onClick={() => setClaimAllOpen(true)}
              >
                CLAIM ALL
              </button>
              {totalClaimable === 0n ? <span className="label mono">NOTHING CLAIMABLE YET</span> : null}
            </div>
          </div>
        </section>
      ) : null}
      {claimAllOpen && user ? (
        <ClaimAllModal
          pools={claimAllPools}
          streams={claimAllStreams}
          user={user}
          onClose={() => setClaimAllOpen(false)}
        />
      ) : null}
    </>
  );
}

// Reports one lending market's aggregate upward; renders nothing itself.
// Hooks stay unconditional by mounting one child per market.
function PositionSummaryMarket({
  market,
  user,
  symbols,
  onData,
}: {
  market: MarketInfo & { lending: Address };
  user?: Address;
  symbols: SymbolMap;
  onData: (key: string, data: MarketAggregate | null) => void;
}) {
  const liquidity = useLendingLiquidity(market.lending);
  const book = useLoanBook(market.lending, user);

  const key = `${market.lending}-${market.market}`;
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);
  const normalizedUser = user?.toLowerCase();

  const isLoading = liquidity.isLoading || book.isLoading;
  const hasError = Boolean(liquidity.error || book.error);

  const aggregate = useMemo<MarketAggregate>(() => {
    if (isLoading || hasError) {
      return {
        underlyingSymbol,
        ovrfloSymbol,
        supplied: 0n,
        suppliedCount: 0,
        openLoanCount: 0,
        loanSatisfied: 0n,
        loanObligation: 0n,
        pools: [],
        status: isLoading ? "loading" : "error",
      };
    }
    const userLiquidity = selectLiquidityForLender(liquidity.liquidity, market.market, normalizedUser);
    const marketPools = selectForMarket(book.pools, market.market);
    const openLoans = selectForMarket(book.loans, market.market).filter(({ loan }) => isLoanOpen(loan));
    return {
      underlyingSymbol,
      ovrfloSymbol,
      supplied: userLiquidity.reduce((acc, position) => acc + position.availableLiquidity, 0n),
      suppliedCount: userLiquidity.length + marketPools.length,
      openLoanCount: openLoans.length,
      loanSatisfied: openLoans.reduce((acc, { loan }) => acc + loan.drawn + loan.repaid, 0n),
      loanObligation: openLoans.reduce((acc, { loan }) => acc + loan.obligation, 0n),
      pools: marketPools
        .filter(({ claimable }) => claimable > 0n)
        // Pool shares pay out in the market's ovrfloToken (OVRFLOLending._claimFair).
        .map(({ pool, claimable }) => ({
          lending: market.lending,
          loanId: pool.id,
          claimable,
          asset: market.ovrfloToken,
        })),
      status: "ready",
    };
  }, [
    book.loans,
    book.pools,
    hasError,
    isLoading,
    liquidity.liquidity,
    market.lending,
    market.market,
    market.ovrfloToken,
    normalizedUser,
    ovrfloSymbol,
    underlyingSymbol,
  ]);

  useEffect(() => {
    onData(key, aggregate);
    return () => onData(key, null);
  }, [aggregate, key, onData]);

  return null;
}
