"use client";

import { useAccount } from "wagmi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/constants";
import { WalletActionCta } from "./WalletActionCta";

export function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount();

  if (!isConnected || chainId === CHAIN_ID) return null;

  return (
    <div
      className="border-b-2 border-[#000] bg-[#fff4d6] px-6 py-3 lg:px-8"
      data-testid="banner-wrong-network"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-semibold text-black">
          OVRFLO supports {CHAIN_NAME} only. Please switch your wallet to chain {CHAIN_ID}.
        </span>
        <WalletActionCta className="nb-button px-4 py-2 text-xs sm:w-auto" />
      </div>
    </div>
  );
}
