"use client";

import type { ReactNode } from "react";
import { SURFACE_STATE_LABEL, type SurfaceStateKind } from "@/lib/surface-state";
import { ActionButton } from "./ActionButton";
import "./kit.css";

export function SurfaceState({
  state,
  topology,
  onRefresh,
  children,
}: {
  state: SurfaceStateKind;
  topology: string;
  onRefresh?: () => void;
  children?: ReactNode;
}) {
  const label = SURFACE_STATE_LABEL[state];
  const role = state === "ERROR" ? "alert" : "status";
  return (
    <div
      className="kit-surface-state"
      data-surface-state={state}
      data-topology={topology}
      role={role}
    >
      <span className="kit-surface-state-label">{label}</span>
      {state === "STALE" && onRefresh ? (
        <ActionButton onClick={onRefresh}>REFRESH</ActionButton>
      ) : null}
      {children}
    </div>
  );
}
