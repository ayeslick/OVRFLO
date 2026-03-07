"use client";

import { useAccount } from "wagmi";
import { CHAIN_ID } from "@/lib/constants";
import { WalletActionCta } from "./WalletActionCta";

export function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount();

  if (!isConnected || chainId === CHAIN_ID) return null;

  return (
    <div className="bg-red-900/60 text-red-200 py-3 text-sm">
      <div className="max-w-3xl mx-auto px-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>Wrong network. Please switch to chain {CHAIN_ID}.</span>
        <WalletActionCta className="px-3 py-1.5 rounded-lg bg-red-200 text-red-950 font-semibold disabled:opacity-40" />
      </div>
    </div>
  );
}
