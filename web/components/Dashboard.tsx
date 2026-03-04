"use client";

import { useState, useMemo } from "react";
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
import { useAllMarkets } from "@/hooks/useAllMarkets";

export function Dashboard() {
  const [newOpen, setNewOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

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

  const { markets: allMarkets } = useAllMarkets(ovrflos);

  return (
    <>
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
    </>
  );
}
