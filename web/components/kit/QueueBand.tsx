"use client";

import "./kit.css";

export type QueueBandVariant = "queue" | "pool";
export type QueueBandState = "ready" | "empty-ahead" | "fits" | "partial" | "empty-tick" | "loading" | "unavailable";

export function QueueBand({
  variant = "queue",
  state,
  aheadFraction = 0,
  selfFraction = 0,
  valueText,
  aheadLabel,
  selfLabel,
}: {
  variant?: QueueBandVariant;
  state: QueueBandState;
  aheadFraction?: number;
  selfFraction?: number;
  valueText: string;
  aheadLabel: string;
  selfLabel: string;
}) {
  if (state === "loading") {
    return (
      <div className="kit-queue" data-state="loading">
        LOADING
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div className="kit-queue" data-state="unavailable">
        QUEUE UNAVAILABLE
      </div>
    );
  }

  const ahead = Math.max(0, aheadFraction);
  const self = Math.max(0, selfFraction);
  const overrun = variant === "pool" && self + ahead > 1 ? self + ahead - 1 : 0;
  const pool = variant === "pool" ? Math.max(0, 1 - self) : Math.max(0, 1 - ahead - self);

  return (
    <div className="kit-queue" data-state={state} data-variant={variant}>
      <div className="kit-queue-labels">
        <span>{aheadLabel}</span>
        <span>{selfLabel}</span>
      </div>
      <div
        className="kit-queue-band"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, self) * 100)}
        aria-valuetext={valueText}
      >
        {variant === "queue" ? (
          <>
            <div className="kit-dots" data-part="ahead" style={{ flex: `${ahead} 0 0` }} />
            <div
              className="kit-dots"
              data-part="self"
              style={{ flex: `${self} 1 0`, borderLeft: ahead > 0 ? "2px solid var(--ink)" : undefined }}
            />
          </>
        ) : (
          <>
            <div className="kit-dots" data-part="draw" style={{ flex: `${Math.min(self, 1)} 0 0` }} />
            <div className="kit-dots" data-part="pool" style={{ flex: `${pool} 1 0` }} />
            {overrun > 0 ? <div className="kit-dots" data-part="overrun" style={{ flex: `${overrun} 0 0` }} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
