"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor, type SymbolMap } from "@/hooks/useMarketSymbols";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { userFacingError } from "@/lib/errors";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";

import { applySlippageDown, chooseSellNowLiquidity, isSeriesMatchedStream } from "@/lib/modal-logic";
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
import { invalidateAllOnChainReads } from "@/lib/invalidate";
import { useQueryClient } from "@tanstack/react-query";
import type { ActiveAction, ActionType, MarketInfo } from "@/lib/types";
import { RateLadder } from "./RateLadder";

export type Accent = "gold" | "cyan" | "neutral";

type Props = {
  market: MarketInfo;
  user?: Address;
  action: ActiveAction;
  symbols: SymbolMap;
  onClose: () => void;
};

export const ACTION_META: Record<ActionType, { title: string; accent: Accent }> = {
  supply: { title: "SUPPLY LIQUIDITY", accent: "gold" },
  withdraw: { title: "WITHDRAW LIQUIDITY", accent: "gold" },
  claim_share: { title: "CLAIM LENDING SHARE", accent: "gold" },
  deposit: { title: "DEPOSIT PT", accent: "gold" },
  claim_matured: { title: "CLAIM MATURED PT", accent: "gold" },
  wrap: { title: "WRAP", accent: "neutral" },
  unwrap: { title: "UNWRAP", accent: "neutral" },
  borrow: { title: "BORROW AGAINST STREAM", accent: "cyan" },
  claim_stream: { title: "CLAIM STREAM", accent: "gold" },
  sell: { title: "SELL STREAM NOW", accent: "cyan" },
  repay: { title: "REPAY LOAN", accent: "cyan" },
  close: { title: "CLOSE LOAN", accent: "cyan" },
};

export function accentClass(accent: Accent) {
  return accent === "gold" ? "button-gold" : accent === "cyan" ? "button-cyan" : "";
}

export function ActionModal({ market, user, action, symbols, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const meta = ACTION_META[action.type];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal-panel"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={meta.title}
      >
        <div className="modal-header">
          <h3 className="modal-heading" tabIndex={-1}>
            {meta.title}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <FormBody action={action} market={market} user={user} symbols={symbols} accent={meta.accent} onClose={onClose} />
      </div>
    </div>
  );
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
    case "sell":
      return <SellForm market={market} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    case "repay":
      return <RepayForm market={market} user={user} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    default:
      return null;
  }
}

