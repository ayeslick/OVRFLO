"use client";

import { useAccount } from "wagmi";
import { useUserStreams } from "@/hooks/useStreams";
import { useTokenSymbols, getTokenSymbol } from "@/hooks/useTokenLabels";
import { CHAIN_NAME, SABLIER_ENVIO_URL } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { StreamCard } from "./StreamCard";
import { StatusPanel } from "./StatusPanel";
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
  const ptSymbols = useTokenSymbols(allMarkets.map((market) => market.ptToken));
  const { data: streams, isLoading, error } = useUserStreams(address, ovrfloAddrs);

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
      <StatusPanel
        title="Unable to load your streams"
        description={`The Sablier indexer at ${SABLIER_ENVIO_URL} did not return stream data for ${CHAIN_NAME}. Confirm the indexer is healthy and that the app is pointed at the intended mainnet deployment.`}
        details={[getErrorMessage(error)]}
      />
    );
  }

  if (!streams || streams.length === 0) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        {ovrflos.length === 0
          ? "No OVRFLO markets are currently available from the configured factory."
          : "No active OVRFLO streams found for this wallet yet."}
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
      ? `${symbol} · ${new Date(Number(market.expiry) * 1000).toLocaleDateString()}`
      : undefined;
  }

  return (
    <div className="flex flex-col gap-4">
      {streams.map((s) => (
        <StreamCard key={s.id} stream={s} ptName={resolvePtName(s)} />
      ))}
    </div>
  );
}
