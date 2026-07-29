"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { useZeroFirstApprove } from "@/hooks/useZeroFirstApprove";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { userFacingError } from "@/lib/errors";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";

import { applySlippageDown, isSeriesMatchedStream, repayMax } from "@/lib/modal-logic";
import {
  bufferedFeeApproveAmount,
  convertApprovalNeeds,
  convertValidationError,
  depositCapStatus,
  type ConvertMode,
} from "@/lib/convert";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import {
  borrowReceiptSummary,
  classifyBorrowError,
  parseSlippageBps,
  planSelectedBorrow,
  resolveSelectedTick,
  SLIPPAGE_DEFAULT_PCT,
} from "@/lib/borrow";
import { buildLadder } from "@/lib/router";
import {
  aprChoices,
  formatBpsPct,
  lenderReturnBps,
  loanOutstanding,
  MAX_UINT128,
  upfrontBps,
} from "@/lib/lending-math";
import { adjustReceiptSummary, classifyAdjustError } from "@/lib/positions";
import { useQueryClient } from "@tanstack/react-query";
import type { ActiveAction, ActionType, MarketInfo } from "@/lib/types";
import { RateLadder } from "./RateLadder";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useBorrowDemand, type BorrowDemandStatus } from "@/hooks/useBorrowDemand";
import { demandLevel, type RateDemand } from "@/lib/demand";

export type Accent = "gold" | "cyan" | "neutral";

export const ACTION_META: Record<ActionType, { title: string; accent: Accent }> = {
  supply: { title: "SUPPLY LIQUIDITY", accent: "gold" },
  withdraw: { title: "WITHDRAW LIQUIDITY", accent: "gold" },
  claim_share: { title: "CLAIM SHARE", accent: "gold" },
  deposit: { title: "DEPOSIT PT", accent: "gold" },
  claim_matured: { title: "CLAIM MATURED PT", accent: "gold" },
  wrap: { title: "WRAP", accent: "neutral" },
  unwrap: { title: "UNWRAP", accent: "neutral" },
  borrow: { title: "BORROW AGAINST STREAM", accent: "cyan" },
  claim_stream: { title: "CLAIM STREAM", accent: "gold" },
  adjust_rate: { title: "ADJUST RATE", accent: "gold" },
  repay: { title: "REPAY LOAN", accent: "cyan" },
  close: { title: "CLOSE LOAN", accent: "cyan" },
};

export function accentClass(accent: Accent) {
  return accent === "gold" ? "button-gold" : accent === "cyan" ? "button-cyan" : "";
}

