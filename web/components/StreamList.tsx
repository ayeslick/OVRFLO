"use client";

import { useAccount } from "wagmi";
import { useUserStreams } from "@/hooks/useStreams";
import { useTokenSymbols, getTokenSymbol } from "@/hooks/useTokenLabels";
import { CHAIN_NAME, SABLIER_ENVIO_URL } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { StreamCard } from "./StreamCard";
import { PreviewStreamCard } from "./PreviewStreamCard";
import { StatusPanel } from "./StatusPanel";
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

  function renderEmptyState() {
    return (
      <article className="nb-panel-dark flex min-h-48 items-center justify-center p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.05em] text-[var(--color-heading)]">
          No OVRFLOs yet.
        </p>
      </article>
    );
  }

  if (preview) {
    const previewStreams = preview.streams.filter((stream) => preview.streamCards[stream.id]);

    if (previewStreams.length === 0) {
      return renderEmptyState();
    }

    return (
      <div className="flex flex-col gap-4">
        {previewStreams.map((stream) => {
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

  if (!address || !streams || streams.length === 0) {
    return renderEmptyState();
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
