"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { formatAddress, formatAprBps, formatMaturity, formatTokenAmount } from "@/lib/format";
import { isSeriesMatchedStream } from "@/lib/modal-logic";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { ACTION_META, FormBody } from "./ActionModal";
import { PositionList } from "./PositionList";

type Props = {
  market: MarketInfo;
  user?: Address;
  onBack: () => void;
};

export function MarketDetail({ market, user, onBack }: Props) {
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    setActiveAction(null);
  }, [user, market.market]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (activeAction) setActiveAction(null);
      else onBack();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onBack, activeAction]);

  useEffect(() => {
    if (activeAction && panelRef.current) {
      const input = panelRef.current.querySelector("input");
      input?.focus();
    }
  }, [activeAction]);

  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  useEffect(() => {
    setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
  }, []);

  const matured = nowSeconds !== null && nowSeconds >= market.expiryCached;

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
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });

  const symbolRead = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "symbol",
  });
  const symbol = symbolRead.data ?? formatAddress(market.ovrfloToken);

  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const ovrfloBal = ovrfloBalance.data ?? 0n;
  const underlyingBal = underlyingBalance.data ?? 0n;
  const ptBal = ptBalance.data ?? 0n;
  const wrapCapacity = wrappedUnderlying.data ?? 0n;

  const actionMeta = activeAction ? ACTION_META[activeAction.type] : null;

  return (
    <div className="modal-scrim" onClick={onBack}>
      <div
        className="modal-panel market-detail-panel"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={actionMeta ? actionMeta.title : "Market Detail"}
      >
        <div className="modal-header">
          {actionMeta ? (
            <h3 className="modal-heading">{actionMeta.title}</h3>
          ) : (
            <div>
              <h3 className="modal-heading">{symbol}</h3>
              <div className="market-detail-meta">
                <span className="mono">FEE {formatAprBps(market.feeBps)}</span>
                <span className="mono">MATURITY {formatMaturity(market.expiryCached)}</span>
              </div>
            </div>
          )}
          <button
            type="button"
            className="modal-close"
            onClick={() => (activeAction ? setActiveAction(null) : onBack())}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div key={activeAction ? activeAction.type : "detail"} className="market-detail-view">
          {activeAction && actionMeta ? (
            <FormBody
              action={activeAction}
              market={market}
              user={user}
              accent={actionMeta.accent}
              onClose={() => setActiveAction(null)}
            />
          ) : (
            <>
              {user ? (
                <div className="market-detail-section">
                  <div className="label mono">BALANCE</div>
                  <div className="balance-summary">
                    <div className="balance-row">
                      <span className="mono">{formatTokenAmount(underlyingBal, "wstETH")}</span>
                      <button
                        className="button mono"
                        type="button"
                        disabled={underlyingBal === 0n}
                        onClick={() => setActiveAction({ type: "wrap" })}
                      >
                        WRAP
                      </button>
                    </div>
                    <div className="balance-row">
                      <span className="mono">{formatTokenAmount(ptBal, "PT")}</span>
                      {!matured ? (
                        <button
                          className="button mono"
                          type="button"
                          disabled={ptBal === 0n}
                          onClick={() => setActiveAction({ type: "deposit" })}
                        >
                          DEPOSIT PT
                        </button>
                      ) : null}
                    </div>
                    <div className="balance-row">
                      <span className="mono">{formatTokenAmount(ovrfloBal, "ovrflo")}</span>
                      {wrapCapacity > 0n ? (
                        <button
                          className="button mono"
                          type="button"
                          disabled={ovrfloBal === 0n}
                          onClick={() => setActiveAction({ type: "unwrap" })}
                        >
                          UNWRAP
                        </button>
                      ) : null}
                      {matured ? (
                        <button
                          className="button mono"
                          type="button"
                          disabled={ovrfloBal === 0n}
                          onClick={() => setActiveAction({ type: "claim_matured" })}
                        >
                          CLAIM
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="market-detail-section">
                <PositionList market={market} user={user} onAction={setActiveAction} />
              </div>

              <div className="market-detail-actions">
                <div className="action-with-caption">
                  <button
                    className="button button-gold mono"
                    type="button"
                    disabled={!market.lending}
                    onClick={() => setActiveAction({ type: "supply" })}
                  >
                    SUPPLY LIQUIDITY
                  </button>
                  {!market.lending ? <span className="label mono">LENDING NOT DEPLOYED</span> : null}
                </div>
                <div className="action-with-caption">
                  <button
                    className="button button-cyan mono"
                    type="button"
                    disabled={eligibleStreams.length === 0}
                    onClick={() => setActiveAction({ type: "borrow" })}
                  >
                    BORROW
                  </button>
                  {eligibleStreams.length === 0 ? <span className="label mono">NO STREAMS AVAILABLE</span> : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
