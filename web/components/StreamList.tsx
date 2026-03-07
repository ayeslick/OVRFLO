"use client";

import { useAccount } from "wagmi";
import { useUserStreams } from "@/hooks/useStreams";
import { useTokenSymbols, getTokenSymbol } from "@/hooks/useTokenLabels";
import { parseStreamError } from "@/lib/tx-errors";
import { StreamCard } from "./StreamCard";
import { WalletActionCta } from "./WalletActionCta";
import type { SablierStream } from "@/lib/sablier";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MarketInfo } from "@/hooks/useAllMarkets";

interface Props {
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
}

export function StreamList({ ovrflos, allMarkets }: Props) {
  const { address } = useAccount();
  const ovrfloAddrs = ovrflos.map((o) => o.address);
  const { data: streams, isLoading, error, refetch } = useUserStreams(address, ovrfloAddrs);
  const ptSymbols = useTokenSymbols(allMarkets.map((market) => market.ptToken));

  if (!address) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-[var(--color-muted)]">Connect wallet to view your streams.</p>
        <div className="flex justify-center">
          <WalletActionCta />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        Loading streams...
      </p>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-red-400">{parseStreamError(error)}</p>
        <button
          onClick={() => void refetch()}
          className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-heading)] font-semibold text-sm hover:border-[var(--color-accent)] transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (ovrfloAddrs.length === 0) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        No OVRFLO contracts are configured yet.
      </p>
    );
  }

  if (!streams || streams.length === 0) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        No active streams yet.
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
    return symbol ? `${symbol} · ${new Date(Number(market.expiry) * 1000).toLocaleDateString()}` : undefined;
  }

  return (
    <div className="flex flex-col gap-4">
      {streams.map((s) => (
        <StreamCard key={s.id} stream={s} ptName={resolvePtName(s)} />
      ))}
    </div>
  );
}
