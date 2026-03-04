"use client";

import { useAccount } from "wagmi";
import { useUserStreams } from "@/hooks/useStreams";
import { StreamCard } from "./StreamCard";
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
  const { data: streams, isLoading } = useUserStreams(address, ovrfloAddrs);

  if (!address) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        Connect wallet to view your streams.
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        Loading streams...
      </p>
    );
  }

  if (!streams || streams.length === 0) {
    return (
      <p className="text-[var(--color-muted)] text-center py-12">
        No OVRFLOs yet.
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
    return `PT-${market.ptToken.slice(0, 6)}...${market.ptToken.slice(-4)}`;
  }

  return (
    <div className="flex flex-col gap-4">
      {streams.map((s) => (
        <StreamCard key={s.id} stream={s} ptName={resolvePtName(s)} />
      ))}
    </div>
  );
}
