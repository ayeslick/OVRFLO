"use client";

import { ActionButton } from "@/components/kit/ActionButton";
import { Receipt, type ReceiptLine, type ReceiptState } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep } from "@/components/kit/SettlementTrace";
import { AcknowledgeRiskStep } from "@/components/first-run/AcknowledgeRiskStep";
import { formatAddress, formatAprBps, formatId, formatMaturityDate, formatTokenAmount } from "@/lib/format";
import type { RecoveryCopy } from "@/lib/recovery-copy";
import { reviewLiveCopy } from "@/lib/named-surface-state";
import { SupplyFacts } from "./Facts";
import {
  supplyTrace,
  type SupplyCheckpoint,
  type SupplySnapshot,
} from "./helpers";
import "./supply.css";

export function ReviewHandoff({
  frozen,
  live,
  drifted,
  checkpoint,
  steps,
  underlyingSymbol,
  expiry,
  operator,
  tokenApproved,
  acknowledged,
  signingBlockedReason,
  approveBusy,
  approveCooldown,
  clearing,
  supplyBusy,
  txHash,
  positionId,
  errorCopy,
  recoveryCopy,
  recoveryLabel,
  onApprove,
  onSupply,
  onRelatch,
  onRecovery,
  onViewPosition,
}: {
  frozen: SupplySnapshot;
  live: SupplySnapshot;
  drifted: boolean;
  checkpoint: SupplyCheckpoint;
  steps?: readonly TraceStep[];
  underlyingSymbol: string;
  expiry: bigint;
  operator: string;
  tokenApproved: boolean;
  acknowledged: boolean;
  signingBlockedReason?: string;
  approveBusy: boolean;
  approveCooldown: boolean;
  clearing: boolean;
  supplyBusy: boolean;
  txHash?: string;
  positionId?: bigint;
  errorCopy?: string;
  recoveryCopy?: RecoveryCopy | null;
  recoveryLabel?: string;
  onAcknowledge: () => void;
  onApprove: () => void;
  onSupply: () => void;
  onRelatch: () => void;
  onRecovery?: () => void;
  onViewPosition: (positionId: bigint) => void;
}) {
  const needsApprove = !tokenApproved;
  const ackRequired = !acknowledged && (checkpoint === "acknowledge" || checkpoint === "review");
  const trace = steps
    ? [...steps]
    : supplyTrace({
        underlyingSymbol,
        needsApprove,
        ackRequired,
        checkpoint,
      });
  const permissionState: ReceiptState =
    checkpoint === "approve" ? "current" : tokenApproved ? "skipped" : "ghosted";
  const actionState = actionReceiptState(checkpoint);
  const confirmed = checkpoint === "confirmed";
  const approveLocked = approveBusy || approveCooldown;
  const liveCopy = reviewLiveCopy({ drifted, checkpoint });

  return (
    <div className="supply-split" data-ui="UI-REVIEW-SPLIT" data-state={checkpoint}>
      {liveCopy ? (
        <p className="kit-vh" role="status" aria-live="polite" aria-atomic="true" data-ui="UI-REVIEW-LIVE">
          {liveCopy}
        </p>
      ) : null}
      <div>
        <p className="supply-kicker">REVIEW SUPPLY</p>
        <SupplyFacts
          amount={frozen.amount}
          aprBps={frozen.aprBps}
          expiry={expiry}
          ahead={frozen.ahead}
          underlyingSymbol={underlyingSymbol}
        />
        {drifted ? (
          <div className="supply-notice" data-kind="updated" data-ui="UI-REVIEW-STALE">
            <p>ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN</p>
            <div className="supply-diff">
              <span>
                AMOUNT {formatTokenAmount(frozen.amount, underlyingSymbol)} →{" "}
                {formatTokenAmount(live.amount, underlyingSymbol)}
              </span>
              <span>
                APR {formatAprBps(frozen.aprBps)} → {formatAprBps(live.aprBps)}
              </span>
              <span>
                AHEAD {formatTokenAmount(frozen.ahead, underlyingSymbol)} →{" "}
                {formatTokenAmount(live.ahead, underlyingSymbol)}
              </span>
            </div>
            <ActionButton onClick={onRelatch}>REVIEW AGAIN</ActionButton>
          </div>
        ) : null}
      </div>
      <div>
        <SettlementTrace steps={trace} />
        {ackRequired ? <AcknowledgeRiskStep path="fixed" /> : null}
        {!tokenApproved ? (
          <Receipt kind="permission" state={permissionState} lines={permissionLines(frozen.amount, operator, underlyingSymbol)} />
        ) : null}
        <Receipt
          kind="action"
          state={actionState}
          lines={
            confirmed
              ? confirmedLines({
                  positionId,
                  amount: frozen.amount,
                  aprBps: frozen.aprBps,
                  ahead: frozen.ahead,
                  underlyingSymbol,
                  expiry,
                })
              : actionLines({
                  amount: frozen.amount,
                  aprBps: frozen.aprBps,
                  ahead: frozen.ahead,
                  underlyingSymbol,
                  expiry,
                  hash: txHash,
                })
          }
          note={confirmed ? "ALWAYS TOKEN-EXACT" : undefined}
        />
        {clearing ? (
          <p className="supply-notice">THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE</p>
        ) : null}
        {recoveryCopy ? (
          <p className="supply-status" data-ui="UI-REVIEW-RECOVERY">
            {recoveryCopy.completed} {recoveryCopy.remaining} {recoveryCopy.next}
          </p>
        ) : null}
        {errorCopy ? (
          <p className="supply-error" role="alert" data-ui="UI-REVIEW-TX-STATE">
            {errorCopy}
            {recoveryLabel && onRecovery ? (
              <>
                {" "}
                <button type="button" className="supply-change" onClick={onRecovery}>
                  {recoveryLabel}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="supply-actions">
          {checkpoint === "approve" && signingBlockedReason ? (
            <ActionButton disabled disabledReason={signingBlockedReason}>
              {`APPROVE ${underlyingSymbol}`}
            </ActionButton>
          ) : null}
          {checkpoint === "approve" && !signingBlockedReason ? (
            approveLocked ? (
              <ActionButton variant="primary" busy>
                {`APPROVE ${underlyingSymbol}`}
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={onApprove}>
                {`APPROVE ${underlyingSymbol}`}
              </ActionButton>
            )
          ) : null}
          {checkpoint === "sign" && drifted ? (
            <ActionButton disabled disabledReason="ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN">
              SUPPLY
            </ActionButton>
          ) : null}
          {checkpoint === "sign" && !drifted && signingBlockedReason ? (
            <ActionButton disabled disabledReason={signingBlockedReason}>
              SUPPLY
            </ActionButton>
          ) : null}
          {checkpoint === "sign" && !drifted && !signingBlockedReason ? (
            supplyBusy ? (
              <ActionButton variant="primary" busy>
                SUPPLY
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={onSupply}>
                SUPPLY
              </ActionButton>
            )
          ) : null}
          {checkpoint === "pending" ? (
            <p className="supply-status">
              TRANSACTION {txHash ? truncateHash(txHash) : "SUBMITTED"} — SAFE TO LEAVE
            </p>
          ) : null}
          {checkpoint === "confirmed" && positionId !== undefined ? (
            <ActionButton variant="primary" onClick={() => onViewPosition(positionId)}>
              VIEW POSITION
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function actionReceiptState(checkpoint: SupplyCheckpoint): ReceiptState {
  if (checkpoint === "confirmed") return "confirmed";
  if (checkpoint === "pending") return "chain-pending";
  if (checkpoint === "sign") return "frozen-review";
  if (checkpoint === "approve" || checkpoint === "acknowledge") return "ghosted";
  return "frozen-review";
}

function permissionLines(amount: bigint, operator: string, underlyingSymbol: string): ReceiptLine[] {
  return [
    { key: "TOKEN", value: underlyingSymbol },
    { key: "SPENDER", value: `OVRFLO LENDING · ${formatAddress(operator as `0x${string}`)}` },
    { key: "ALLOWANCE", value: formatTokenAmount(amount, underlyingSymbol) },
    { key: "MATCH", value: "MATCH EXACT" },
  ];
}

function actionLines(input: {
  amount: bigint;
  aprBps: number;
  ahead: bigint;
  underlyingSymbol: string;
  expiry: bigint;
  hash?: string;
}): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { key: "AMOUNT", value: formatTokenAmount(input.amount, input.underlyingSymbol) },
    { key: "APR", value: formatAprBps(input.aprBps) },
    { key: "MATURITY", value: formatMaturityDate(input.expiry) },
    { key: "AHEAD", value: formatTokenAmount(input.ahead, input.underlyingSymbol) },
    { key: "EARNINGS", value: "BEGIN ONLY WHEN FILLED" },
  ];
  if (input.hash) lines.push({ key: "TX", value: truncateHash(input.hash) });
  return lines;
}

function confirmedLines(input: {
  positionId?: bigint;
  amount: bigint;
  aprBps: number;
  ahead: bigint;
  underlyingSymbol: string;
  expiry: bigint;
}): ReceiptLine[] {
  return [
    { key: "POSITION", value: input.positionId === undefined ? "—" : formatId(input.positionId) },
    { key: "AMOUNT", value: formatTokenAmount(input.amount, input.underlyingSymbol) },
    { key: "APR", value: formatAprBps(input.aprBps) },
    { key: "MATURITY", value: formatMaturityDate(input.expiry) },
    { key: "FILLED", value: formatTokenAmount(0n, input.underlyingSymbol) },
    { key: "UNFILLED", value: formatTokenAmount(input.amount, input.underlyingSymbol) },
    { key: "CLAIMABLE", value: formatTokenAmount(0n, input.underlyingSymbol) },
    { key: "AHEAD", value: formatTokenAmount(input.ahead, input.underlyingSymbol) },
  ];
}

function truncateHash(hash: string) {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}
