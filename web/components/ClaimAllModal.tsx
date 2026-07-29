"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useTxQueue, type QueueRowStatus } from "@/hooks/useTxQueue";
import { planClaimAll, type QueuedTx } from "@/lib/claim-all";
import { formatAddress, formatId } from "@/lib/format";

// `asset` is the token the claim pays out in, carried through to the queue so a
// confirmed claim invalidates the balance read it changed.
export type ClaimAllPool = { lending: Address; loanId: bigint; claimable: bigint; asset: Address };
export type ClaimAllStream = { streamId: bigint; withdrawable: bigint; asset: Address };

type Props = {
  pools: ClaimAllPool[];
  streams: ClaimAllStream[];
  user: Address;
  onClose: () => void;
};

const STATUS_COPY: Record<QueueRowStatus, string> = {
  pending: "PENDING",
  signing: "SIGNING",
  confirming: "CONFIRMING",
  confirmed: "CONFIRMED",
  failed: "FAILED",
};

function rowCopy(tx: QueuedTx) {
  return tx.kind === "pool-claims"
    ? `CLAIM ${tx.loanIds.length} POOL SHARE${tx.loanIds.length === 1 ? "" : "S"} — ${formatAddress(tx.lending)}`
    : `CLAIM STREAM ${formatId(tx.streamId)}`;
}

// R3 claim-all review modal: nothing signs until CONFIRM QUEUE; the queue runs
// sequentially with per-row status; RESUME re-plans from the live props (never
// the stale plan); Escape/scrim-close are blocked while a tx is in flight.
export function ClaimAllModal({ pools, streams, user, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(panelRef, true);

  const queue = useTxQueue(user);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [started, setStarted] = useState(false);
  // Everything the user reviewed was claimed elsewhere before they confirmed.
  // Saying so beats queueing nothing and reporting success.
  const [nothingLeft, setNothingLeft] = useState(false);
  // The initial review plan; RESUME recomputes from the live pools/streams props.
  const [reviewPlan] = useState<QueuedTx[]>(() => planClaimAll({ pools, streams }));

  const closeBlocked = queue.inFlight;
  useEscapeKey(onClose, !closeBlocked);

  useEffect(() => {
    if (queue.done) doneRef.current?.focus();
  }, [queue.done]);
  useEffect(() => {
    if (queue.failed) closeRef.current?.focus();
  }, [queue.failed]);

  const rows = started ? queue.rows.map((row) => row.tx) : reviewPlan;

  return (
    <div className="modal-scrim" onClick={() => (closeBlocked ? undefined : onClose())}>
      <div
        className="modal-panel"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Claim all"
      >
        <div className="modal-header">
          <h3 className="modal-heading" tabIndex={-1} ref={headingRef}>
            CLAIM ALL
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={closeBlocked}
            aria-label="Close"
            ref={closeRef}
          >
            ✕
          </button>
        </div>
        <div className="claim-queue" aria-live="polite">
          {rows.length === 0 ? (
            <div className="empty mono">NOTHING CLAIMABLE</div>
          ) : (
            rows.map((tx, index) => (
              <div className="claim-queue-row mono" key={`${tx.kind}-${index}`}>
                <span>{rowCopy(tx)}</span>
                <span className="label mono">{started ? STATUS_COPY[queue.statusOf(index)] : "QUEUED"}</span>
              </div>
            ))
          )}
        </div>
        {queue.paused ? (
          <div className="label mono status-warning">WALLET CHANGED — RE-EVALUATING</div>
        ) : null}
        {queue.failed ? (
          <div className="label mono status-negative">TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES</div>
        ) : null}
        {nothingLeft ? (
          <div className="label mono status-warning" role="status">
            NOTHING LEFT TO CLAIM — THESE WERE CLAIMED ELSEWHERE WHILE THIS WAS OPEN
          </div>
        ) : null}
        {queue.done ? (
          <>
            <div className="label mono status-positive">ALL CLAIMS CONFIRMED</div>
            <button className="button button-gold mono" type="button" ref={doneRef} onClick={onClose}>
              DONE
            </button>
          </>
        ) : !started ? (
          <button
            className="button button-gold mono"
            type="button"
            disabled={reviewPlan.length === 0}
            onClick={() => {
              // R41/M-6: plan at submit, not at modal open. `reviewPlan` is the
              // snapshot the user is looking at, which is the right thing to
              // *show* — but between opening the modal and confirming, a stream
              // can be claimed elsewhere or a pool share drawn down, and
              // submitting the frozen plan would queue transactions that are
              // already spent. RESUME always re-planned; the first confirm did
              // not, which is the asymmetry M-6 identified.
              //
              // Planning from live props, not from a forced refetch, is the
              // deliberate choice. A refetch would narrow the window rather than
              // close it — the queue runs its transactions sequentially, so the
              // fifth claim can be spent by another session while the second is
              // still confirming, and no amount of pre-flight freshness covers
              // that. The queue already answers it properly: a spent claim
              // reverts, its row goes FAILED, and RESUME re-plans from live
              // data. Adding the refetch would also mean planning after an
              // await, and `pools` reaches this component through a child-effect
              // to parent-state hop (PositionSummaryMarket's onData) — so what
              // the plan read would depend on React flush ordering. A guarantee
              // that holds by timing luck is worse than the honest revert.
              const fresh = planClaimAll({ pools, streams });
              if (fresh.length === 0) {
                setNothingLeft(true);
                return;
              }
              setStarted(true);
              queue.start(fresh);
              // The confirm button unmounts once the queue runs — park focus on
              // the heading so it is never dropped to <body> (R3).
              headingRef.current?.focus();
            }}
          >
            CONFIRM QUEUE
          </button>
        ) : queue.failed || queue.paused ? (
          <button
            className="button button-gold mono"
            type="button"
            disabled={queue.inFlight}
            onClick={() => queue.resume(planClaimAll({ pools, streams }))}
          >
            RESUME
          </button>
        ) : null}
      </div>
    </div>
  );
}
