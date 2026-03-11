"use client";

import { useAccount } from "wagmi";
import { useUserStreams } from "@/hooks/useStreams";
import { useTokenSymbols, getTokenSymbol } from "@/hooks/useTokenLabels";
import { CHAIN_NAME, SABLIER_ENVIO_URL } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { StreamCard } from "./StreamCard";
import { PreviewStreamCard } from "./PreviewStreamCard";
import { StatusPanel } from "./StatusPanel";
import { WalletActionCta } from "./WalletActionCta";
import type { SablierStream } from "@/lib/sablier";
import type { OvrfloEntry } from "@/hooks/useOvrflos";
import type { MarketInfo } from "@/hooks/useAllMarkets";
import type { MockStreamCardData } from "@/lib/mock-dashboard";

interface Props {
  ovrflos: OvrfloEntry[];
  allMarkets: MarketInfo[];
  preview?: {
    streams: SablierStream[];
    streamCards: Record<string, MockStreamCardData>;
  };
}

export function StreamList({ ovrflos, allMarkets, preview }: Props) {
  const { address } = useAccount();
  const ovrfloAddrs = ovrflos.map((o) => o.address);
  const ptSymbols = useTokenSymbols(allMarkets.map((market) => market.ptToken));
  const { data: streams, isLoading, error } = useUserStreams(address, ovrfloAddrs);

  if (preview) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {preview.streams.map((stream) => {
          const previewCard = preview.streamCards[stream.id];
          if (!previewCard) return null;

          return (
            <PreviewStreamCard
              key={stream.id}
              tokenId={stream.tokenId}
              label={previewCard.seriesLabel}
              preview={previewCard}
            />
          );
        })}
      </div>
    );
  }

  if (!address) {
    return (
      <div className="nb-panel-dark flex min-h-56 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-[var(--color-muted)]">Connect wallet to view your active OVRFLO streams.</p>
        <div className="flex justify-center">
          <WalletActionCta />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="nb-panel-dark flex min-h-56 items-center justify-center p-6 text-center">
        <p className="nb-kicker text-[var(--color-muted)]">Loading streams...</p>
      </div>
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
      <div className="nb-panel-dark flex min-h-56 items-center justify-center p-6 text-center">
        <p className="max-w-md text-sm leading-6 text-[var(--color-muted)]">
          {ovrflos.length === 0
            ? "No OVRFLO markets are currently available from the configured factory."
            : "No active OVRFLO streams found for this wallet yet."}
        </p>
      </div>
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
    <div className="grid gap-4 xl:grid-cols-2">
      {streams.map((s) => (
        <StreamCard key={s.id} stream={s} ptName={resolvePtName(s)} />
      ))}
    </div>
  );
}