// --- Shared components ---

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
        <span
          key={step}
          className={
            i < activeIndex ? "step-done" : i === activeIndex ? (error ? "step-error" : "step-active") : "step-pending"
          }
        >
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
  if (tx.error) return <div className="label mono status-negative">{userFacingError(tx.error)}</div>;
  return null;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="button mono" type="button" onClick={onClose}>
      CLOSE
    </button>
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
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = setInterval(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), 30_000);
    return () => clearInterval(id);
  }, []);

  const amount = parseAmount(raw);
  const connectedAddress = connection.addresses?.[0];
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

  const approveTx = useWriteFlow(connectedAddress);
  const actionTx = useWriteFlow(connectedAddress);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setApprovedAmount(0n);
    setSelectedAprRaw(null);
  });

  useEffect(() => {
    if (approveTx.error) setApprovedAmount(0n);
  }, [approveTx.error]);

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

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const allowanceAmount = allowance.data ?? 0n;
  const walletBalance = balanceOf.data ?? 0n;
  const validationError = amount > 0n && amount > walletBalance ? "INSUFFICIENT BALANCE" : null;
  const approvalCovers = allowanceAmount >= amount || approvedAmount >= amount;
  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  const disabled =
    !market.lending || aprBps === null || amount === 0n || busy || Boolean(validationError) || matured;
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
          ],
        }))}
        selectedAprBps={aprBps}
        onSelect={setSelectedAprRaw}
        truncated={liquidity.tooLarge}
        emptyText="LOADING RATES"
      />
      {/* Real per-rate borrower demand lands with the Ponder pipeline (ticket 09). */}
      <div className="label mono">
        DEMAND (30D) AT {aprBps !== null ? formatAprBps(aprBps) : "—"} — NO DATA YET
      </div>
      <input className={`input mono ${validationError ? "input-error" : ""}`} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      {validationError ? <div className="label mono status-negative">{validationError}</div> : null}
      {matured ? <div className="label mono status-negative">MARKET MATURED — SUPPLY CLOSED</div> : null}
      <div className="summary-row mono" aria-live="polite">
        SUPPLY {formatTokenAmount(amount, underlyingSymbol)} @ {aprBps !== null ? formatAprBps(aprBps) : "—"}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(approveTx.error ?? actionTx.error)} accent={accent} />
      {!approvalCovers ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            approveTx.writeContract({
              address: market.underlying,
              abi: erc20Abi,
              functionName: "approve",
              args: [market.lending, amount],
            });
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
          setPendingLabel("CLAIM");
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
          setPendingLabel("CLAIM");
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
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(tx.error)} accent={accent} />
      <button
        className={`button ${accentClass(accent)} mono`}
        disabled={!writeArgs || tx.isSigning || tx.isConfirming}
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
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  const amount = parseAmount(raw);
  const mode = action.type;
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);

  const approveTx = useWriteFlow(connectedAddress);
  const actionTx = useWriteFlow(connectedAddress);
  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  const disabled = amount === 0n || busy;

  const guard = useWalletChangeReset(connectedAddress, () => {
    setRaw("");
    setPtApprovedAmount(0n);
    setUnderlyingApprovedAmount(0n);
  });

  useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);
  useEffect(() => {
    if (approveTx.error) {
      setPtApprovedAmount(0n);
      setUnderlyingApprovedAmount(0n);
    }
  }, [approveTx.error]);

  const matured = nowSeconds !== null && nowSeconds >= market.expiryCached;

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
  const balanceRead = useReadContract({
    address: spendToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const depositPreview = preview.data as [bigint, bigint, bigint, bigint] | undefined;
  const feeAmount = depositPreview?.[2] ?? 0n;
  const minToUser = applySlippageDown(depositPreview?.[0] ?? 0n);

  const needsPtApproval =
    mode === "deposit" && amount > 0n && (ptAllowance.data ?? 0n) < amount && ptApprovedAmount < amount;
  const needsUnderlyingApproval =
    ((mode === "deposit" && feeAmount > 0n) || mode === "wrap") &&
    amount > 0n &&
    (underlyingAllowance.data ?? 0n) < (mode === "wrap" ? amount : feeAmount) &&
    underlyingApprovedAmount < (mode === "wrap" ? amount : feeAmount);
  const needsApproval = needsPtApproval || needsUnderlyingApproval;
  const wrapCapacity = wrappedUnderlying.data ?? 0n;
  const walletBalance = balanceRead.data ?? 0n;
  const validationError = amount > 0n && amount > walletBalance ? "INSUFFICIENT BALANCE" : null;

  const modeDisabled =
    disabled ||
    Boolean(validationError) ||
    (mode === "deposit" && (!depositPreview || matured)) ||
    (mode === "claim_matured" && !matured) ||
    (mode === "unwrap" && wrapCapacity < amount);

  const steps = needsApproval ? ["APPROVE", "SIGN", "CONFIRMED"] : ["SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? steps.length - 1 : 0;

  return (
    <div className="form-grid">
      <input className={`input mono ${validationError ? "input-error" : ""}`} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      {validationError ? <div className="label mono status-negative">{validationError}</div> : null}
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
        <div className="label mono">UNWRAP CAPACITY {formatTokenAmount(wrapCapacity, underlyingSymbol)}</div>
      ) : null}
      {mode === "claim_matured" && !matured ? (
        <div className="label mono status-negative">CLAIM ENABLES AFTER MATURITY</div>
      ) : null}
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(approveTx.error ?? actionTx.error)} accent={accent} />
      {needsPtApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            approveTx.writeContract({
              address: market.ptToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [market.vault, amount],
            });
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
            const approveAmount = mode === "wrap" ? amount : feeAmount;
            approveTx.writeContract({
              address: market.underlying,
              abi: erc20Abi,
              functionName: "approve",
              args: [market.vault, approveAmount],
            });
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
  const [staleRecovery, setStaleRecovery] = useState(false);
  const [submitted, setSubmitted] = useState<{ target: bigint; quotedNet: bigint } | null>(null);
  // Lazy init is safe (the modal only ever renders client-side) and means a
  // matured market is gated on the very first render — the ladder and router
  // never run against it, not even for a frame.
  const [nowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  const target = parseAmount(raw);
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);
  const feeBps = lending.params.feeBps;

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

  const approveTx = useWriteFlow(connectedAddress);
  const actionTx = useWriteFlow(connectedAddress);

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
    if (approveTx.error) setStreamApprovedId(null);
  }, [approveTx.error]);

  // A liquidity race is recoverable: refresh every on-chain read so the ladder
  // and quotes reflect the new depth, then ask for one explicit re-confirm.
  const errorKind = actionTx.error ? classifyBorrowError(actionTx.error) : null;
  useEffect(() => {
    if (errorKind !== "stale") return;
    setStaleRecovery(true);
    invalidateAllOnChainReads(queryClient, connectedAddress);
  }, [errorKind, actionTx.error, queryClient, connectedAddress]);

  // A terminal error is terminal for the *stream*, not the form — picking a
  // different stream clears the failed transaction and re-arms the button.
  const resetActionTx = actionTx.reset;
  useEffect(() => {
    resetActionTx();
    setStaleRecovery(false);
  }, [selectedStreamId, resetActionTx]);

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
  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  const terminal = errorKind === "terminal";
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
    gatherIds.length === 0;

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

      <input className="input mono" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />

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
        error={Boolean(approveTx.error ?? actionTx.error)}
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

