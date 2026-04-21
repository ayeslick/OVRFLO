"use client";

import { useAccount } from "wagmi";
import { useUserStreams } from "@/hooks/useStreams";
import { useTokenSymbols, getTokenSymbol } from "@/hooks/useTokenLabels";
import { CHAIN_NAME } from "@/lib/config";
import { getErrorMessage } from "@/lib/errors";
import { StreamTableRow } from "./StreamTableRow";
import { StatusPanel } from "./StatusPanel";
import type { SablierStream } from "@/lib/sablier";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MarketInfo } from "@/hooks/useAllMarkets";

interface Props {
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
}

const TABLE_HEADERS = ["#", "Stream", "Streamed", "Withdrawable", "Ends", ""];

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden border-2 border-[#000] bg-white shadow-[var(--shadow-hard-sm)]">
      <table className="w-full" data-testid="stream-table">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b-2 border-[#000] bg-[#f0f4f8]">
            {TABLE_HEADERS.map((h) => (
              <th
                key={h || "action"}
                className="nb-kicker px-4 py-3 text-left text-black/40"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function StreamList({ ovrflos, allMarkets }: Props) {
  const { address } = useAccount();
  const ovrfloAddrs = ovrflos.map((o) => o.address);
  const ptSymbols = useTokenSymbols(
    allMarkets.map((market) => market.ptToken)
  );
  const {
    data: streams,
    isLoading,
    error,
  } = useUserStreams(address, ovrfloAddrs);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5">
        {/* Summary skeleton */}
        <div className="grid grid-cols-3 gap-0 border-2 border-black/20 bg-white/90 shadow-[var(--shadow-hard-sm)] animate-pulse">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-2 border-r border-black/10 px-4 py-5 last:border-r-0"
            >
              <div className="h-3 w-24 bg-black/10" />
              <div className="h-6 w-16 bg-black/15" />
            </div>
          ))}
        </div>
        {/* Table skeleton */}
        <div className="overflow-hidden border-2 border-black/20 bg-white/90 animate-pulse">
          <div className="border-b border-black/10 bg-[#f0f4f8] px-4 py-3">
            <div className="h-3 w-64 bg-black/10" />
          </div>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-black/10 px-4 py-4"
            >
              <div className="h-7 w-7 bg-[#5dc0f5]/30" />
              <div className="h-4 w-28 bg-black/10" />
              <div className="h-3 w-20 bg-black/10" />
              <div className="ml-auto h-8 w-24 bg-black/70" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <StatusPanel
        title="Unable to load your streams"
        description={`On-chain stream scan for ${CHAIN_NAME} did not return data. Confirm the RPC endpoint is reachable and that NEXT_PUBLIC_FACTORY_FROM_BLOCK is set appropriately for this deployment.`}
        details={[getErrorMessage(error)]}
      />
    );
  }

  if (!address || !streams || streams.length === 0) {
    return (
      <p
        className="py-12 text-center text-sm text-[#a3c0e8]/60"
        data-testid="empty-streams"
      >
        No active streams. Use{" "}
        <span className="font-semibold text-white">+ New OVRFLO</span> to
        create one.
      </p>
    );
  }

  function resolvePtName(stream: SablierStream): string | undefined {
    const assetAddr = stream.asset.address.toLowerCase();
    const endTime = BigInt(stream.endTime);
    const ovrflo = ovrflos.find(
      (o) => o.ovrfloToken.toLowerCase() === assetAddr
    );
    if (!ovrflo) return undefined;
    const market = allMarkets.find(
      (m) =>
        m.ovrflo.toLowerCase() === ovrflo.address.toLowerCase() &&
        m.expiry === endTime
    );
    if (!market) return undefined;
    const symbol = getTokenSymbol(ptSymbols, market.ptToken, undefined);
    return symbol
      ? `${symbol} · ${new Date(Number(market.expiry) * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : undefined;
  }

  return (
    <div className="flex flex-col gap-5">
      <TableShell>
        {streams.map((s, i) => (
          <StreamTableRow
            key={s.id}
            stream={s}
            ptName={resolvePtName(s)}
            index={i}
          />
        ))}
      </TableShell>
    </div>
  );
}
