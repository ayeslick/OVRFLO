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

  const handleWalletAction = () => {
    if (wrongChain) {
      void switchChainAsync({ chainId: CHAIN_ID });
      return;
    }
    void appKitModal?.open(address ? { view: "Account" } : { view: "Connect", namespace: "eip155" });
  };

  return (
    <header
      className="sticky top-0 z-50 border-b-2 border-[#000] bg-white"
      data-testid="header"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-20 sm:px-6 lg:px-8">
        {/* Logo */}
        <a
          href="#"
          aria-label="OVRFLO"
          className="flex shrink-0 items-center gap-2 sm:gap-3"
          data-testid="link-home"
        >
          <span className="flex h-8 w-8 items-center justify-center border-2 border-[#000] bg-[#0b1221] sm:h-10 sm:w-10">
            <span className="flex h-4 w-4 items-center justify-center border-2 border-[#000] bg-[#5dc0f5] sm:h-5 sm:w-5" />
          </span>
          <span className="text-base font-bold uppercase tracking-tight text-black sm:text-lg">OVRFLO</span>
        </a>

        {/* Right side actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Settings icon button */}
          <button
            type="button"
            className="nb-icon-button"
            aria-label="Settings"
            data-testid="button-settings"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M16.2 12.5a1.4 1.4 0 00.3 1.5l.05.05a1.7 1.7 0 01-1.2 2.9 1.7 1.7 0 01-1.2-.5l-.05-.05a1.4 1.4 0 00-1.5-.3 1.4 1.4 0 00-.85 1.28v.14a1.7 1.7 0 11-3.4 0v-.07a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.5.3l-.05.05a1.7 1.7 0 11-2.4-2.4l.05-.05a1.4 1.4 0 00.3-1.5 1.4 1.4 0 00-1.28-.85h-.14a1.7 1.7 0 110-3.4h.07A1.4 1.4 0 003.5 7.53a1.4 1.4 0 00-.3-1.5l-.05-.05a1.7 1.7 0 112.4-2.4l.05.05a1.4 1.4 0 001.5.3h.07a1.4 1.4 0 00.85-1.28v-.14a1.7 1.7 0 113.4 0v.07a1.4 1.4 0 00.85 1.28 1.4 1.4 0 001.5-.3l.05-.05a1.7 1.7 0 112.4 2.4l-.05.05a1.4 1.4 0 00-.3 1.5v.07a1.4 1.4 0 001.28.85h.14a1.7 1.7 0 110 3.4h-.07a1.4 1.4 0 00-1.28.85z" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>

          {/* Wallet button */}
          <button
            type="button"
            onClick={handleWalletAction}
            disabled={isPending}
            aria-label={wrongChain ? `Switch wallet network to ${CHAIN_NAME}` : address ? `Open account for wallet ${address}` : "Connect wallet"}
            title={address ?? walletLabel}
            className="nb-button nb-button-dark flex items-center gap-1.5 px-3 py-2 sm:gap-2.5 sm:px-4"
            data-testid="button-wallet"
          >
            {/* Wallet icon */}
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 8v8a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h8" stroke="#5dc0f5" strokeWidth="1.5" strokeLinecap="square" />
              <circle cx="14" cy="12" r="1" fill="#5dc0f5" />
            </svg>
            <span className="mono text-sm font-semibold uppercase tracking-wider">
              {walletLabel}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
