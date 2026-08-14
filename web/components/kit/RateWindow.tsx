"use client";

import "./kit.css";
import "./forced-colors.css";

export type RateTick = {
  id: string;
  aprLabel: string;
  hint: string;
};

export type RateWindowState = "loading" | "ready" | "empty" | "unavailable";

export function RateWindow({
  ticks,
  selectedId,
  state,
  atMin,
  atMax,
  neighborLow,
  neighborHigh,
  onSelect,
  onStep,
  onAllRates,
}: {
  ticks: readonly RateTick[];
  selectedId?: string;
  state: RateWindowState;
  atMin: boolean;
  atMax: boolean;
  neighborLow?: string;
  neighborHigh?: string;
  onSelect?: (id: string) => void;
  onStep?: (direction: -1 | 1) => void;
  onAllRates?: () => void;
}) {
  if (state === "loading") {
    return (
      <div className="kit-rate-window-status" data-state="loading">
        LOADING RATES
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div className="kit-rate-window-status" data-state="unavailable">
        RATES UNAVAILABLE
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="kit-rate-window-status" data-state="empty">
        NO LIQUIDITY POSTED AT ANY RATE
      </div>
    );
  }

  return (
    <div className="kit-rate-window" data-state="ready">
      <div className="kit-rates">
        <button
          type="button"
          className="kit-paddle"
          aria-label="Lower APR"
          disabled={atMin}
          onClick={() => onStep?.(-1)}
        >
          ◂
          {atMin ? <span className="kit-paddle-reason">LOWEST CONFIGURED APR</span> : null}
        </button>
        <div className="kit-rate-chips">
          {ticks.map((tick) => {
            const selected = tick.id === selectedId;
            return (
              <button
                key={tick.id}
                type="button"
                className="kit-rate"
                data-selected={selected ? "true" : "false"}
                aria-pressed={selected}
                onClick={() => onSelect?.(tick.id)}
              >
                <div className="kit-rate-apr">{selected ? `■ ${tick.aprLabel}` : tick.aprLabel}</div>
                <div className="kit-rate-hint">{tick.hint}</div>
                <div className="kit-dots kit-rate-band" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="kit-paddle"
          aria-label="Higher APR"
          disabled={atMax}
          onClick={() => onStep?.(1)}
        >
          ▸
          {atMax ? <span className="kit-paddle-reason">HIGHEST CONFIGURED APR</span> : null}
        </button>
      </div>
      <div className="kit-stepper-hint">
        <span>{neighborLow ?? ""}</span>
        <button type="button" className="kit-all-rates" onClick={onAllRates}>
          ALL RATES
        </button>
        <span>{neighborHigh ?? ""}</span>
      </div>
    </div>
  );
}
