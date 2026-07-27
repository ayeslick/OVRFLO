"use client";

import { formatAprBps } from "@/lib/format";

// Shared tick ladder (tickets 06/07). Rows carry pre-formatted display cells so
// the borrow side (upfront %, borrowable depth) and the supply side (lender
// return, waiting liquidity) render through one component.

export type LadderRowSpec = {
  aprBps: number;
  cells: string[];
  best?: boolean;
};

export function RateLadder({
  label,
  rows,
  selectedAprBps,
  onSelect,
  truncated,
  emptyText,
  footnote,
}: {
  label: string;
  rows: LadderRowSpec[];
  selectedAprBps: number | null;
  onSelect: (aprBps: number) => void;
  truncated?: boolean;
  emptyText: string;
  footnote?: string | null;
}) {
  return (
    <div className="ladder" role="radiogroup" aria-label={label}>
      {truncated ? (
        <div className="label mono status-warning">LIQUIDITY LIST TRUNCATED — TOTALS MAY BE UNDERSTATED</div>
      ) : null}
      {rows.length === 0 ? (
        // Dim, not status-negative: an empty or still-loading ladder is a
        // placeholder state, and status colors are reserved for errors.
        <div className="label mono">{emptyText}</div>
      ) : (
        rows.map((row) => (
          <button
            key={row.aprBps}
            type="button"
            role="radio"
            aria-checked={row.aprBps === selectedAprBps}
            className={`ladder-row mono ${row.aprBps === selectedAprBps ? "ladder-row-selected" : ""}`}
            onClick={() => onSelect(row.aprBps)}
          >
            <span>{formatAprBps(row.aprBps)}</span>
            {row.cells.map((cell, index) => (
              <span key={index}>{cell}</span>
            ))}
            {row.best ? <span className="status-positive">BEST</span> : null}
          </button>
        ))
      )}
      {footnote ? <div className="label mono">{footnote}</div> : null}
    </div>
  );
}
