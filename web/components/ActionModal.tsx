"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import type { Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { useBorrowerLoans } from "@/hooks/useBorrowerLoans";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { erc20Abi, ovrfloAbi, ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { userFacingError } from "@/lib/errors";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";
import { loanOutstanding, MAX_UINT128 } from "@/lib/lending-math";
import {
  applySlippageDown,
  borrowQuoteCopy,
  chooseSellNowLiquidity,
  isSeriesMatchedStream,
  staleBatchCopy,
} from "@/lib/modal-logic";
import { lendingKeys, ovrfloKeys, streamKeys } from "@/lib/query-keys";
import type { ActiveAction, ActionType, MarketInfo } from "@/lib/types";

type Accent = "gold" | "cyan" | "neutral";

type Props = {
  market: MarketInfo;
  user?: Address;
  action: ActiveAction;
  onClose: () => void;
};

const ACTION_META: Record<ActionType, { title: string; accent: Accent }> = {
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

function accentClass(accent: Accent) {
  return accent === "gold" ? "button-gold" : accent === "cyan" ? "button-cyan" : "";
}

export function ActionModal({ market, user, action, onClose }: Props) {
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
        <h3 className="modal-heading" tabIndex={-1}>
          {meta.title}
        </h3>
        <FormBody action={action} market={market} user={user} accent={meta.accent} onClose={onClose} />
      </div>
    </div>
  );
}

