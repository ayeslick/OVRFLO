"use client";

import { useRef } from "react";
import { formatAprBps } from "@/lib/format";
import { TruncationNotice } from "./TruncationNotice";

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
  // R15/M-4: the group already claimed `radiogroup`/`radio` but behaved like a
  // row of buttons — every option sat in the tab order and arrows did nothing.
  // A radiogroup is one tab stop: Tab enters and leaves, arrows move within.
  // Anyone navigating by keyboard was otherwise forced to Tab through every
  // rate to reach the control after the ladder.
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = rows.findIndex((row) => row.aprBps === selectedAprBps);
  // With nothing selected the first row holds the tab stop, so the group is
  // always reachable.
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function moveTo(index: number) {
    const wrapped = (index + rows.length) % rows.length;
    onSelect(rows[wrapped].aprBps);
    // Selection and focus move together, which is what the radiogroup pattern
    // expects — arrowing through options announces each one as it is chosen.
    rowRefs.current[wrapped]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveTo(index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveTo(index - 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(rows.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="ladder" role="radiogroup" aria-label={label}>
      {truncated ? (
        <TruncationNotice limit={500} noun="IDS" detail="TOTALS MAY BE UNDERSTATED" />
      ) : null}
      {rows.length === 0 ? (
        // Dim, not status-negative: an empty or still-loading ladder is a
        // placeholder state, and status colors are reserved for errors.
        <div className="label mono">{emptyText}</div>
      ) : (
        rows.map((row, index) => (
          <button
            key={row.aprBps}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={row.aprBps === selectedAprBps}
            tabIndex={index === tabStopIndex ? 0 : -1}
            className={`ladder-row mono ${row.aprBps === selectedAprBps ? "ladder-row-selected" : ""}`}
            onClick={() => onSelect(row.aprBps)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{formatAprBps(row.aprBps)}</span>
            {row.cells.map((cell, cellIndex) => (
              <span key={cellIndex}>{cell}</span>
            ))}
            {row.best ? <span className="status-positive">BEST</span> : null}
          </button>
        ))
      )}
      {footnote ? <div className="label mono">{footnote}</div> : null}
    </div>
  );
}
