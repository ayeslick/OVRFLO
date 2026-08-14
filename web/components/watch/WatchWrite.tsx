"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { ActionButton } from "@/components/kit/ActionButton";
import { AmountField } from "@/components/kit/AmountField";
import { Receipt } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep } from "@/components/kit/SettlementTrace";
import { AcknowledgeRiskStep } from "@/components/first-run/AcknowledgeRiskStep";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useWatchBalances, type WatchBalances } from "@/hooks/useWatchBalances";
import { erc20Abi, ovrfloLendingAbi } from "@/lib/abis";
import { claimedPayoutFromLogs } from "@/lib/claim-receipt";
import { formatCoverDate, formatTruncatedDecimal } from "@/lib/format";
import { MAX_UINT128 } from "@/lib/lending-math";
import { parseDecimalInput } from "@/lib/parse";
import { coverDate, type StreamSchedule } from "@/lib/payoff";
import { readRepayHandoff, writeRepayHandoff } from "@/lib/storage";
import type { MarketInfo } from "@/lib/types";
import { userFacingError } from "@/lib/errors";
import "./watch-write-exits.css";

export type WatchWriteKind = "claim" | "withdraw" | "repay" | "close";

export function WatchWrite({
  kind,
  lending,
  market,
  positionId,
  loanId,
  claimPairs,
  claimable,
  unfilled,
  outstanding,
  withdrawable,
  symbol,
  underlyingSymbol = "underlying",
  signingAllowed,
  schedule,
  nowSeconds,
  balances: balancesOverride,
  onClose,
}: {
  kind: WatchWriteKind;
  lending: Address;
  market: Pick<
    MarketInfo,
    "vault" | "lending" | "market" | "underlying" | "ovrfloToken" | "ptToken" | "expiryCached"
  >;
  positionId?: bigint;
  loanId?: bigint;
  claimPairs?: readonly { loanId: bigint; claimable: bigint }[];
  claimable?: bigint;
  unfilled?: bigint;
  outstanding?: bigint;
  withdrawable?: bigint;
  symbol: string;
  underlyingSymbol?: string;
  signingAllowed: boolean;
  schedule?: StreamSchedule;
  nowSeconds?: bigint;
  balances?: WatchBalances;
  onClose: () => void;
}) {
  const chain = useChainGuard();
  const { approveTx, actionTx: flow } = useApprovalWriteFlows(undefined, market);
  const liveBalances = useWatchBalances(market);
  const balances = balancesOverride ?? liveBalances;
  const [repayRaw, setRepayRaw] = useState(
    outstanding !== undefined ? formatTruncatedDecimal(outstanding, 18, 5) : "",
  );
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const parsedRepay = parseDecimalInput(repayRaw);
  const repayAmount = parsedRepay.ok ? parsedRepay.value : 0n;
  const allowance =
    balances.ovrfloAllowance.status === "ready" ? balances.ovrfloAllowance.value : 0n;
  const allowanceReady = balances.ovrfloAllowance.status === "ready";
  const tokenApproved =
    kind !== "repay" ||
    repayAmount <= 0n ||
    approvedAmount >= repayAmount ||
    (allowanceReady && allowance >= repayAmount);
  const allowancePending =
    kind === "repay" && repayAmount > 0n && !tokenApproved && !allowanceReady;
  const needsApprove = kind === "repay" && repayAmount > 0n && !tokenApproved && allowanceReady;
  const ackTrace = useAcknowledgeRiskTrace(traceSteps(kind, flow, true, needsApprove));

  useEffect(() => {
    if (kind !== "repay" || loanId === undefined) return;
    const restored = readRepayHandoff(loanId);
    if (restored) setRepayRaw(restored);
  }, [kind, loanId]);

  useEffect(() => {
    if (approveTx.isConfirmed && repayAmount > 0n) setApprovedAmount(repayAmount);
  }, [approveTx.isConfirmed, repayAmount]);

  if (chain.wrongChain) {
    return (
      <div className="watch-write" data-ui="UI-WATCH-WRITE" data-write={kind} data-gate="network">
        <p>
          CONNECTED CHAIN {chain.connectedChainId ?? "—"} · EXPECTED {chain.expectedChainId}
        </p>
        {chain.switchError ? (
          <ActionButton disabled disabledReason="SWITCH REJECTED — CHANGE NETWORK IN YOUR WALLET">
            SWITCH NETWORK
          </ActionButton>
        ) : chain.isSwitching ? (
          <ActionButton disabled disabledReason="SWITCHING…">
            SWITCH NETWORK
          </ActionButton>
        ) : (
          <ActionButton onClick={() => chain.switchChain()}>SWITCH NETWORK</ActionButton>
        )}
      </div>
    );
  }

  const stale = !signingAllowed;
  const busy = flow.isSigning || flow.isConfirming || flow.isInFlight;
  const approveBusy = approveTx.isSigning || approveTx.isConfirming || approveTx.isInFlight;
  const wrapShortfall = repayWrapShortfall(kind, repayAmount, balances);
  const coverPair = repayCoverPair(schedule, outstanding, repayAmount, nowSeconds);
  const claimedPayout = flow.isConfirmed
    ? claimedPayoutFromLogs(flow.receipt?.logs, positionId)
    : null;
  const payoutValue =
    kind === "claim" && flow.isConfirmed
      ? claimedPayout === null
        ? "CHECKING…"
        : `${formatTruncatedDecimal(claimedPayout, 18, 5)} ${symbol}`
      : undefined;

  function submit() {
    if (stale || busy || !tokenApproved || allowancePending) return;
    if (wrapShortfall) return;
    if (kind === "claim" && positionId !== undefined) {
      const pairs = (claimPairs ?? []).filter((pair) => pair.claimable > 0n);
      if (pairs.length === 1) {
        flow.writeContract({
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "claim",
          args: [pairs[0]!.loanId, positionId, MAX_UINT128],
        });
        return;
      }
      if (pairs.length > 1) {
        flow.writeContract({
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "multicall",
          args: [pairs.slice(0, 32).map((pair) => encodeClaim(pair.loanId, positionId))],
        });
      }
      return;
    }
    if (kind === "withdraw" && positionId !== undefined) {
      flow.writeContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "withdraw",
        args: [positionId],
      });
      return;
    }
    if (kind === "repay" && loanId !== undefined && repayAmount > 0n) {
      flow.writeContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "repay",
        args: [loanId, repayAmount],
      });
      return;
    }
    if (kind === "close" && loanId !== undefined) {
      flow.writeContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "close",
        args: [loanId],
      });
    }
  }

  function onApprove() {
    if (stale || approveBusy || repayAmount <= 0n || !allowanceReady) return;
    approveTx.writeContract({
      address: market.ovrfloToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [lending, repayAmount],
    });
  }

  return (
    <div className="watch-write" data-ui="UI-WATCH-WRITE" data-write={kind}>
      <SettlementTrace steps={ackTrace.steps} />
      {ackTrace.needsAcknowledgment ? <AcknowledgeRiskStep /> : null}
      {kind === "repay" && !flow.isConfirmed ? (
        <AmountField
          label="REPAY AMOUNT"
          value={repayRaw}
          unit={symbol}
          onChange={setRepayRaw}
          onMax={() => outstanding !== undefined && setRepayRaw(formatTruncatedDecimal(outstanding, 18, 5))}
          onSubmit={submit}
        />
      ) : null}
      {kind === "repay" && !flow.isConfirmed && coverPair ? (
        <dl className="watch-facts" data-ui="UI-REVIEW-REPAY">
          <div className="watch-fact">
            <dt>CURRENT COVER</dt>
            <dd>{coverPair.current}</dd>
          </div>
          <div className="watch-fact">
            <dt>AFTER THIS REPAY</dt>
            <dd>{coverPair.next}</dd>
          </div>
        </dl>
      ) : null}
      {wrapShortfall && !flow.isConfirmed ? (
        <div className="watch-write" data-ui="UI-REVIEW-REPAY-PREPARE" data-state="shortfall">
          <p>
            Wallet holds {formatTruncatedDecimal(wrapShortfall.have, 18, 5)} {symbol}. Wrapping{" "}
            {formatTruncatedDecimal(wrapShortfall.need, 18, 5)} {underlyingSymbol} covers the rest.
          </p>
          <div className="kit-action-wrap">
            <a
              className="kit-action"
              href={`/assets/?return=repay&loan=${loanId?.toString() ?? ""}`}
              onClick={() => loanId !== undefined && writeRepayHandoff(loanId, repayRaw)}
            >
              WRAP SHORTFALL
            </a>
          </div>
        </div>
      ) : null}
      {kind === "repay" && !flow.isConfirmed && needsApprove ? (
        <Receipt
          kind="permission"
          state="current"
          lines={[
            { key: "TOKEN", value: symbol },
            { key: "SPENDER", value: "OVRFLO LENDING" },
            { key: "ALLOWANCE", value: `${formatTruncatedDecimal(repayAmount, 18, 5)} ${symbol}` },
            { key: "MATCH", value: "MATCH EXACT" },
          ]}
        />
      ) : null}
      <Receipt
        kind="action"
        state={receiptState(flow)}
        lines={receiptLines(kind, symbol, {
          claimable,
          unfilled,
          outstanding,
          withdrawable,
          repayAmount,
          payoutValue,
        })}
      />
      {flow.error ? <p className="kit-field-error">{userFacingError(flow.error)}</p> : null}
      {approveTx.error ? <p className="kit-field-error">{userFacingError(approveTx.error)}</p> : null}
      {flow.hash ? <p className="watch-hero-meta">{truncateHash(flow.hash)}</p> : null}
      {kind === "claim" && flow.isConfirmed ? (
        <ClaimConfirmedExits
          symbol={symbol}
          underlyingSymbol={underlyingSymbol}
          payout={claimedPayout}
          wrapReserve={balances.wrapReserve}
          matured={balances.matured}
          onKeep={onClose}
        />
      ) : null}
      <div className="watch-actions">
        {ackTrace.needsAcknowledgment || flow.isConfirmed ? null : stale ? (
          <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
            {actionLabel(kind, symbol, claimable)}
          </ActionButton>
        ) : wrapShortfall ? (
          <ActionButton disabled disabledReason="WRAP THE ADDITIONAL AMOUNT TO REPAY THIS">
            REPAY
          </ActionButton>
        ) : allowancePending ? (
          <ActionButton disabled disabledReason="CHECKING…">
            REPAY
          </ActionButton>
        ) : needsApprove ? (
          <ActionButton variant="primary" busy={approveBusy} onClick={onApprove}>
            {`APPROVE ${symbol}`}
          </ActionButton>
        ) : (
          <ActionButton variant="primary" busy={busy} onClick={submit}>
            {actionLabel(kind, symbol, claimable)}
          </ActionButton>
        )}
        <ActionButton
          onClick={() => {
            flow.reset();
            approveTx.reset();
            onClose();
          }}
        >
          {flow.isConfirmed ? "DONE" : "BACK"}
        </ActionButton>
      </div>
    </div>
  );
}

