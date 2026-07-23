"use client";

import { useReadContracts } from "wagmi";
import { erc20Abi } from "@/lib/abis";
import type { MarketInfo } from "@/lib/types";
import { formatAddress, formatAprBps, formatMaturity } from "@/lib/format";

type Props = {
  markets: MarketInfo[];
  selected?: MarketInfo | null;
  onSelect: (market: MarketInfo) => void;
};

export function MarketsTable({ markets, selected, onSelect }: Props) {
  const symbolReads = useReadContracts({
    contracts: markets.map((market) => ({
      address: market.ovrfloToken,
      abi: erc20Abi,
      functionName: "symbol" as const,
    })),
    query: { enabled: markets.length > 0 },
  });

  const symbols = symbolReads.data ?? [];

  return (
    <section className="section">
      <div style={{ marginBottom: "0.75rem" }}>
        <h2>MARKETS</h2>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Fee</th>
              <th>Maturity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td className="empty mono" colSpan={4}>
                  NO APPROVED MARKETS
                </td>
              </tr>
            ) : (
              markets.map((market, index) => {
                const symbolResult = symbols[index];
                const symbol = symbolResult?.status === "success" ? symbolResult.result : undefined;
                return (
                  <tr key={`${market.vault}-${market.market}`}>
                    <td>
                      <div className="mono">{symbol ?? formatAddress(market.ovrfloToken)}</div>
                      <div className="label mono">PT {formatAddress(market.ptToken)}</div>
                    </td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
