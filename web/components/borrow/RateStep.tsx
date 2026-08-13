"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { RateWindow, type RateTick, type RateWindowState } from "@/components/kit/RateWindow";
import type { LadderModel, TickWindow } from "@/lib/ladder";
import { formatAprBps, formatTokenAmount } from "@/lib/format";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { liveTickCopy } from "./quote";
import "./borrow.css";

export function RateStep({
  windowState,
  window,
  selectedAprBps,
  underlyingSymbol,
  allRatesOpen,
  ladder,
  emptyTickCopy,
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
  emptyTickCopy?: string;
  onSelect: (aprBps: number) => void;
  onStep: (direction: -1 | 1) => void;
  onOpenAllRates: () => void;
  onCloseAllRates: () => void;
}) {
  const ticks: RateTick[] = window.rungs.map((rung) => ({
    id: String(rung.aprBps),
    aprLabel: formatAprBps(rung.aprBps),
    hint: `${formatTokenAmount(rung.availableWei, underlyingSymbol)} AVAILABLE`,
  }));

  return (
    <div data-ui="UI-BORROW-RATE-WINDOW" data-state={windowState}>
      <p className="borrow-hint">Lower rate, deeper pool — depth is not a guaranteed fill.</p>
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
      {emptyTickCopy ? (
        <p className="borrow-notice" data-ui="UI-BORROW-POOL-BAND" data-state="empty-tick">
          {emptyTickCopy}
        </p>
      ) : null}
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
  const noLive = ladder?.pickable.length === 0 && ladder.rungs.length > 0;

  return (
    <dialog
      ref={dialog}
      className="borrow-rates-dialog"
      data-ui="UI-RATES-WORKSPACE"
      data-state="borrow-context"
      onClose={onClose}
    >
      <div className="borrow-rates-head">
        <h2>ALL RATES · BORROW · {underlyingSymbol}</h2>
        <button type="button" className="borrow-change" onClick={onClose}>
          Close
        </button>
      </div>
      {emptyLadder ? (
        <p className="borrow-status" data-state="unavailable">
          RATES UNAVAILABLE
        </p>
      ) : noLive ? (
        <p className="borrow-status" data-ui="UI-RATES-EMPTY" data-state="no-live-depth">
          NO LIQUIDITY POSTED AT ANY RATE
        </p>
      ) : (
        <p className="borrow-hint">{liveTickCopy(ladder)}</p>
      )}
      {ladder && ladder.rungs.length > 0 ? (
        <div
          className="borrow-rates-list"
          role="radiogroup"
          aria-label="All rates"
          data-ui="UI-RATES-LADDER"
          onKeyDown={onKeyDown}
        >
          {ladder.rungs.map((rung) => {
            const selected = rung.aprBps === selectedAprBps;
            const empty = rung.kind === "empty";
            return (
              <button
                key={rung.aprBps}
                type="button"
                role="radio"
                className="borrow-rate-row"
                data-ui="UI-RATES-ROW"
                data-kind={empty ? "empty" : "live"}
                aria-checked={selected}
                onClick={() => {
                  onPick(rung.aprBps);
                  onClose();
                }}
              >
                <span>{selected ? `■ ${formatAprBps(rung.aprBps)}` : formatAprBps(rung.aprBps)}</span>
                <span>{formatTokenAmount(rung.availableWei, underlyingSymbol)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </dialog>
  );
}
