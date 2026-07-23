"use client";

import type { MarketInfo } from "@/lib/types";
import { formatAddress, formatAprBps, formatMaturity } from "@/lib/format";

type Props = {
  markets: MarketInfo[];
  selected?: MarketInfo | null;
  onSelect: (market: MarketInfo) => void;
};

export function MarketsTable({ markets, selected, onSelect }: Props) {
  return (
    <section className="section">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <div>
          <div className="label mono">MARKETS</div>
          <h2>Approved Pendle series</h2>
        </div>
        <div className="label mono">LIVE MARKET DEPTH</div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Liquidity depth</th>
              <th>APR</th>
              <th>Fee</th>
              <th>Maturity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td className="empty mono" colSpan={6}>
                  NO APPROVED MARKETS
                </td>
              </tr>
            ) : (
              markets.map((market) => (
                <tr key={`${market.vault}-${market.market}`}>
                  <td>
                    <div className="mono">{formatAddress(market.market)}</div>
                    <div className="label mono">PT {formatAddress(market.ptToken)}</div>
                  </td>
                  <td className="mono">{market.lending ? "SEE LENDING PANEL" : "NOT DEPLOYED"}</td>
                  <td className="mono">{formatAprBps(1000)}</td>
                  <td className="mono">{formatAprBps(market.feeBps)}</td>
                  <td className="mono">{formatMaturity(market.expiryCached)}</td>
                  <td>
                    <button
                      type="button"
                      className="button mono"
                      disabled={selected?.market === market.market}
                      onClick={() => onSelect(market)}
                    >
                      {selected?.market === market.market ? "SELECTED" : "SELECT"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
