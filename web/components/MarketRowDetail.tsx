"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { formatTokenAmount } from "@/lib/format";
import { isSeriesMatchedStream } from "@/lib/modal-logic";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { PositionList } from "./PositionList";

type Props = {
  market: MarketInfo;
  user?: Address;
  symbols: SymbolMap;
  onMode: (action: ActiveAction) => void;
};

// Expanded-row content (R7): balances with context verbs, this market's positions,
// then the three mode buttons. Disabled modes always say why (DESIGN.md §8) —
// never hidden without a caption, except DEPOSIT PT which R7 hides post-maturity.
export function MarketRowDetail({ market, user, symbols, onMode }: Props) {
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);
  const matured = nowSeconds !== null && nowSeconds >= market.expiryCached;

  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  const ovrfloBalance = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user) },
  });
  const underlyingBalance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user) },
  });
  const ptBalance = useReadContract({
    address: market.ptToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user) },
  });
  // Also read by ConvertForm for capacity display — wagmi dedupes by query key.
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });

  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const ovrfloBal = ovrfloBalance.data ?? 0n;
  const underlyingBal = underlyingBalance.data ?? 0n;
  const ptBal = ptBalance.data ?? 0n;
  const wrapCapacity = wrappedUnderlying.data ?? 0n;
  const wrapReserveShort = wrapCapacity === 0n || wrapCapacity < ovrfloBal;

  const disconnected = !user;
  const supplyCaption = disconnected
    ? "CONNECT WALLET"
    : !market.lending
      ? "LENDING NOT DEPLOYED"
      : matured
        ? "MARKET MATURED"
        : null;
  const borrowCaption = disconnected
    ? "CONNECT WALLET"
    : !market.lending
      ? "LENDING NOT DEPLOYED"
      : matured
        ? "MARKET MATURED"
        : eligibleStreams.length === 0
          ? "NO STREAMS AVAILABLE"
          : null;
  const depositCaption = disconnected ? "CONNECT WALLET" : null;

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
            disabled={Boolean(borrowCaption)}
            onClick={() => onMode({ type: "borrow" })}
          >
            BORROW
          </button>
          {borrowCaption ? <span className="label mono">{borrowCaption}</span> : null}
        </div>
        {!matured ? (
          <div className="action-with-caption">
            <button
              className="button button-gold mono"
              type="button"
              disabled={Boolean(depositCaption) || ptBal === 0n}
              onClick={() => onMode({ type: "deposit" })}
            >
              DEPOSIT PT
            </button>
            {depositCaption ? (
              <span className="label mono">{depositCaption}</span>
            ) : ptBal === 0n ? (
              <span className="label mono">NO PT BALANCE</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
