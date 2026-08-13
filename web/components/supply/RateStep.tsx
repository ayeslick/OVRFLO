"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { RateWindow, type RateTick, type RateWindowState } from "@/components/kit/RateWindow";
import type { LadderModel, TickWindow } from "@/lib/ladder";
import { formatAprBps, formatTokenAmount } from "@/lib/format";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import "./supply.css";

export function RateStep({
  windowState,
  window,
  selectedAprBps,
  underlyingSymbol,
  allRatesOpen,
  ladder,
  onSelect,
  onStep,
  onOpenAllRates,
  onCloseAllRates,
}: {
  windowState: RateWindowState;
  window: TickWindow;
  selectedAprBps: number | null;
  underlyingSymbol: string;
  allRatesOpen: boolean;
  ladder: LadderModel | null;
  onSelect: (aprBps: number) => void;
  onStep: (direction: -1 | 1) => void;
  onOpenAllRates: () => void;
  onCloseAllRates: () => void;
}) {
  const ticks: RateTick[] = window.rungs.map((rung) => ({
    id: String(rung.aprBps),
    aprLabel: formatAprBps(rung.aprBps),
    hint: `${formatTokenAmount(rung.availableWei, underlyingSymbol)} AHEAD`,
  }));

  return (
    <div data-ui="UI-SUPPLY-RATE-WINDOW" data-state={windowState}>
      <p className="supply-hint">Existing unfilled amount ahead at each tick. Ahead is not a wait-time estimate.</p>
      <div data-ui="UI-SUPPLY-STEPPER">
        <RateWindow
          ticks={ticks}
          selectedId={selectedAprBps === null ? undefined : String(selectedAprBps)}
          state={windowState}
          atMin={window.prev === "disabled-min"}
          atMax={window.next === "disabled-max"}
          neighborLow={window.neighborBelow ? formatAprBps(window.neighborBelow.aprBps) : undefined}
          neighborHigh={window.neighborAbove ? formatAprBps(window.neighborAbove.aprBps) : undefined}
          onSelect={(id) => onSelect(Number(id))}
          onStep={onStep}
          onAllRates={onOpenAllRates}
        />
      </div>
      <RatesWorkspace
        open={allRatesOpen}
        ladder={ladder}
        selectedAprBps={selectedAprBps}
        underlyingSymbol={underlyingSymbol}
        onPick={onSelect}
        onClose={onCloseAllRates}
      />
    </div>
  );
}

function RatesWorkspace({
  open,
  ladder,
  selectedAprBps,
  underlyingSymbol,
  onPick,
  onClose,
}: {
  open: boolean;
  ladder: LadderModel | null;
  selectedAprBps: number | null;
  underlyingSymbol: string;
  onPick: (aprBps: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEscapeKey(onClose, open);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!ladder || ladder.rungs.length === 0) return;
      const current = ladder.rungs.findIndex((rung) => rung.aprBps === selectedAprBps);
      const last = ladder.rungs.length - 1;
      let next = current < 0 ? 0 : current;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(last, next + 1);
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(0, next - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      else return;
      event.preventDefault();
      const rung = ladder.rungs[next];
      if (rung) onPick(rung.aprBps);
    },
    [ladder, onPick, selectedAprBps],
  );

  if (!open) return null;

  const emptyLadder = !ladder || ladder.rungs.length === 0;

  return (
    <dialog
      ref={dialog}
      className="supply-rates-dialog"
      data-ui="UI-RATES-WORKSPACE"
      data-state="supply-context"
      onClose={onClose}
    >
      <div className="supply-rates-head">
        <h2>ALL RATES · SUPPLY · {underlyingSymbol}</h2>
        <button type="button" className="supply-change" onClick={onClose} data-ui="UI-RATES-CLOSE">
          Close
        </button>
      </div>
      {emptyLadder ? (
        <p className="supply-status" data-state="unavailable">
          RATES UNAVAILABLE
        </p>
      ) : (
        <p className="supply-hint">Unfilled ahead at each configured tick.</p>
      )}
      {ladder && ladder.rungs.length > 0 ? (
        <div
          className="supply-rates-list"
          role="radiogroup"
          aria-label="All rates"
          data-ui="UI-RATES-LADDER"
          onKeyDown={onKeyDown}
        >
          {ladder.rungs.map((rung) => {
            const selected = rung.aprBps === selectedAprBps;
            return (
              <button
                key={rung.aprBps}
                type="button"
                role="radio"
                className="supply-rate-row"
                data-ui="UI-RATES-ROW"
                aria-checked={selected}
                onClick={() => {
                  onPick(rung.aprBps);
                  onClose();
                }}
              >
                <span>{selected ? `■ ${formatAprBps(rung.aprBps)}` : formatAprBps(rung.aprBps)}</span>
                <span>{formatTokenAmount(rung.availableWei, underlyingSymbol)} AHEAD</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </dialog>
  );
}
