"use client";

import { WalletButton } from "wallet-runtime";

export function MarketsApp() {
  return (
    <main className="container">
      <header className="topbar">
        <div className="brand">
          <img src="/images/logo-mark.png" alt="" />
          <h1>OVRFLO</h1>
        </div>
        <nav className="nav">
          <span className="label mono">MARKETS</span>
          <WalletButton />
        </nav>
      </header>
    </main>
  );
}
