"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  useTxQueue,
  type QueueInvariant,
  type QueueRowStatus,
  type UseTxQueueOptions,
} from "@/hooks/useTxQueue";
import {
  claimAllInputCandidates,
  planClaimAll,
  sameClaimAllCandidates,
  sameClaimAllPlan,
  type ClaimAllPreflightEvaluation,
  type ClaimAllPreflightReason,
  type ClaimAllPreflightSource,
  type QueuedTx,
} from "@/lib/claim-all";
import { chainId as configuredChainId } from "@/lib/config";
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
  preflight?: ClaimAllPreflightEvaluation;
  onRetryPreflight?: (source: ClaimAllPreflightSource) => void;
  execution?: Pick<UseTxQueueOptions, "identity" | "rebuild" | "executor">;
};

const STATUS_COPY: Record<QueueRowStatus, string> = {
  pending: "PENDING",
  preparing: "PREPARING",
  confirmed: "CONFIRMED",
  skipped: "SKIPPED",
  "needs-review": "NEEDS REVIEW",
  paused: "PAUSED",
  "refresh-failed": "REFRESH FAILED",
  failed: "FAILED",
};

function rowCopy(tx: QueuedTx) {
  return tx.kind === "pool-claims"
    ? `CLAIM ${tx.claims.length} POOL SHARE${tx.claims.length === 1 ? "" : "S"} — ${formatAddress(tx.lending)}`
    : `CLAIM STREAM ${formatId(tx.streamId)}`;
}

const DEFAULT_PREFLIGHT: ClaimAllPreflightEvaluation = {
  status: "blocked",
  canReview: false,
  reason: "verifier-unavailable",
  candidateIds: [],
  progress: [
    {
      source: "markets",
      status: "failed",
      retryable: false,
      message: "Legacy lending discovery is not batch-complete",
    },
    {
      source: "streams",
      status: "failed",
      retryable: false,
      message: "Legacy stream discovery is not batch-complete",
    },
    {
      source: "hydration",
      status: "failed",
      retryable: false,
      message: "Batch hydration is unavailable",
    },
    {
      source: "verifier",
      status: "failed",
      retryable: false,
      message: "Independent verifier is unavailable",
    },
  ],
};

const NO_EXECUTOR: UseTxQueueOptions["executor"] = {
  confirm: async () => ({
    status: "invalid",
    errors: [
      {
        code: "snapshot-not-ready",
        message: "Claim All executor is unavailable",
      },
    ],
  }),
  retryRefresh: async () => null,
};

const NO_REBUILD: UseTxQueueOptions["rebuild"] = async () => ({
  status: "skipped",
});

function preflightInvariant(
  preflight: ClaimAllPreflightEvaluation,
  planMatchesPreflight: boolean,
): QueueInvariant {
  if (preflight.canReview && !planMatchesPreflight) {
    return { ready: false, reason: "completeness" };
  }
  if (preflight.canReview) return { ready: true };
  if (preflight.reason === "provider-disagreement") {
    return { ready: false, reason: "agreement" };
  }
  if (preflight.reason === "hydration-incomplete") {
    return { ready: false, reason: "hydration" };
  }
  return { ready: false, reason: "completeness" };
}

function preflightFailureCopy(reason: ClaimAllPreflightReason | null): string | null {
  switch (reason) {
    case "verifier-unavailable":
      return "INDEPENDENT VERIFIER UNAVAILABLE — BATCH DISABLED";
    case "provider-disagreement":
      return "PRIMARY AND VERIFIER CANDIDATE SETS DISAGREE — BATCH DISABLED";
    case "hydration-incomplete":
      return "LIVE HYDRATION IS INCOMPLETE — BATCH DISABLED";
    case "snapshot-mismatch":
      return "PREFLIGHT SOURCES DO NOT SHARE ONE BLOCK/HASH — BATCH DISABLED";
    case "discovery-incomplete":
      return "DISCOVERY IS INCOMPLETE — BATCH DISABLED";
    default:
      return null;
  }
}

