"use client";

import { Fragment } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { useNowSecondsHydrationSafe } from "@/hooks/useNowSeconds";
import { ovrfloAbi } from "@/lib/abis";
import { formatAprBps, formatCountdown, formatMaturityDate, formatTokenAmount } from "@/lib/format";
import { aprChoices, formatBpsPct, upfrontBps } from "@/lib/lending-math";
import { buildLadder } from "@/lib/router";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { MarketRowDetail } from "./MarketRowDetail";

type Props = {
  markets: MarketInfo[];
  symbols: SymbolMap;
  user?: Address;
  selected?: MarketInfo | null;
  onSelect: (market: MarketInfo | null) => void;
  onMode: (market: MarketInfo, action: ActiveAction) => void;
};


export function MarketsTable({ markets, symbols, user, selected, onSelect, onMode }: Props) {
  const nowSeconds = useNowSecondsHydrationSafe();

  const tvlReads = useReadContracts({
    contracts: markets.map((market) => ({
      address: market.vault,
      abi: ovrfloAbi,
      functionName: "marketTotalDeposited" as const,
      args: [market.market] as const,
    })),
    query: { enabled: markets.length > 0 },
  });

  return (
    <section className="section">
      <div style={{ marginBottom: "0.75rem" }}>
        <h2>MARKETS</h2>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Maturity</th>
              <th>TVL</th>
              <th>Rates</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td className="empty mono" colSpan={4}>
                  NO APPROVED MARKETS
                </td>
              </tr>
            ) : (
              markets.map((market, index) => {
                const symbol = symbolFor(symbols, market.ovrfloToken);
                const expanded = selected?.market === market.market;
                const tvlResult = tvlReads.data?.[index];
                const tvl = tvlResult?.status === "success" ? (tvlResult.result as bigint) : undefined;
                const secondsLeft =
                  nowSeconds !== null && market.expiryCached > nowSeconds ? market.expiryCached - nowSeconds : 0n;
                return (
                  <Fragment key={`${market.vault}-${market.market}`}>
                    {/* aria-expanded lives on the toggle button only — the
                        `row` role does not permit it outside a treegrid. */}
                    <tr
                      className={expanded ? "row-expanded" : undefined}
                      onClick={() => onSelect(expanded ? null : market)}
                    >
                      <td>
                        <button type="button" className="row-toggle mono" aria-expanded={expanded}>
                          {expanded ? "▾" : "▸"} {symbol}
                        </button>
                      </td>
                      <td className="mono">
                        {formatMaturityDate(market.expiryCached)}
                        {/* Time-to-maturity drives the borrow/deposit decision
                            here, so DESIGN.md §10's countdown form applies —
                            days alone hid up to 23 hours of remaining term. */}
                        <span className="label mono"> {formatCountdown(secondsLeft)}</span>
                      </td>
                      <td className="mono">{formatTokenAmount(tvl, symbolFor(symbols, market.underlying))}</td>
                      <td className="mono">
                        <RatesCell market={market} nowSeconds={nowSeconds} />
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="market-row-detail">
                        <td colSpan={4} onClick={(e) => e.stopPropagation()}>
                          <div role="region" aria-label={`${symbol} market detail`}>
                            <MarketRowDetail
                              market={market}
                              user={user}
                              symbols={symbols}
                              onMode={(action) => onMode(market, action)}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// R5 RATES: the market's live tick range in both lenses ("10.00%–12.00% APR · 90.2%–94.3% ↑"),
// pure math over enumerated liquidity — zero extra reads beyond the hooks' own.
function RatesCell({ market, nowSeconds }: { market: MarketInfo; nowSeconds: bigint | null }) {
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);

  if (!market.lending || nowSeconds === null) return <>—</>;
  const ticks = aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps);
  const liquid = buildLadder(liquidity.liquidity, market.market, ticks).filter((tick) => tick.total > 0n);
  if (liquid.length === 0) return <>—</>;

  const ttm = market.expiryCached > nowSeconds ? market.expiryCached - nowSeconds : 0n;
  const minTick = liquid[0].aprBps;
  const maxTick = liquid[liquid.length - 1].aprBps;
  const upAtMax = upfrontBps(maxTick, ttm, lending.params.feeBps);
  const upAtMin = upfrontBps(minTick, ttm, lending.params.feeBps);
  const apr = minTick === maxTick ? formatAprBps(minTick) : `${formatAprBps(minTick)}–${formatAprBps(maxTick)}`;
  const upfront = minTick === maxTick ? formatBpsPct(upAtMin) : `${formatBpsPct(upAtMax)}–${formatBpsPct(upAtMin)}`;
  return (
    <>
      {apr} APR · {upfront} ↑
    </>
  );
}
