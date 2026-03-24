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

  if (preview) {
    const previewStreams = preview.streams.filter((stream) => preview.streamCards[stream.id]);

    if (previewStreams.length === 0) {
      return (
        <p className="py-12 text-center text-sm text-[#a3c0e8]/60" data-testid="empty-streams">
          No active streams. Use <span className="font-semibold text-white">+ New OVRFLO</span> to create one.
        </p>
      );
    }

    return (
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="stream-grid">
        {previewStreams.map((stream, i) => {
          const previewCard = preview.streamCards[stream.id];
          if (!previewCard) return null;

          return (
            <PreviewStreamCard
              key={stream.id}
              tokenId={stream.tokenId}
              label={previewCard.seriesLabel}
              preview={previewCard}
              index={i}
            />
          );
        })}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="stream-grid-skeleton">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="nb-stream-card animate-pulse p-6"
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="h-7 w-7 bg-[#5dc0f5]/30" />
              <div className="h-5 w-32 bg-black/10" />
            </div>
            <div className="mb-4 h-5 w-full bg-[#0b1221]" />
            <div className="mb-4 grid grid-cols-2 gap-0">
              <div className="h-16 bg-[#f0f4f8]" />
              <div className="h-16 bg-[#5dc0f5]/10" />
            </div>
            <div className="h-12 w-full bg-black/80" />
          </div>
        ))}
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
    return (
      <p className="py-12 text-center text-sm text-[#a3c0e8]/60" data-testid="empty-streams">
        No active streams. Use <span className="font-semibold text-white">+ New OVRFLO</span> to create one.
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
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="stream-grid">
      {streams.map((s, i) => (
        <StreamCard key={s.id} stream={s} ptName={resolvePtName(s)} index={i} />
      ))}
    </div>
  );
}
