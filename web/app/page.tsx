"use client";

import { useState, useMemo } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";
import { StreamList } from "@/components/StreamList";
import { NewOvrfloModal } from "@/components/NewOvrfloModal";
import { ClaimModal } from "@/components/ClaimModal";
import {
  useOvrfloCount,
  useOvrfloAddresses,
  useOvrfloInfos,
  type OvrfloEntry,
} from "@/hooks/useOvrflos";
import {
  useMarketCount,
  useMarketAddresses,
  useMarketSeries,
  type MarketInfo,
} from "@/hooks/useApprovedMarkets";
import { OVRFLO_FACTORY } from "@/lib/constants";

export default function Home() {
  const [newOpen, setNewOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  // 1. Enumerate all OVRFLOs from factory
  const { data: countData } = useOvrfloCount();
  const ovrfloCount = countData?.[0]?.result ? Number(countData[0].result) : 0;

  const { data: addrData } = useOvrfloAddresses(ovrfloCount);
  const ovrfloAddrs = useMemo(
    () =>
      (addrData ?? [])
        .map((d) => d.result as `0x${string}`)
        .filter(Boolean),
    [addrData]
  );

  const { data: infoData } = useOvrfloInfos(ovrfloAddrs);
  const ovrflos: OvrfloEntry[] = useMemo(
    () =>
      ovrfloAddrs
        .map((addr, i) => {
          const info = infoData?.[i]?.result as
            | [string, string, string]
            | undefined;
          if (!info) return null;
          return {
            address: addr,
            treasury: info[0] as `0x${string}`,
            underlying: info[1] as `0x${string}`,
            ovrfloToken: info[2] as `0x${string}`,
          };
        })
        .filter(Boolean) as OvrfloEntry[],
    [ovrfloAddrs, infoData]
  );

  // 2. Collect approved markets across all OVRFLOs
  const allMarkets = useAllMarkets(ovrflos);

  return (
    <>
      <Header />
      <WrongNetworkBanner />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">My OVRFLOs</h2>
          <div className="flex gap-3">
            <button
              onClick={() => setNewOpen(true)}
              className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold text-sm hover:brightness-110 transition"
            >
              New OVRFLO
            </button>
            <button
              onClick={() => setClaimOpen(true)}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-heading)] font-semibold text-sm hover:border-[var(--color-accent)] transition"
            >
              Claim
            </button>
          </div>
        </div>

        <StreamList ovrflos={ovrflos} allMarkets={allMarkets} />

        <NewOvrfloModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          ovrflos={ovrflos}
          allMarkets={allMarkets}
        />
        <ClaimModal
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          ovrflos={ovrflos}
          allMarkets={allMarkets}
        />
      </main>
      <Footer />
    </>
  );
}

function useAllMarkets(ovrflos: OvrfloEntry[]): MarketInfo[] {
  // For each OVRFLO, get market count, addresses, and series data.
  // Since hooks can't be called conditionally, we use the first OVRFLO
  // pattern and aggregate. For a dynamic number of OVRFLOs, we batch
  // multicall-style reads. Here we handle up to the known list.

  // Market counts for each OVRFLO
  const counts = ovrflos.map((o) => {
    const { data } = useMarketCount(o.address);
    return data?.[0]?.result ? Number(data[0].result) : 0;
  });

  // Market addresses for each OVRFLO
  const addrs = ovrflos.map((o, i) => {
    const { data } = useMarketAddresses(o.address, counts[i]);
    return (data ?? []).map((d) => d.result as `0x${string}`).filter(Boolean);
  });

  // Series info for each market
  const seriesResults = ovrflos.map((o, i) => {
    const { data } = useMarketSeries(o.address, addrs[i]);
    return data;
  });

  return useMemo(() => {
    const result: MarketInfo[] = [];
    ovrflos.forEach((o, oi) => {
      const marketAddrs = addrs[oi];
      const series = seriesResults[oi];
      marketAddrs.forEach((market, mi) => {
        const s = series?.[mi]?.result as
          | [boolean, number, number, bigint, string, string, string]
          | undefined;
        if (!s) return;
        result.push({
          market,
          ovrflo: o.address,
          approved: s[0],
          twapDuration: s[1],
          feeBps: s[2],
          expiry: s[3],
          ptToken: s[4] as `0x${string}`,
          ovrfloToken: s[5] as `0x${string}`,
          underlying: s[6] as `0x${string}`,
        });
      });
    });
    return result;
  }, [ovrflos, addrs, seriesResults]);
}
