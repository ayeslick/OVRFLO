"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { erc20Abi, ovrfloAbi } from "@/lib/abis";
import { convertApprovalNeeds, depositCapStatus } from "@/lib/convert";
import { formatTokenAmount } from "@/lib/format";
import { applySlippageDown } from "@/lib/modal-logic";
import { readQuery } from "@/lib/query-keys";
import type { MarketInfo } from "@/lib/types";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useNowSecondsHydrationSafe } from "@/hooks/useNowSeconds";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { useZeroFirstApprove } from "@/hooks/useZeroFirstApprove";
import { StreamCreate, type StreamCreateStage } from "./StreamCreate";
import type { StreamMarketOption } from "./StreamSelectMarket";
import { exactAmountString, parseEnteredAmount, streamIdFromLogs } from "./helpers";
import { depositCapCopy, streamTrace, type StreamStage } from "./trace";
import { txStatusCopy } from "./tx-status";

export function StreamCreateFlow({
  markets,
  marketsStatus,
  symbolFor,
  signingAllowed,
}: {
  markets: readonly MarketInfo[];
  marketsStatus: "loading" | "ready" | "empty" | "unavailable";
  symbolFor: (address: Address) => string;
  signingAllowed: boolean;
}) {
  const connection = useConnection();
  const queryClient = useQueryClient();
  const user = connection.addresses?.[0];
  const now = useNowSecondsHydrationSafe();
  const ack = useAcknowledgment();
  const chain = useChainGuard();
  const [stage, setStage] = useState<StreamCreateStage>("market");
  const [selectedId, setSelectedId] = useState<Address | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [ptApprovedAmount, setPtApprovedAmount] = useState(0n);
  const [latchedNeedsPt, setLatchedNeedsPt] = useState(false);
  const [ptSubmitting, setPtSubmitting] = useState(false);
  const [depositSubmitting, setDepositSubmitting] = useState(false);

  const market = markets.find((row) => row.market === selectedId) ?? null;
  const scope = market ?? [];
  const ptApprove = useWriteFlow(user, scope);
  const depositTx = useWriteFlow(user, scope);
  const ptZero = useZeroFirstApprove(ptApprove);

  const reset = useCallback(() => {
    setStage("market");
    setSelectedId(null);
    setAmountRaw("");
    setPtApprovedAmount(0n);
    setLatchedNeedsPt(false);
    setPtSubmitting(false);
    setDepositSubmitting(false);
    ptApprove.reset();
    depositTx.reset();
  }, [depositTx, ptApprove]);

  const walletReset = useWalletChangeReset(user, reset, {
    chainId: connection.chainId,
    queryClient,
  });

  const enabled = Boolean(user && market);
  const reads = useReadContracts({
    allowFailure: true,
    contracts:
      user && market
        ? [
            { address: market.ptToken, abi: erc20Abi, functionName: "balanceOf", args: [user] },
            {
              address: market.ptToken,
              abi: erc20Abi,
              functionName: "allowance",
              args: [user, market.vault],
            },
            {
              address: market.vault,
              abi: ovrfloAbi,
              functionName: "marketDepositLimits",
              args: [market.market],
            },
            {
              address: market.vault,
              abi: ovrfloAbi,
              functionName: "marketTotalDeposited",
              args: [market.market],
            },
            { address: market.vault, abi: ovrfloAbi, functionName: "MIN_PT_AMOUNT" },
          ]
        : [],
    query: { ...readQuery, enabled },
  });

  const amountWei = parseEnteredAmount(amountRaw);
  const previewEnabled = Boolean(market && amountWei !== null && amountWei > 0n);
  const preview = useReadContract({
    address: market?.vault,
    abi: ovrfloAbi,
    functionName: "previewDeposit",
    args: market && amountWei !== null ? [market.market, amountWei] : undefined,
    query: { ...readQuery, enabled: previewEnabled },
  });

  const ptBalance = asBig(reads.data?.[0]);
  const ptAllowance = asBig(reads.data?.[1]) ?? 0n;
  const capLimit = asBig(reads.data?.[2]);
  const capUsed = asBig(reads.data?.[3]);
  const minPt = asBig(reads.data?.[4]) ?? 1_000_000n;
  const capLoaded = capLimit !== null && capUsed !== null;
  const cap = depositCapStatus({
    mode: "deposit",
    amount: amountWei ?? 0n,
    capLoaded,
    capLimit: capLimit ?? 0n,
    capUsed: capUsed ?? 0n,
  });

  const previewTuple = preview.data;
  const toWallet = previewTuple?.[0];
  const toStream = previewTuple?.[1];
  const fee = previewTuple?.[2] ?? 0n;

  const approval = convertApprovalNeeds({
    mode: "deposit",
    amount: amountWei ?? 0n,
    feeAmount: fee,
    ptAllowance,
    ptApprovedAmount,
    underlyingAllowance: 0n,
    underlyingApprovedAmount: 0n,
  });

  useEffect(() => {
    if (ptApprove.isConfirmed && amountWei) {
      setPtApprovedAmount(amountWei);
      setPtSubmitting(false);
    }
  }, [amountWei, ptApprove.isConfirmed]);

  useEffect(() => {
    if (ptApprove.hasFailed) setPtSubmitting(false);
    if (depositTx.hasFailed) setDepositSubmitting(false);
  }, [depositTx.hasFailed, ptApprove.hasFailed]);

  useEffect(() => {
    if (depositTx.isConfirmed) setStage("confirmed");
    else if (depositTx.isConfirming || depositTx.isRefreshing) setStage("pending");
  }, [depositTx.isConfirmed, depositTx.isConfirming, depositTx.isRefreshing]);

  useEffect(() => {
    if (stage === "approve-pt" && !approval.needsPtApproval && ptApprovedAmount > 0n) {
      setStage("sign");
    }
  }, [approval.needsPtApproval, ptApprovedAmount, stage]);

  const openMarkets = markets.filter((row) => now === null || now < row.expiryCached);
  const options: StreamMarketOption[] = openMarkets.map((row) => ({
    id: row.market,
    vault: row.vault,
    underlyingSymbol: symbolFor(row.underlying),
    ovrfloSymbol: symbolFor(row.ovrfloToken),
    expiry: row.expiryCached,
  }));
  const marketStatus =
    marketsStatus === "ready" && options.length === 0 ? "empty" : marketsStatus;

  const underlyingSymbol = market ? symbolFor(market.underlying) : "the market's underlying";
  const ovrfloSymbol = market ? symbolFor(market.ovrfloToken) : "the market's ovrflo token";

  const amountError = useMemo(() => {
    if (!amountRaw.trim()) return undefined;
    if (amountWei === null || amountWei <= 0n) return "ENTER A VALID AMOUNT";
    if (amountWei < minPt) return "BELOW MINIMUM PT";
    if (ptBalance === null && reads.isLoading) return undefined;
    if (ptBalance === null) return "BALANCE UNAVAILABLE";
    if (amountWei > ptBalance) return "INSUFFICIENT BALANCE";
    if (cap.capExceeded) return depositCapCopy({
      capLimit: capLimit ?? 0n,
      capRemaining: cap.capRemaining,
      capExceeded: true,
      capReached: false,
    });
    if (cap.capReached) return depositCapCopy({
      capLimit: capLimit ?? 0n,
      capRemaining: cap.capRemaining,
      capExceeded: false,
      capReached: true,
    });
    return undefined;
  }, [amountRaw, amountWei, cap.capExceeded, cap.capReached, cap.capRemaining, capLimit, minPt, ptBalance, reads.isLoading]);

  const capCopy = capLoaded
    ? depositCapCopy({
        capLimit: capLimit ?? 0n,
        capRemaining: cap.capRemaining,
        capExceeded: cap.capExceeded,
        capReached: cap.capReached,
      })
    : reads.isLoading
      ? "CHECKING CAP…"
      : "CAP UNAVAILABLE";

  function changeAmount(next: string) {
    setAmountRaw(next);
    if (stage !== "amount" && stage !== "market") {
      setStage("amount");
      setPtApprovedAmount(0n);
      ptApprove.reset();
      depositTx.reset();
    }
  }

  function continueFromMarket() {
    if (!selectedId) return;
    setStage("amount");
  }

  function continueFromAmount() {
    if (amountError || amountWei === null) return;
    setLatchedNeedsPt(approval.needsPtApproval);
    setStage("review");
  }

  function continueFromReview() {
    setLatchedNeedsPt(approval.needsPtApproval);
    if (ack.ready && !ack.acknowledged) {
      setStage("ack");
      return;
    }
    advanceAfterAck();
  }

  function advanceAfterAck() {
    if (approval.needsPtApproval) {
      setStage("approve-pt");
      return;
    }
    setStage("sign");
  }

  function onApprovePt() {
    if (!market || amountWei === null || chain.wrongChain || !signingAllowed) return;
    setPtSubmitting(true);
    ptZero.submit(market.ptToken, market.vault, amountWei, ptAllowance);
  }

  function onDeposit() {
    if (!market || amountWei === null || toWallet === undefined || chain.wrongChain || !signingAllowed) return;
    setDepositSubmitting(true);
    depositTx.writeContract({
      address: market.vault,
      abi: ovrfloAbi,
      functionName: "deposit",
      args: [market.market, amountWei, applySlippageDown(toWallet)],
    } as never);
  }

  const traceStage: StreamStage =
    stage === "approve-pt" || stage === "ack" || stage === "market" || stage === "amount"
      ? stage
      : stage === "sign" || stage === "pending"
        ? stage === "pending"
          ? "pending"
          : "deposit"
        : stage === "confirmed"
          ? "confirmed"
          : "review";

  const baseSteps = streamTrace({
    needsPt: latchedNeedsPt || approval.needsPtApproval,
    needsFee: false,
    ackRequired: false,
    stage: traceStage,
  });
  const ackTrace = useAcknowledgeRiskTrace(baseSteps);
  const steps = ackTrace.steps;

  const permissionCurrent =
    stage === "approve-pt"
      ? [
          { key: "TOKEN", value: "PT" },
          { key: "SPENDER", value: market ? spend(market.vault) : "vault" },
          { key: "ALLOWANCE", value: formatTokenAmount(amountWei ?? undefined, "PT") },
          { key: "MATCH", value: "EXACT" },
        ]
      : [];

  const actionLines = [
    { key: "ACTION", value: "DEPOSIT" },
    { key: "PT IN", value: formatTokenAmount(amountWei ?? undefined, "PT") },
    { key: "MINTED", value: formatTokenAmount(toWallet, ovrfloSymbol) },
    { key: "STREAM", value: formatTokenAmount(toStream, ovrfloSymbol) },
    { key: "FEE", value: formatTokenAmount(fee, underlyingSymbol) },
  ];

  const activeTx = stage === "approve-pt" ? ptApprove : depositTx;
  const tx = txStatusCopy(activeTx);
  const streamId = streamIdFromLogs(depositTx.receipt?.logs);
  const skipPermission =
    (stage === "approve-pt" && !(latchedNeedsPt || approval.needsPtApproval)) ||
    (stage !== "approve-pt" && !latchedNeedsPt && !approval.needsPtApproval);

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
    <StreamCreate
      stage={stage}
      marketStatus={marketStatus}
      markets={options}
      selectedMarket={selectedId}
      onSelectMarket={setSelectedId}
      underlyingSymbol={underlyingSymbol}
      ovrfloSymbol={ovrfloSymbol}
      amountRaw={amountRaw}
      onAmount={changeAmount}
      amountError={amountError ?? undefined}
      ptBalanceLabel={
        ptBalance === null ? (reads.isLoading ? "CHECKING…" : "UNAVAILABLE") : formatTokenAmount(ptBalance, "PT")
      }
      maxDisabled={ptBalance === null}
      onMax={() => {
        if (ptBalance !== null) setAmountRaw(exactAmountString(ptBalance));
      }}
      onContinue={
        stage === "market" ? continueFromMarket : stage === "amount" ? continueFromAmount : continueFromReview
      }
      continueDisabled={
        stage === "market"
          ? !selectedId
          : Boolean(
              amountError ||
                amountWei === null ||
                amountWei <= 0n ||
                !user ||
                (previewEnabled && preview.isLoading) ||
                (previewEnabled && preview.isError) ||
                cap.capExceeded ||
                cap.capReached,
            )
      }
      continueReason={
        stage === "market"
          ? "SELECT A MARKET"
          : !user
            ? "CONNECT WALLET"
            : amountError
              ? amountError
              : previewEnabled && preview.isError
                ? "PREVIEW UNAVAILABLE"
                : previewEnabled && preview.isLoading
                  ? "CHECKING PREVIEW…"
                  : "ENTER AN AMOUNT"
      }
      steps={steps}
      ptIn={amountWei ?? undefined}
      minted={toWallet}
      streamAmount={toStream}
      currentFee={fee}
      boundedApproval={undefined}
      maturity={market?.expiryCached}
      capCopy={capCopy}
      permissionLines={permissionCurrent}
      permissionState={skipPermission ? "skipped" : stage === "approve-pt" ? "current" : "ghosted"}
      actionLines={actionLines}
      actionState={
        stage === "confirmed" ? "confirmed" : stage === "pending" ? "chain-pending" : stage === "sign" ? "current" : "ghosted"
      }
      onAcknowledge={() => {
        ack.acknowledge();
        advanceAfterAck();
      }}
      onApprovePt={onApprovePt}
      approvePtBusy={ptSubmitting || ptApprove.isInFlight}
      approvePtDisabled={chain.wrongChain || !signingAllowed || ptApprove.isInFlight}
      approvePtReason={
        chain.wrongChain ? "SWITCH NETWORK" : !signingAllowed ? "EVENTS STALE — SIGNING DISABLED" : "APPROVAL IN FLIGHT"
      }
      onDeposit={onDeposit}
      depositBusy={depositSubmitting || depositTx.isInFlight}
      depositDisabled={
        chain.wrongChain ||
        !signingAllowed ||
        depositTx.isInFlight ||
        depositTx.isConfirmed ||
        toWallet === undefined
      }
      depositReason={
        chain.wrongChain
          ? "SWITCH NETWORK"
          : !signingAllowed
            ? "EVENTS STALE — SIGNING DISABLED"
            : toWallet === undefined
              ? "PREVIEW UNAVAILABLE"
              : depositTx.isConfirmed
                ? "CONFIRMED"
                : "SIGNING…"
      }
      txCopy={tx?.copy}
      txState={tx?.state}
      onRetryRefresh={depositTx.retryRefresh}
      refreshFailed={depositTx.refreshFailed}
      needsReview={depositTx.needsReview}
      onReReview={() => setStage("review")}
      streamId={streamId}
      borrowHref={streamId !== null ? `/borrow/?stream=${streamId.toString()}` : "/borrow/"}
      viewStreamHref={
        streamId !== null ? `/?stream=${streamId.toString()}` : "/"
      }
    />
  );
}

function asBig(row: { status: "success" | "failure"; result?: unknown } | undefined): bigint | null {
  if (!row || row.status !== "success" || typeof row.result !== "bigint") return null;
  return row.result;
}

function spend(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
