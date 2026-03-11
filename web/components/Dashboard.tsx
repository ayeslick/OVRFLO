"use client";

import { useState } from "react";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";
import { StatusPanel } from "@/components/StatusPanel";
import { StreamList } from "@/components/StreamList";
import { NewOvrfloModal } from "@/components/NewOvrfloModal";
import { ClaimModal } from "@/components/ClaimModal";
import { CHAIN_NAME, OVRFLO_FACTORY } from "@/lib/constants";
import { useDashboardData } from "@/hooks/useDashboardData";

export function Dashboard() {
  const [newOpen, setNewOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const {
    tokenLabels,
    marketLabels,
    ovrflos,
    allMarkets,
    streams,
    streamCards,
    createFlows,
    claimFlows,
    actionsDisabled,
    isPreview,
    launchReadError,
  } = useDashboardData();

  return (
    <>
      <WrongNetworkBanner />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-10 pt-28 sm:px-6 lg:px-8">
        <section id="portfolio" className="nb-panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-2xl text-[var(--color-ink)] sm:text-3xl">My OVRFLOs</h1>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                disabled={actionsDisabled}
                className="nb-button w-full sm:w-auto"
              >
                New OVRFLO
              </button>
              <button
                type="button"
                onClick={() => setClaimOpen(true)}
                disabled={actionsDisabled}
                className="nb-button nb-button-secondary w-full sm:w-auto"
              >
                Claim
              </button>
            </div>
          </div>
        </section>

        {launchReadError ? (
          <StatusPanel
            title="Launch data unavailable"
            description={`The app could not read launch data from factory ${OVRFLO_FACTORY} on ${CHAIN_NAME}. Check web/.env.example, confirm the deployed factory address is correct, and verify mainnet RPC access.`}
            details={[launchReadError.message]}
          />
        ) : null}

        <section aria-label="OVRFLO list" className="flex flex-col gap-4">
          <StreamList
            ovrflos={ovrflos}
            allMarkets={allMarkets}
            preview={isPreview ? { streams, streamCards } : undefined}
          />
        </section>

        <NewOvrfloModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          ovrflos={ovrflos}
          allMarkets={allMarkets}
          preview={
            isPreview
              ? {
                  tokenLabels,
                  marketLabels,
                  createFlows,
                }
              : undefined
          }
        />
        <ClaimModal
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          ovrflos={ovrflos}
          allMarkets={allMarkets}
          preview={
            isPreview
              ? {
                  tokenLabels,
                  marketLabels,
                  claimFlows,
                }
              : undefined
          }
        />
      </main>
    </>
  );
}
