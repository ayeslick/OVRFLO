"use client";

import { useState } from "react";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";
import { StatusPanel } from "@/components/StatusPanel";
import { StreamList } from "@/components/StreamList";
import { NewOvrfloModal } from "@/components/NewOvrfloModal";
import { ClaimModal } from "@/components/ClaimModal";
import { NetworkGuard } from "@/components/NetworkGuard";
import { CHAIN_NAME, OVRFLO_FACTORY } from "@/lib/config";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUsdPrices } from "@/hooks/useUsdPrices";

export function Dashboard() {
  const [newOpen, setNewOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const {
    ovrflos,
    allMarkets,
    streams,
    actionsDisabled,
    launchReadError,
  } = useDashboardData();

  const { data: usdPrices } = useUsdPrices({
    underlyings: ovrflos.map((o) => o.underlying),
    markets: allMarkets,
  });

  const streamCount = streams?.length ?? 0;

  return (
    <>
      <WrongNetworkBanner />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 pb-12 pt-8 lg:px-8">
        {/* Heading section */}
        <section id="portfolio" className="flex flex-col gap-1" data-testid="section-portfolio">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-3xl font-bold uppercase tracking-wide text-white">
                  My OVRFLOs
                </h1>
                {streamCount > 0 ? (
                  <span className="mono text-lg font-bold text-[#5dc0f5]">
                    ({String(streamCount).padStart(2, "0")})
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[#a3c0e8]/60">
                Manage Your Principal And Your Streaming Yield
              </p>
            </div>

            <div className="flex gap-3">
              <NetworkGuard>
                <button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  disabled={actionsDisabled}
                  className="nb-button flex items-center gap-2"
                  data-testid="button-new-ovrflo"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
                  </svg>
                  New OVRFLO
                </button>
                <button
                  type="button"
                  onClick={() => setClaimOpen(true)}
                  disabled={actionsDisabled}
                  className="nb-button nb-button-secondary flex items-center gap-2"
                  data-testid="button-claim"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
                    <path d="M8 3v10M5 10l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
                  </svg>
                  Claim
                </button>
              </NetworkGuard>
            </div>
          </div>
        </section>

        {/* Error panel */}
        {launchReadError ? (
          <StatusPanel
            title="Launch data unavailable"
            description={`The app could not read launch data from factory ${OVRFLO_FACTORY} on ${CHAIN_NAME}. Check web/.env.example, confirm the deployed factory address is correct, and verify mainnet RPC access.`}
            details={[launchReadError.message]}
          />
        ) : null}

        {/* Stream cards */}
        <section aria-label="OVRFLO list" data-testid="section-streams">
          <StreamList ovrflos={ovrflos} allMarkets={allMarkets} />
        </section>

        {/* Modals */}
        <NewOvrfloModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          ovrflos={ovrflos}
          allMarkets={allMarkets}
          prices={usdPrices}
        />
        <ClaimModal
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          ovrflos={ovrflos}
          allMarkets={allMarkets}
          prices={usdPrices}
        />
      </main>
    </>
  );
}
