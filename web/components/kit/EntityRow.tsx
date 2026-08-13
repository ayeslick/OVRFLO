"use client";

import type { ReactNode } from "react";
import "./kit.css";

export type EntityRowState =
  | "resting"
  | "partial"
  | "filled"
  | "repaying"
  | "close-ready"
  | "eligible"
  | "pledged"
  | "vesting"
  | "settled"
  | "loading"
  | "unavailable";

export function EntityRow({
  identity,
  stateLine,
  decisive,
  state,
  selected = false,
  miniband,
  badge,
  onSelect,
}: {
  identity: string;
  stateLine: string;
  decisive: ReactNode;
  state: EntityRowState;
  selected?: boolean;
  miniband?: { filled: number } | null;
  badge?: string;
  onSelect?: () => void;
}) {
  const resting = state === "resting";
  const showBand = Boolean(miniband) && !resting;

  return (
    <button
      type="button"
      className="kit-entity-row"
      data-state={state}
      data-selected={selected ? "true" : "false"}
      onClick={onSelect}
    >
      <div className="kit-entity-top">
        <span>{identity}</span>
        {badge ? <span className="kit-entity-badge">{badge}</span> : null}
        <span className="kit-entity-decisive">{decisive}</span>
      </div>
      <div className="kit-entity-state">{stateLine}</div>
      {resting && miniband ? (
        <div className="kit-miniband" data-kind="inert" aria-hidden="true">
          <div className="kit-dots" style={{ flex: 1, color: "#8a8a8a" }} />
        </div>
      ) : null}
      {showBand && miniband ? (
        <div className="kit-miniband" data-kind="live" aria-hidden="true">
          <div
            className="kit-dots"
            style={{ flex: `${Math.max(0, miniband.filled)} 0 0`, color: "var(--gold-ink)" }}
          />
          <div
            className="kit-dots"
            style={{ flex: `${Math.max(0, 1 - miniband.filled)} 1 0`, color: "#8a8a8a" }}
          />
        </div>
      ) : null}
    </button>
  );
}
