"use client";

import { useState } from "react";
import { ActionButton } from "@/components/kit/ActionButton";
import { AddressChip } from "@/components/kit/AddressChip";
import { AmountField } from "@/components/kit/AmountField";
import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { Receipt, type ReceiptLine, type ReceiptState } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep } from "@/components/kit/SettlementTrace";
import { formatTokenAmount } from "@/lib/format";
import { exactAmountString, moneyLabel, type MoneyRead } from "./helpers";
import "./assets.css";

export type ConverterDirection = "wrap" | "unwrap";

export type ConverterStage =
  | "amount"
  | "review"
  | "ack"
  | "approve"
  | "sign"
  | "pending"
  | "confirmed";

export type UnwrapAvailability =
  | "enabled"
  | "disabled-reserve"
  | "disabled-balance"
  | "absent";

export type ConverterProps = {
  direction: ConverterDirection;
  onDirection: (direction: ConverterDirection) => void;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  destination?: string;
  walletUnderlying: MoneyRead;
  walletOvrflo: MoneyRead;
  wrapReserve: MoneyRead;
  matured: boolean;
  amountRaw: string;
  amountWei: bigint | null;
  onAmount: (next: string) => void;
  amountError?: string;
  unwrapAvailability: UnwrapAvailability;
  availableReserveLabel?: string;
  outputState: "ready" | "empty" | "invalid";
  outputLabel: string;
  stage: ConverterStage;
  steps: readonly TraceStep[];
  permissionLines: readonly ReceiptLine[];
  permissionState: ReceiptState;
  actionLines: readonly ReceiptLine[];
  actionState: ReceiptState;
  txCopy?: string;
  txState?: string;
  onContinue?: () => void;
  continueDisabled?: boolean;
  continueReason?: string;
  onAcknowledge?: () => void;
  onApprove?: () => void;
  approveBusy?: boolean;
  approveDisabled?: boolean;
  approveReason?: string;
  approveLabel?: string;
  onSubmit?: () => void;
  submitBusy?: boolean;
  submitDisabled?: boolean;
  submitReason?: string;
  submitLabel?: string;
  onRetryRefresh?: () => void;
  refreshFailed?: boolean;
  needsReview?: boolean;
  onReReview?: () => void;
  confirmedCopy?: string;
  repayHref?: string;
  onClaim?: () => void;
  claimBusy?: boolean;
  claimDisabled?: boolean;
  claimReason?: string;
  claimVisible?: boolean;
  connected: boolean;
};

