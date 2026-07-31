"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { encodeFunctionData } from "viem";
import { useConnection, useReadContract } from "wagmi";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useQueryClient } from "@tanstack/react-query";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { erc20Abi, ovrfloLendingAbi } from "@/lib/abis";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";
import { adjustReceiptSummary, classifyAdjustError } from "@/lib/positions";
import { aprChoices, formatBpsPct, lenderReturnBps } from "@/lib/lending-math";
import { buildLadder } from "@/lib/router";
import { RateLadder } from "../RateLadder";
import { userFacingError } from "@/lib/errors";
import type { ActionFlowProps } from "./ActionFlowShell";
import { SimpleActionFlow } from "./ClaimFlow";
import {
  ActionFlowShell,
  ApproveTxState,
  CloseButton,
  RefreshTxState,
  StepIndicator,
  WalletChangedNotice,
  accentClass,
} from "./ActionFlowShell";

// --- Adjust-rate form ---

// Moves a position's idle liquidity to a new rate in one transaction:
// multicall(withdrawLiquidity(id), supplyLiquidity(market, newApr, freshIdle)).
// The idle amount is re-read immediately before submitting — a shrunk value
// routes through the ticket-06 re-confirm recovery, never a stale submit.
export function AdjustRateFlow({
  market,
  action,
  symbols,
  accent,
  onClose,
}: Pick<ActionFlowProps, "market" | "action" | "symbols" | "accent" | "onClose">) {
  const connection = useConnection();
  const queryClient = useQueryClient();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending, market.market);
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

  const { approveTx, actionTx, zeroFirst, busy } = useApprovalWriteFlows(connectedAddress, market);

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
    <ActionFlowShell>
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
      <RefreshTxState
        tx={actionTx}
        refreshingLabel="MOVE: CONFIRMED — REFRESHING"
        failedLabel="MOVE CONFIRMED — REFRESH FAILED"
      />
      {actionTx.isConfirmed ? <div className="label mono status-positive">CONFIRMED</div> : null}
      {errorKind === "retryable" && !actionTx.refreshFailed ? (
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
    </ActionFlowShell>
  );
}

export function PositionFlow({
  market,
  user,
  action,
  symbols,
  accent,
  onClose,
}: ActionFlowProps) {
  if (action.type === "adjust_rate") {
    return <AdjustRateFlow market={market} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
  }
  return <SimpleActionFlow market={market} user={user} action={action} accent={accent} onClose={onClose} />;
}
