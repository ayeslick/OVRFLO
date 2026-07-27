"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection } from "wagmi";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useMarketSymbols } from "@/hooks/useMarketSymbols";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { MarketDetail } from "./MarketDetail";
import { MarketsTable } from "./MarketsTable";
import { PositionSummary } from "./PositionSummary";
import { WalletButton } from "./WalletButton";

export function MarketsApp() {
  const connection = useConnection();
  const markets = useAllMarkets();
  const symbols = useMarketSymbols(markets.markets);
  // KTD1 two-level state: selectedMarket drives the expanded row; activeMode
  // drives the overlay. Closing the overlay clears activeMode only — the row
  // stays expanded. The overlay's scrim blocks the table while open, so the
  // two can never point at different markets.
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo | null>(null);
  const [activeMode, setActiveMode] = useState<{ market: MarketInfo; action: ActiveAction } | null>(null);

  const connectedAddress = useMemo(() => connection.addresses?.[0], [connection.addresses]);

  // R30: the expanded row's balances and positions describe a different account
  // after a signer switch — collapse and close everything.
  useEffect(() => {
    setSelectedMarket(null);
    setActiveMode(null);
  }, [connectedAddress]);

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

      <PositionSummary markets={markets.markets} user={connectedAddress} symbols={symbols} />
      <MarketsTable
        markets={markets.markets}
        symbols={symbols}
        user={connectedAddress}
        selected={selectedMarket}
        onSelect={setSelectedMarket}
        onMode={(market, action) => setActiveMode({ market, action })}
      />

      {activeMode ? (
        <MarketDetail
          market={activeMode.market}
          user={connectedAddress}
          action={activeMode.action}
          symbols={symbols}
          onClose={() => setActiveMode(null)}
        />
      ) : null}
    </main>
  );
}
