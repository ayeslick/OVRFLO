"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { CHAIN_ID } from "@/lib/constants";

interface Props {
  className?: string;
}

export function WalletActionCta({ className }: Props) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();

  if (!address) {
    return (
      <div className={className ?? "nb-wallet-shell"}>
        <appkit-button />
      </div>
    );
  }

  if (chainId === CHAIN_ID) return null;

  return (
    <button
      onClick={() => void switchChainAsync({ chainId: CHAIN_ID })}
      disabled={isPending}
      className={className ?? "nb-button w-full"}
    >
      {isPending ? "Switching..." : `Switch to chain ${CHAIN_ID}`}
    </button>
  );
}
