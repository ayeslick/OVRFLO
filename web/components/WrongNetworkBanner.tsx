"use client";

import { useAccount } from "wagmi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/constants";
import { WalletActionCta } from "./WalletActionCta";

export function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount();

  if (!isConnected || chainId === CHAIN_ID) return null;

  return (
    <div className="fixed inset-x-0 top-[88px] z-40 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)] sm:flex-row sm:items-center sm:justify-between">
        <span className="leading-6">
          OVRFLO web supports {CHAIN_NAME} only. Please switch your wallet to
          chain {CHAIN_ID}.
        </span>
        <WalletActionCta className="nb-button w-full rounded-[4px] sm:w-auto" />
      </div>
    </div>
  );
}