function ClaimConfirmedExits({
  symbol,
  underlyingSymbol,
  payout,
  wrapReserve,
  matured,
  onKeep,
}: {
  symbol: string;
  underlyingSymbol: string;
  payout: bigint | null;
  wrapReserve: WatchBalances["wrapReserve"];
  matured: boolean;
  onKeep: () => void;
}) {
  const unwrapEnabled =
    payout !== null && wrapReserve.status === "ready" && wrapReserve.value >= payout;
  const reserveLabel =
    wrapReserve.status === "ready"
      ? formatTruncatedDecimal(wrapReserve.value, 18, 5)
      : wrapReserve.status === "loading"
        ? "CHECKING…"
        : "UNAVAILABLE";
  const state = unwrapEnabled ? "unwrap-enabled" : "reserve-insufficient";
  return (
    <div data-ui="UI-REVIEW-CLAIM-CONFIRMED" data-state={state}>
      <p>
        {payout === null
          ? "RECEIVED CHECKING…"
          : `RECEIVED ${formatTruncatedDecimal(payout, 18, 5)} ${symbol}`}
        . Unwrap, keep, and claim PT are different assets.
      </p>
      {unwrapEnabled ? (
        <div className="kit-action-wrap">
          <a className="kit-action" href="/assets/">
            UNWRAP TO UNDERLYING
          </a>
        </div>
      ) : (
        <ActionButton disabled disabledReason={`RESERVE ${reserveLabel} ${underlyingSymbol} — NOT A FAILED CLAIM`}>
          UNWRAP TO UNDERLYING
        </ActionButton>
      )}
      <ActionButton onClick={onKeep}>{`KEEP ${symbol}`}</ActionButton>
      {matured ? (
        <div className="kit-action-wrap">
          <a className="kit-action" href="/assets/">
            CLAIM PT
          </a>
        </div>
      ) : (
        <ActionButton disabled disabledReason="CLAIM PT OPENS AT SERIES MATURITY">
          CLAIM PT
        </ActionButton>
      )}
    </div>
  );
}

