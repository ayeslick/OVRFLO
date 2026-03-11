"use client";

import { CHAIN_NAME } from "@/lib/constants";

export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b-2 border-[var(--color-border)] bg-[var(--color-bg)] shadow-[0_4px_0_0_var(--color-border)]">
      <div className="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <a href="#portfolio" className="flex items-center gap-3 text-[var(--color-heading)]">
          <span className="flex h-11 w-11 items-center justify-center border-2 border-[var(--color-ink)] bg-[var(--color-accent)] text-sm font-bold tracking-[0.05em] text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]">
            OV
          </span>
          <span className="text-lg font-bold uppercase tracking-[0.05em]">OVRFLO</span>
        </a>

        <nav aria-label="Primary" className="flex items-center justify-center gap-3 sm:gap-6">
          <a href="#portfolio" className="nb-link">
            Portfolio
          </a>
          <a href="#stats" className="nb-link">
            Stats
          </a>
          <a href="#positions" className="nb-link">
            Positions
          </a>
        </nav>

        <div className="flex items-center justify-end gap-2">
          <span className="nb-chip nb-kicker hidden sm:inline-flex">{CHAIN_NAME} only</span>
          <div className="nb-wallet-shell">
            <appkit-button />
          </div>
        </div>
      </div>
    </header>
  );
}