export function FormBody({
  action,
  market,
  user,
  symbols,
  accent,
  onClose,
}: {
  action: ActiveAction;
  market: MarketInfo;
  user?: Address;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const chainGuard = useChainGuard();
  if (chainGuard.wrongChain) {
    return (
      <WrongNetworkNotice
        connectedChainId={chainGuard.connectedChainId}
        expectedChainId={chainGuard.expectedChainId}
        onSwitch={chainGuard.switchChain}
        isSwitching={chainGuard.isSwitching}
        error={chainGuard.switchError}
      />
    );
  }

  switch (action.type) {
    case "supply":
      return <SupplyForm market={market} symbols={symbols} accent={accent} onClose={onClose} />;
    case "withdraw":
    case "claim_share":
    case "claim_stream":
    case "close":
      return <SimpleActionForm market={market} user={user} action={action} accent={accent} onClose={onClose} />;
    case "deposit":
    case "claim_matured":
    case "wrap":
    case "unwrap":
      return <ConvertForm market={market} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    case "borrow":
      return <BorrowForm market={market} user={user} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    case "adjust_rate":
      return <AdjustRateForm market={market} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    case "repay":
      return <RepayForm market={market} user={user} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    default:
      return null;
  }
}

// --- Shared components ---

function stepClassName(i: number, activeIndex: number, error: boolean) {
  if (i < activeIndex) return "step-done";
  if (i !== activeIndex) return "step-pending";
  return error ? "step-error" : "step-active";
}

function StepIndicator({
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

type WriteFlow = ReturnType<typeof useWriteFlow>;

function TxState({ tx, pendingLabel }: { tx: WriteFlow; pendingLabel?: string | null }) {
  if (tx.isSigning)
    return <div className="label mono status-warning">{pendingLabel ? `${pendingLabel}: SIGNING` : "SIGNING"}</div>;
  if (tx.isConfirming)
    return (
      <div className="label mono status-warning">
        {pendingLabel ? `${pendingLabel}: CONFIRMING` : "CONFIRMING"} {tx.hash?.slice(0, 10)}…
      </div>
    );
  if (tx.isConfirmed) return <div className="label mono status-positive">CONFIRMED</div>;
  if (tx.isReverted) return <div className="label mono status-negative">TRANSACTION REVERTED ON-CHAIN</div>;
  if (tx.error) return <div className="label mono status-negative">{userFacingError(tx.error)}</div>;
  return null;
}

// Approval progress only — deliberately never renders CONFIRMED. The completed
// state of a form derives solely from the action transaction (KTD6/R24).
function ApproveTxState({ tx, label }: { tx: WriteFlow; label: string }) {
  if (tx.isSigning) return <div className="label mono status-warning">{label}: SIGNING</div>;
  if (tx.isConfirming)
    return (
      <div className="label mono status-warning">
        {label}: CONFIRMING {tx.hash?.slice(0, 10)}…
      </div>
    );
  if (tx.isReverted) return <div className="label mono status-negative">{label}: REVERTED ON-CHAIN</div>;
  if (tx.error) return <div className="label mono status-negative">{userFacingError(tx.error)}</div>;
  return null;
}

// Demand cell for one ladder rate. "no data" (indexer unreachable) and
// "genuinely zero borrows" must never look alike (ticket 09).
function demandCellCopy(
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

function DemandAnnotation({ status }: { status: BorrowDemandStatus }) {
  if (status === "loading") return <div className="label mono">DEMAND: LOADING</div>;
  if (status === "unavailable") {
    return <div className="label mono status-warning">DEMAND DATA UNAVAILABLE — INDEXER UNREACHABLE</div>;
  }
  return <div className="label mono">DEMAND: TRAILING 30 DAYS, YOUR OWN BORROWS EXCLUDED</div>;
}

function CloseButton({ onClose }: { onClose: () => void }) {
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
function WrongNetworkNotice({
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
function AmountInput({
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

function WalletChangedNotice({ onContinue }: { onContinue: () => void }) {
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

function parseAmount(raw: string): bigint {
  try {
    if (!raw.trim()) return 0n;
    return parseUnits(raw.trim(), 18);
  } catch {
    return 0n;
  }
}

function formatUnits18(value: bigint) {
  return formatUnits(value, 18);
}

// --- Supply form ---

function SupplyForm({
  market,
  symbols,
  accent,
  onClose,
}: {
  market: MarketInfo;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const [raw, setRaw] = useState("");
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const [selectedAprRaw, setSelectedAprRaw] = useState<number | null>(null);
  // Live clock: maturity is checked when the panel opens AND re-checked while
  // it stays open — a market crossing maturity mid-session closes supply.
  const nowSeconds = useNowSeconds(true);

  const amount = parseAmount(raw);
  const connectedAddress = connection.addresses?.[0];
  const demandState = useBorrowDemand(market.market, connectedAddress);
  const underlyingSymbol = symbolFor(symbols, market.underlying);

  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;

  // aprMinBps may legally be 0, so "loaded" is judged by aprMaxBps (a
  // configured market always has a positive ceiling), never by the minimum.
  const ratesReady = !lending.isLoading && lending.params.aprMaxBps > 0;
  const ticks = ratesReady ? aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps) : [];
  // No `self` passed to buildLadder, so `total` already includes the lender's
  // own supply — waiting liquidity deliberately counts it.
  const ladder = buildLadder(liquidity.liquidity, market.market, ticks);
  const aprBps =
    selectedAprRaw !== null && ticks.includes(selectedAprRaw) ? selectedAprRaw : (ticks[0] ?? null);

  const { approveTx, actionTx, busy } = useApprovalWriteFlows(connectedAddress);
  const zeroFirst = useZeroFirstApprove(approveTx);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setApprovedAmount(0n);
    setSelectedAprRaw(null);
  });

  useEffect(() => {
    if (approveTx.hasFailed) setApprovedAmount(0n);
  }, [approveTx.hasFailed]);

  const allowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });
  const balanceOf = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const allowanceAmount = allowance.data ?? 0n;
  const walletBalance = balanceOf.data ?? 0n;
  const validationError = amount > 0n && amount > walletBalance ? "INSUFFICIENT BALANCE" : null;
  const approvalCovers = allowanceAmount >= amount || approvedAmount >= amount;
  // R7/H-3: `isConfirmed` belongs in the predicate, not just the step
  // indicator. Without it `busy` drops back to false on confirmation and the
  // button re-arms with the original arguments still populated — one more
  // click submits the same transaction again.
  const disabled =
    !market.lending || aprBps === null || amount === 0n || busy || Boolean(validationError) || matured ||
    actionTx.isConfirmed;
  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : approvalCovers ? 1 : 0;

  return (
    <div className="form-grid">
      <RateLadder
        label="SUPPLY RATE"
        rows={ladder.map((tick) => ({
          aprBps: tick.aprBps,
          cells: [
            `RETURN ${formatBpsPct(lenderReturnBps(tick.aprBps, ttmSeconds))}`,
            `WAITING ${formatTokenAmount(tick.total, underlyingSymbol)}`,
            demandCellCopy(
              demandState.status,
              demandState.demand.find((row) => row.aprBps === tick.aprBps),
              demandState.peak,
              (value) => formatTokenAmount(value, underlyingSymbol),
            ),
          ],
        }))}
        selectedAprBps={aprBps}
        onSelect={setSelectedAprRaw}
        truncated={liquidity.tooLarge}
        emptyText="LOADING RATES"
      />
      <DemandAnnotation status={demandState.status} />
      <AmountInput
        id="supply-amount"
        label={`AMOUNT (${underlyingSymbol})`}
        value={raw}
        onChange={setRaw}
        error={validationError}
        balance={walletBalance}
        symbol={underlyingSymbol}
        max={() => setRaw(formatUnits18(walletBalance))}
      />
      {matured ? <div className="label mono status-negative">MARKET MATURED — SUPPLY CLOSED</div> : null}
      <div className="summary-row mono" aria-live="polite">
        SUPPLY {formatTokenAmount(amount, underlyingSymbol)} @ {aprBps !== null ? formatAprBps(aprBps) : "—"}
      </div>
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {!approvalCovers ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            zeroFirst.submit(market.underlying, market.lending, amount, allowanceAmount);
            setApprovedAmount(amount);
          }}
        >
          APPROVE
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending || aprBps === null) return;
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "supplyLiquidity",
              args: [market.market, aprBps, amount],
            });
          }}
        >
          SUPPLY @ {aprBps !== null ? formatAprBps(aprBps) : "—"}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE" />
      <TxState tx={actionTx} pendingLabel="SUPPLY" />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Simple action form (withdraw, claim_share, claim_stream, close) ---

function SimpleActionForm({
  market,
  user,
  action,
  accent,
  onClose,
}: {
  market: MarketInfo;
  user?: Address;
  action: ActiveAction;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const connectedAddress = connection.addresses?.[0];

  const tx = useWriteFlow(connectedAddress ?? user);

  const guard = useWalletChangeReset(connectedAddress, () => setPendingLabel(null));

  useEffect(() => {
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const steps = ["SIGN", "CONFIRMED"];
  const activeIndex = tx.isConfirmed || tx.isConfirming ? 1 : 0;

  let summary = "";
  let buttonText = "";
  const writeArgs: (() => void) | null = (() => {
    switch (action.type) {
      case "withdraw":
        if (action.positionId === undefined) return null;
        summary = `WITHDRAW LIQUIDITY ${formatId(action.positionId)}`;
        buttonText = "WITHDRAW";
        return () => {
          if (!market.lending) return;
          setPendingLabel("WITHDRAW");
          tx.writeContract({
            address: market.lending,
            abi: ovrfloLendingAbi,
            functionName: "withdrawLiquidity",
            args: [action.positionId!],
          });
        };
      case "claim_share":
        if (action.positionId === undefined) return null;
        summary = `CLAIM SHARE POOL ${formatId(action.positionId)}`;
        buttonText = "CLAIM SHARE";
        return () => {
          if (!market.lending) return;
          setPendingLabel("CLAIM SHARE");
          tx.writeContract({
            address: market.lending,
            abi: ovrfloLendingAbi,
            functionName: "claimLoanPoolShare",
            args: [action.positionId!, MAX_UINT128],
          });
        };
      case "claim_stream":
        if (action.streamId === undefined) return null;
        summary = `CLAIM STREAM ${formatId(action.streamId)}`;
        buttonText = "CLAIM STREAM";
        return () => {
          if (!connectedAddress) return;
          setPendingLabel("CLAIM STREAM");
          tx.writeContract({
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "withdrawMax",
            args: [action.streamId!, connectedAddress],
          });
        };
      case "close":
        if (action.loanId === undefined) return null;
        summary = `CLOSE LOAN ${formatId(action.loanId)}`;
        buttonText = "CLOSE LOAN";
        return () => {
          if (!market.lending) return;
          setPendingLabel("CLOSE");
          tx.writeContract({
            address: market.lending,
            abi: ovrfloLendingAbi,
            functionName: "closeLoan",
            args: [action.loanId!],
          });
        };
      default:
        return null;
    }
  })();

  return (
    <div className="form-grid">
      <div className="summary-row mono" aria-live="polite">
        {summary}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={tx.hasFailed} accent={accent} />
      <button
        className={`button ${accentClass(accent)} mono`}
        disabled={!writeArgs || tx.isSigning || tx.isConfirming || tx.isConfirmed}
        type="button"
        onClick={() => writeArgs?.()}
      >
        {buttonText}
      </button>
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Convert form (deposit, claim_matured, wrap, unwrap) ---

function ConvertForm({
  market,
  action,
  symbols,
  accent,
  onClose,
}: {
  market: MarketInfo;
  action: ActiveAction;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const [raw, setRaw] = useState("");
  const [ptApprovedAmount, setPtApprovedAmount] = useState(0n);
  const [underlyingApprovedAmount, setUnderlyingApprovedAmount] = useState(0n);
  const nowSeconds = useNowSeconds(true);
  const amount = parseAmount(raw);
  const mode = action.type as ConvertMode;
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  const { approveTx, actionTx, busy } = useApprovalWriteFlows(connectedAddress);
  const zeroFirst = useZeroFirstApprove(approveTx);
  const disabled = amount === 0n || busy || actionTx.isConfirmed;

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setPtApprovedAmount(0n);
    setUnderlyingApprovedAmount(0n);
  });

  useEffect(() => {
    if (approveTx.hasFailed) {
      setPtApprovedAmount(0n);
      setUnderlyingApprovedAmount(0n);
    }
  }, [approveTx.hasFailed]);

  const matured = nowSeconds >= market.expiryCached;

  // Deposit-cap edge state (spec: "deposit form disabled with the cap shown,
  // 0 = unlimited").
  const depositLimit = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "marketDepositLimits",
    args: [market.market],
    query: { enabled: mode === "deposit" },
  });
  const totalDeposited = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "marketTotalDeposited",
    args: [market.market],
    query: { enabled: mode === "deposit" },
  });
  const preview = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "previewDeposit",
    args: amount > 0n ? [market.market, amount] : undefined,
    query: { enabled: mode === "deposit" && amount > 0n },
  });
  const wrappedUnderlying = useReadContract({
    address: market.vault,
    abi: ovrfloAbi,
    functionName: "wrappedUnderlying",
  });
  const ptAllowance = useReadContract({
    address: market.ptToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, market.vault] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
  const underlyingAllowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, market.vault] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });
  const spendToken = mode === "deposit" ? market.ptToken : mode === "wrap" ? market.underlying : market.ovrfloToken;
  // PT has no entry in the symbol map — it is not one of the market's named
  // tokens — so the deposit case names it directly rather than rendering blank.
  const spendSymbol = mode === "deposit" ? "PT" : mode === "wrap" ? underlyingSymbol : ovrfloSymbol;
  const balanceRead = useReadContract({
    address: spendToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const depositPreview = preview.data as [bigint, bigint, bigint, bigint] | undefined;
  const feeAmount = depositPreview?.[2] ?? 0n;
  const minToUser = applySlippageDown(depositPreview?.[0] ?? 0n);
  const wrapCapacity = wrappedUnderlying.data ?? 0n;
  const walletBalance = balanceRead.data ?? 0n;
  const capLoaded = depositLimit.data !== undefined && totalDeposited.data !== undefined;
  const capLimit = depositLimit.data ?? 0n;
  const capUsed = totalDeposited.data ?? 0n;

  const { needsPtApproval, needsUnderlyingApproval, needsApproval } = convertApprovalNeeds({
    mode,
    amount,
    feeAmount,
    ptAllowance: ptAllowance.data ?? 0n,
    ptApprovedAmount,
    underlyingAllowance: underlyingAllowance.data ?? 0n,
    underlyingApprovedAmount,
  });
  const { capRemaining, capReached, capExceeded } = depositCapStatus({ mode, amount, capLoaded, capLimit, capUsed });
  const validationError = convertValidationError({ amount, walletBalance, capExceeded, capRemaining });

  const modeDisabled =
    disabled ||
    Boolean(validationError) ||
    (mode === "deposit" && (!depositPreview || matured || !capLoaded || capReached)) ||
    (mode === "claim_matured" && !matured) ||
    (mode === "unwrap" && wrapCapacity < amount);

  const steps = needsApproval ? ["APPROVE", "SIGN", "CONFIRMED"] : ["SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? steps.length - 1 : 0;

  return (
    <div className="form-grid">
      <AmountInput
        id="convert-amount"
        label={`AMOUNT (${spendSymbol})`}
        value={raw}
        onChange={setRaw}
        error={validationError}
        balance={walletBalance}
        symbol={spendSymbol}
        max={() => setRaw(formatUnits18(walletBalance))}
      />
      {mode === "deposit" ? (
        <div className="summary-row mono" aria-live="polite">
          {depositPreview ? (
            <>
              TO WALLET {formatTokenAmount(depositPreview[0], ovrfloSymbol)} / STREAM{" "}
              {formatTokenAmount(depositPreview[1], ovrfloSymbol)} / FEE {formatTokenAmount(feeAmount, underlyingSymbol)}
            </>
          ) : amount > 0n ? (
            "LOADING"
          ) : (
            "—"
          )}
        </div>
      ) : null}
      {mode === "unwrap" ? (
        <div className="label mono">WRAP RESERVE {formatTokenAmount(wrapCapacity, underlyingSymbol)}</div>
      ) : null}
      {mode === "deposit" && capLoaded && capLimit > 0n ? (
        capReached ? (
          <div className="label mono status-negative">
            DEPOSIT CAP REACHED — {formatTokenAmount(capLimit, "PT")}
          </div>
        ) : (
          <div className="label mono">
            DEPOSIT CAP {formatTokenAmount(capLimit, "PT")} / REMAINING{" "}
            {formatTokenAmount(capRemaining ?? 0n, "PT")}
          </div>
        )
      ) : null}
      {mode === "claim_matured" && !matured ? (
        <div className="label mono status-negative">CLAIM ENABLES AFTER MATURITY</div>
      ) : null}
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {needsPtApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            zeroFirst.submit(market.ptToken, market.vault, amount, ptAllowance.data ?? 0n);
            setPtApprovedAmount(amount);
          }}
        >
          APPROVE PT
        </button>
      ) : needsUnderlyingApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            // Wrap approves the exact amount it spends; only the deposit fee —
            // which requotes between blocks — carries the 2% buffer (R9).
            const approveAmount = mode === "wrap" ? amount : bufferedFeeApproveAmount(feeAmount);
            zeroFirst.submit(market.underlying, market.vault, approveAmount, underlyingAllowance.data ?? 0n);
            setUnderlyingApprovedAmount(approveAmount);
          }}
        >
          APPROVE {underlyingSymbol}
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={modeDisabled}
          type="button"
          onClick={() => {
            if (mode === "deposit") {
              actionTx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "deposit",
                args: [market.market, amount, minToUser],
              });
              return;
            }
            if (mode === "claim_matured") {
              actionTx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "claim",
                args: [market.ptToken, amount],
              });
              return;
            }
            actionTx.writeContract({
              address: market.vault,
              abi: ovrfloAbi,
              functionName: mode === "wrap" ? "wrap" : "unwrap",
              args: [amount],
            });
          }}
        >
          {mode === "claim_matured" ? "CLAIM" : mode.toUpperCase()}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE" />
      <TxState tx={actionTx} pendingLabel={mode.toUpperCase()} />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Borrow form ---

