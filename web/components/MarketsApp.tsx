"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import type { Loan, MarketInfo } from "@/lib/types";
import { ActionPanel } from "./ActionPanel";
import { MarketsTable } from "./MarketsTable";
import { PositionPanels } from "./PositionPanels";
import { WalletButton } from "./WalletButton";

export function MarketsApp() {
  const connection = useConnection();
  const markets = useAllMarkets();
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<Loan | undefined>();

  useEffect(() => {
    if (!selectedMarket && markets.markets[0]) {
      setSelectedMarket(markets.markets[0]);
    }
  }, [markets.markets, selectedMarket]);

  const connectedAddress = useMemo(() => connection.addresses?.[0], [connection.addresses]);

  return (
    <main className="container">
      <header className="topbar">
        <div className="brand">
          <img src="/images/logo-mark.png" alt="" />
          <span>OVRFLO</span>
        </div>
        <nav className="nav">
          <span className="label mono">MARKETS</span>
          <WalletButton />
        </nav>
      </header>

      <section className="hero">
        <div className="hero-main">
          <div className="label mono">OVRFLO MARKETS</div>
          <h1>Markets.</h1>
          <p>
            Supply liquidity, sell streams instantly, borrow against yield, and manage vault conversion flows in one
            market interface.
          </p>
        </div>
        <div className="hero-side">
          <div className="label mono">SYSTEM STATUS</div>
          <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
            <div className="mono">FACTORY READ: {markets.error ? "ERROR" : markets.isLoading ? "LOADING" : "READY"}</div>
            <div className="mono">CONNECTED: {connectedAddress ? "YES" : "NO"}</div>
            <div className="mono">PANELS: LENDING / BORROWING / STREAMS</div>
          </div>
        </div>
      </section>

      <MarketsTable markets={markets.markets} selected={selectedMarket} onSelect={setSelectedMarket} />
      <PositionPanels market={selectedMarket} user={connectedAddress} onSelectLoan={setSelectedLoan} />
      <ActionPanel market={selectedMarket} loan={selectedLoan} />
    </main>
  );
}
