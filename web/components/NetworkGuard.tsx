"use client";

import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { CHAIN_ID } from "@/lib/config";
import { WalletActionCta } from "./WalletActionCta";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export function NetworkGuard({ children, fallback }: Props) {
  const { chainId, isConnected } = useAccount();
  const rightChain = !isConnected || chainId === CHAIN_ID;

  if (rightChain) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <WalletActionCta
          className="nb-button nb-button-secondary flex items-center gap-2"
        />
      )}
    </>
  );
}