function BorrowForm({
  market,
  user,
  action,
  symbols,
  accent,
  onClose,
}: {
  market: MarketInfo;
  user?: Address;
  action: ActiveAction;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const queryClient = useQueryClient();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const [selectedStreamId, setSelectedStreamId] = useState<bigint | null>(action.streamId ?? null);
  const [raw, setRaw] = useState("");
  const [slippageRaw, setSlippageRaw] = useState(SLIPPAGE_DEFAULT_PCT);
  const [selectedAprRaw, setSelectedAprRaw] = useState<number | null>(null);
  const [showAlternative, setShowAlternative] = useState(false);
  const [streamApprovedId, setStreamApprovedId] = useState<bigint | null>(null);
  const [submitted, setSubmitted] = useState<{ target: bigint; quotedNet: bigint } | null>(null);
  // Known on the very first render, so a matured market is gated before the
  // ladder or router ever run — not even for a frame.
  const nowSeconds = useNowSeconds(true);

  const target = parseAmount(raw);
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);
  const feeBps = lending.params.feeBps;
  const demandState = useBorrowDemand(market.market, connectedAddress);

  // Maturity gate: past maturity neither the ladder nor the router ever runs
  // (gatherLiquidity reverts on expired series anyway).
  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;

  const ticks = aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps);
  const ladder = buildLadder(liquidity.liquidity, market.market, ticks, connectedAddress);
  const liquidTicks = ladder.filter((tick) => tick.total > 0n);
  const selectedApr = resolveSelectedTick(ladder, selectedAprRaw);
  const bestApr = resolveSelectedTick(ladder, null);
  const hasOwnLiquidity = ladder.some((tick) => tick.own > 0n);
  const plan = selectedApr !== null ? planSelectedBorrow(ladder, selectedApr, target) : null;

  const { approveTx, actionTx, busy } = useApprovalWriteFlows(connectedAddress);
  const zeroFirst = useZeroFirstApprove(approveTx);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setSelectedStreamId(action.streamId ?? null);
    setRaw("");
    setSlippageRaw(SLIPPAGE_DEFAULT_PCT);
    setSelectedAprRaw(null);
    setShowAlternative(false);
    setStreamApprovedId(null);
    setStaleRecovery(false);
    setSubmitted(null);
  });

  const recipient = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getRecipient",
    args: selectedStreamId ? [selectedStreamId] : undefined,
    query: { enabled: selectedStreamId !== null },
  });

  const quoteEnabled = Boolean(market.lending && selectedStreamId && selectedApr !== null && !matured);
  // Full-borrow quote (borrowAmount = 0) for the stream's grossPrice — the cap
  // the price-blind ladder plan is clamped to before quoting the actual fill.
  const fullQuote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: quoteEnabled ? [market.market, selectedStreamId!, selectedApr!, 0n] : undefined,
    query: { enabled: quoteEnabled },
  });
  const fullQuoteData = fullQuote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const grossPrice = fullQuoteData?.[0];

  const planFill = plan?.fill ?? 0n;
  const fill = grossPrice !== undefined && grossPrice < planFill ? grossPrice : planFill;
  const priceCapped = target > 0n && grossPrice !== undefined && grossPrice < planFill;

  const fillEnabled = quoteEnabled && fill > 0n;
  const fillQuote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: fillEnabled ? [market.market, selectedStreamId!, selectedApr!, fill] : undefined,
    query: { enabled: fillEnabled },
  });

  const gather = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "gatherLiquidity",
    args:
      fillEnabled && connectedAddress
        ? [market.market, selectedApr!, fill, 1n, connectedAddress]
        : undefined,
    query: { enabled: Boolean(fillEnabled && connectedAddress) },
  });

  const approved = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getApproved",
    args: selectedStreamId ? [selectedStreamId] : undefined,
    query: { enabled: selectedStreamId !== null },
  });

  const approvedForAll = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "isApprovedForAll",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });

  useEffect(() => {
    if (approveTx.hasFailed) setStreamApprovedId(null);
  }, [approveTx.hasFailed]);

  // A liquidity race is recoverable: refresh every on-chain read so the ladder
  // and quotes reflect the new depth, then ask for one explicit re-confirm.
  const { errorKind, terminal, staleRecovery, setStaleRecovery } = useStaleRecovery(
    actionTx.error,
    classifyBorrowError,
    queryClient,
    connectedAddress,
  );

  // A terminal error is terminal for the *stream*, not the form — picking a
  // different stream clears the failed transaction and re-arms the button.
  const resetActionTx = actionTx.reset;
  useEffect(() => {
    resetActionTx();
    setStaleRecovery(false);
  }, [selectedStreamId, resetActionTx, setStaleRecovery]);

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;
  if (matured) {
    return (
      <div className="form-grid">
        <div className="label mono status-negative">MARKET MATURED — BORROWING CLOSED</div>
        <CloseButton onClose={onClose} />
      </div>
    );
  }

  const quoteData = fillQuote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const gatherData = gather.data as [bigint[], boolean] | undefined;
  const gatherIds = gatherData?.[0] ?? [];

  const slippageBps = parseSlippageBps(slippageRaw);
  const minAcceptable =
    quoteData !== undefined && slippageBps !== null ? applySlippageDown(quoteData[3], slippageBps) : null;

  const recipientMatches =
    !selectedStreamId || recipient.data?.toLowerCase() === connectedAddress?.toLowerCase();

  const streamApproved =
    Boolean(selectedStreamId && streamApprovedId === selectedStreamId) ||
    Boolean(market.lending && approved.data?.toLowerCase() === market.lending.toLowerCase()) ||
    approvedForAll.data === true;

  const needsApproval = !streamApproved && selectedStreamId !== null;
  // Pre-submit terminal condition: quote()/gatherLiquidity reject genuinely
  // ineligible streams before the user ever signs.
  const readError = fullQuote.error ?? fillQuote.error ?? gather.error;
  const disabled =
    !market.lending ||
    !selectedStreamId ||
    !recipientMatches ||
    target === 0n ||
    fill === 0n ||
    busy ||
    !quoteData ||
    minAcceptable === null ||
    gatherIds.length === 0 ||
    actionTx.isConfirmed;

  const receiptSummary =
    actionTx.isConfirmed && actionTx.receipt && market.lending
      ? borrowReceiptSummary(actionTx.receipt.logs, feeBps, market.lending)
      : null;
  // The contract clamps the borrow to available liquidity, so a partial fill
  // can confirm without reverting — the receipt is the source of truth.
  const partialFillReceived =
    receiptSummary !== null && submitted !== null && receiptSummary.contributed < submitted.target;
  const receivedDiffers =
    receiptSummary !== null && submitted !== null && receiptSummary.net !== submitted.quotedNet;

  const steps = ["APPROVE STREAM", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : streamApproved ? 1 : 0;

  return (
    <div className="form-grid">
      {action.streamId === undefined ? (
        <select
          className="input mono"
          value={selectedStreamId?.toString() ?? ""}
          onChange={(e) => setSelectedStreamId(e.target.value ? BigInt(e.target.value) : null)}
        >
          <option value="">SELECT STREAM</option>
          {eligibleStreams.map((stream) => (
            <option key={stream.streamId.toString()} value={stream.streamId.toString()}>
              {stream.streamId.toString()} / {formatTokenAmount(stream.deposited - stream.withdrawn, ovrfloSymbol)}
            </option>
          ))}
        </select>
      ) : (
        <div className="label mono">STREAM {formatId(selectedStreamId ?? undefined)}</div>
      )}

      <RateLadder
        label="BORROW RATE"
        rows={liquidTicks.map((tick) => ({
          aprBps: tick.aprBps,
          cells: [
            `UPFRONT ${formatBpsPct(upfrontBps(tick.aprBps, ttmSeconds, feeBps))}`,
            `DEPTH ${formatTokenAmount(tick.total, underlyingSymbol)}`,
          ],
          best: tick.aprBps === bestApr,
        }))}
        selectedAprBps={selectedApr}
        onSelect={(aprBps) => {
          setSelectedAprRaw(aprBps);
          setShowAlternative(false);
        }}
        truncated={liquidity.tooLarge}
        emptyText="NO LIQUIDITY POSTED AT ANY RATE"
        footnote={hasOwnLiquidity ? "YOUR OWN SUPPLY IS EXCLUDED — YOU CANNOT BORROW AGAINST IT" : null}
      />
      {liquidTicks.length === 0 ? (
        // Empty ladder still shows recent borrower demand so a would-be lender
        // opening BORROW by mistake — or a borrower scouting — sees the market
        // isn't dead. Unreachable indexer stays distinct from zero borrows.
        demandState.status === "ok" ? (
          demandState.demand.length === 0 ? (
            <div className="label mono">NO LOANS IN 30 DAYS</div>
          ) : (
            demandState.demand.map((row) => (
              <div key={row.aprBps} className="label mono">
                RECENT DEMAND {formatAprBps(row.aprBps)} — {row.count} LOANS /{" "}
                {formatTokenAmount(row.amount, underlyingSymbol)} (30D)
              </div>
            ))
          )
        ) : (
          <DemandAnnotation status={demandState.status} />
        )
      ) : null}

      <AmountInput
        id="borrow-amount"
        label={`AMOUNT (${underlyingSymbol})`}
        value={raw}
        onChange={setRaw}
      />

      <label className="label mono" htmlFor="borrow-slippage">
        SLIPPAGE %
      </label>
      <input
        id="borrow-slippage"
        className={`input mono ${slippageBps === null ? "input-error" : ""}`}
        value={slippageRaw}
        onChange={(e) => setSlippageRaw(e.target.value)}
      />
      {slippageBps === null ? <div className="label mono status-negative">SLIPPAGE MUST BE 0.1–5%</div> : null}

      <div className="summary-row mono" aria-live="polite">
        {quoteData ? (
          <>
            NET {formatTokenAmount(quoteData[3], underlyingSymbol)} / OBLIGATION{" "}
            {formatTokenAmount(quoteData[1], ovrfloSymbol)} / RESIDUAL {formatTokenAmount(quoteData[4], ovrfloSymbol)}
          </>
        ) : target > 0n && fill > 0n ? (
          "LOADING"
        ) : (
          "—"
        )}
      </div>

      {plan?.partial && target > 0n ? (
        <div className="label mono status-warning">
          PARTIAL FILL — {formatTokenAmount(fill, underlyingSymbol)} OF {formatTokenAmount(target, underlyingSymbol)}{" "}
          AVAILABLE AT {selectedApr !== null ? formatAprBps(selectedApr) : "—"}
        </div>
      ) : null}
      {priceCapped ? (
        <div className="label mono status-warning">AMOUNT EXCEEDS STREAM VALUE — QUOTING MAXIMUM</div>
      ) : null}
      {plan?.partial && target > 0n && plan.alternativeAprBps !== null ? (
        !showAlternative ? (
          <button className="button mono" type="button" onClick={() => setShowAlternative(true)}>
            SHOW OTHER OPTIONS
          </button>
        ) : (
          <button
            className="button mono"
            type="button"
            onClick={() => {
              setSelectedAprRaw(plan.alternativeAprBps);
              setShowAlternative(false);
            }}
          >
            SWITCH TO {formatAprBps(plan.alternativeAprBps)} — COVERS FULL AMOUNT
          </button>
        )
      ) : null}

      {selectedStreamId && !recipientMatches ? (
        <div className="label mono status-negative">CONNECTED WALLET IS NOT RECIPIENT</div>
      ) : null}
      {readError ? <div className="label mono status-negative">{userFacingError(readError)}</div> : null}

      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />

      {staleRecovery && !actionTx.isConfirmed && !busy ? (
        <div className="label mono status-warning" role="status">
          LIQUIDITY CHANGED SINCE YOUR QUOTE — REVIEW THE NEW NUMBER AND RE-CONFIRM
        </div>
      ) : null}
      {terminal ? (
        <div className="label mono status-negative">{userFacingError(actionTx.error)}</div>
      ) : null}
      {actionTx.isReverted ? (
        <div className="label mono status-negative">TRANSACTION REVERTED ON-CHAIN</div>
      ) : null}

      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || !selectedStreamId || busy || terminal}
          type="button"
          onClick={() => {
            if (!market.lending || !selectedStreamId) return;
            approveTx.writeContract({
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "approve",
              args: [market.lending, selectedStreamId],
            });
            setStreamApprovedId(selectedStreamId);
          }}
        >
          APPROVE STREAM
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled || terminal}
          type="button"
          onClick={() => {
            if (!market.lending || !selectedStreamId || !quoteData || minAcceptable === null || gatherIds.length === 0)
              return;
            setStaleRecovery(false);
            setSubmitted({ target: fill, quotedNet: quoteData[3] });
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "createBorrowerLoanPool",
              args: [gatherIds, selectedStreamId, fill, minAcceptable],
            });
          }}
        >
          {staleRecovery ? "RE-CONFIRM BORROW" : "BORROW"}
        </button>
      )}

      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE STREAM" />
      {actionTx.isSigning ? <div className="label mono status-warning">BORROW: SIGNING</div> : null}
      {actionTx.isConfirming ? (
        <div className="label mono status-warning">BORROW: CONFIRMING {actionTx.hash?.slice(0, 10)}…</div>
      ) : null}
      {actionTx.isConfirmed ? <div className="label mono status-positive">CONFIRMED</div> : null}
      {errorKind === "retryable" ? (
        <div className="label mono status-negative">{userFacingError(actionTx.error)}</div>
      ) : null}

      {actionTx.isConfirmed && receiptSummary ? (
        <div className="summary-row mono" aria-live="polite">
          RECEIVED {formatTokenAmount(receiptSummary.net, underlyingSymbol)}
          {submitted && (partialFillReceived || receivedDiffers) ? (
            <span className="status-warning">
              {" "}
              — {partialFillReceived ? "PARTIAL FILL, " : ""}QUOTED{" "}
              {formatTokenAmount(submitted.quotedNet, underlyingSymbol)}
            </span>
          ) : null}
        </div>
      ) : null}
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Adjust-rate form ---