function FormBody({
  action,
  market,
  user,
  accent,
  onClose,
}: {
  action: ActiveAction;
  market: MarketInfo;
  user?: Address;
  accent: Accent;
  onClose: () => void;
}) {
  switch (action.type) {
    case "supply":
      return <SupplyForm market={market} accent={accent} onClose={onClose} />;
    case "withdraw":
    case "claim_share":
    case "claim_stream":
    case "close":
      return <SimpleActionForm market={market} user={user} action={action} accent={accent} onClose={onClose} />;
    case "deposit":
    case "claim_matured":
    case "wrap":
    case "unwrap":
      return <ConvertForm market={market} action={action} accent={accent} onClose={onClose} />;
    case "borrow":
      return <BorrowForm market={market} user={user} action={action} accent={accent} onClose={onClose} />;
    case "sell":
      return <SellForm market={market} action={action} accent={accent} onClose={onClose} />;
    case "repay":
      return <RepayForm market={market} user={user} action={action} accent={accent} onClose={onClose} />;
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

function TxState({ tx, pendingLabel }: { tx: ReturnType<typeof useWriteFlow>; pendingLabel?: string | null }) {
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

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="button mono" type="button" onClick={onClose}>
      CLOSE
    </button>
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
  accent,
  onClose,
}: {
  market: MarketInfo;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const lending = useLending(market.lending);
  const [raw, setRaw] = useState("");
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const amount = parseAmount(raw);
  const aprBps = lending.params.aprMinBps || 1000;

  const invalidateKeys = useMemo(
    () => [lendingKeys.liquidity(market.lending), ovrfloKeys.markets()],
    [market.lending],
  );
  const tx = useWriteFlow(invalidateKeys);

  useEffect(() => {
    if (tx.error) setApprovedAmount(0n);
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

  const allowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connection.addresses?.[0] && market.lending ? [connection.addresses[0], market.lending] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0] && market.lending) },
  });

  const allowanceAmount = allowance.data ?? 0n;
  const approvalCovers = allowanceAmount >= amount || approvedAmount >= amount;
  const disabled = !market.lending || amount === 0n || tx.isSigning || tx.isConfirming;
  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex = tx.isConfirmed || tx.isConfirming ? 2 : approvalCovers || tx.isSigning ? 1 : 0;

  return (
    <div className="form-grid">
      <input className="input mono" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      <div className="summary-row mono" aria-live="polite">
        LIQUIDITY {formatTokenAmount(amount, "wstETH")} @ {formatAprBps(aprBps)}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(tx.error)} accent={accent} />
      {!approvalCovers ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            setPendingLabel("APPROVE");
            tx.writeContract({
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
            if (!market.lending) return;
            setPendingLabel("SUPPLY");
            tx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "supplyLiquidity",
              args: [market.market, aprBps, amount],
            });
          }}
        >
          SUPPLY @ {formatAprBps(aprBps)}
        </button>
      )}
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
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

  const invalidateKeys = useMemo(() => {
    switch (action.type) {
      case "withdraw":
        return [lendingKeys.liquidity(market.lending)];
      case "claim_share":
        return [lendingKeys.lenderPools(market.lending, user)];
      case "claim_stream":
        return [streamKeys.held(user)];
      case "close":
        return [lendingKeys.borrowerLoans(market.lending, user)];
      default:
        return [];
    }
  }, [action.type, market.lending, user]);

  const tx = useWriteFlow(invalidateKeys);

  useEffect(() => {
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

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
          if (!connection.addresses?.[0]) return;
          setPendingLabel("CLAIM");
          tx.writeContract({
            address: SABLIER_LOCKUP_ADDRESS,
            abi: sablierLockupAbi,
            functionName: "withdrawMax",
            args: [action.streamId!, connection.addresses[0]],
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
  accent,
  onClose,
}: {
  market: MarketInfo;
  action: ActiveAction;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const [raw, setRaw] = useState("");
  const [ptApprovedAmount, setPtApprovedAmount] = useState(0n);
  const [underlyingApprovedAmount, setUnderlyingApprovedAmount] = useState(0n);
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const amount = parseAmount(raw);
  const mode = action.type;

  const tx = useWriteFlow([ovrfloKeys.markets(), lendingKeys.borrowerLoans(market.lending)]);
  const disabled = amount === 0n || tx.isSigning || tx.isConfirming;

  useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);
  useEffect(() => {
    if (tx.error) {
      setPtApprovedAmount(0n);
      setUnderlyingApprovedAmount(0n);
    }
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

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
    args: connection.addresses?.[0] ? [connection.addresses[0], market.vault] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0]) },
  });
  const underlyingAllowance = useReadContract({
    address: market.underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: connection.addresses?.[0] ? [connection.addresses[0], market.vault] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0]) },
  });

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

  const modeDisabled =
    disabled ||
    (mode === "deposit" && (!depositPreview || matured)) ||
    (mode === "claim_matured" && !matured) ||
    (mode === "unwrap" && wrapCapacity < amount);

  const steps = needsApproval ? ["APPROVE", "SIGN", "CONFIRMED"] : ["SIGN", "CONFIRMED"];
  const activeIndex =
    tx.isConfirmed || tx.isConfirming
      ? steps.length - 1
      : needsApproval
        ? tx.isSigning
          ? 1
          : 0
        : 0;

  return (
    <div className="form-grid">
      <input className="input mono" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      {mode === "deposit" ? (
        <div className="summary-row mono" aria-live="polite">
          {depositPreview ? (
            <>
              TO WALLET {formatTokenAmount(depositPreview[0], "ovrflo")} / STREAM{" "}
              {formatTokenAmount(depositPreview[1], "ovrflo")} / FEE {formatTokenAmount(feeAmount, "wstETH")}
            </>
          ) : amount > 0n ? (
            "LOADING"
          ) : (
            "—"
          )}
        </div>
      ) : null}
      {mode === "unwrap" ? (
        <div className="label mono">UNWRAP CAPACITY {formatTokenAmount(wrapCapacity, "wstETH")}</div>
      ) : null}
      {mode === "claim_matured" && !matured ? (
        <div className="label mono status-negative">CLAIM ENABLES AFTER MATURITY</div>
      ) : null}
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(tx.error)} accent={accent} />
      {needsPtApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={disabled}
          type="button"
          onClick={() => {
            setPendingLabel("APPROVE PT");
            tx.writeContract({
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
            setPendingLabel("APPROVE wstETH");
            tx.writeContract({
              address: market.underlying,
              abi: erc20Abi,
              functionName: "approve",
              args: [market.vault, approveAmount],
            });
            setUnderlyingApprovedAmount(approveAmount);
          }}
        >
          APPROVE wstETH
        </button>
      ) : (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={modeDisabled}
          type="button"
          onClick={() => {
            setPendingLabel(mode.toUpperCase());
            if (mode === "deposit") {
              tx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "deposit",
                args: [market.market, amount, minToUser],
              });
              return;
            }
            if (mode === "claim_matured") {
              tx.writeContract({
                address: market.vault,
                abi: ovrfloAbi,
                functionName: "claim",
                args: [market.ptToken, amount],
              });
              return;
            }
            tx.writeContract({
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
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Borrow form ---

function BorrowForm({
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
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const [selectedStreamId, setSelectedStreamId] = useState<bigint | null>(action.streamId ?? null);
  const [raw, setRaw] = useState("");
  const [streamApprovedId, setStreamApprovedId] = useState<bigint | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const borrowAmount = parseAmount(raw);
  const aprBps = lending.params.aprMinBps || 1000;
  const connectedAddress = connection.addresses?.[0];

  const tx = useWriteFlow([
    streamKeys.held(connectedAddress),
    lendingKeys.borrowerLoans(market.lending, connectedAddress),
    lendingKeys.lenderPools(market.lending, connectedAddress),
    lendingKeys.liquidity(market.lending),
  ]);

  const recipient = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getRecipient",
    args: selectedStreamId ? [selectedStreamId] : undefined,
    query: { enabled: selectedStreamId !== null },
  });

  const quote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args:
      market.lending && selectedStreamId && borrowAmount > 0n
        ? [market.market, selectedStreamId, aprBps, borrowAmount]
        : undefined,
    query: { enabled: Boolean(market.lending && selectedStreamId && borrowAmount > 0n) },
  });

  const gather = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "gatherLiquidity",
    args:
      market.lending && selectedStreamId && connectedAddress && borrowAmount > 0n
        ? [market.market, aprBps, borrowAmount, 1n, connectedAddress]
        : undefined,
    query: { enabled: Boolean(market.lending && selectedStreamId && connectedAddress && borrowAmount > 0n) },
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

  const quoteData = quote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const gatherData = gather.data as [bigint[], boolean] | undefined;
  const positionsAtRate = liquidity.liquidity.filter(
    (position) => position.market.toLowerCase() === market.market.toLowerCase() && position.aprBps === aprBps,
  );

  const recipientMatches =
    !selectedStreamId || recipient.data?.toLowerCase() === connectedAddress?.toLowerCase();

  const streamApproved =
    Boolean(selectedStreamId && streamApprovedId === selectedStreamId) ||
    Boolean(market.lending && approved.data?.toLowerCase() === market.lending.toLowerCase()) ||
    approvedForAll.data === true;

  const needsApproval = !streamApproved && selectedStreamId !== null;
  const disabled =
    !market.lending ||
    !selectedStreamId ||
    !recipientMatches ||
    borrowAmount === 0n ||
    tx.isSigning ||
    tx.isConfirming;

  const staleCopy = tx.error instanceof Error ? staleBatchCopy(tx.error.message) : null;

  useEffect(() => {
    if (tx.error) setStreamApprovedId(null);
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

  const steps = ["APPROVE STREAM", "SIGN", "CONFIRMED"];
  const activeIndex =
    tx.isConfirmed || tx.isConfirming ? 2 : streamApproved ? (tx.isSigning ? 1 : 1) : 0;

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
              {stream.streamId.toString()} / {formatTokenAmount(stream.deposited - stream.withdrawn, "ovrflo")}
            </option>
          ))}
        </select>
      ) : (
        <div className="label mono">STREAM {formatId(selectedStreamId ?? undefined)}</div>
      )}
      <input className="input mono" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      <div className="summary-row mono" aria-live="polite">
        {quoteData ? (
          <>
            NET {formatTokenAmount(quoteData[3], "wstETH")} / OBLIGATION{" "}
            {formatTokenAmount(quoteData[1], "ovrflo")} / RESIDUAL {formatTokenAmount(quoteData[4], "ovrflo")}
          </>
        ) : borrowAmount > 0n ? (
          "LOADING"
        ) : (
          "—"
        )}
      </div>
      <div className="label mono">
        {selectedStreamId && !recipientMatches
          ? "CONNECTED WALLET IS NOT RECIPIENT"
          : borrowQuoteCopy({
              gatheredIds: gatherData?.[0] ?? [],
              sufficient: gatherData?.[1] ?? false,
              positionsAtRate,
              borrower: connectedAddress,
            })}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(tx.error)} accent={accent} />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || !selectedStreamId || tx.isSigning || tx.isConfirming}
          type="button"
          onClick={() => {
            if (!market.lending || !selectedStreamId) return;
            setPendingLabel("APPROVE STREAM");
            tx.writeContract({
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
          disabled={disabled || !quoteData || !gatherData?.[1]}
          type="button"
          onClick={() => {
            if (!market.lending || !selectedStreamId || !gatherData || !quoteData) return;
            setPendingLabel("BORROW");
            tx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "createBorrowerLoanPool",
              args: [gatherData[0], selectedStreamId, borrowAmount, applySlippageDown(quoteData[3])],
            });
          }}
        >
          BORROW
        </button>
      )}
      {staleCopy ? <div className="label mono status-warning">{staleCopy}</div> : null}
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Sell form ---

