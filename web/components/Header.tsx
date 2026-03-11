"use client";

import { modal as appKitModal } from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/constants";

function formatAddress(address: `0x${string}`) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Header() {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const wrongChain = Boolean(address && chainId !== undefined && chainId !== CHAIN_ID);

  const walletLabel = wrongChain
    ? isPending
      ? "Switching..."
      : "Switch Network"
    : address
      ? formatAddress(address)
      : "Connect Wallet";
  const walletButtonClass = wrongChain ? "nb-button" : "nb-button nb-button-secondary";
  const walletIndicatorClass = wrongChain
    ? "border-[var(--color-ink)] bg-[#ffd166]"
    : address
      ? "border-[var(--color-ink)] bg-[var(--color-accent)]"
      : "border-[var(--color-border)] bg-[var(--color-surface-muted)]";

  const handleWalletAction = () => {
    if (wrongChain) {
      void switchChainAsync({ chainId: CHAIN_ID });
      return;
    }

    void appKitModal?.open(address ? { view: "Account" } : { view: "Connect", namespace: "eip155" });
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b-2 border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <a href="#portfolio" aria-label="OVERFLOW" className="flex items-center gap-3 text-[var(--color-heading)]">
          <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-hard-sm)]">
            <img
              src="/brand/overflow-mark.png"
              alt="Overflow mark"
              width={44}
              height={44}
              className="h-11 w-11 object-contain"
            />
          </span>
          <span className="text-lg font-bold uppercase tracking-[0.05em] sm:text-xl">OVERFLOW</span>
        </a>

        <button
          type="button"
          onClick={handleWalletAction}
          disabled={isPending}
          aria-label={wrongChain ? `Switch wallet network to ${CHAIN_NAME}` : address ? `Open account for wallet ${address}` : "Connect wallet"}
          title={address ?? walletLabel}
          className={`${walletButtonClass} min-h-12 min-w-[176px] justify-between rounded-[4px] px-3 py-2 sm:min-w-[208px]`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className={`h-3 w-3 shrink-0 border-2 ${walletIndicatorClass}`} />
            <span className="mono truncate text-sm font-semibold uppercase tracking-[0.05em] text-[var(--color-ink)]">
              {walletLabel}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.5 6L8 10.5L12.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
            </svg>
          </span>
        </button>
      </div>
    </header>
  );
}
