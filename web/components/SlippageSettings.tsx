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
        className="nb-icon-button h-9 w-9 text-sm"
        aria-label="Adjust slippage settings"
        aria-expanded={open}
        data-testid="button-slippage-settings"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16.2 12.5a1.4 1.4 0 00.3 1.5l.05.05a1.7 1.7 0 01-1.2 2.9 1.7 1.7 0 01-1.2-.5l-.05-.05a1.4 1.4 0 00-1.5-.3 1.4 1.4 0 00-.85 1.28v.14a1.7 1.7 0 11-3.4 0v-.07a1.4 1.4 0 00-.92-1.28 1.4 1.4 0 00-1.5.3l-.05.05a1.7 1.7 0 11-2.4-2.4l.05-.05a1.4 1.4 0 00.3-1.5 1.4 1.4 0 00-1.28-.85h-.14a1.7 1.7 0 110-3.4h.07A1.4 1.4 0 003.5 7.53a1.4 1.4 0 00-.3-1.5l-.05-.05a1.7 1.7 0 112.4-2.4l.05.05a1.4 1.4 0 001.5.3h.07a1.4 1.4 0 00.85-1.28v-.14a1.7 1.7 0 113.4 0v.07a1.4 1.4 0 00.85 1.28 1.4 1.4 0 001.5-.3l.05-.05a1.7 1.7 0 112.4 2.4l-.05.05a1.4 1.4 0 00-.3 1.5v.07a1.4 1.4 0 001.28.85h.14a1.7 1.7 0 110 3.4h-.07a1.4 1.4 0 00-1.28.85z" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open ? (
        <div
          className="absolute right-0 top-12 z-10 w-56 border-2 border-[#000] bg-white p-4 text-black shadow-[var(--shadow-hard-sm)]"
          data-testid="panel-slippage"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="nb-kicker text-black/40">Slippage</span>
            <span className="mono text-xs font-semibold text-black/50">0.1% – 5%</span>
          </div>

          <div className="flex gap-2">
            <input
              id="slippage-input"
              type="text"
              inputMode="decimal"
              aria-label="Slippage tolerance in percent"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="nb-input mono flex-1 px-3 py-2 text-sm"
              style={{ minHeight: "40px" }}
              data-testid="input-slippage"
            />
            <button
              type="button"
              onClick={apply}
              className="nb-button px-3 py-2 text-[10px]"
              style={{ minHeight: "40px" }}
              data-testid="button-set-slippage"
            >
              Set
            </button>
          </div>

          <p className="mono mt-2 text-xs text-black/50">
            Current: {slippageBps / 100}%
          </p>
        </div>
      ) : null}
    </div>
  );
}
