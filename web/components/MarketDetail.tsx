"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { formatAddress, formatAprBps, formatMaturity, formatTokenAmount } from "@/lib/format";
import { isSeriesMatchedStream } from "@/lib/modal-logic";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { ActionModal } from "./ActionModal";
import { PositionList } from "./PositionList";

type Props = {
  market: MarketInfo;
  user?: Address;
  onBack: () => void;
};

export function MarketDetail({ market, user, onBack }: Props) {
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);

  useEffect(() => {
    setActiveAction(null);
  }, [user, market.market]);

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

  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const ovrfloBal = ovrfloBalance.data ?? 0n;
  const underlyingBal = underlyingBalance.data ?? 0n;
  const ptBal = ptBalance.data ?? 0n;
  const wrapCapacity = wrappedUnderlying.data ?? 0n;

  return (
    <>
      <div style={{ padding: "1rem 0" }}>
        <button type="button" className="button mono" onClick={onBack}>
          ← BACK TO MARKETS
        </button>
      </div>

      <section className="section">
        <div className="label mono">{formatAddress(market.market)}</div>
        <div style={{ display: "flex", gap: "2rem", marginTop: "0.5rem" }}>
          <div className="mono">FEE {formatAprBps(market.feeBps)}</div>
          <div className="mono">MATURITY {formatMaturity(market.expiryCached)}</div>
        </div>
      </section>

      {user ? (
        <section className="section">
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
        </section>
      ) : null}

      <section className="section">
        <PositionList market={market} user={user} onAction={setActiveAction} />
      </section>

      <section className="section">
        <div style={{ display: "flex", gap: "1rem" }}>
          <button
            className="button button-gold mono"
            type="button"
            disabled={!market.lending}
            onClick={() => setActiveAction({ type: "supply" })}
          >
            SUPPLY LIQUIDITY
          </button>
          {!market.lending ? <span className="label mono">LENDING NOT DEPLOYED</span> : null}

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
      </section>

      {activeAction ? (
        <ActionModal
          market={market}
          user={user}
          action={activeAction}
          onClose={() => setActiveAction(null)}
        />
      ) : null}
    </>
  );
}