function SellForm({
  market,
  action,
  accent,
  onClose,
}: {
  market: MarketInfo;
  action: ActiveAction;
  accent: Accent;
  onClose: () => void;
}) {
  const connection = useConnection();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending);
  const streamId = action.streamId ?? null;

  const [streamApprovedId, setStreamApprovedId] = useState<bigint | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const aprBps = lending.params.aprMinBps || 1000;
  const connectedAddress = connection.addresses?.[0];

  const tx = useWriteFlow([
    streamKeys.held(connectedAddress),
    lendingKeys.borrowerLoans(market.lending, connectedAddress),
    lendingKeys.liquidity(market.lending),
  ]);

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
  const disabled =
    !market.lending || !streamId || !sellPosition || !sellQuoteData || !streamApproved || tx.isSigning || tx.isConfirming;

  useEffect(() => {
    if (tx.error) setStreamApprovedId(null);
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

  const steps = ["APPROVE STREAM", "SIGN", "CONFIRMED"];
  const activeIndex = tx.isConfirmed || tx.isConfirming ? 2 : streamApproved ? (tx.isSigning ? 1 : 1) : 0;

  return (
    <div className="form-grid">
      <div className="label mono">STREAM {formatId(streamId ?? undefined)}</div>
      <div className="summary-row mono" aria-live="polite">
        {sellQuoteData ? (
          <>
            NET {formatTokenAmount(sellQuoteData[3], "wstETH")} / GROSS{" "}
            {formatTokenAmount(sellQuoteData[0], "wstETH")}
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
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(tx.error)} accent={accent} />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || !streamId || tx.isSigning || tx.isConfirming}
          type="button"
          onClick={() => {
            if (!market.lending || !streamId) return;
            setPendingLabel("APPROVE STREAM");
            tx.writeContract({
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
            setPendingLabel("SELL");
            tx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "sellStreamToLiquidity",
              args: [sellPosition.id, streamId, applySlippageDown(sellQuoteData[3])],
            });
          }}
        >
          SELL NOW {sellQuoteData ? formatTokenAmount(sellQuoteData[3], "wstETH") : ""}
        </button>
      )}
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}

