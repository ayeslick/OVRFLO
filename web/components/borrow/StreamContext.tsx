"use client";

import type { HydratedStream } from "@/hooks/useStreams";
import { formatId, formatMaturityDate, formatTokenAmount } from "@/lib/format";
import "./borrow.css";

export function StreamContext({
  stream,
  ovrfloSymbol,
  stale,
  onChange,
}: {
  stream: HydratedStream;
  ovrfloSymbol: string;
  stale?: boolean;
  onChange: () => void;
}) {
  return (
    <div data-ui="UI-BORROW-STREAM-CONTEXT" data-state={stale ? "stale" : "ready"}>
      <button type="button" className="borrow-change" onClick={onChange}>
        ← CHANGE STREAM
      </button>
      <div className="borrow-stream-meta">
        <span>STREAM {formatId(stream.streamId)}</span>
        <span>REMAINING {formatTokenAmount(stream.remaining, ovrfloSymbol)}</span>
        <span>MATURITY {formatMaturityDate(stream.schedule.end)}</span>
      </div>
    </div>
  );
}
