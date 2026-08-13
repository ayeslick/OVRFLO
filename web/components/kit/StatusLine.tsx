"use client";

import "./kit.css";

export type StatusKind = "synced" | "reconnecting" | "degraded" | "unavailable";

export function StatusLine({
  status,
  asOf,
  usdUnavailable = false,
}: {
  status: StatusKind;
  asOf?: string;
  usdUnavailable?: boolean;
}) {
  const copy = statusCopy(status, asOf);
  return (
    <div className="kit-status" data-state={status} role="status">
      <span>{copy}</span>
      <span>{usdUnavailable ? "USD UNAVAILABLE" : "SCHEDULES TICK LIVE"}</span>
    </div>
  );
}

function statusCopy(status: StatusKind, asOf?: string) {
  if (status === "synced") return asOf ? `EVENTS AS OF ${asOf}` : "SYNCED";
  if (status === "reconnecting") return "RECONNECTING";
  if (status === "degraded") {
    return asOf ? `DEGRADED — SHOWING LAST KNOWN · EVENTS AS OF ${asOf}` : "DEGRADED — SHOWING LAST KNOWN";
  }
  return "EVENTS UNAVAILABLE";
}
