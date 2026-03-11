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
        className="nb-button nb-button-secondary min-h-11 px-3 py-2 text-[0.6875rem]"
        aria-label="Adjust slippage settings"
      >
        Slippage {slippageBps / 100}%
      </button>
      {open && (
        <div className="absolute right-0 top-14 z-10 w-56 rounded-[8px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]">
          <label className="nb-kicker mb-2 block text-[var(--color-border)]">
            Slippage (%)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="nb-input mono min-h-11 flex-1 px-3 py-2 text-sm"
            />
            <button
              onClick={apply}
              className="nb-button min-h-11 px-3 py-2 text-[0.6875rem]"
            >
              Set
            </button>
          </div>
          <div className="mt-2 text-xs text-[var(--color-ink)]/70">
            Range: 0.1% - 5%
          </div>
        </div>
      )}
    </div>
  );
}
