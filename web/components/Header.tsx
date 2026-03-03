"use client";

export function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-[var(--color-heading)]">
          OVRFLO
        </span>
      </div>
      <appkit-button />
    </header>
  );
}
