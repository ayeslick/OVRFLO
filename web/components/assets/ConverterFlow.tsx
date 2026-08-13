"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { formatTokenAmount } from "@/lib/format";
import { readQuery } from "@/lib/query-keys";
import type { MarketInfo } from "@/lib/types";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useNowSecondsHydrationSafe } from "@/hooks/useNowSeconds";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { Converter, type ConverterDirection, type ConverterStage, type UnwrapAvailability } from "./Converter";
import { parseEnteredAmount, type MoneyRead } from "./helpers";
import { unwrapTrace, wrapTrace, type UnwrapStage, type WrapStage } from "./trace";
import { txStatusCopy } from "./tx-status";

export function ConverterFlow({
  market,
  underlyingSymbol,
  ovrfloSymbol,
  repayHref,
  signingAllowed,
}: {
  market: MarketInfo | null;
  underlyingSymbol: string;
  ovrfloSymbol: string;
  repayHref?: string;
  signingAllowed: boolean;
}) {
  const connection = useConnection();
  const user = connection.addresses?.[0];
  const connected = connection.status === "connected";
  const now = useNowSecondsHydrationSafe();
  const ack = useAcknowledgment();
  const chain = useChainGuard();
  const [direction, setDirection] = useState<ConverterDirection>("wrap");
  const [amountRaw, setAmountRaw] = useState("");
  const [stage, setStage] = useState<ConverterStage>("amount");
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const [traceNeedsApprove, setTraceNeedsApprove] = useState(false);
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const scope = market ?? [];
  const wrapFlows = useApprovalWriteFlows(user, scope);
  const unwrapTx = useWriteFlow(user, scope);
  const claimTx = useWriteFlow(user, scope);

  const reset = useCallback(() => {
    setAmountRaw("");
    setStage("amount");
    setApprovedAmount(0n);
    setTraceNeedsApprove(false);
    setApproveSubmitting(false);
    setActionSubmitting(false);
    wrapFlows.approveTx.reset();
    wrapFlows.actionTx.reset();
    unwrapTx.reset();
    claimTx.reset();
  }, [unwrapTx, wrapFlows.actionTx, wrapFlows.approveTx, claimTx]);

  const walletReset = useWalletChangeReset(user, reset);

  const enabled = Boolean(user && market);
  const reads = useReadContracts({
    allowFailure: true,
    contracts:
      user && market
        ? [
            { address: market.underlying, abi: erc20Abi, functionName: "balanceOf", args: [user] },
            { address: market.ovrfloToken, abi: erc20Abi, functionName: "balanceOf", args: [user] },
            {
              address: market.underlying,
              abi: erc20Abi,
              functionName: "allowance",
              args: [user, market.vault],
            },
            { address: market.vault, abi: ovrfloAbi, functionName: "wrappedUnderlying" },
          ]
        : [],
    query: { ...readQuery, enabled },
  });

  const walletUnderlying = moneyRead(reads.data?.[0]?.status, reads.data?.[0]?.result, reads.isLoading, enabled);
  const walletOvrflo = moneyRead(reads.data?.[1]?.status, reads.data?.[1]?.result, reads.isLoading, enabled);
  const allowanceRead = moneyRead(reads.data?.[2]?.status, reads.data?.[2]?.result, reads.isLoading, enabled);
  const wrapReserve = moneyRead(reads.data?.[3]?.status, reads.data?.[3]?.result, reads.isLoading, enabled);

  const matured = Boolean(market && now !== null && now >= market.expiryCached);
  const amountWei = parseEnteredAmount(amountRaw);
  const allowance = allowanceRead.status === "ready" ? allowanceRead.value : 0n;
  const needsApprove =
    direction === "wrap" &&
    amountWei !== null &&
    amountWei > 0n &&
    allowance < amountWei &&
    approvedAmount < amountWei;

  useEffect(() => {
    if (wrapFlows.approveTx.isConfirmed && amountWei && amountWei > 0n) {
      setApprovedAmount(amountWei);
      setApproveSubmitting(false);
    }
  }, [amountWei, wrapFlows.approveTx.isConfirmed]);

  useEffect(() => {
    if (wrapFlows.approveTx.hasFailed || wrapFlows.actionTx.hasFailed || unwrapTx.hasFailed) {
      setApproveSubmitting(false);
      setActionSubmitting(false);
    }
  }, [unwrapTx.hasFailed, wrapFlows.actionTx.hasFailed, wrapFlows.approveTx.hasFailed]);

  const actionFlow = direction === "wrap" ? wrapFlows.actionTx : unwrapTx;
  useEffect(() => {
    if (actionFlow.isConfirmed) setStage("confirmed");
    else if (actionFlow.isConfirming || actionFlow.isRefreshing) setStage("pending");
  }, [actionFlow.isConfirmed, actionFlow.isConfirming, actionFlow.isRefreshing]);

  const unwrapAvailability = useMemo<UnwrapAvailability>(() => {
    if (matured) return "absent";
    if (wrapReserve.status === "loading" || walletOvrflo.status === "loading") return "enabled";
    if (wrapReserve.status === "unavailable" || walletOvrflo.status === "unavailable") return "enabled";
    if (walletOvrflo.value === 0n) return "disabled-balance";
    const requested = amountWei && amountWei > 0n ? amountWei : 0n;
    if (requested > 0n && requested > wrapReserve.value) return "disabled-reserve";
    if (wrapReserve.value === 0n) return "disabled-reserve";
    return "enabled";
  }, [amountWei, matured, walletOvrflo, wrapReserve]);

  const amountError = useMemo(() => {
    if (!amountRaw.trim()) return undefined;
    if (amountWei === null || amountWei <= 0n) return "ENTER A VALID AMOUNT";
    if (direction === "wrap") {
      if (walletUnderlying.status === "loading") return undefined;
      if (walletUnderlying.status === "unavailable") return "BALANCE UNAVAILABLE";
      if (amountWei > walletUnderlying.value) return "INSUFFICIENT BALANCE";
    } else {
      if (walletOvrflo.status === "unavailable" || wrapReserve.status === "unavailable") {
        return "RESERVE UNAVAILABLE";
      }
      if (walletOvrflo.status === "ready" && amountWei > walletOvrflo.value) return "INSUFFICIENT BALANCE";
    }
    return undefined;
  }, [amountRaw, amountWei, direction, walletOvrflo, walletUnderlying, wrapReserve]);

  const outputState = !amountRaw.trim() ? "empty" : amountError ? "invalid" : "ready";
  const outputLabel =
    outputState === "empty"
      ? "—"
      : outputState === "invalid"
        ? amountError ?? "INVALID"
        : `${amountRaw.trim()} ${direction === "wrap" ? ovrfloSymbol : underlyingSymbol}`;

  function changeAmount(next: string) {
    setAmountRaw(next);
    if (stage !== "amount") {
      setStage("amount");
      setApprovedAmount(0n);
      wrapFlows.approveTx.reset();
      wrapFlows.actionTx.reset();
      unwrapTx.reset();
    }
  }

  function changeDirection(next: ConverterDirection) {
    if (next === "unwrap" && matured) return;
    setDirection(next);
    reset();
  }

  function continueFromAmount() {
    if (amountError || amountWei === null || amountWei <= 0n) return;
    if (direction === "unwrap" && unwrapAvailability === "disabled-reserve") return;
    setTraceNeedsApprove(needsApprove);
    setStage("review");
  }

  function continueFromReview() {
    if (ack.ready && !ack.acknowledged) {
      setStage("ack");
      return;
    }
    advanceAfterAck();
  }

  function advanceAfterAck() {
    if (direction === "wrap" && needsApprove) {
      setStage("approve");
      return;
    }
    setStage("sign");
  }

  function onApprove() {
    if (!market || amountWei === null || chain.wrongChain || !signingAllowed) return;
    setApproveSubmitting(true);
    wrapFlows.zeroFirst.submit(market.underlying, market.vault, amountWei, allowance);
  }

  function onSubmit() {
    if (!market || amountWei === null || chain.wrongChain || !signingAllowed) return;
    setActionSubmitting(true);
    if (direction === "wrap") {
      wrapFlows.actionTx.writeContract({
        address: market.vault,
        abi: ovrfloAbi,
        functionName: "wrap",
        args: [amountWei],
      } as never);
      return;
    }
    unwrapTx.writeContract({
      address: market.vault,
      abi: ovrfloAbi,
      functionName: "unwrap",
      args: [amountWei],
    } as never);
  }

  function onClaim() {
    if (!market || chain.wrongChain || !signingAllowed) return;
    const amount =
      amountWei && amountWei > 0n
        ? amountWei
        : walletOvrflo.status === "ready"
          ? walletOvrflo.value
          : 0n;
    if (amount <= 0n) return;
    setActionSubmitting(true);
    claimTx.writeContract({
      address: market.vault,
      abi: ovrfloAbi,
      functionName: "claim",
      args: [market.ptToken, amount],
    } as never);
  }

  useEffect(() => {
    if (direction === "wrap" && stage === "approve" && !needsApprove && approvedAmount > 0n) {
      setStage("sign");
    }
  }, [approvedAmount, direction, needsApprove, stage]);

  const wrapStage: WrapStage =
    stage === "pending" || stage === "confirmed" || stage === "ack" || stage === "approve"
      ? stage
      : stage === "sign"
        ? "wrap"
        : "amount";
  const unwrapStage: UnwrapStage =
    stage === "pending" || stage === "confirmed" || stage === "ack"
      ? stage
      : stage === "sign" || stage === "review"
        ? "unwrap"
        : "amount";

  const steps =
    direction === "wrap"
      ? wrapTrace({
          underlyingSymbol,
          needsApprove: traceNeedsApprove || needsApprove,
          ackRequired: ack.ready && !ack.acknowledged,
          stage: wrapStage,
        })
      : unwrapTrace({
          ackRequired: ack.ready && !ack.acknowledged,
          stage: unwrapStage,
        });

  const permissionLines =
    direction === "wrap"
      ? [
          { key: "TOKEN", value: underlyingSymbol },
          { key: "SPENDER", value: market ? formatSpender(market.vault) : "vault" },
          { key: "ALLOWANCE", value: formatTokenAmount(amountWei ?? undefined, underlyingSymbol) },
          { key: "MATCH", value: "EXACT" },
        ]
      : [];
  const actionLines = [
    { key: "ACTION", value: direction === "wrap" ? "WRAP" : "UNWRAP" },
    {
      key: "AMOUNT",
      value: formatTokenAmount(
        amountWei ?? undefined,
        direction === "wrap" ? underlyingSymbol : ovrfloSymbol,
      ),
    },
    {
      key: "OUTPUT",
      value: formatTokenAmount(
        amountWei ?? undefined,
        direction === "wrap" ? ovrfloSymbol : underlyingSymbol,
      ),
    },
  ];

  const flowSlice = direction === "wrap" ? wrapFlows.actionTx : unwrapTx;
  const approveSlice = wrapFlows.approveTx;
  const activeTx = stage === "approve" ? approveSlice : flowSlice;
  const tx = txStatusCopy(activeTx);

  const continueDisabled = Boolean(
    amountError ||
      amountWei === null ||
      amountWei <= 0n ||
      (direction === "unwrap" && unwrapAvailability !== "enabled") ||
      (direction === "unwrap" && wrapReserve.status !== "ready") ||
      (direction === "wrap" && walletUnderlying.status !== "ready") ||
      !connected ||
      !market,
  );
  const continueReason = !connected
    ? "CONNECT WALLET"
    : !market
      ? "SELECT A MARKET"
      : chain.wrongChain
        ? "SWITCH NETWORK"
        : direction === "unwrap" && unwrapAvailability === "disabled-reserve"
          ? "UNWRAP UNAVAILABLE — RESERVE"
          : direction === "unwrap" && wrapReserve.status !== "ready"
            ? wrapReserve.status === "unavailable"
              ? "RESERVE UNAVAILABLE"
              : "CHECKING…"
            : direction === "wrap" && walletUnderlying.status !== "ready"
              ? walletUnderlying.status === "unavailable"
                ? "BALANCE UNAVAILABLE"
                : "CHECKING…"
              : amountError ?? "ENTER AN AMOUNT";

  if (walletReset.walletChanged) {
    return (
      <div className="assets-banner" role="status">
        <p>WALLET CHANGED — RE-ENTER</p>
        <button type="button" className="kit-action" onClick={walletReset.acknowledge}>
          CONTINUE
        </button>
      </div>
    );
  }

  return (
    <Converter
      direction={matured && direction === "unwrap" ? "wrap" : direction}
      onDirection={changeDirection}
      underlyingSymbol={underlyingSymbol}
      ovrfloSymbol={ovrfloSymbol}
      destination={user}
      walletUnderlying={walletUnderlying}
      walletOvrflo={walletOvrflo}
      wrapReserve={wrapReserve}
      matured={matured}
      amountRaw={amountRaw}
      amountWei={amountWei}
      onAmount={changeAmount}
      amountError={amountError}
      unwrapAvailability={unwrapAvailability}
      availableReserveLabel={
        wrapReserve.status === "ready" ? formatTokenAmount(wrapReserve.value, underlyingSymbol) : undefined
      }
      outputState={outputState}
      outputLabel={outputLabel}
      stage={stage}
      steps={steps}
      permissionLines={permissionLines}
      permissionState={
        direction === "unwrap" || !(traceNeedsApprove || needsApprove)
          ? "skipped"
          : stage === "approve"
            ? "current"
            : "ghosted"
      }
      actionLines={actionLines}
      actionState={
        stage === "confirmed" ? "confirmed" : stage === "pending" ? "chain-pending" : stage === "sign" ? "current" : "ghosted"
      }
      txCopy={tx?.copy}
      txState={tx?.state}
      onContinue={stage === "amount" ? continueFromAmount : continueFromReview}
      continueDisabled={continueDisabled}
      continueReason={continueReason}
      onAcknowledge={() => {
        ack.acknowledge();
        advanceAfterAck();
      }}
      onApprove={onApprove}
      approveBusy={approveSubmitting || wrapFlows.approveTx.isInFlight}
      approveDisabled={chain.wrongChain || !signingAllowed || wrapFlows.approveTx.isInFlight}
      approveReason={
        chain.wrongChain ? "SWITCH NETWORK" : !signingAllowed ? "EVENTS STALE — SIGNING DISABLED" : "APPROVAL IN FLIGHT"
      }
      approveLabel={`APPROVE ${underlyingSymbol}`}
      onSubmit={onSubmit}
      submitBusy={actionSubmitting || actionFlow.isInFlight}
      submitDisabled={chain.wrongChain || !signingAllowed || actionFlow.isInFlight || actionFlow.isConfirmed}
      submitReason={
        chain.wrongChain
          ? "SWITCH NETWORK"
          : !signingAllowed
            ? "EVENTS STALE — SIGNING DISABLED"
            : actionFlow.isConfirmed
              ? "CONFIRMED"
              : "SIGNING…"
      }
      submitLabel={direction === "wrap" ? "WRAP" : "UNWRAP"}
      onRetryRefresh={actionFlow.retryRefresh}
      refreshFailed={actionFlow.refreshFailed}
      needsReview={actionFlow.needsReview}
      onReReview={() => setStage("review")}
      confirmedCopy={
        stage === "confirmed"
          ? `RECEIVED ${formatTokenAmount(amountWei ?? undefined, direction === "wrap" ? ovrfloSymbol : underlyingSymbol)}`
          : undefined
      }
      repayHref={direction === "wrap" ? repayHref : undefined}
      onClaim={onClaim}
      claimBusy={claimTx.isInFlight}
      claimDisabled={!matured || walletOvrflo.status !== "ready" || walletOvrflo.value === 0n || chain.wrongChain}
      claimReason={
        !matured
          ? "NOT MATURED"
          : walletOvrflo.status !== "ready"
            ? "BALANCE UNAVAILABLE"
            : "NO BALANCE"
      }
      claimVisible={matured}
      connected={connected}
    />
  );
}

function moneyRead(
  status: "success" | "failure" | undefined,
  result: unknown,
  isLoading: boolean,
  enabled: boolean,
): MoneyRead {
  if (!enabled) return { status: "loading" };
  if (isLoading && status === undefined) return { status: "loading" };
  if (status !== "success" || typeof result !== "bigint") return { status: "unavailable" };
  return { status: "ready", value: result };
}

function formatSpender(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
