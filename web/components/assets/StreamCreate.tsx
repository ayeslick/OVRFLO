"use client";

import { ActionButton } from "@/components/kit/ActionButton";
import { AmountField } from "@/components/kit/AmountField";
import { Receipt, type ReceiptLine, type ReceiptState } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep } from "@/components/kit/SettlementTrace";
import { formatMaturityDate, formatTokenAmount } from "@/lib/format";
import { StreamSelectMarket, type StreamMarketOption } from "./StreamSelectMarket";
import "./assets.css";
import type { Address } from "viem";

export type StreamCreateStage =
  | "market"
  | "amount"
  | "review"
  | "ack"
  | "approve-pt"
  | "approve-fee"
  | "sign"
  | "pending"
  | "confirmed";

export type StreamCreateProps = {
  stage: StreamCreateStage;
  marketStatus: "loading" | "ready" | "empty" | "unavailable";
  markets: readonly StreamMarketOption[];
  selectedMarket: Address | null;
  onSelectMarket: (id: Address) => void;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  amountRaw: string;
  onAmount: (next: string) => void;
  amountError?: string;
  ptBalanceLabel: string;
  maxDisabled?: boolean;
  onMax?: () => void;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueReason?: string;
  steps: readonly TraceStep[];
  ptIn?: bigint;
  minted?: bigint;
  streamAmount?: bigint;
  currentFee?: bigint;
  boundedApproval?: bigint;
  maturity?: bigint;
  capCopy?: string | null;
  permissionLines: readonly ReceiptLine[];
  permissionState: ReceiptState;
  actionLines: readonly ReceiptLine[];
  actionState: ReceiptState;
  onAcknowledge?: () => void;
  onApprovePt?: () => void;
  approvePtBusy?: boolean;
  approvePtDisabled?: boolean;
  approvePtReason?: string;
  onApproveFee?: () => void;
  approveFeeBusy?: boolean;
  approveFeeDisabled?: boolean;
  approveFeeReason?: string;
  onDeposit?: () => void;
  depositBusy?: boolean;
  depositDisabled?: boolean;
  depositReason?: string;
  txCopy?: string;
  txState?: string;
  onRetryRefresh?: () => void;
  refreshFailed?: boolean;
  needsReview?: boolean;
  onReReview?: () => void;
  streamId?: bigint | null;
  borrowHref?: string;
  viewStreamHref?: string;
};