// R3 claim-all review modal: nothing signs until CONFIRM QUEUE; the queue runs
// sequentially with per-row status; RESUME re-plans from the live props (never
// the stale plan); Escape/scrim-close are blocked while a tx is in flight.
export function ClaimAllModal({
  pools,
  streams,
  user,
  onClose,
  preflight = DEFAULT_PREFLIGHT,
  onRetryPreflight,
  execution,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(panelRef, true);
  const inputCandidates = claimAllInputCandidates({ pools, streams });
  const planMatchesPreflight = sameClaimAllCandidates(
    inputCandidates,
    preflight.candidateIds,
  );
  const canReviewPlan = preflight.canReview && planMatchesPreflight;

  const queue = useTxQueue({
    identity: execution?.identity ?? {
      account: user,
      chainId: configuredChainId,
    },
    invariants: () => preflightInvariant(preflight, planMatchesPreflight),
    rebuild: execution?.rebuild ?? NO_REBUILD,
    executor: execution?.executor ?? NO_EXECUTOR,
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [reviewing, setReviewing] = useState(false);
  const [started, setStarted] = useState(false);
  // Everything the user reviewed was claimed elsewhere before they confirmed.
  // Saying so beats queueing nothing and reporting success.
  const [nothingLeft, setNothingLeft] = useState(false);
  const [reviewChanged, setReviewChanged] = useState(false);
  // The initial review plan; RESUME recomputes from the live pools/streams props.
  const [reviewPlan, setReviewPlan] = useState<QueuedTx[]>(() =>
    planClaimAll({ pools, streams }),
  );

  const closeBlocked = queue.inFlight;
  useEscapeKey(onClose, !closeBlocked);

  useEffect(() => {
    if (queue.done) doneRef.current?.focus();
  }, [queue.done]);
  useEffect(() => {
    if (queue.failed) closeRef.current?.focus();
  }, [queue.failed]);
  useEffect(() => {
    if (!started && !canReviewPlan) setReviewing(false);
  }, [canReviewPlan, started]);

  const rows = started ? queue.rows.map((row) => row.tx) : reviewPlan;
  const failureCopy =
    preflight.canReview && !planMatchesPreflight
      ? "DISPLAYED CLAIMS NO LONGER MATCH THE CORROBORATED PREFLIGHT — BATCH DISABLED"
      : preflightFailureCopy(preflight.reason);

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
        {!reviewing && !started ? (
          <>
            <div className="label mono">PREFLIGHT</div>
            <div className="claim-queue" aria-live="polite">
              {preflight.progress.map((progress) => (
                <div className="claim-queue-row mono" key={progress.source}>
                  <span>
                    {progress.source.toUpperCase()} — {progress.status.toUpperCase()}
                  </span>
                  {progress.status === "failed" && progress.retryable && onRetryPreflight ? (
                    <button
                      className="button button-ghost mono"
                      type="button"
                      onClick={() => onRetryPreflight(progress.source)}
                    >
                      RETRY {progress.source.toUpperCase()}
                    </button>
                  ) : (
                    <span className="label mono">{progress.message}</span>
                  )}
                </div>
              ))}
            </div>
            {failureCopy ? (
              <>
                <div className="label mono status-warning">{failureCopy}</div>
                <div className="label mono">
                  INDIVIDUAL VERIFIED CLAIMS AND KNOWN-ID RECOVERY REMAIN AVAILABLE
                </div>
              </>
            ) : null}
            {canReviewPlan ? (
              <button
                className="button button-gold mono"
                type="button"
                onClick={() => {
                  const nextReview = planClaimAll({ pools, streams });
                  setReviewPlan(nextReview);
                  setReviewChanged(false);
                  if (nextReview.length === 0) {
                    setNothingLeft(true);
                    return;
                  }
                  setReviewing(true);
                }}
              >
                REVIEW CLAIMS
              </button>
            ) : null}
            <button
              className="button button-ghost mono"
              type="button"
              onClick={onClose}
            >
              CANCEL PREFLIGHT
            </button>
          </>
        ) : (
          <div className="claim-queue" aria-live="polite">
            {rows.length === 0 ? (
              <div className="empty mono">NOTHING CLAIMABLE</div>
            ) : (
              rows.map((tx, index) => (
                <div className="claim-queue-row mono" key={`${tx.kind}-${index}`}>
                  <span>{rowCopy(tx)}</span>
                  <span className="label mono">
                    {started ? STATUS_COPY[queue.statusOf(index)] : "QUEUED"}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {queue.paused ? (
          <div className="label mono status-warning">
            QUEUE PAUSED — RE-EVALUATING COMPLETENESS, ACCOUNT, AND CHAIN
          </div>
        ) : null}
        {queue.failed ? (
          <div className="label mono status-negative">TRANSACTION FAILED — RESUME RE-CHECKS CLAIMABLES</div>
        ) : null}
        {queue.needsReview ? (
          <div className="label mono status-warning">
            CLAIMS CHANGED — REVIEW THE UPDATED GROUP BEFORE CONTINUING
          </div>
        ) : null}
        {nothingLeft ? (
          <div className="label mono status-warning" role="status">
            NOTHING LEFT TO CLAIM — THESE WERE CLAIMED ELSEWHERE WHILE THIS WAS OPEN
          </div>
        ) : null}
        {reviewChanged ? (
          <div className="label mono status-warning" role="status">
            CLAIMS CHANGED WHILE REVIEWING — CHECK THE UPDATED QUEUE
          </div>
        ) : null}
        {queue.done ? (
          <>
            <div className="label mono status-positive">
              {queue.outcome === "complete_with_skips"
                ? "ALL AVAILABLE CLAIMS CONFIRMED — SOME ROWS SKIPPED"
                : "ALL CLAIMS CONFIRMED"}
            </div>
            <button className="button button-gold mono" type="button" ref={doneRef} onClick={onClose}>
              DONE
            </button>
          </>
        ) : reviewing && !started ? (
          <button
            className="button button-gold mono"
            type="button"
            disabled={reviewPlan.length === 0 || !canReviewPlan}
            onClick={() => {
              // R41/M-6: plan at submit, not at modal open. `reviewPlan` is the
              // snapshot the user is looking at, which is the right thing to
              // *show* — but between opening the modal and confirming, a stream
              // can be claimed elsewhere or a pool share drawn down, and
              // submitting the frozen plan would queue transactions that are
              // already spent. RESUME always re-planned; the first confirm did
              // not, which is the asymmetry M-6 identified.
              //
              // The live-prop replan catches changes already reflected by
              // React. It is not transaction authority: U6 rebuilds the row
              // again from one captured block immediately before simulation,
              // so changes that land between rows become skipped or require
              // another review without relying on render timing.
              const fresh = planClaimAll({ pools, streams });
              if (fresh.length === 0) {
                setNothingLeft(true);
                return;
              }
              if (!sameClaimAllPlan(reviewPlan, fresh)) {
                setReviewPlan(fresh);
                setReviewChanged(true);
                return;
              }
              setReviewChanged(false);
              setStarted(true);
              if (queue.rows.length === 0) {
                queue.start(fresh);
              } else {
                queue.acceptReview(fresh);
              }
              // The confirm button unmounts once the queue runs — park focus on
              // the heading so it is never dropped to <body> (R3).
              headingRef.current?.focus();
            }}
          >
            CONFIRM QUEUE
          </button>
        ) : queue.needsReview ? (
          <button
            className="button button-gold mono"
            type="button"
            disabled={!canReviewPlan}
            onClick={() => {
              setReviewPlan(planClaimAll({ pools, streams }));
              setReviewChanged(false);
              setReviewing(true);
              setStarted(false);
            }}
          >
            REVIEW CHANGES
          </button>
        ) : queue.failed || queue.paused ? (
          <button
            className="button button-gold mono"
            type="button"
            disabled={queue.inFlight || !canReviewPlan}
            onClick={() => queue.resume(planClaimAll({ pools, streams }))}
          >
            RESUME
          </button>
        ) : null}
      </div>
    </div>
  );
}
