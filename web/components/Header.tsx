"use client";

import { CHAIN_NAME } from "@/lib/constants";

export function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-[var(--color-heading)]">
          OVRFLO
        </span>
        <span className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {CHAIN_NAME} only
        </span>
      </div>
      <appkit-button />
    </header>
  );
}