export function StreamCreate({
  stage,
  marketStatus,
  markets,
  selectedMarket,
  onSelectMarket,
  underlyingSymbol,
  ovrfloSymbol,
  amountRaw,
  onAmount,
  amountError,
  ptBalanceLabel,
  maxDisabled,
  onMax,
  onContinue,
  continueDisabled,
  continueReason,
  steps,
  ptIn,
  minted,
  streamAmount,
  currentFee,
  boundedApproval,
  maturity,
  capCopy,
  permissionLines,
  permissionState,
  actionLines,
  actionState,
  onAcknowledge,
  onApprovePt,
  approvePtBusy,
  approvePtDisabled,
  approvePtReason,
  onApproveFee,
  approveFeeBusy,
  approveFeeDisabled,
  approveFeeReason,
  onDeposit,
  depositBusy,
  depositDisabled,
  depositReason,
  txCopy,
  txState,
  onRetryRefresh,
  refreshFailed,
  needsReview,
  onReReview,
  streamId,
  borrowHref,
  viewStreamHref,
}: StreamCreateProps) {
  if (stage === "market") {
    return (
      <StreamSelectMarket
        status={marketStatus}
        markets={markets}
        selected={selectedMarket}
        onSelect={onSelectMarket}
        onContinue={onContinue}
      />
    );
  }

  if (stage === "amount") {
    return (
      <section data-ui="UI-ASSETS-STREAM-ENTER-PT" data-control="UI-ASSETS-STREAM-ENTER-PT" data-state={amountError ? "invalid" : amountRaw ? "valid" : "empty"}>
        <span className="assets-bay-kicker">CREATE STREAM</span>
        <h2 className="assets-bay-title">PT amount</h2>
        <p className="assets-note">WALLET PT {ptBalanceLabel}</p>
        <AmountField
          id="assets-pt-amount"
          label="PT"
          value={amountRaw}
          unit="PT"
          error={amountError}
          maxDisabled={maxDisabled}
          onChange={onAmount}
          onSubmit={onContinue}
          onMax={onMax}
        />
        {capCopy ? <p className="assets-note">{capCopy}</p> : null}
        <p className="assets-note">Deposit mints {ovrfloSymbol} and opens a Sablier stream. PT is 18 decimals.</p>
        <div className="assets-actions">
          {continueDisabled ? (
            <ActionButton disabled disabledReason={continueReason ?? "ENTER AN AMOUNT"}>
              CONTINUE
            </ActionButton>
          ) : (
            <ActionButton onClick={onContinue}>CONTINUE</ActionButton>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      data-ui={stage === "confirmed" ? "UI-ASSETS-STREAM-CONFIRMED" : "UI-REVIEW-STREAM-DEPOSIT"}
      data-control={stage === "confirmed" ? "UI-ASSETS-STREAM-CONFIRMED" : "UI-REVIEW-STREAM-DEPOSIT"}
      data-state={stage}
    >
      <span className="assets-bay-kicker">CREATE STREAM</span>
      <h2 className="assets-bay-title">{stage === "confirmed" ? "Stream created" : "Review deposit"}</h2>
      <div className="assets-split" data-control="UI-REVIEW-SPLIT">
        <dl className="assets-facts">
          <div className="assets-row">
            <dt>PT IN</dt>
            <dd>{formatTokenAmount(ptIn, "PT")}</dd>
          </div>
          <div className="assets-row">
            <dt>MINTED TO WALLET</dt>
            <dd>{formatTokenAmount(minted, ovrfloSymbol)}</dd>
          </div>
          <div className="assets-row">
            <dt>STREAM AMOUNT</dt>
            <dd>{formatTokenAmount(streamAmount, ovrfloSymbol)}</dd>
          </div>
          <div className="assets-row">
            <dt>CURRENT FEE</dt>
            <dd>{formatTokenAmount(currentFee, underlyingSymbol)}</dd>
          </div>
          <div className="assets-row">
            <dt>BOUNDED APPROVAL</dt>
            <dd>{formatTokenAmount(boundedApproval, underlyingSymbol)}</dd>
          </div>
          <div className="assets-row">
            <dt>MATURITY</dt>
            <dd>{maturity !== undefined ? formatMaturityDate(maturity) : "—"}</dd>
          </div>
          <div className="assets-row">
            <dt>CAP</dt>
            <dd>{capCopy ?? "—"}</dd>
          </div>
          {stage === "confirmed" && streamId !== undefined && streamId !== null ? (
            <div className="assets-row">
              <dt>STREAM</dt>
              <dd>#{streamId.toString()}</dd>
            </div>
          ) : null}
        </dl>
        <div>
          <SettlementTrace steps={steps} />
          {permissionState !== "skipped" ? (
            <Receipt kind="permission" state={permissionState} lines={permissionLines} />
          ) : null}
          <Receipt kind="action" state={actionState} lines={actionLines} />
          <div className="assets-actions">{renderActions()}</div>
          {txCopy ? (
            <p className="assets-tx" data-control="UI-REVIEW-TX-STATE" data-state={txState}>
              {txCopy}
            </p>
          ) : null}
          {refreshFailed && onRetryRefresh ? (
            <ActionButton onClick={onRetryRefresh}>RETRY REFRESH</ActionButton>
          ) : null}
          {needsReview && onReReview ? (
            <ActionButton onClick={onReReview}>REVIEW AND CONFIRM AGAIN</ActionButton>
          ) : null}
          {stage === "confirmed" ? (
            <div className="assets-confirmed-actions">
              {borrowHref ? (
                <a href={borrowHref} data-variant="primary">
                  BORROW AGAINST THIS STREAM
                </a>
              ) : null}
              {viewStreamHref ? <a href={viewStreamHref}>VIEW STREAM</a> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );

  function renderActions() {
    if (stage === "ack" && onAcknowledge) {
      return (
        <>
          <ActionButton onClick={onAcknowledge} variant="primary">
            ACKNOWLEDGE RISK
          </ActionButton>
          <a href="/risk">Read the risk note</a>
        </>
      );
    }
    if (stage === "approve-pt") {
      if (approvePtDisabled) {
        return (
          <ActionButton disabled disabledReason={approvePtReason ?? "APPROVAL NOT READY"}>
            APPROVE PT
          </ActionButton>
        );
      }
      return (
        <ActionButton onClick={onApprovePt} busy={approvePtBusy} variant="primary">
          APPROVE PT
        </ActionButton>
      );
    }
    if (stage === "approve-fee") {
      if (approveFeeDisabled) {
        return (
          <ActionButton disabled disabledReason={approveFeeReason ?? "APPROVAL NOT READY"}>
            APPROVE FEE
          </ActionButton>
        );
      }
      return (
        <ActionButton onClick={onApproveFee} busy={approveFeeBusy} variant="primary">
          APPROVE FEE
        </ActionButton>
      );
    }
    if (stage === "sign" || stage === "pending") {
      if (depositDisabled) {
        return (
          <ActionButton disabled disabledReason={depositReason ?? "SIGNING DISABLED"}>
            DEPOSIT
          </ActionButton>
        );
      }
      return (
        <ActionButton onClick={onDeposit} busy={depositBusy} variant="primary">
          DEPOSIT
        </ActionButton>
      );
    }
    if (stage === "review") {
      return (
        <ActionButton onClick={onContinue} variant="primary">
          REVIEW DEPOSIT
        </ActionButton>
      );
    }
    return null;
  }
}