// Moves a position's idle liquidity to a new rate in one transaction:
// multicall(withdrawLiquidity(id), supplyLiquidity(market, newApr, freshIdle)).
// The idle amount is re-read immediately before submitting — a shrunk value
// routes through the ticket-06 re-confirm recovery, never a stale submit.
function AdjustRateForm({
  market,
  action,
  symbols,
  accent,
  onClose,
}: {
  market: MarketInfo;
  action: ActiveAction;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const queryClient = useQueryClient();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const positionId = action.positionId ?? null;

  const [selectedAprRaw, setSelectedAprRaw] = useState<number | null>(null);
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const nowSeconds = useNowSeconds(true);

  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;

  const positionRead = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "liquidityPositions",
    args: positionId !== null ? [positionId] : undefined,
    query: { enabled: Boolean(market.lending && positionId !== null) },
  });
  const positionData = positionRead.data as [Address, Address, number, bigint] | undefined;
  const [, , positionAprBps, positionIdleAmount] = positionData ?? [];
  const currentAprBps = positionAprBps ?? null;
  const idleAmount = positionIdleAmount ?? 0n;

  const { approveTx, actionTx, busy } = useApprovalWriteFlows(connectedAddress);
  const zeroFirst = useZeroFirstApprove(approveTx);

  // An ERC20 shortfall here is a liquidity race (position shrank after the
  // fresh read), so it routes through the stale-recovery path too.
  const { errorKind, terminal, staleRecovery, setStaleRecovery } = useStaleRecovery(
    actionTx.error,
    classifyAdjustError,
    queryClient,
    connectedAddress,
  );

  const guard = useWalletChangeReset(connectedAddress, () => {
    setSelectedAprRaw(null);
    setApprovedAmount(0n);
    setStaleRecovery(false);
  });

  const allowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });

  useEffect(() => {
    if (approveTx.hasFailed) setApprovedAmount(0n);
  }, [approveTx.hasFailed]);

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const ratesReady = !lending.isLoading && lending.params.aprMaxBps > 0;
  const ticks = ratesReady ? aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps) : [];
  // Excludes the user's own supply (including the position being moved) from
  // the WAITING depth — consistent with the borrow-side ladder.
  const ladder = buildLadder(liquidity.liquidity, market.market, ticks, connectedAddress);
  const newAprBps = selectedAprRaw !== null && ticks.includes(selectedAprRaw) ? selectedAprRaw : null;
  const sameRate = newAprBps !== null && newAprBps === currentAprBps;

  const needsApproval =
    idleAmount > 0n && (allowance.data ?? 0n) < idleAmount && approvedAmount < idleAmount;
  const disabled =
    !market.lending ||
    positionId === null ||
    idleAmount === 0n ||
    newAprBps === null ||
    sameRate ||
    matured ||
    busy ||
    terminal ||
    actionTx.isConfirmed;

  const receiptSummary =
    actionTx.isConfirmed && actionTx.receipt && market.lending
      ? adjustReceiptSummary(actionTx.receipt.logs, market.lending)
      : null;
  // The position can shrink between the fresh read and execution; the wallet
  // covers the difference. The receipt exposes it: refunded < moved.
  const walletTopUp =
    receiptSummary !== null && receiptSummary.refunded < receiptSummary.moved
      ? receiptSummary.moved - receiptSummary.refunded
      : null;

  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : needsApproval ? 0 : 1;

  async function submitAdjust() {
    if (!market.lending || positionId === null || newAprBps === null) return;
    // Fresh idle read immediately before submitting — never the cached value.
    const fresh = await positionRead.refetch();
    const freshIdle = (fresh.data as [Address, Address, number, bigint] | undefined)?.[3] ?? 0n;
    if (freshIdle === 0n) {
      setStaleRecovery(true);
      return;
    }
    if (freshIdle !== idleAmount) {
      // Shrunk (or grew) since the form opened: surface the fresh number and
      // ask for one explicit re-confirm — the next click submits freshIdle.
      setStaleRecovery(true);
      return;
    }
    setStaleRecovery(false);
    actionTx.writeContract({
      address: market.lending,
      abi: ovrfloLendingAbi,
      functionName: "multicall",
      args: [
        [
          encodeFunctionData({
            abi: ovrfloLendingAbi,
            functionName: "withdrawLiquidity",
            args: [positionId],
          }),
          encodeFunctionData({
            abi: ovrfloLendingAbi,
            functionName: "supplyLiquidity",
            args: [market.market, newAprBps, freshIdle],
          }),
        ],
      ],
    });
  }

  return (
    <div className="form-grid">
      <div className="label mono">
        POSITION {formatId(positionId ?? undefined)} / IDLE {formatTokenAmount(idleAmount, underlyingSymbol)} @{" "}
        {currentAprBps !== null ? formatAprBps(currentAprBps) : "—"}
      </div>
      <RateLadder
        label="NEW RATE"
        rows={ladder.map((tick) => ({
          aprBps: tick.aprBps,
          cells: [
            `RETURN ${formatBpsPct(lenderReturnBps(tick.aprBps, ttmSeconds))}`,
            `WAITING ${formatTokenAmount(tick.total, underlyingSymbol)}`,
          ],
        }))}
        selectedAprBps={newAprBps}
        onSelect={setSelectedAprRaw}
        truncated={liquidity.tooLarge}
        emptyText="LOADING RATES"
      />
      {sameRate ? <div className="label mono">SELECT A DIFFERENT RATE</div> : null}
      {matured ? <div className="label mono status-negative">MARKET MATURED — RATES CLOSED</div> : null}
      <div className="summary-row mono" aria-live="polite">
        MOVE {formatTokenAmount(idleAmount, underlyingSymbol)} TO{" "}
        {newAprBps !== null ? formatAprBps(newAprBps) : "—"}
      </div>
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {staleRecovery && !actionTx.isConfirmed && !busy ? (
        <div className="label mono status-warning" role="status">
          IDLE AMOUNT CHANGED SINCE THE FORM OPENED — REVIEW THE NEW NUMBER AND RE-CONFIRM
        </div>
      ) : null}
      {terminal ? <div className="label mono status-negative">{userFacingError(actionTx.error)}</div> : null}
      {actionTx.isReverted ? (
        <div className="label mono status-negative">TRANSACTION REVERTED ON-CHAIN</div>
      ) : null}
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || idleAmount === 0n || busy || matured}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            zeroFirst.submit(market.underlying, market.lending, idleAmount, allowance.data ?? 0n);
            setApprovedAmount(idleAmount);
          }}
        >
          APPROVE
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => void submitAdjust()}
        >
          {staleRecovery ? "RE-CONFIRM ADJUST RATE" : "ADJUST RATE"}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE" />
      {actionTx.isSigning ? <div className="label mono status-warning">MOVE: SIGNING</div> : null}
      {actionTx.isConfirming ? (
        <div className="label mono status-warning">MOVE: CONFIRMING {actionTx.hash?.slice(0, 10)}…</div>
      ) : null}
      {actionTx.isConfirmed ? <div className="label mono status-positive">CONFIRMED</div> : null}
      {errorKind === "retryable" ? (
        <div className="label mono status-negative">{userFacingError(actionTx.error)}</div>
      ) : null}
      {actionTx.isConfirmed && receiptSummary ? (
        <div className="summary-row mono" aria-live="polite">
          MOVED {formatTokenAmount(receiptSummary.moved, underlyingSymbol)} TO {formatAprBps(receiptSummary.aprBps)}
          {walletTopUp !== null ? (
            <span className="status-warning">
              {" "}
              — POSITION REFUNDED {formatTokenAmount(receiptSummary.refunded, underlyingSymbol)},{" "}
              {formatTokenAmount(walletTopUp, underlyingSymbol)} DRAWN FROM WALLET
            </span>
          ) : null}
        </div>
      ) : null}
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Repay form ---