// --- Repay form ---

function RepayForm({
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
  const borrowerLoans = useBorrowerLoans(market.lending, user);
  const loanEntry = borrowerLoans.loans.find(({ loan }) => loan.id === action.loanId);
  const loan = loanEntry?.loan;

  const [raw, setRaw] = useState("");
  const [repayApprovedAmount, setRepayApprovedAmount] = useState(0n);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const repayInput = parseAmount(raw);
  const outstanding = loan ? loanOutstanding(loan) : 0n;
  const repayAmount = repayInput > outstanding && outstanding > 0n ? outstanding : repayInput;

  const tx = useWriteFlow([
    lendingKeys.borrowerLoans(market.lending, user),
    lendingKeys.lenderPools(market.lending, user),
  ]);

  const repayAllowance = useReadContract({
    address: market.ovrfloToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: connection.addresses?.[0] && market.lending ? [connection.addresses[0], market.lending] : undefined,
    query: { enabled: Boolean(connection.addresses?.[0] && market.lending) },
  });

  const needsApproval =
    Boolean(market.lending) &&
    repayAmount > 0n &&
    (repayAllowance.data ?? 0n) < repayAmount &&
    repayApprovedAmount < repayAmount;

  const disabled = !market.lending || !loan || repayAmount === 0n || tx.isSigning || tx.isConfirming;

  useEffect(() => {
    if (tx.error) setRepayApprovedAmount(0n);
    if (tx.error || tx.isConfirmed) setPendingLabel(null);
  }, [tx.error, tx.isConfirmed]);

  const steps = ["APPROVE", "SIGN", "CONFIRMED"];
  const activeIndex =
    tx.isConfirmed || tx.isConfirming ? 2 : needsApproval ? (tx.isSigning ? 1 : 0) : tx.isSigning ? 1 : 1;

  if (borrowerLoans.isLoading) {
    return <div className="label mono">LOADING</div>;
  }
  if (!loan) {
    return <div className="label mono status-negative">LOAN NOT FOUND</div>;
  }

  return (
    <div className="form-grid">
      <div className="label mono">LOAN {formatId(loan.id)} / OUTSTANDING {formatTokenAmount(outstanding, "ovrflo")}</div>
      <input className="input mono" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0.00" />
      <button
        className="button mono"
        type="button"
        disabled={outstanding === 0n}
        onClick={() => setRaw(formatUnits18(outstanding))}
      >
        MAX
      </button>
      <div className="summary-row mono" aria-live="polite">
        REPAY {formatTokenAmount(repayAmount, "ovrflo")} / REMAINING {formatTokenAmount(outstanding - repayAmount, "ovrflo")}
      </div>
      <StepIndicator steps={steps} activeIndex={activeIndex} error={Boolean(tx.error)} accent={accent} />
      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || tx.isSigning || tx.isConfirming}
          type="button"
          onClick={() => {
            if (!market.lending) return;
            setPendingLabel("APPROVE REPAY");
            tx.writeContract({
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
            setPendingLabel("REPAY");
            tx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "repayLoan",
              args: [loan.id, repayAmount],
            });
          }}
        >
          REPAY {formatTokenAmount(repayAmount, "ovrflo")}
        </button>
      )}
      <TxState tx={tx} pendingLabel={pendingLabel} />
      {tx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </div>
  );
}
