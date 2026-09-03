"use client";

import { useState } from "react";
import { ActionButton } from "@/components/kit/ActionButton";
import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { Receipt, type ReceiptLine, type ReceiptState } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep, type TraceStepState } from "@/components/kit/SettlementTrace";
import { AcknowledgeRiskStep } from "@/components/first-run/AcknowledgeRiskStep";
import { formatAddress, formatAprBps, formatCoverDate, formatId, formatTokenAmount } from "@/lib/format";
import type { RecoveryCopy } from "@/lib/recovery-copy";
import type { CoverDate } from "@/lib/payoff";
import { BorrowFacts, coverLabel } from "./Facts";
import type { BorrowQuote, BorrowQuoteSnapshot } from "./quote";
import "./borrow.css";

export type BorrowCheckpoint =
  | "review"
  | "acknowledge"
  | "approve"
  | "sign"
  | "pending"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "unknown";

export type ReviewMode = "borrow" | "post";

export function ReviewHandoff({
  quote,
  frozen,
  drifted,
  checkpoint,
  steps,
  underlyingSymbol,
  ovrfloSymbol,
  aprBps,
  streamId,
  operator,
  cover,
  repayCurrent,
  repayNext,
  acknowledged,
  streamApproved,
  signingBlockedReason,
  approveBusy,
  borrowBusy,
  txHash,
  loanId,
  actualNet,
  actualObligation,
  confirmedCover,
  errorCopy,
  recoveryCopy,
  recoveryLabel,
  onApprove,
  onBorrow,
  onRelatch,
  onRecovery,
  onViewLoan,
  onViewWaiting,
  mode = "borrow",
  waitingCopy,
}: {
  quote: BorrowQuote;
  frozen: BorrowQuoteSnapshot;
  drifted: boolean;
  checkpoint: BorrowCheckpoint;
  steps?: readonly TraceStep[];
  underlyingSymbol: string;
  ovrfloSymbol: string;
  aprBps: number;
  streamId: bigint;
  operator: string;
  cover: CoverDate;
  repayCurrent: CoverDate;
  repayNext: CoverDate;
  acknowledged: boolean;
  streamApproved: boolean;
  signingBlockedReason?: string;
  approveBusy: boolean;
  borrowBusy: boolean;
  txHash?: string;
  loanId?: bigint;
  actualNet?: bigint;
  actualObligation?: bigint;
  confirmedCover?: CoverDate;
  errorCopy?: string;
  recoveryCopy?: RecoveryCopy | null;
  recoveryLabel?: string;
  onAcknowledge: () => void;
  onApprove: () => void;
  onBorrow: () => void;
  onRelatch: () => void;
  onRecovery?: () => void;
  onViewLoan: (loanId: bigint) => void;
  onViewWaiting?: (streamId: bigint) => void;
  mode?: ReviewMode;
  waitingCopy?: string;
}) {
  const [feeOpen, setFeeOpen] = useState(true);
  const [repayOpen, setRepayOpen] = useState(true);
  const trace = steps ? [...steps] : settlementSteps(checkpoint, streamApproved, acknowledged, mode);
  const ackRequired = !acknowledged && (checkpoint === "acknowledge" || checkpoint === "review");
  const permissionState: ReceiptState =
    checkpoint === "approve" ? "current" : streamApproved ? "skipped" : "ghosted";
  const actionState = actionReceiptState(checkpoint);
  const confirmed = checkpoint === "confirmed";

  return (
    <div className="borrow-split" data-ui="UI-REVIEW-SPLIT" data-state={checkpoint}>
      <div>
        <p className="borrow-kicker">{mode === "post" ? "REVIEW REQUEST" : "REVIEW BORROW"}</p>
        {mode === "post" && waitingCopy ? <p className="borrow-lede">{waitingCopy}</p> : null}
        <BorrowFacts
          quote={quote}
          underlyingSymbol={underlyingSymbol}
          ovrfloSymbol={ovrfloSymbol}
          cover={cover}
          feeOpen={feeOpen}
          onToggleFee={() => setFeeOpen((open) => !open)}
        />
        <p className="borrow-fact">
          <span>APR</span>
          <span>{formatAprBps(aprBps)}</span>
        </p>
        <DisclosureRow
          id="borrow-repay-preview"
          label="REPAY PREVIEW · COVER DATES"
          open={repayOpen}
          onToggle={() => setRepayOpen((open) => !open)}
        >
          <div className="borrow-facts" data-ui="UI-REVIEW-REPAY">
            <div className="borrow-fact">
              <span>CURRENT COVER</span>
              <span>{coverLabel(repayCurrent)}</span>
            </div>
            <div className="borrow-fact">
              <span>AFTER FULL REPAY</span>
              <span>{coverLabel(repayNext)}</span>
            </div>
          </div>
        </DisclosureRow>
        {drifted ? (
          <div className="borrow-notice" data-kind="updated" data-ui="UI-BORROW-QUOTE-UPDATED">
            <p>QUOTE UPDATED</p>
            <div className="borrow-diff">
              <span>GROSS {formatTokenAmount(frozen.actualBorrow, underlyingSymbol)} → {formatTokenAmount(quote.actualBorrow, underlyingSymbol)}</span>
              <span>FEE {formatTokenAmount(frozen.feeAmount, underlyingSymbol)} → {formatTokenAmount(quote.feeAmount, underlyingSymbol)}</span>
              <span>OBLIGATION {formatTokenAmount(frozen.obligation, ovrfloSymbol)} → {formatTokenAmount(quote.obligation, ovrfloSymbol)}</span>
            </div>
            <ActionButton onClick={onRelatch}>REVIEW AGAIN</ActionButton>
          </div>
        ) : null}
      </div>
      <div>
        <SettlementTrace steps={trace} />
        {ackRequired ? <AcknowledgeRiskStep /> : null}
        {!streamApproved ? (
          <Receipt
            kind="permission"
            state={permissionState}
            lines={permissionLines(streamId, operator, mode)}
          />
        ) : null}
        <Receipt
          kind="action"
          state={actionState}
          lines={
            confirmed
              ? confirmedLines({
                  loanId,
                  net: actualNet ?? quote.net,
                  obligation: actualObligation ?? quote.obligation,
                  cover: confirmedCover ?? cover,
                  underlyingSymbol,
                  ovrfloSymbol,
                  streamId,
                  aprBps,
                })
              : actionLines({
                  quote,
                  underlyingSymbol,
                  ovrfloSymbol,
                  aprBps,
                  streamId,
                  hash: txHash,
                })
          }
          note={confirmed ? "ALWAYS TOKEN-EXACT" : undefined}
        />
        {recoveryCopy ? (
          <p className="borrow-status" data-ui="UI-REVIEW-RECOVERY">
            {recoveryCopy.completed} {recoveryCopy.remaining} {recoveryCopy.next}
          </p>
        ) : null}
        {errorCopy ? (
          <p className="borrow-error" role="alert" data-ui="UI-REVIEW-TX-STATE">
            {errorCopy}
            {recoveryLabel && onRecovery ? (
              <>
                {" "}
                <button type="button" className="borrow-change" onClick={onRecovery}>
                  {recoveryLabel}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="borrow-actions">
          {checkpoint === "approve" && signingBlockedReason ? (
            <ActionButton disabled disabledReason={signingBlockedReason}>
              APPROVE STREAM
            </ActionButton>
          ) : null}
          {checkpoint === "approve" && !signingBlockedReason ? (
            approveBusy ? (
              <ActionButton variant="primary" busy>
                APPROVE STREAM
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={onApprove}>
                APPROVE STREAM
              </ActionButton>
            )
          ) : null}
          {checkpoint === "sign" && drifted ? (
            <ActionButton disabled disabledReason="QUOTE UPDATED — REVIEW AGAIN">
              {mode === "post" ? "POST REQUEST" : "BORROW"}
            </ActionButton>
          ) : null}
          {checkpoint === "sign" && !drifted && signingBlockedReason ? (
            <ActionButton disabled disabledReason={signingBlockedReason}>
              {mode === "post" ? "POST REQUEST" : "BORROW"}
            </ActionButton>
          ) : null}
          {checkpoint === "sign" && !drifted && !signingBlockedReason ? (
            borrowBusy ? (
              <ActionButton variant="primary" busy>
                {mode === "post" ? "POST REQUEST" : "BORROW"}
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={onBorrow}>
                {mode === "post" ? "POST REQUEST" : "BORROW"}
              </ActionButton>
            )
          ) : null}
          {checkpoint === "pending" ? (
            <p className="borrow-status" data-named-state="transaction-pending">
              TRANSACTION {txHash ? truncateHash(txHash) : "SUBMITTED"} — SAFE TO LEAVE
            </p>
          ) : null}
          {checkpoint === "rejected" ? (
            <ActionButton variant="primary" onClick={onBorrow}>
              RETRY
            </ActionButton>
          ) : null}
          {checkpoint === "reverted" ? (
            <ActionButton variant="primary" onClick={onRelatch}>
              REVIEW AGAIN
            </ActionButton>
          ) : null}
          {checkpoint === "unknown" ? (
            <p className="borrow-status" data-named-state="transaction-unknown">
              TRANSACTION OUTCOME UNKNOWN — DO NOT SUBMIT AGAIN
            </p>
          ) : null}
          {checkpoint === "confirmed" && mode === "post" && onViewWaiting ? (
            <ActionButton variant="primary" onClick={() => onViewWaiting(streamId)}>
              VIEW WAITING REQUEST
            </ActionButton>
          ) : null}
          {checkpoint === "confirmed" && mode === "borrow" && loanId !== undefined ? (
            <ActionButton variant="primary" onClick={() => onViewLoan(loanId)}>
              VIEW LOAN
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function borrowTrace(
  checkpoint: BorrowCheckpoint,
  streamApproved: boolean,
  acknowledged: boolean,
  mode: ReviewMode = "borrow",
): TraceStep[] {
  return settlementSteps(checkpoint, streamApproved, acknowledged, mode);
}

function settlementSteps(
  checkpoint: BorrowCheckpoint,
  streamApproved: boolean,
  acknowledged: boolean,
  mode: ReviewMode = "borrow",
): TraceStep[] {
  const stream: TraceStepState = "done";
  const amount: TraceStepState = "done";
  const ack: TraceStepState =
    checkpoint === "acknowledge" ? "active" : acknowledged || pastAck(checkpoint) ? "done" : "pending";
  const approve: TraceStepState = streamApproved
    ? "skipped"
    : checkpoint === "approve"
      ? "active"
      : checkpoint === "acknowledge" || checkpoint === "review"
        ? "pending"
        : "done";
  const borrow: TraceStepState =
    checkpoint === "sign" || checkpoint === "rejected" || checkpoint === "reverted" || checkpoint === "unknown"
      ? "active"
      : checkpoint === "pending" || checkpoint === "confirmed"
        ? "done"
        : "pending";
  const settled: TraceStepState = checkpoint === "confirmed" ? "done" : "pending";
  const steps: TraceStep[] = [
    { id: "stream", label: "STREAM", state: stream },
    { id: "amount", label: "AMOUNT", state: amount },
  ];
  if (!acknowledged && (checkpoint === "acknowledge" || checkpoint === "review")) {
    steps.push({ id: "ack", label: "ACKNOWLEDGE RISK", state: ack });
  }
  steps.push(
    { id: "approve", label: "APPROVE STREAM", state: approve },
    { id: "borrow", label: mode === "post" ? "POST REQUEST" : "BORROW", state: borrow },
    { id: "settled", label: "SETTLED", state: settled },
  );
  return steps;
}

function pastAck(checkpoint: BorrowCheckpoint) {
  return (
    checkpoint === "approve" ||
    checkpoint === "sign" ||
    checkpoint === "pending" ||
    checkpoint === "confirmed" ||
    checkpoint === "rejected" ||
    checkpoint === "reverted" ||
    checkpoint === "unknown"
  );
}

function actionReceiptState(checkpoint: BorrowCheckpoint): ReceiptState {
  if (checkpoint === "confirmed") return "confirmed";
  if (checkpoint === "pending") return "chain-pending";
  if (checkpoint === "sign") return "frozen-review";
  if (checkpoint === "approve" || checkpoint === "acknowledge") return "ghosted";
  return "frozen-review";
}

function permissionLines(streamId: bigint, operator: string, mode: ReviewMode = "borrow"): ReceiptLine[] {
  return [
    { key: "ASSET", value: "Sablier stream NFT" },
    { key: "STREAM", value: formatId(streamId) },
    {
      key: "OPERATOR",
      value:
        mode === "post"
          ? `REQUEST BOOK · ${formatAddress(operator as `0x${string}`)}`
          : `OVRFLO LENDING · ${formatAddress(operator as `0x${string}`)}`,
    },
    { key: "SCOPE", value: "SINGLE STREAM" },
    { key: "MATCH", value: "MATCH EXACT" },
  ];
}

function actionLines(input: {
  quote: BorrowQuote;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  aprBps: number;
  streamId: bigint;
  hash?: string;
}): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { key: "STREAM", value: formatId(input.streamId) },
    { key: "APR", value: formatAprBps(input.aprBps) },
    { key: "GROSS", value: formatTokenAmount(input.quote.fill, input.underlyingSymbol) },
    { key: "FEE", value: formatTokenAmount(input.quote.feeAmount, input.underlyingSymbol) },
    { key: "NET", value: formatTokenAmount(input.quote.net, input.underlyingSymbol) },
    { key: "OBLIGATION", value: formatTokenAmount(input.quote.obligation, input.ovrfloSymbol) },
    { key: "MIN ACCEPTABLE", value: formatTokenAmount(input.quote.minAcceptable, input.underlyingSymbol) },
  ];
  if (input.hash) lines.push({ key: "TX", value: truncateHash(input.hash) });
  return lines;
}

function confirmedLines(input: {
  loanId?: bigint;
  net: bigint;
  obligation: bigint;
  cover: CoverDate;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  streamId: bigint;
  aprBps: number;
}): ReceiptLine[] {
  return [
    { key: "LOAN", value: input.loanId === undefined ? "—" : formatId(input.loanId) },
    { key: "NET", value: formatTokenAmount(input.net, input.underlyingSymbol) },
    { key: "OBLIGATION", value: formatTokenAmount(input.obligation, input.ovrfloSymbol) },
    { key: "COVER", value: input.cover.status === "projected" ? formatCoverDate(input.cover.at) : coverLabel(input.cover) },
    { key: "STREAM", value: formatId(input.streamId) },
    { key: "APR", value: formatAprBps(input.aprBps) },
  ];
}

function truncateHash(hash: string) {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}
