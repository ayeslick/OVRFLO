"use client";

import { useEffect, useState } from "react";

interface Props {
  slippageBps: number;
  onChange: (bps: number) => void;
}

export function SlippageSettings({ slippageBps, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(String(slippageBps / 100));

  useEffect(() => {
    setInput(String(slippageBps / 100));
  }, [slippageBps]);

  function apply() {
    const value = Number.parseFloat(input);
    if (Number.isNaN(value) || value < 0.1 || value > 5) return;
    onChange(Math.round(value * 100));
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="nb-icon-button"
        aria-label="Adjust slippage settings"
        aria-expanded={open}
      >
        <span aria-hidden>⚙</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-14 z-10 w-56 rounded-[4px] border-2 border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-ink)] shadow-[var(--shadow-hard-sm)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="slippage-input" className="nb-kicker text-[var(--color-border)]">
              Slippage
            </label>
            <span className="text-xs text-[var(--color-ink)]/70">0.1%–5%</span>
          </div>

          <div className="flex gap-2">
            <input
              id="slippage-input"
              type="text"
              inputMode="decimal"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="nb-input mono min-h-11 flex-1 px-3 py-2 text-sm"
            />
            <button type="button" onClick={apply} className="nb-button min-h-11 px-3 py-2 text-[0.6875rem]">
              Set
            </button>
          </div>

          <p className="mt-2 text-xs text-[var(--color-ink)]/70">Current: {slippageBps / 100}%</p>
        </div>
      ) : null}
    </div>
  );
}