export function Converter({
  direction,
  onDirection,
  underlyingSymbol,
  ovrfloSymbol,
  destination,
  walletUnderlying,
  walletOvrflo,
  wrapReserve,
  matured,
  amountRaw,
  amountWei,
  onAmount,
  amountError,
  unwrapAvailability,
  availableReserveLabel,
  outputState,
  outputLabel,
  stage,
  steps,
  permissionLines,
  permissionState,
  actionLines,
  actionState,
  txCopy,
  txState,
  onContinue,
  continueDisabled,
  continueReason,
  onAcknowledge,
  onApprove,
  approveBusy,
  approveDisabled,
  approveReason,
  approveLabel,
  onSubmit,
  submitBusy,
  submitDisabled,
  submitReason,
  submitLabel,
  onRetryRefresh,
  refreshFailed,
  needsReview,
  onReReview,
  confirmedCopy,
  repayHref,
  onClaim,
  claimBusy,
  claimDisabled,
  claimReason,
  claimVisible,
  connected,
}: ConverterProps) {
  const [reserveOpen, setReserveOpen] = useState(false);
  const unwrapAbsent = matured || unwrapAvailability === "absent";
  const showReview = stage !== "amount";
  const reserveState =
    wrapReserve.status === "loading"
      ? "loading"
      : wrapReserve.status === "unavailable"
        ? "unavailable"
        : wrapReserve.value === 0n
          ? "empty-reserve"
          : "ready";

  return (
    <section data-control="UI-ASSETS-CONVERTER" data-state={direction}>
      <div className="assets-bays">
        <aside className="assets-bay" data-control="UI-ASSETS-RESERVE" data-state={reserveState}>
          <span className="assets-bay-kicker">RESERVE</span>
          <h2 className="assets-bay-title">Wallet and wrap reserve</h2>
          <dl>
            <div className="assets-row">
              <dt>WALLET {underlyingSymbol}</dt>
              <dd>{connected ? moneyLabel(walletUnderlying, underlyingSymbol) : "CONNECT WALLET"}</dd>
            </div>
            <div className="assets-row">
              <dt>WRAP RESERVE</dt>
              <dd>{connected ? moneyLabel(wrapReserve, underlyingSymbol) : "CONNECT WALLET"}</dd>
            </div>
          </dl>
          <p className="assets-rule">
            Unwrap cannot exceed the tracked wrap reserve. The reserve is a vault accounting
            figure, not the wallet balance. Direct transfers to the vault do not increase wrap
            reserve.
          </p>
        </aside>

        <div className="assets-bay" data-control="UI-ASSETS-WRAP-AMOUNT">
          <span className="assets-bay-kicker">CONVERT 1:1</span>
          <h2 className="assets-bay-title">{direction === "wrap" ? "Wrap" : "Unwrap"}</h2>
          <div className="assets-directions" role="group" aria-label="Convert direction">
            <button type="button" aria-pressed={direction === "wrap"} onClick={() => onDirection("wrap")}>
              WRAP
            </button>
            {unwrapAbsent ? null : (
              <button
                type="button"
                aria-pressed={direction === "unwrap"}
                onClick={() => onDirection("unwrap")}
              >
                UNWRAP
              </button>
            )}
          </div>

          {direction === "unwrap" && unwrapAvailability === "disabled-reserve" ? (
            <div
              className="assets-unavailable"
              data-control="UI-ASSETS-UNWRAP"
              data-state="disabled-reserve"
              role="status"
            >
              <strong>UNWRAP UNAVAILABLE</strong>
              Wrap reserve cannot cover this amount. Available reserve{" "}
              {availableReserveLabel ?? moneyLabel(wrapReserve, underlyingSymbol)}. Wrap and other
              exits stay open. This is not a failed unwrap and not a failed claim.
            </div>
          ) : null}

          {direction === "unwrap" && unwrapAvailability === "disabled-balance" ? (
            <p className="assets-note" data-control="UI-ASSETS-UNWRAP" data-state="disabled-balance">
              No {ovrfloSymbol} to unwrap.
            </p>
          ) : null}

          <AmountField
            id="assets-convert-amount"
            label={direction === "wrap" ? `WRAP ${underlyingSymbol}` : `UNWRAP ${ovrfloSymbol}`}
            value={amountRaw}
            unit={direction === "wrap" ? underlyingSymbol : ovrfloSymbol}
            error={amountError}
            maxDisabled={
              direction === "wrap"
                ? walletUnderlying.status !== "ready"
                : walletOvrflo.status !== "ready" || wrapReserve.status !== "ready"
            }
            onChange={onAmount}
            onSubmit={onContinue}
            onMax={() => {
              if (direction === "wrap" && walletUnderlying.status === "ready") {
                onAmount(exactAmountString(walletUnderlying.value));
                return;
              }
              if (walletOvrflo.status === "ready" && wrapReserve.status === "ready") {
                const cap =
                  walletOvrflo.value < wrapReserve.value ? walletOvrflo.value : wrapReserve.value;
                onAmount(exactAmountString(cap));
              }
            }}
          />

          <div className="assets-output" data-control="UI-ASSETS-OUTPUT" data-state={outputState}>
            <span className="assets-output-label">OUTPUT</span>
            <span className="assets-output-value">{outputLabel}</span>
          </div>
          <p className="assets-note">
            1:1 · no protocol fee · no stream · destination{" "}
            {destination ? <AddressChip address={destination} /> : "wallet"}
          </p>

          {stage === "amount" ? (
            continueDisabled ? (
              <ActionButton disabled disabledReason={continueReason ?? "ENTER AN AMOUNT"}>
                CONTINUE
              </ActionButton>
            ) : (
              <ActionButton onClick={onContinue}>CONTINUE</ActionButton>
            )
          ) : null}

          {showReview ? (
            <div className="assets-split" data-control="UI-REVIEW-SPLIT">
              <div className="assets-facts">
                <dl>
                  <div className="assets-row">
                    <dt>IN</dt>
                    <dd>
                      {formatTokenAmount(
                        amountWei ?? undefined,
                        direction === "wrap" ? underlyingSymbol : ovrfloSymbol,
                      )}
                    </dd>
                  </div>
                  <div className="assets-row">
                    <dt>OUT</dt>
                    <dd>
                      {formatTokenAmount(
                        amountWei ?? undefined,
                        direction === "wrap" ? ovrfloSymbol : underlyingSymbol,
                      )}
                    </dd>
                  </div>
                  <div className="assets-row">
                    <dt>FEE</dt>
                    <dd>NONE</dd>
                  </div>
                </dl>
              </div>
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
                    {confirmedCopy ? <p className="assets-note">{confirmedCopy}</p> : null}
                    {repayHref ? (
                      <a href={repayHref}>USE FOR REPAY</a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="assets-bay" data-control={claimVisible ? "UI-ASSETS-CLAIM-PT" : "UI-ASSETS-UNWRAP"}>
          <span className="assets-bay-kicker">OVRFLO TOKEN</span>
          <h2 className="assets-bay-title">{ovrfloSymbol}</h2>
          <p className="assets-claim-copy">
            {ovrfloSymbol} is an equal claim on eligible PT after maturity. It is not a claim on{" "}
            {underlyingSymbol}. CLAIM PT burns {ovrfloSymbol} 1:1 for PT. Redemption from PT to{" "}
            {underlyingSymbol} happens through Pendle, outside this control. No deadline, no
            forfeiture.
          </p>
          <dl>
            <div className="assets-row">
              <dt>WALLET {ovrfloSymbol}</dt>
              <dd>{connected ? moneyLabel(walletOvrflo, ovrfloSymbol) : "CONNECT WALLET"}</dd>
            </div>
          </dl>
          {claimVisible ? (
            claimDisabled ? (
              <ActionButton disabled disabledReason={claimReason ?? "NO BALANCE"}>
                CLAIM PT
              </ActionButton>
            ) : (
              <ActionButton onClick={onClaim} busy={claimBusy}>
                CLAIM PT
              </ActionButton>
            )
          ) : null}
        </aside>
      </div>

      <div className="assets-disclosures">
        <DisclosureRow
          id="assets-reserve-how"
          label="HOW THE RESERVE WORKS"
          open={reserveOpen}
          onToggle={() => setReserveOpen((open) => !open)}
        >
          Wrap adds the received underlying to the tracked wrap reserve. Unwrap returns underlying
          only while that reserve covers the amount. Empty reserve disables unwrap and is not a
          failed user balance.
        </DisclosureRow>
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
    if (stage === "approve") {
      if (approveDisabled) {
        return (
          <ActionButton disabled disabledReason={approveReason ?? "APPROVAL NOT READY"}>
            {approveLabel ?? "APPROVE"}
          </ActionButton>
        );
      }
      return (
        <ActionButton onClick={onApprove} busy={approveBusy} variant="primary">
          {approveLabel ?? "APPROVE"}
        </ActionButton>
      );
    }
    if (stage === "sign" || stage === "pending") {
      if (submitDisabled) {
        return (
          <ActionButton disabled disabledReason={submitReason ?? "SIGNING DISABLED"}>
            {submitLabel ?? (direction === "wrap" ? "WRAP" : "UNWRAP")}
          </ActionButton>
        );
      }
      return (
        <ActionButton onClick={onSubmit} busy={submitBusy} variant="primary">
          {submitLabel ?? (direction === "wrap" ? "WRAP" : "UNWRAP")}
        </ActionButton>
      );
    }
    if (stage === "review") {
      return (
        <ActionButton onClick={onContinue} variant="primary">
          {direction === "wrap" ? "REVIEW WRAP" : "REVIEW UNWRAP"}
        </ActionButton>
      );
    }
    return null;
  }
}
