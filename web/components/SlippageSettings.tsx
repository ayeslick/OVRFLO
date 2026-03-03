"use client";

import { useState } from "react";

interface Props {
  slippageBps: number;
  onChange: (bps: number) => void;
}

export function SlippageSettings({ slippageBps, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(String(slippageBps / 100));

  function apply() {
    const val = parseFloat(input);
    if (isNaN(val) || val < 0.1 || val > 5) return;
    onChange(Math.round(val * 100));
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
        title="Slippage settings"
      >
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-10 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3 w-48">
          <label className="text-xs text-[var(--color-muted)] mb-1 block">
            Slippage (%)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-heading)] mono"
            />
            <button
              onClick={apply}
              className="text-xs px-2 py-1 bg-[var(--color-accent)] text-[var(--color-bg)] rounded font-semibold"
            >
              Set
            </button>
          </div>
          <div className="text-xs text-[var(--color-muted)] mt-1">
            Range: 0.1% - 5%
          </div>
        </div>
      )}
    </div>
  );
}
