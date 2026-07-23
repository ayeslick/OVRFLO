"use client";

import { useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import type { MarketInfo } from "@/lib/types";
import { MarketDetail } from "./MarketDetail";
import { MarketsTable } from "./MarketsTable";
import { PositionSummary } from "./PositionSummary";
import { WalletButton } from "./WalletButton";

export function MarketsApp() {
  const connection = useConnection();
  const markets = useAllMarkets();
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo | null>(null);

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

      <MarketsTable markets={markets.markets} selected={selectedMarket} onSelect={setSelectedMarket} />
      <PositionSummary markets={markets.markets} user={connectedAddress} />

      {selectedMarket ? (
        <MarketDetail
          market={selectedMarket}
          user={connectedAddress}
          onBack={() => setSelectedMarket(null)}
        />
      ) : null}
    </main>
  );
}
