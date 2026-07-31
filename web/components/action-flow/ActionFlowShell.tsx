"use client";

import { type ReactNode } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import type { SymbolMap } from "@/hooks/useMarketSymbols";
import type { BorrowDemandStatus } from "@/hooks/useBorrowDemand";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { demandLevel, type RateDemand } from "@/lib/demand";
import { userFacingError } from "@/lib/errors";
import { formatTokenAmount } from "@/lib/format";

export type Accent = "gold" | "cyan" | "neutral";

export type ActionFlowProps = {
  action: ActiveAction;
  market: MarketInfo;
  user?: Address;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
};

export function ActionFlowShell({ children }: { children: ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

export function accentClass(accent: Accent) {
  return accent === "gold" ? "button-gold" : accent === "cyan" ? "button-cyan" : "";
}

function stepClassName(i: number, activeIndex: number, error: boolean) {
  if (i < activeIndex) return "step-done";
  if (i !== activeIndex) return "step-pending";
  return error ? "step-error" : "step-active";
}

export function StepIndicator({
  steps,
  activeIndex,
  error,
  accent,
}: {
  steps: string[];
  activeIndex: number;
  error: boolean;
  accent: Accent;
}) {
  return (
    <div className="modal-step-list mono" aria-live="polite" data-accent={accent}>
      {steps.map((step, i) => (
        <span key={step} className={stepClassName(i, activeIndex, error)}>
          [{i + 1}] {step}
        </span>
      ))}
    </div>
  );
}

export type WriteFlow = ReturnType<typeof useWriteFlow>;

export function ReviewChangedState({ tx }: { tx: WriteFlow }) {
  if (!tx.needsReview) return null;
  return (
    <div className="label mono status-warning" role="status">
      ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN
      {tx.review ? (
        <div>
          UPDATED {tx.review.title}: {tx.review.call.functionName}{" "}
          {JSON.stringify(tx.review.call.args, (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RefreshTxState({
  tx,
  refreshingLabel,
  failedLabel,
}: {
  tx: WriteFlow;
  refreshingLabel: string;
  failedLabel: string;
}) {
  if (tx.needsReview) return <ReviewChangedState tx={tx} />;
  if (tx.isRefreshing) {
    return <div className="label mono status-warning">{refreshingLabel}</div>;
  }
  if (!tx.refreshFailed) return null;
  return (
    <div className="form-grid" role="alert">
      <div className="label mono status-warning">
        {failedLabel} {tx.hash?.slice(0, 10)}…
      </div>
      <button className="button mono" type="button" onClick={() => void tx.retryRefresh()}>
        RETRY REFRESH
      </button>
    </div>
  );
}

export function TxState({ tx, pendingLabel }: { tx: WriteFlow; pendingLabel?: string | null }) {
  if (tx.isSigning)
    return <div className="label mono status-warning">{pendingLabel ? `${pendingLabel}: SIGNING` : "SIGNING"}</div>;
  if (tx.isConfirming)
    return (
      <div className="label mono status-warning">
        {pendingLabel ? `${pendingLabel}: CONFIRMING` : "CONFIRMING"} {tx.hash?.slice(0, 10)}…
      </div>
    );
  if (tx.isRefreshing || tx.refreshFailed)
    return (
      <RefreshTxState
        tx={tx}
        refreshingLabel="CONFIRMED — REFRESHING"
        failedLabel="TRANSACTION CONFIRMED — REFRESH FAILED"
      />
    );
  if (tx.isConfirmed) return <div className="label mono status-positive">CONFIRMED</div>;
  if (tx.needsReview) return <ReviewChangedState tx={tx} />;
  if (tx.isReverted) return <div className="label mono status-negative">TRANSACTION REVERTED ON-CHAIN</div>;
  if (tx.error) return <div className="label mono status-negative">{userFacingError(tx.error)}</div>;
  return null;
}

// Approval progress only — deliberately never renders CONFIRMED. The completed
// state of a form derives solely from the action transaction (KTD6/R24).
export function ApproveTxState({ tx, label }: { tx: WriteFlow; label: string }) {
  if (tx.isSigning) return <div className="label mono status-warning">{label}: SIGNING</div>;
  if (tx.isConfirming)
    return (
      <div className="label mono status-warning">
        {label}: CONFIRMING {tx.hash?.slice(0, 10)}…
      </div>
    );
  if (tx.isRefreshing || tx.refreshFailed)
    return (
      <RefreshTxState
        tx={tx}
        refreshingLabel={`${label}: REFRESHING`}
        failedLabel={`${label}: CONFIRMED — REFRESH FAILED`}
      />
    );
  if (tx.isReverted) return <div className="label mono status-negative">{label}: REVERTED ON-CHAIN</div>;
  if (tx.error) return <div className="label mono status-negative">{userFacingError(tx.error)}</div>;
  return null;
}

// Demand cell for one ladder rate. "no data" (indexer unreachable) and
// "genuinely zero borrows" must never look alike (ticket 09).
export function demandCellCopy(
  status: BorrowDemandStatus,
  row: RateDemand | undefined,
  peak: bigint,
  formatAmount: (amount: bigint) => string,
): string {
  if (status === "loading") return "DEMAND —";
  if (status === "unavailable") return "DEMAND: NO DATA";
  if (!row) return "NO LOANS IN 30 DAYS";
  return `DEMAND ${demandLevel(row.amount, peak)} · ${row.count} · ${formatAmount(row.amount)}`;
}

export function DemandAnnotation({ status }: { status: BorrowDemandStatus }) {
  if (status === "loading") return <div className="label mono">DEMAND: LOADING</div>;
  if (status === "unavailable") {
    return <div className="label mono status-warning">DEMAND DATA UNAVAILABLE — INDEXER UNREACHABLE</div>;
  }
  return <div className="label mono">DEMAND: TRAILING 30 DAYS, YOUR OWN BORROWS EXCLUDED</div>;
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="button mono" type="button" onClick={onClose}>
      CLOSE
    </button>
  );
}

// R5: on a wrong chain every primary action control becomes this one. Gating at
// FormBody covers all six forms' write paths at a single seam — a per-form gate
// would have to be re-applied correctly six times and re-applied again for the
// seventh form. Deliberately stronger than a header-only network indicator,
// which the ETHSKILLS QA checklist calls insufficient for exactly this case.
export function WrongNetworkNotice({
  connectedChainId,
  expectedChainId,
  onSwitch,
  isSwitching,
  error,
}: {
  connectedChainId?: number;
  expectedChainId: number;
  onSwitch: () => void;
  isSwitching: boolean;
  error: Error | null;
}) {
  return (
    <div className="form-grid">
      <div className="label mono status-warning">
        WRONG NETWORK — CONNECTED TO {connectedChainId ?? "UNKNOWN"}, EXPECTED {expectedChainId}
      </div>
      <button className="button mono" type="button" onClick={onSwitch} disabled={isSwitching}>
        {isSwitching ? "SWITCHING…" : `SWITCH TO NETWORK ${expectedChainId}`}
      </button>
      {error ? <div className="label mono status-negative">SWITCH REJECTED — CHANGE NETWORK IN YOUR WALLET</div> : null}
    </div>
  );
}

// R14/R24: the amount field was a bare `<input>` at all four call sites — no
// programmatic label, no decimal input mode, and a validation state carried only
// by a CSS class, which assistive technology cannot see. One primitive so the
// four cannot drift, and so a fifth form inherits the behaviour.
//
// `max` is optional. Three forms bound the amount by a wallet balance and expose
// MAX plus a balance line; BorrowForm does not, because a borrow is bounded by
// posted ladder depth rather than by anything in the user's wallet — showing a
// wallet balance there would describe the wrong constraint.
export function AmountInput({
  id,
  label,
  value,
  onChange,
  error,
  balance,
  symbol,
  max,
  maxDisabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  balance?: bigint;
  symbol?: string;
  max?: () => void;
  /// Repay bounds MAX by the outstanding obligation, not the wallet balance.
  maxDisabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const balanceId = `${id}-balance`;
  const describedBy = [error ? errorId : null, balance !== undefined ? balanceId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="amount-field">
      <label className="label mono" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`input mono ${error ? "input-error" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
      />
      {balance !== undefined ? (
        <div className="balance-row">
          <span id={balanceId} className="label mono">
            BALANCE {formatTokenAmount(balance, symbol ?? "")}
          </span>
          {max ? (
            <button className="button mono" type="button" disabled={maxDisabled ?? balance === 0n} onClick={max}>
              MAX
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} className="label mono status-negative" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function WalletChangedNotice({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="form-grid">
      <div className="label mono status-warning">WALLET CHANGED — RE-ENTER</div>
      <button className="button mono" type="button" onClick={onContinue}>
        CONTINUE
      </button>
    </div>
  );
}

// --- Helpers ---

export function parseAmount(raw: string): bigint {
  try {
    if (!raw.trim()) return 0n;
    return parseUnits(raw.trim(), 18);
  } catch {
    return 0n;
  }
}

export function formatUnits18(value: bigint) {
  return formatUnits(value, 18);
}
