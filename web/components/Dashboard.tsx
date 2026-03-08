"use client";

import { useState, useMemo } from "react";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";
import { StatusPanel } from "@/components/StatusPanel";
import { StreamList } from "@/components/StreamList";
import { NewOvrfloModal } from "@/components/NewOvrfloModal";
import { ClaimModal } from "@/components/ClaimModal";
import { CHAIN_NAME, OVRFLO_FACTORY } from "@/lib/constants";
import { getReadContractsError } from "@/lib/errors";
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

  const { data: countData, error: countError } = useOvrfloCount();
  const ovrfloCount = countData?.[0]?.result ? Number(countData[0].result) : 0;

  const { data: addrData, error: addrError } = useOvrfloAddresses(ovrfloCount);
  const ovrfloAddrs = useMemo(
    () =>
      (addrData ?? [])
        .map((d) => d.result as `0x${string}`)
        .filter(Boolean),
    [addrData]
  );

  const { data: infoData, error: infoError } = useOvrfloInfos(ovrfloAddrs);
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

  const { markets: allMarkets, error: marketsError } = useAllMarkets(ovrflos);

  const launchReadError = useMemo(
    () =>
      getReadContractsError(
        countError,
        countData,
        "Unable to read the OVRFLO count from the configured factory."
      ) ??
      getReadContractsError(
        addrError,
        addrData,
        "Unable to read OVRFLO addresses from the configured factory."
      ) ??
      getReadContractsError(
        infoError,
        infoData,
        "Unable to read OVRFLO metadata from the configured factory."
      ) ??
      marketsError,
    [countError, countData, addrError, addrData, infoError, infoData, marketsError]
  );

  const actionsDisabled = Boolean(launchReadError);

  return (
    <>
      <WrongNetworkBanner />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">My OVRFLOs</h2>
          <div className="flex gap-3">
            <button
              onClick={() => setNewOpen(true)}
              disabled={actionsDisabled}
              className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold text-sm hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              New OVRFLO
            </button>
            <button
              onClick={() => setClaimOpen(true)}
              disabled={actionsDisabled}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-heading)] font-semibold text-sm hover:border-[var(--color-accent)] transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              Claim
            </button>
          </div>
        </div>

        {launchReadError ? (
          <StatusPanel
            title="Unable to load OVRFLO markets"
            description={`The app could not read launch data from factory ${OVRFLO_FACTORY} on ${CHAIN_NAME}. Check web/.env.example, confirm the deployed factory address is correct, and verify mainnet RPC access.`}
            details={[launchReadError.message]}
          />
        ) : (
          <StreamList ovrflos={ovrflos} allMarkets={allMarkets} />
        )}

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
