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
import { TruncationNotice } from "./TruncationNotice";

type Props = {
  markets: MarketInfo[];
  truncated?: boolean;
  isLoading?: boolean;
  error?: Error | null;
  symbols: SymbolMap;
  user?: Address;
  selected?: MarketInfo | null;
  onSelect: (market: MarketInfo | null) => void;
  onMode: (market: MarketInfo, action: ActiveAction) => void;
};


export function MarketsTable({
  markets,
  truncated,
  isLoading,
  error,
  symbols,
  user,
  selected,
  onSelect,
  onMode,
}: Props) {
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
      <div className="section-heading">
        <h2>SELF-REPAYING MARKETS</h2>
        <p>Supply liquidity or borrow against a deterministic stream.</p>
      </div>
      {/* L-2: the vault list caps at 100 and said nothing — markets past the
          hundredth simply vanished. Same disclosure component the 500-id scans
          use, so every truncated list reads the same way. The cap applies twice
          over (vaults, then each vault's markets), so the noun names what the
          reader is looking at rather than which of the two caps was hit. */}
      {truncated ? <TruncationNotice limit={100} noun="VAULTS AND MARKETS PER VAULT" /> : null}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Maturity</th>
              <th>TVL</th>
              <th>Lend / Borrow</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td className="empty mono" colSpan={4}>
                  {isLoading
                    ? "LOADING MARKETS"
                    : error
                      ? "UNABLE TO LOAD MARKETS — REFRESH"
                      : "NO APPROVED MARKETS"}
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
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {/* R23/M-11: the expanded detail used to be a <tr> inside this table, so
          it inherited `table { min-width: 760px }` and every position card,
          balance row, and action button sat in a 760px layout box — overflowing
          horizontally on mobile, against DESIGN.md §5's "cards render at every
          breakpoint, not a reflow". Rendering it as a sibling below the table
          detaches it from that floor entirely. Clipping the overflow would have
          hidden the symptom while leaving cards unreadable. */}
      {selected ? (
        <div
          className="market-row-detail"
          role="region"
          aria-label={`${symbolFor(symbols, selected.ovrfloToken)} market detail`}
        >
          <div className="market-detail-heading">
            <h3>{symbolFor(symbols, selected.ovrfloToken)}</h3>
            <span className="label mono">Matures {formatMaturityDate(selected.expiryCached)}</span>
          </div>
          <MarketRowDetail
            market={selected}
            user={user}
            symbols={symbols}
            onMode={(action) => onMode(selected, action)}
          />
        </div>
      ) : null}
    </section>
  );
}

// The live tick range in both explicitly named lenses, computed over enumerated
// liquidity with zero additional reads.
function RatesCell({ market, nowSeconds }: { market: MarketInfo; nowSeconds: bigint | null }) {
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);

  if (!market.lending) return <span className="label">UNAVAILABLE</span>;
  if (nowSeconds === null || lending.isLoading || liquidity.isLoading) {
    return <span className="label">LOADING</span>;
  }
  if (lending.error || liquidity.error) return <span className="label">UNAVAILABLE</span>;
  const ticks = aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps);
  const liquid = buildLadder(liquidity.liquidity, market.market, ticks).filter((tick) => tick.total > 0n);
  if (liquid.length === 0) return <span className="label">NO LIQUIDITY</span>;

  const ttm = market.expiryCached > nowSeconds ? market.expiryCached - nowSeconds : 0n;
  const minTick = liquid[0].aprBps;
  const maxTick = liquid[liquid.length - 1].aprBps;
  const upAtMax = upfrontBps(maxTick, ttm, lending.params.feeBps);
  const upAtMin = upfrontBps(minTick, ttm, lending.params.feeBps);
  const apr = minTick === maxTick ? formatAprBps(minTick) : `${formatAprBps(minTick)}–${formatAprBps(maxTick)}`;
  const upfront = minTick === maxTick ? formatBpsPct(upAtMin) : `${formatBpsPct(upAtMax)}–${formatBpsPct(upAtMin)}`;
  return (
    <span className="rate-pair">
      <span>
        <span className="label">LEND</span>
        <span className="rate-lend">{apr} APR</span>
      </span>
      <span>
        <span className="label">BORROW</span>
        <span className="rate-borrow">{upfront} UPFRONT</span>
      </span>
    </span>
  );
}
