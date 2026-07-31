"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { formatTokenAmount } from "@/lib/format";
import { isSeriesMatchedStream } from "@/lib/modal-logic";
import { marketBorrowTeaserBps } from "@/lib/positions";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { PositionList } from "./PositionList";

type Props = {
  market: MarketInfo;
  user?: Address;
  symbols: SymbolMap;
  onMode: (action: ActiveAction) => void;
};

// Shared prefix for supply/borrow captions: wallet, then lending deployment,
// then maturity — in that priority order. `null` means "no caption needed."
function baseActionCaption(disconnected: boolean, lendingDeployed: boolean, matured: boolean) {
  if (disconnected) return "CONNECT WALLET";
  if (!lendingDeployed) return "LENDING NOT DEPLOYED";
  if (matured) return "MARKET MATURED";
  return null;
}

// Expanded-row content: contextual balance utilities, this market's positions,
// then the two primary market actions. Deposit stays beside the PT balance so
// it has one canonical entry point instead of competing with Supply/Borrow.
export function MarketRowDetail({ market, user, symbols, onMode }: Props) {
  const nowSeconds = useNowSeconds(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const matured = nowSeconds >= market.expiryCached;

  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  // One multicall round trip for all three wallet balances instead of three
  // separate reads — same address/enabled shape for each, so they always
  // land in the same batch and there's nothing to lose by combining them.
  const balanceReads = useReadContracts({
    contracts: [
      { address: market.ovrfloToken, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
      { address: market.underlying, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
      { address: market.ptToken, abi: erc20Abi, functionName: "balanceOf" as const, args: user ? [user] : undefined },
    ],
    query: { enabled: Boolean(user) },
  });
  const [ovrfloBalance, underlyingBalance, ptBalance] = balanceReads.data ?? [];
  // Also read by ConvertForm for capacity display — wagmi dedupes by query key.
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });

  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  // Same ladder/teaser path PositionList prices its stream cards from, so the
  // market-row gate and the per-stream placeholder always agree on "empty".
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending, market.market);
  const liquiditySettled = !lending.isLoading && !liquidity.isLoading;
  const borrowTeaserBps = marketBorrowTeaserBps({
    liquidity: liquidity.liquidity,
    market: market.market,
    aprMinBps: lending.params.aprMinBps,
    aprMaxBps: lending.params.aprMaxBps,
    feeBps: lending.params.feeBps,
    ttmSeconds: matured ? 0n : market.expiryCached - nowSeconds,
    matured,
    self: user,
  });

  const ovrfloBal = ovrfloBalance?.status === "success" ? ovrfloBalance.result : 0n;
  const underlyingBal = underlyingBalance?.status === "success" ? underlyingBalance.result : 0n;
  const ptBal = ptBalance?.status === "success" ? ptBalance.result : 0n;
  const wrapCapacity = wrappedUnderlying.data ?? 0n;
  const wrapReserveShort = wrapCapacity === 0n;

  const disconnected = !user;
  const supplyCaption = baseActionCaption(disconnected, Boolean(market.lending), matured);
  const borrowCaption =
    baseActionCaption(disconnected, Boolean(market.lending), matured) ??
    (eligibleStreams.length === 0 ? "NO STREAMS AVAILABLE" : null) ??
    // Only claim "no liquidity" once the reads settle — an in-flight read is
    // not-yet-known, not empty (KTD2).
    (liquiditySettled && borrowTeaserBps === null ? "NO LIQUIDITY POSTED AT ANY RATE" : null);
  // An unsettled read keeps BORROW disabled without asserting why: opening the
  // flow blind is what walks a borrower into a wasted APPROVE STREAM signature.
  const borrowDisabled = Boolean(borrowCaption) || !liquiditySettled;
  return (
    <div className="row-detail">
      {user ? (
        <div className="row-detail-section">
          <div className="label mono">BALANCES</div>
          <div className="balance-summary">
            <div className="balance-row">
              <span className="mono">{formatTokenAmount(underlyingBal, underlyingSymbol)}</span>
            </div>
            <div className="balance-row">
              <span className="mono">{formatTokenAmount(ptBal, "PT")}</span>
              {!matured ? (
                <span className="action-with-caption">
                  <button
                    className="button mono"
                    type="button"
                    disabled={ptBal === 0n}
                    onClick={() => onMode({ type: "deposit" })}
                  >
                    DEPOSIT PT
                  </button>
                  {ptBal === 0n ? <span className="label mono">NO BALANCE</span> : null}
                </span>
              ) : null}
            </div>
            <div className="balance-row">
              <span className="mono">{formatTokenAmount(ovrfloBal, ovrfloSymbol)}</span>
              {matured ? (
                <span className="action-with-caption">
                  <button
                    className="button mono"
                    type="button"
                    disabled={ovrfloBal === 0n}
                    onClick={() => onMode({ type: "claim_matured" })}
                  >
                    CLAIM PT
                  </button>
                  {ovrfloBal === 0n ? <span className="label mono">NO BALANCE</span> : null}
                </span>
              ) : (
                <span className="action-with-caption">
                  <button
                    className="button mono"
                    type="button"
                    disabled={ovrfloBal === 0n || wrapReserveShort}
                    onClick={() => onMode({ type: "unwrap" })}
                  >
                    UNWRAP
                  </button>
                  {wrapReserveShort ? (
                    <span className="label mono">WRAP RESERVE EMPTY</span>
                  ) : ovrfloBal === 0n ? (
                    <span className="label mono">NO BALANCE</span>
                  ) : null}
                </span>
              )}
            </div>
          </div>
          <button
            className="advanced-toggle label mono"
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            ADVANCED {advancedOpen ? "▾" : "▸"}
          </button>
          {advancedOpen ? (
            <div className="balance-row">
              <span className="label mono">WRAP {underlyingSymbol} → {ovrfloSymbol}</span>
              <button
                className="button mono"
                type="button"
                disabled={underlyingBal === 0n}
                onClick={() => onMode({ type: "wrap" })}
              >
                WRAP
              </button>
              {underlyingBal === 0n ? <span className="label mono">NO BALANCE</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="row-detail-section">
        <PositionList market={market} user={user} symbols={symbols} onAction={onMode} />
      </div>

      <div className="market-detail-actions">
        <div className="action-with-caption">
          <button
            className="button button-gold mono"
            type="button"
            disabled={Boolean(supplyCaption)}
            onClick={() => onMode({ type: "supply" })}
          >
            SUPPLY
          </button>
          {supplyCaption ? <span className="label mono">{supplyCaption}</span> : null}
        </div>
        <div className="action-with-caption">
          <button
            className="button button-cyan mono"
            type="button"
            disabled={borrowDisabled}
            onClick={() => onMode({ type: "borrow" })}
          >
            BORROW
          </button>
          {borrowCaption ? <span className="label mono">{borrowCaption}</span> : null}
        </div>
      </div>
    </div>
  );
}
