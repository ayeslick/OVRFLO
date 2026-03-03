"use client";

import { useAccount } from "wagmi";
import { CHAIN_ID } from "@/lib/constants";

export function WrongNetworkBanner() {
  const { chainId, isConnected } = useAccount();

  if (!isConnected || chainId === CHAIN_ID) return null;

  return (
    <div className="bg-red-900/60 text-red-200 text-center py-2 text-sm">
      Wrong network. Please switch to chain {CHAIN_ID}.
    </div>
  );
}
