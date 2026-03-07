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
      <div className={className}>
        <appkit-button />
      </div>
    );
  }

  if (chainId === CHAIN_ID) return null;

  return (
    <button
      onClick={() => void switchChainAsync({ chainId: CHAIN_ID })}
      disabled={isPending}
      className={className ?? "w-full py-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-bg)] font-semibold disabled:opacity-40"}
    >
      {isPending ? "Switching..." : `Switch to chain ${CHAIN_ID}`}
    </button>
  );
}
