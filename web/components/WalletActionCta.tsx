"use client";

import { modal as appKitModal } from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/constants";

interface Props {
  className?: string;
}

export function WalletActionCta({ className }: Props) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();

  if (!address) {
    return (
      <button
        type="button"
        onClick={() => void appKitModal?.open({ view: "Connect", namespace: "eip155" })}
        className={className ?? "nb-button nb-button-dark w-full"}
        aria-label="Connect wallet"
        data-testid="button-connect-wallet"
      >
        Connect Wallet
      </button>
    );
  }

  if (chainId === CHAIN_ID) return null;

  return (
    <button
      type="button"
      onClick={() => void switchChainAsync({ chainId: CHAIN_ID })}
      disabled={isPending}
      className={className ?? "nb-button nb-button-dark w-full"}
      aria-label={`Switch wallet network to ${CHAIN_NAME}`}
      data-testid="button-switch-network"
    >
      {isPending ? "Switching..." : `Switch to ${CHAIN_NAME}`}
    </button>
  );
}