function repayWrapShortfall(
  kind: WatchWriteKind,
  repayAmount: bigint,
  balances: WatchBalances,
): { have: bigint; need: bigint } | null {
  if (kind !== "repay" || repayAmount <= 0n) return null;
  if (balances.walletOvrflo.status !== "ready" || balances.walletUnderlying.status !== "ready") return null;
  if (balances.walletOvrflo.value >= repayAmount) return null;
  const need = repayAmount - balances.walletOvrflo.value;
  if (balances.walletUnderlying.value < need) return null;
  return { have: balances.walletOvrflo.value, need };
}

function repayCoverPair(
  schedule: StreamSchedule | undefined,
  outstanding: bigint | undefined,
  repayAmount: bigint,
  nowSeconds: bigint | undefined,
): { current: string; next: string } | null {
  if (!schedule || outstanding === undefined || nowSeconds === undefined) return null;
  const current = coverDate(schedule, outstanding, nowSeconds);
  const nextOutstanding = outstanding > repayAmount ? outstanding - repayAmount : 0n;
  const next = coverDate(schedule, nextOutstanding, nowSeconds);
  return {
    current: coverLabel(current),
    next: coverLabel(next),
  };
}

function coverLabel(cover: ReturnType<typeof coverDate>): string {
  if (cover.status === "uncovered") return "UNCOVERED";
  if (cover.status === "covered") return formatCoverDate(cover.at).toUpperCase();
  return `~ ${formatCoverDate(cover.at).toUpperCase()}`;
}

