"use client";

import { useState } from "react";
import { ActionButton } from "@/components/kit/ActionButton";
import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { Receipt, type ReceiptLine, type ReceiptState } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep, type TraceStepState } from "@/components/kit/SettlementTrace";
import { formatAddress, formatAprBps, formatCoverDate, formatId, formatTokenAmount } from "@/lib/format";
import type { CoverDate } from "@/lib/payoff";
import { BorrowFacts, coverLabel } from "./Facts";
import type { BorrowQuote, QuoteSnapshot } from "./quote";
import "./borrow.css";

export type BorrowCheckpoint =
  | "review"
  | "acknowledge"
  | "approve"
  | "sign"
  | "pending"
  | "confirmed";

export function ReviewHandoff({
  quote,
  frozen,
  drifted,
  checkpoint,
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
  recoveryLabel,
  onAcknowledge,
  onApprove,
  onBorrow,
  onRelatch,
  onRecovery,
  onViewLoan,
}: {
  quote: BorrowQuote;
  frozen: QuoteSnapshot;
  drifted: boolean;
  checkpoint: BorrowCheckpoint;
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
  recoveryLabel?: string;
  onAcknowledge: () => void;
  onApprove: () => void;
  onBorrow: () => void;
  onRelatch: () => void;
  onRecovery?: () => void;
  onViewLoan: (loanId: bigint) => void;
}) {
  const [feeOpen, setFeeOpen] = useState(true);
  const [repayOpen, setRepayOpen] = useState(true);
  const trace = settlementSteps(checkpoint, streamApproved, acknowledged);
  const permissionState: ReceiptState =
    checkpoint === "approve" ? "current" : streamApproved ? "skipped" : "ghosted";
  const actionState = actionReceiptState(checkpoint);
  const confirmed = checkpoint === "confirmed";

  return (
    <div className="borrow-split" data-ui="UI-REVIEW-SPLIT" data-state={checkpoint}>
      <div>
        <p className="borrow-kicker">REVIEW BORROW</p>
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
              <span>GROSS {formatTokenAmount(frozen.gross, underlyingSymbol)} → {formatTokenAmount(quote.gross, underlyingSymbol)}</span>
              <span>FEE {formatTokenAmount(frozen.feeAmount, underlyingSymbol)} → {formatTokenAmount(quote.feeAmount, underlyingSymbol)}</span>
              <span>NET {formatTokenAmount(frozen.net, underlyingSymbol)} → {formatTokenAmount(quote.net, underlyingSymbol)}</span>
              <span>DEPTH {formatTokenAmount(frozen.depth, underlyingSymbol)} → {formatTokenAmount(quote.depth, underlyingSymbol)}</span>
            </div>
            <ActionButton onClick={onRelatch}>REVIEW AGAIN</ActionButton>
          </div>
        ) : null}
      </div>
      <div>
        <SettlementTrace steps={trace} />
        {!streamApproved ? (
          <Receipt
            kind="permission"
            state={permissionState}
            lines={permissionLines(streamId, operator)}
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
          {checkpoint === "acknowledge" ? (
            <ActionButton variant="primary" onClick={onAcknowledge}>
              ACKNOWLEDGE RISK
            </ActionButton>
          ) : null}
          {checkpoint === "approve" ? (
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
              BORROW
            </ActionButton>
          ) : null}
          {checkpoint === "sign" && !drifted && signingBlockedReason ? (
            <ActionButton disabled disabledReason={signingBlockedReason}>
              BORROW
            </ActionButton>
          ) : null}
          {checkpoint === "sign" && !drifted && !signingBlockedReason ? (
            borrowBusy ? (
              <ActionButton variant="primary" busy>
                BORROW
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={onBorrow}>
                BORROW
              </ActionButton>
            )
          ) : null}
          {checkpoint === "pending" ? (
            <p className="borrow-status">
              TRANSACTION {txHash ? truncateHash(txHash) : "SUBMITTED"} — SAFE TO LEAVE
            </p>
          ) : null}
          {checkpoint === "confirmed" && loanId !== undefined ? (
            <ActionButton variant="primary" onClick={() => onViewLoan(loanId)}>
              VIEW LOAN
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function settlementSteps(
  checkpoint: BorrowCheckpoint,
  streamApproved: boolean,
  acknowledged: boolean,
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
    checkpoint === "sign" ? "active" : checkpoint === "pending" || checkpoint === "confirmed" ? "done" : "pending";
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
    { id: "borrow", label: "BORROW", state: borrow },
    { id: "settled", label: "SETTLED", state: settled },
  );
  return steps;
}

function pastAck(checkpoint: BorrowCheckpoint) {
  return checkpoint === "approve" || checkpoint === "sign" || checkpoint === "pending" || checkpoint === "confirmed";
}

function actionReceiptState(checkpoint: BorrowCheckpoint): ReceiptState {
  if (checkpoint === "confirmed") return "confirmed";
  if (checkpoint === "pending") return "chain-pending";
  if (checkpoint === "sign") return "frozen-review";
  if (checkpoint === "approve" || checkpoint === "acknowledge") return "ghosted";
  return "frozen-review";
}

function permissionLines(streamId: bigint, operator: string): ReceiptLine[] {
  return [
    { key: "ASSET", value: "Sablier stream NFT" },
    { key: "STREAM", value: formatId(streamId) },
    { key: "OPERATOR", value: `OVRFLO LENDING · ${formatAddress(operator as `0x${string}`)}` },
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
