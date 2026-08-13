"use client";

import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { ActionButton } from "@/components/kit/ActionButton";
import { AmountField } from "@/components/kit/AmountField";
import { Receipt } from "@/components/kit/Receipt";
import { SettlementTrace, type TraceStep } from "@/components/kit/SettlementTrace";
import { AcknowledgeRiskStep } from "@/components/first-run/AcknowledgeRiskStep";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { ovrfloLendingAbi } from "@/lib/abis";
import { MAX_UINT128 } from "@/lib/lending-math";
import { parseDecimalInput } from "@/lib/parse";
import { formatTruncatedDecimal } from "@/lib/format";
import type { MarketInfo } from "@/lib/types";
import { userFacingError } from "@/lib/errors";

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
  signingAllowed,
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
  signingAllowed: boolean;
  onClose: () => void;
}) {
  const chain = useChainGuard();
  const flow = useWriteFlow(undefined, market);
  const ackTrace = useAcknowledgeRiskTrace(traceSteps(kind, flow, true));
  const [repayRaw, setRepayRaw] = useState(
    outstanding !== undefined ? formatTruncatedDecimal(outstanding, 18, 5) : "",
  );

  if (chain.wrongChain) {
    return (
      <div className="watch-write" data-write={kind} data-gate="network">
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

  const steps = ackTrace.steps;
  const stale = !signingAllowed;
  const busy = flow.isSigning || flow.isConfirming || flow.isInFlight;
  const parsedRepay = parseDecimalInput(repayRaw);
  const repayAmount = parsedRepay.ok ? parsedRepay.value : 0n;

  function submit() {
    if (stale || busy) return;
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
          args: [
            pairs.slice(0, 32).map((pair) =>
              encodeClaim(pair.loanId, positionId),
            ),
          ],
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

  return (
    <div className="watch-write" data-write={kind}>
      <SettlementTrace steps={steps} />
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
      <Receipt kind="action" state={receiptState(flow)} lines={receiptLines(kind, symbol, { claimable, unfilled, outstanding, withdrawable, repayAmount })} />
      {flow.error ? <p className="kit-field-error">{userFacingError(flow.error)}</p> : null}
      {flow.hash ? <p className="watch-hero-meta">{truncateHash(flow.hash)}</p> : null}
      <div className="watch-actions">
        {ackTrace.needsAcknowledgment ? null : !flow.isConfirmed ? (
          stale ? (
            <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
              {actionLabel(kind, symbol, claimable)}
            </ActionButton>
          ) : (
            <ActionButton variant="primary" busy={busy} onClick={submit}>
              {actionLabel(kind, symbol, claimable)}
            </ActionButton>
          )
        ) : null}
        <ActionButton onClick={() => { flow.reset(); onClose(); }}>
          {flow.isConfirmed ? "DONE" : "BACK"}
        </ActionButton>
      </div>
    </div>
  );
}

function encodeClaim(loanId: bigint, positionId: bigint) {
  return encodeFunctionData({
    abi: ovrfloLendingAbi,
    functionName: "claim",
    args: [loanId, positionId, MAX_UINT128],
  });
}

function actionLabel(kind: WatchWriteKind, symbol: string, claimable?: bigint) {
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
  return [
    ...ack,
    { id: "amount", label: "AMOUNT", state: acknowledged ? "done" : "pending" },
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
  },
) {
  if (kind === "claim") {
    return [
      { key: "PAYOUT", value: `${formatTruncatedDecimal(amounts.claimable ?? 0n, 18, 5)} ${symbol}` },
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
