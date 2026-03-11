"use client";

import { useState } from "react";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";
import { StatusPanel } from "@/components/StatusPanel";
import { StreamList } from "@/components/StreamList";
import { NewOvrfloModal } from "@/components/NewOvrfloModal";
import { ClaimModal } from "@/components/ClaimModal";
import { CHAIN_NAME, OVRFLO_FACTORY } from "@/lib/constants";
import { useDashboardData } from "@/hooks/useDashboardData";

type DashboardTab = "active" | "claimable" | "closed";

const TAB_LABELS: Record<DashboardTab, string> = {
  active: "Active",
  claimable: "Claimable",
  closed: "Closed",
};

const EMPTY_MESSAGES: Record<DashboardTab, string> = {
  active: "No active OVRFLO positions.",
  claimable: "No claimable positions right now.",
  closed: "No closed OVRFLO positions.",
};

export function Dashboard() {
  const [newOpen, setNewOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>("active");
  const {
    heroStats,
    ovrflos,
    allMarkets,
    streams,
    streamCards,
    actionsDisabled,
    isPreview,
    launchReadError,
  } = useDashboardData();

  const previewStreamsByTab: Record<DashboardTab, typeof streams> = {
    active: streams.filter((stream) => !streamCards[stream.id]?.closed),
    claimable: streams.filter(
      (stream) => streamCards[stream.id]?.claimable && !streamCards[stream.id]?.closed,
    ),
    closed: streams.filter((stream) => Boolean(streamCards[stream.id]?.closed)),
  };

  const currentPreviewStreams = previewStreamsByTab[activeTab];

  return (
    <>
      <WrongNetworkBanner />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-10 pt-28 sm:px-6 lg:px-8">
        <section id="portfolio" className="nb-panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl text-[var(--color-ink)] sm:text-3xl">Portfolio</h1>
              {isPreview ? <span className="nb-chip nb-kicker">Read only</span> : null}
            </div>

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

        <section id="stats" aria-label="Portfolio stats" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {heroStats.map((stat, index) => (
            <article
              key={stat.label}
              className={`border-2 p-4 ${
                index % 2 === 0
                  ? "rounded-[8px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]"
                  : "rounded-[8px] border-[var(--color-ink)] bg-[var(--color-surface-muted)] text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="nb-kicker text-[var(--color-border)]">{stat.label}</p>
                <span className="flex h-10 w-10 items-center justify-center border-2 border-[var(--color-ink)] bg-[var(--color-accent)] text-sm font-bold shadow-[var(--shadow-hard-sm)]">
                  {index + 1}
                </span>
              </div>
              <p className="mt-6 text-3xl font-bold uppercase tracking-[0.05em] sm:text-[2rem]">
                {stat.value}
              </p>
              <p className="mt-2 text-sm text-[var(--color-ink)]/75">{stat.detail}</p>
            </article>
          ))}
        </section>

        {launchReadError ? (
          <StatusPanel
            title="Launch data unavailable"
            description={`The app could not read launch data from factory ${OVRFLO_FACTORY} on ${CHAIN_NAME}. Check web/.env.example, confirm the deployed factory address is correct, and verify mainnet RPC access.`}
            details={[launchReadError.message]}
          />
        ) : null}

        <section id="positions" className="nb-panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b-2 border-[var(--color-border)] pb-5 md:flex-row md:items-center md:justify-between">
            <div role="tablist" aria-label="Portfolio views" className="flex flex-wrap gap-3">
              {(Object.keys(TAB_LABELS) as DashboardTab[]).map((tab) => {
                const isActive = activeTab === tab;

                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`portfolio-tab-${tab}`}
                    aria-selected={isActive}
                    aria-controls={`portfolio-panel-${tab}`}
                    onClick={() => setActiveTab(tab)}
                    className={`nb-button min-h-0 px-4 py-2 text-[0.6875rem] ${
                      isActive ? "" : "nb-button-secondary"
                    }`}
                  >
                    {TAB_LABELS[tab]}
                    <span className="rounded-[4px] border-2 border-current px-2 py-0.5 text-[0.625rem] leading-none">
                      {previewStreamsByTab[tab].length}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="nb-chip nb-kicker">{previewStreamsByTab[activeTab].length} items</span>
          </div>

          <div
            role="tabpanel"
            id={`portfolio-panel-${activeTab}`}
            aria-labelledby={`portfolio-tab-${activeTab}`}
            className="mt-6"
          >
            {currentPreviewStreams.length > 0 ? (
              <StreamList
                ovrflos={ovrflos}
                allMarkets={allMarkets}
                preview={{ streams: currentPreviewStreams, streamCards }}
              />
            ) : (
              <article className="nb-panel-dark flex min-h-64 items-center justify-center p-6 text-center">
                <div>
                  <p className="nb-kicker text-[var(--color-muted)]">{TAB_LABELS[activeTab]}</p>
                  <p className="mt-3 text-sm font-semibold uppercase tracking-[0.05em] text-[var(--color-heading)]">
                    {EMPTY_MESSAGES[activeTab]}
                  </p>
                </div>
              </article>
            )}
          </div>
        </section>

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