function encodeClaim(loanId: bigint, positionId: bigint) {
  return encodeFunctionData({
    abi: ovrfloLendingAbi,
    functionName: "claim",
    args: [loanId, positionId, MAX_UINT128],
  });
}

function actionLabel(kind: WatchWriteKind, symbol: string, claimable: bigint | undefined) {
  if (kind === "claim") {
    return claimable !== undefined
      ? `CLAIM ${formatTruncatedDecimal(claimable, 18, 5)} ${symbol}`
      : "CLAIM";
  }
  if (kind === "withdraw") return "WITHDRAW UNFILLED";
  if (kind === "repay") return "REPAY";
  return "CLOSE FROM STREAM";
}

function traceSteps(
  kind: WatchWriteKind,
  flow: { isSigning: boolean; isConfirming: boolean; isConfirmed: boolean; isReverted: boolean },
  acknowledged: boolean,
  repayApprove: boolean,
): TraceStep[] {
  const actionState: TraceStep["state"] = flow.isConfirmed
    ? "done"
    : flow.isReverted
      ? "error"
      : flow.isSigning || flow.isConfirming
        ? "active"
        : acknowledged
          ? "active"
          : "pending";
  const settled: TraceStep["state"] = flow.isConfirmed ? "done" : "pending";
  const ack: TraceStep[] = acknowledged
    ? []
    : [{ id: "ack", label: "ACKNOWLEDGE RISK", state: "active" }];
  if (kind === "claim") {
    return [...ack, { id: "claim", label: "CLAIM", state: actionState }, { id: "settled", label: "SETTLED", state: settled }];
  }
  if (kind === "withdraw") {
    return [...ack, { id: "withdraw", label: "WITHDRAW", state: actionState }, { id: "settled", label: "SETTLED", state: settled }];
  }
  if (kind === "close") {
    return [...ack, { id: "close", label: "CLOSE", state: actionState }, { id: "settled", label: "SETTLED", state: settled }];
  }
  const approve: TraceStep[] = repayApprove
    ? [{ id: "approve", label: "APPROVE", state: "active" }]
    : [];
  return [
    ...ack,
    { id: "amount", label: "AMOUNT", state: acknowledged ? "done" : "pending" },
    ...approve,
    { id: "repay", label: "REPAY", state: actionState },
    { id: "settled", label: "SETTLED", state: settled },
  ];
}

function receiptState(flow: { isSigning: boolean; isConfirming: boolean; isConfirmed: boolean; isReverted: boolean }) {
  if (flow.isConfirmed) return "confirmed" as const;
  if (flow.isReverted) return "reverted" as const;
  if (flow.isSigning) return "wallet-pending" as const;
  if (flow.isConfirming) return "chain-pending" as const;
  return "frozen-review" as const;
}

function receiptLines(
  kind: WatchWriteKind,
  symbol: string,
  amounts: {
    claimable?: bigint;
    unfilled?: bigint;
    outstanding?: bigint;
    withdrawable?: bigint;
    repayAmount: bigint;
    payoutValue?: string;
  },
) {
  if (kind === "claim") {
    return [
      {
        key: amounts.payoutValue !== undefined ? "RECEIVED" : "PAYOUT",
        value:
          amounts.payoutValue ??
          `${formatTruncatedDecimal(amounts.claimable ?? 0n, 18, 5)} ${symbol}`,
      },
      { key: "ASSET", value: symbol },
    ];
  }
  if (kind === "withdraw") {
    return [{ key: "UNFILLED", value: `${formatTruncatedDecimal(amounts.unfilled ?? 0n, 18, 5)} ${symbol}` }];
  }
  if (kind === "close") {
    return [
      { key: "OUTSTANDING", value: `${formatTruncatedDecimal(amounts.outstanding ?? 0n, 18, 5)} ${symbol}` },
      { key: "WITHDRAWABLE", value: `${formatTruncatedDecimal(amounts.withdrawable ?? 0n, 18, 5)} ${symbol}` },
    ];
  }
  return [
    { key: "REPAY", value: `${formatTruncatedDecimal(amounts.repayAmount, 18, 5)} ${symbol}` },
    { key: "OUTSTANDING", value: `${formatTruncatedDecimal(amounts.outstanding ?? 0n, 18, 5)} ${symbol}` },
  ];
}

function truncateHash(hash: string) {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