// --- Sell form ---

function SellForm({
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
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const streamId = action.streamId ?? null;

  const [streamApprovedId, setStreamApprovedId] = useState<bigint | null>(null);
  const aprBps = lending.params.aprMinBps || 1000;
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);

  const approveTx = useWriteFlow(connectedAddress);
  const actionTx = useWriteFlow(connectedAddress);

  const guard = useWalletChangeReset(connectedAddress, () => setStreamApprovedId(null));

  const sellQuote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: market.lending && streamId ? [market.market, streamId, aprBps, 0n] : undefined,
    query: { enabled: Boolean(market.lending && streamId) },
  });

  const approved = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getApproved",
    args: streamId ? [streamId] : undefined,
    query: { enabled: streamId !== null },
  });

  const approvedForAll = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "isApprovedForAll",
    args: connectedAddress && market.lending ? [connectedAddress, market.lending] : undefined,
    query: { enabled: Boolean(connectedAddress && market.lending) },
  });

  useEffect(() => {
    if (approveTx.error) setStreamApprovedId(null);
  }, [approveTx.error]);

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const sellQuoteData = sellQuote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const positionsAtRate = liquidity.liquidity.filter(
    (position) => position.market.toLowerCase() === market.market.toLowerCase() && position.aprBps === aprBps,
  );
  const sellPosition = sellQuoteData
    ? chooseSellNowLiquidity({ positions: positionsAtRate, market, grossPrice: sellQuoteData[0] })
    : undefined;

  const streamApproved =
    Boolean(streamId && streamApprovedId === streamId) ||
    Boolean(market.lending && approved.data?.toLowerCase() === market.lending.toLowerCase()) ||
    approvedForAll.data === true;

  const needsApproval = !streamApproved && streamId !== null;
  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  const disabled = !market.lending || !streamId || !sellPosition || !sellQuoteData || !streamApproved || busy;

  const steps = ["APPROVE STREAM", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : streamApproved ? 1 : 0;

  return (
    <div className="form-grid">
      <div className="label mono">STREAM {formatId(streamId ?? undefined)}</div>
      <div className="summary-row mono" aria-live="polite">
        {sellQuoteData ? (
          <>
            NET {formatTokenAmount(sellQuoteData[3], underlyingSymbol)} / GROSS{" "}
            {formatTokenAmount(sellQuoteData[0], underlyingSymbol)}
          </>
        ) : streamId ? (
          "LOADING"
        ) : (
          "—"
        )}
      </div>
      {!sellPosition && sellQuoteData ? (
        <div className="label mono status-negative">NO LIQUIDITY AT THIS PRICE</div>
      ) : null}
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(approveTx.error ?? actionTx.error)} accent={accent} />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || !streamId || busy}
          type="button"
          onClick={() => {
            if (!market.lending || !streamId) return;
            approveTx.writeContract({
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "approve",
              args: [market.lending, streamId],
            });
            setStreamApprovedId(streamId);
          }}
        >
          APPROVE STREAM
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending || !streamId || !sellPosition || !sellQuoteData) return;
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "sellStreamToLiquidity",
              args: [sellPosition.id, streamId, applySlippageDown(sellQuoteData[3])],
            });
          }}
        >
          SELL NOW {sellQuoteData ? formatTokenAmount(sellQuoteData[3], underlyingSymbol) : ""}
        </button>
      )}
      <ApproveTxState tx={approveTx} label="APPROVE STREAM" />
      <TxState tx={actionTx} pendingLabel="SELL" />
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

  const approveTx = useWriteFlow(connectedAddress);
  const actionTx = useWriteFlow(connectedAddress);

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
  const balanceRead = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(connectedAddress) },
  });

  useEffect(() => {
    if (approveTx.error) setRepayApprovedAmount(0n);
  }, [approveTx.error]);

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;

  const needsApproval =
    Boolean(market.lending) &&
    repayAmount > 0n &&
    (repayAllowance.data ?? 0n) < repayAmount &&
    repayApprovedAmount < repayAmount;
  const walletBalance = balanceRead.data ?? 0n;
  const validationError = repayAmount > 0n && repayAmount > walletBalance ? "INSUFFICIENT BALANCE" : null;

  const busy = approveTx.isSigning || approveTx.isConfirming || actionTx.isSigning || actionTx.isConfirming;
  const disabled =
    !market.lending || !loan || repayAmount === 0n || busy || Boolean(validationError);

  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : needsApproval ? 0 : 1;

  if (borrowerLoans.isLoading) {
    return <div className="label mono">LOADING</div>;
  }
  if (!loan) {
    return <div className="label mono status-negative">LOAN NOT FOUND</div>;
  }

  return (
    <div className="form-grid">
      <div className="label mono">LOAN {formatId(loan.id)} / OUTSTANDING {formatTokenAmount(outstanding, ovrfloSymbol)}</div>
      <input className={`input mono ${validationError ? "input-error" : ""}`} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      {validationError ? <div className="label mono status-negative">{validationError}</div> : null}
      <button
        className="button mono"
        type="button"
        disabled={outstanding === 0n}
        onClick={() => setRaw(formatUnits18(outstanding))}
      >
        MAX
      </button>
      <div className="summary-row mono" aria-live="polite">
        REPAY {formatTokenAmount(repayAmount, ovrfloSymbol)} / REMAINING {formatTokenAmount(outstanding - repayAmount, ovrfloSymbol)}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(approveTx.error ?? actionTx.error)} accent={accent} />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || busy}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            approveTx.writeContract({
              address: market.ovrfloToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [market.lending, repayAmount],
            });
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
      <ApproveTxState tx={approveTx} label="APPROVE REPAY" />
      <TxState tx={actionTx} pendingLabel="REPAY" />
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}