function RepayForm({
  market,
  user,
  action,
  symbols,
  accent,
  onClose,
}: {
  market: MarketInfo;
  user?: Address;
  action: ActiveAction;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const borrowerLoans = useBorrowerLoans(market.lending, user);
  const loanEntry = borrowerLoans.loans.find(({ loan }) => loan.id === action.loanId);
  const loan = loanEntry?.loan;

  const [raw, setRaw] = useState("");
  const [repayApprovedAmount, setRepayApprovedAmount] = useState(0n);
  const connectedAddress = connection.addresses?.[0];
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  const repayInput = parseAmount(raw);
  const outstanding = loan ? loanOutstanding(loan) : 0n;
  const repayAmount = repayInput > outstanding && outstanding > 0n ? outstanding : repayInput;

  const { approveTx, actionTx, busy } = useApprovalWriteFlows(connectedAddress);
  const zeroFirst = useZeroFirstApprove(approveTx);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setRepayApprovedAmount(0n);
  });

  const repayAllowance = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });
  // Polled, not just invalidation-driven: the wallet's ovrfloToken balance can
  // change from outside this session (a transfer elsewhere, another channel
  // draining it) with no tx of this modal's own to key an invalidation off
  // of — same reasoning as useBorrowerLoans's polling for an externally
  // closed loan.
  const balanceRead = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress), refetchInterval: 2_000 },
  });

  useEffect(() => {
    if (approveTx.hasFailed) setRepayApprovedAmount(0n);
  }, [approveTx.hasFailed]);

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const needsApproval =
    Boolean(market.lending) &&
    repayAmount > 0n &&
    (repayAllowance.data ?? 0n) < repayAmount &&
    repayApprovedAmount < repayAmount;
  const walletBalance = balanceRead.data ?? 0n;
  const validationError = repayAmount > 0n && repayAmount > walletBalance ? "INSUFFICIENT BALANCE" : null;

  const disabled =
    !market.lending || !loan || repayAmount === 0n || busy || Boolean(validationError) ||
    actionTx.isConfirmed;

  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : needsApproval ? 0 : 1;

  if (borrowerLoans.isLoading) {
    return <div className="label mono">LOADING</div>;
  }
  // `loan` itself never disappears from the read (the contract never zeroes
  // a closed loan's borrower) — closing sets `closed: true` in place. Treat
  // an externally-closed loan as not found, but not one this form's own
  // repay just closed (guarded by `actionTx.isConfirmed`), or a just-repaid
  // loan would flash "LOAN NOT FOUND" instead of the CONFIRMED state below.
  if (!loan || (loan.closed && !actionTx.isConfirmed)) {
    return <div className="label mono status-negative">LOAN NOT FOUND</div>;
  }

  return (
    <div className="form-grid">
      <div className="label mono">LOAN {formatId(loan.id)} / OUTSTANDING {formatTokenAmount(outstanding, ovrfloSymbol)}</div>
      <AmountInput
        id="repay-amount"
        label={`AMOUNT (${ovrfloSymbol})`}
        value={raw}
        onChange={setRaw}
        error={validationError}
        balance={walletBalance}
        symbol={ovrfloSymbol}
        max={() => setRaw(formatUnits18(repayMax(loan, walletBalance)))}
        maxDisabled={outstanding === 0n}
      />
      <div className="summary-row mono" aria-live="polite">
        REPAY {formatTokenAmount(repayAmount, ovrfloSymbol)} / REMAINING {formatTokenAmount(outstanding - repayAmount, ovrfloSymbol)}
      </div>
      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || busy}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            zeroFirst.submit(market.ovrfloToken, market.lending, repayAmount, repayAllowance.data ?? 0n);
            setRepayApprovedAmount(repayAmount);
          }}
        >
          APPROVE REPAY
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending || !loan) return;
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "repayLoan",
              args: [loan.id, repayAmount],
            });
          }}
        >
          REPAY {formatTokenAmount(repayAmount, ovrfloSymbol)}
        </button>
      )}
      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE REPAY" />
      <TxState tx={actionTx} pendingLabel="REPAY" />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}
