"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useReadContracts } from "wagmi";
import { isAddressEqual, parseEventLogs, type Address, type Log } from "viem";
import { WalletButton } from "wallet-runtime";
import { ActionButton } from "@/components/kit/ActionButton";
import { Amount } from "@/components/kit/Amount";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { TokenUsdSwitch } from "@/components/kit/TokenUsdSwitch";
import { ModalErrorBoundary } from "@/components/ModalErrorBoundary";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { sourceFromOutcome, useFreshness } from "@/hooks/useFreshness";
import { useFlowDecisionHistory } from "@/hooks/useFlowDecisionHistory";
import { useLadder } from "@/hooks/useLadder";
import { useLending } from "@/hooks/useLending";
import { useMarketSymbols, symbolFor } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useStaleBalanceGuard } from "@/hooks/useStaleBalanceGuard";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import { useUsdPrice } from "@/hooks/useUsdPrice";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { erc20Abi, ovrfloLendingAbi } from "@/lib/abis";
import { chainId, factoryAddress } from "@/lib/config";
import { decodeContractError, isUserRejection } from "@/lib/errors";
import { formatUsd } from "@/lib/format";
import { stepWindow, tickWindow, type LadderModel } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, UNIT, unitsToWei } from "@/lib/lending-math";
import { parseDecimalInput } from "@/lib/parse";
import { classifySurfaceState } from "@/lib/surface-state";
import { readQuery } from "@/lib/query-keys";
import { writeReceipt } from "@/lib/receipts";
import { flowDraftKey, readFlowDraft, writeFlowDraft } from "@/lib/storage";
import { tokenUsd8 } from "@/lib/usd";
import { AmountStep } from "./AmountStep";
import { SupplyFacts } from "./Facts";
import {
  amountFieldError,
  classifySupplyError,
  snapshotSupply,
  supplyDrift,
  supplyTrace,
  tickNoLongerValid,
  weiToAmountInput,
  type SupplyCheckpoint,
  type SupplySnapshot,
} from "./helpers";
import { MarketContext } from "./MarketContext";
import { QueuePlace } from "./QueuePlace";
import { RateStep } from "./RateStep";
import { ReviewHandoff } from "./ReviewHandoff";
import { MarketUnavailable, SelectMarket, type SupplyMarketOption } from "./SelectMarket";
import "./supply.css";

type Stage = "select-market" | "amount-rate" | "review";

const APPROVE_COOLDOWN_MS = 4000;

function draftKey(account: string) {
  return flowDraftKey("supply", factoryAddress, chainId, account);
}

export function SupplyFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const connected = connection.status === "connected" && Boolean(account);
  const chainGuard = useChainGuard();
  const ack = useAcknowledgment();
  const now = useNowSeconds(true);
  const marketsResult = useAllMarkets();
  const symbols = useMarketSymbols(marketsResult.markets);
  const usd = useUsdPrice();
  const [usdMode, setUsdMode] = useState<"token" | "usd">("token");
  const [selectedMarket, setSelectedMarket] = useState<Address | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [selectedAprBps, setSelectedAprBps] = useState<number | null>(null);
  const [allRatesOpen, setAllRatesOpen] = useState(false);
  const [frozen, setFrozen] = useState<SupplySnapshot | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [bodyKey, setBodyKey] = useState(0);
  const [approvedAmount, setApprovedAmount] = useState(0n);
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveCooldown, setApproveCooldown] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [preTxBalance, setPreTxBalance] = useState<bigint | null>(null);
  const [unavailable, setUnavailable] = useState<{
    name: string;
    reason: "matured-or-inactive" | "tick-config-changed";
  } | null>(null);

  const market = useMemo(
    () => marketsResult.markets.find((row) => selectedMarket && isAddressEqual(row.market, selectedMarket)) ?? null,
    [marketsResult.markets, selectedMarket],
  );
  const lending = market?.lending ?? null;
  const lendingReads = useLending(lending);
  const ladderOutcome = useLadder(lending, market?.market);
  const { approveTx, actionTx, zeroFirst } = useApprovalWriteFlows(account, market ?? []);
  const { freshness, signingAllowed } = useFreshness([sourceFromOutcome(ladderOutcome)]);
  const stale = useStaleRecovery(actionTx.error, classifySupplyError, queryClient, account);

  const { decision, go: goDecision } = useFlowDecisionHistory({
    hasFrozenSnapshot: frozen !== null,
    hasSelection: selectedMarket !== null,
  });
  const stage: Stage =
    decision === "select" ? "select-market" : decision === "amount-rate" ? "amount-rate" : "review";
  const setStage = useCallback(
    (next: Stage, mode: "push" | "replace" = "push") => {
      goDecision(
        next === "select-market" ? "select" : next === "amount-rate" ? "amount-rate" : "review",
        mode,
      );
    },
    [goDecision],
  );

  const resetForm = useCallback(() => {
    goDecision("select", "replace");
    setSelectedMarket(null);
    setAmountRaw("");
    setSelectedAprBps(null);
    setFrozen(null);
    setAllRatesOpen(false);
    setApprovedAmount(0n);
    setApproveSubmitting(false);
    setApproveCooldown(false);
    setActionSubmitting(false);
    setPreTxBalance(null);
    setUnavailable(null);
    approveTx.reset();
    actionTx.reset();
    stale.setStaleRecovery(false);
  }, [actionTx, approveTx, goDecision, stale]);

  const walletReset = useWalletChangeReset(account, resetForm, {
    chainId: connection.chainId,
    queryClient,
  });
  useClearOnConfirm(actionTx.isConfirmed, () => setAmountRaw(""));

  useEffect(() => {
    if (!account) {
      setDraftReady(true);
      return;
    }
    const stored = readFlowDraft(draftKey(account));
    if (stored) {
      setAmountRaw(stored.amountRaw);
      setSelectedAprBps(stored.selectedAprBps);
      if (stored.selectedMarket) setSelectedMarket(stored.selectedMarket);
    }
    setDraftReady(true);
  }, [account]);

  useEffect(() => {
    if (!account || !draftReady) return;
    writeFlowDraft(draftKey(account), {
      amountRaw,
      selectedAprBps,
      selectedStreamId: null,
      selectedMarket: market?.market ?? selectedMarket,
    });
  }, [account, amountRaw, draftReady, market?.market, selectedAprBps, selectedMarket]);

  const moneyEnabled = Boolean(account && market && lending);
  const moneyReads = useReadContracts({
    allowFailure: true,
    contracts:
      moneyEnabled && account && market && lending
        ? [
            { address: market.ovrfloToken, abi: erc20Abi, functionName: "balanceOf", args: [account] },
            {
              address: market.ovrfloToken,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, lending],
            },
          ]
        : [],
    query: { ...readQuery, enabled: moneyEnabled },
  });

  const depthMarkets = useMemo(
    () => marketsResult.markets.filter((row) => row.lending),
    [marketsResult.markets],
  );
  const depthEnabled = depthMarkets.length > 0;
  const depthReads = useReadContracts({
    allowFailure: true,
    contracts: depthMarkets.map((row) => ({
      address: row.lending as Address,
      abi: ovrfloLendingAbi,
      functionName: "tickDepths" as const,
      args: [row.market] as const,
    })),
    query: { ...readQuery, enabled: depthEnabled },
  });

  const balanceReady = moneyReads.data?.[0]?.status === "success";
  const allowanceReady = moneyReads.data?.[1]?.status === "success";
  const walletBalance = balanceReady ? ((moneyReads.data?.[0]?.result as bigint | undefined) ?? 0n) : null;
  const allowance = allowanceReady ? ((moneyReads.data?.[1]?.result as bigint | undefined) ?? 0n) : 0n;
  const balanceLoading = moneyEnabled && !balanceReady && (moneyReads.isLoading || !moneyReads.data);

  const ladder: LadderModel | null = ladderOutcome.status === "ready" ? ladderOutcome.data.model : null;
  const lendingConfig = ladderOutcome.status === "ready" ? ladderOutcome.data.config : null;
  const tickSpacing = ladderOutcome.status === "ready" ? ladderOutcome.data.tickSpacing : 0;
  const unit =
    lendingConfig?.unit ??
    (lendingReads.outcome.status === "ready" ? lendingReads.outcome.data.unit : UNIT);
  const minLiquidity =
    lendingConfig?.minLiquidityAmount ??
    (lendingReads.outcome.status === "ready" ? lendingReads.outcome.data.minLiquidityAmount : MIN_LIQUIDITY_AMOUNT);
  const bounds = {
    aprMin: lendingConfig?.aprMinBps ?? 0,
    aprMax: lendingConfig?.aprMaxBps ?? 0,
  };
  const windowModel = ladder
    ? tickWindow(ladder, selectedAprBps, bounds)
    : tickWindow({ rungs: [], pickable: [], emptyLadder: true, bestDepth: null }, null, bounds);

  useEffect(() => {
    if (selectedAprBps !== null || !ladder || ladder.rungs.length === 0) return;
    const first = ladder.rungs[0];
    if (first) setSelectedAprBps(first.aprBps);
  }, [ladder, selectedAprBps]);

  const underlyingSymbol = market ? symbolFor(symbols, market.underlying) : "underlying";
  const supplySymbol = market ? symbolFor(symbols, market.ovrfloToken) : "ovrfloToken";
  const parsedAmount = parseDecimalInput(amountRaw);
  const amountWei = parsedAmount.ok ? parsedAmount.value : 0n;
  const amountError = amountFieldError(
    amountRaw,
    parsedAmount,
    walletBalance,
    minLiquidity,
    unit,
    supplySymbol,
  );
  const selectedRung = ladder?.rungs.find((rung) => rung.aprBps === selectedAprBps);
  const ahead = selectedRung?.availableWei ?? 0n;
  const windowState =
    !market || ladderOutcome.status === "loading"
      ? "loading"
      : ladderOutcome.status === "unavailable" || (ladder && ladder.emptyLadder)
        ? "unavailable"
        : "ready";

  const liveSnapshot: SupplySnapshot | null =
    selectedAprBps !== null
      ? {
          amount: amountWei,
          aprBps: selectedAprBps,
          ahead,
          aprMinBps: bounds.aprMin,
          aprMaxBps: bounds.aprMax,
          spacing: tickSpacing,
        }
      : null;
  const drifted = Boolean(frozen && liveSnapshot && supplyDrift(frozen, liveSnapshot));
  const receipt = parseSupplied(actionTx.receipt?.logs, lending);
  const tokenApproved =
    parsedAmount.ok &&
    amountWei > 0n &&
    (allowance >= amountWei || approvedAmount >= amountWei);
  const checkpoint = deriveCheckpoint({
    stage,
    ackReady: ack.ready,
    acknowledged: ack.acknowledged,
    tokenApproved,
    isSigning: actionTx.isSigning,
    isConfirming: actionTx.isConfirming,
    isConfirmed: actionTx.isConfirmed,
  });

  const decoded = actionTx.error
    ? decodeContractError(actionTx.error)
    : approveTx.error && !isUserRejection(approveTx.error)
      ? decodeContractError(approveTx.error)
      : null;

  const ackTrace = useAcknowledgeRiskTrace(
    supplyTrace({
      underlyingSymbol: supplySymbol,
      needsApprove: !tokenApproved,
      ackRequired: false,
      checkpoint,
    }),
  );

  const liveBalances =
    walletBalance !== null && market
      ? { [market.ovrfloToken.toLowerCase()]: walletBalance }
      : null;
  const preTxBalances =
    preTxBalance !== null && market
      ? { [market.ovrfloToken.toLowerCase()]: preTxBalance.toString() }
      : null;
  const lastKnownPostTx =
    preTxBalance !== null && frozen && market
      ? {
          [market.ovrfloToken.toLowerCase()]:
            preTxBalance > frozen.amount ? preTxBalance - frozen.amount : 0n,
        }
      : null;
  const guarded = useStaleBalanceGuard({
    hash: actionTx.hash,
    confirmed: actionTx.isConfirmed,
    liveBalances,
    preTxBalances,
    lastKnownPostTx,
  });
  const displayBalance =
    guarded.suppressed && lastKnownPostTx && market
      ? (lastKnownPostTx[market.ovrfloToken.toLowerCase()] ?? walletBalance)
      : walletBalance;

  useEffect(() => {
    if (!actionTx.hash || !market) return;
    if (!actionTx.isConfirming && !actionTx.isConfirmed) return;
    writeReceipt(factoryAddress, {
      hash: actionTx.hash,
      status: actionTx.isConfirmed ? "confirmed" : "pending",
      entityKind: "position",
      entityId: receipt?.positionId?.toString() ?? null,
      preTxBalances: preTxBalances ?? {},
    });
  }, [actionTx.hash, actionTx.isConfirmed, actionTx.isConfirming, market, preTxBalances, receipt?.positionId]);

  useEffect(() => {
    if (!market || stage === "select-market") return;
    if (now >= market.expiryCached) {
      setUnavailable({ name: underlyingSymbol, reason: "matured-or-inactive" });
      setStage("select-market");
      setFrozen(null);
      setSelectedAprBps(null);
    }
  }, [market, now, stage, underlyingSymbol]);

  useEffect(() => {
    if (stage === "select-market") return;
    if (selectedAprBps === null) return;
    if (ladderOutcome.status !== "ready" || tickSpacing <= 0) return;
    if (
      tickNoLongerValid(selectedAprBps, {
        aprMinBps: bounds.aprMin,
        aprMaxBps: bounds.aprMax,
        spacing: tickSpacing,
      })
    ) {
      setUnavailable({ name: underlyingSymbol, reason: "tick-config-changed" });
      setStage("amount-rate");
      setFrozen(null);
    }
  }, [bounds.aprMax, bounds.aprMin, ladderOutcome.status, selectedAprBps, stage, tickSpacing, underlyingSymbol]);

  useEffect(() => {
    if (approveTx.isConfirmed && parsedAmount.ok && amountWei > 0n) {
      setApprovedAmount(amountWei);
      setApproveSubmitting(false);
      setApproveCooldown(true);
      const timer = window.setTimeout(() => setApproveCooldown(false), APPROVE_COOLDOWN_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [amountWei, approveTx.isConfirmed, parsedAmount.ok]);

  useEffect(() => {
    if (approveTx.hasFailed || actionTx.hasFailed) {
      setApproveSubmitting(false);
      setActionSubmitting(false);
    }
  }, [actionTx.hasFailed, approveTx.hasFailed]);

  const usdAvailable = usd.status === "ready" && usd.data.status === "available";
  const usdDisplay =
    usd.status === "ready" && usd.data.status === "available" && parsedAmount.ok
      ? formatUsd(tokenUsd8(parsedAmount.value, usd.data.usd8))
      : undefined;
  const asOf =
    freshness.asOf !== null
      ? new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
          timeZone: "UTC",
        }).format(new Date(Number(freshness.asOf) * 1000))
      : undefined;

  const marketOptions = useMemo<SupplyMarketOption[]>(() => {
    return depthMarkets.flatMap((row, index) => {
      if (now >= row.expiryCached) return [];
      const depthsResult = depthReads.data?.[index];
      const depths =
        depthsResult?.status === "success"
          ? (depthsResult.result as readonly { aprBps: number; availableUnits: bigint }[])
          : null;
      let liveTicks: number | null = depths ? 0 : null;
      let bestDepth: bigint | null = depths ? 0n : null;
      if (depths) {
        for (const depth of depths) {
          const wei = unitsToWei(depth.availableUnits, unit);
          if (wei > 0n) liveTicks = (liveTicks ?? 0) + 1;
          if (bestDepth !== null && wei > bestDepth) bestDepth = wei;
        }
      }
      return [
        {
          market: row.market,
          underlyingSymbol: symbolFor(symbols, row.underlying),
          expiry: row.expiryCached,
          liveTicks,
          bestDepth,
        },
      ];
    });
  }, [depthMarkets, depthReads.data, now, symbols, unit]);

  const marketSelectState = marketSelectStatus(marketsResult.status, marketOptions.length);
  const canContinue =
    parsedAmount.ok &&
    !amountError &&
    selectedAprBps !== null &&
    windowState === "ready" &&
    amountWei >= minLiquidity;

  let signingBlocked: string | undefined;
  if (!signingAllowed) signingBlocked = "EVENTS STALE — SIGNING DISABLED";
  if (chainGuard.wrongChain) signingBlocked = "SWITCH NETWORK";
  if (stale.staleRecovery) signingBlocked = "ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN";

  const usdUnavailable =
    usd.status === "unavailable" || (usd.status === "ready" && usd.data.status === "unavailable");

  function onSelectMarket(id: Address) {
    setSelectedMarket(id);
    setUnavailable(null);
    setFrozen(null);
    setSelectedAprBps(null);
    stale.setStaleRecovery(false);
  }

  function onChangeMarket() {
    setStage("select-market");
    setFrozen(null);
    setApprovedAmount(0n);
  }

  function onMax() {
    if (displayBalance !== null && displayBalance > 0n) setAmountRaw(weiToAmountInput(displayBalance));
  }

  function onReview() {
    if (!liveSnapshot || amountError || !canContinue) return;
    setFrozen(snapshotSupply(liveSnapshot));
    setStage("review");
  }

  function onRelatch() {
    if (!liveSnapshot) return;
    setFrozen(snapshotSupply(liveSnapshot));
    stale.setStaleRecovery(false);
  }

  function onApprove() {
    if (!lending || !market || !frozen || chainGuard.wrongChain || !signingAllowed) return;
    setApproveSubmitting(true);
    zeroFirst.submit(market.ovrfloToken, lending, frozen.amount, allowance);
  }

  function onSupply() {
    if (!lending || !market || !frozen || drifted || chainGuard.wrongChain || !signingAllowed) return;
    setPreTxBalance(walletBalance);
    setActionSubmitting(true);
    actionTx.writeContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "supply",
      args: [market.market, frozen.aprBps, frozen.amount],
    });
  }

  function goRateSelect() {
    setStage("amount-rate");
    setFrozen(null);
    setApprovedAmount(0n);
    stale.setStaleRecovery(false);
  }

  const queueState =
    windowState === "loading"
      ? "loading"
      : windowState === "unavailable"
        ? "unavailable"
        : ahead === 0n
          ? "empty-ahead"
          : "ready";

  const surface = classifySurfaceState({
    dataStatus:
      marketSelectState === "loading"
        ? "loading"
        : marketSelectState === "empty"
          ? "empty"
          : marketSelectState === "unavailable"
            ? "unavailable"
            : "ready",
    hasLastKnown: marketSelectState === "ready" || Boolean(market),
    stale: !signingAllowed || stale.staleRecovery || drifted,
    signingAllowed,
    isSigning: actionTx.isSigning || approveTx.isSigning,
    isConfirming: actionTx.isConfirming,
    isConfirmed: actionTx.isConfirmed,
    error: Boolean(decoded && !isUserRejection(actionTx.error) && !isUserRejection(approveTx.error)),
  });

  return (
    <Shell
      currentNav="supply"
      wallet={<WalletButton />}
      status={<StatusLine status={freshness.kind} asOf={asOf} usdUnavailable={usdUnavailable} />}
      onHome={() => router.push("/")}
    >
      <ModalErrorBoundary control="UI-REVIEW-ERROR-BOUNDARY" onReset={() => setBodyKey((key) => key + 1)}>
        <div className="supply-flow" data-split={stage === "review" ? "true" : "false"} key={bodyKey}>
          <SurfaceState
            state={surface}
            topology="supply"
            onRefresh={
              surface === "STALE"
                ? () => {
                    void queryClient.invalidateQueries();
                    stale.setStaleRecovery(false);
                  }
                : undefined
            }
          />
          {walletReset.walletChanged ? (
            <div className="supply-notice" role="alert">
              <p>WALLET CHANGED — RE-ENTER</p>
              <ActionButton onClick={walletReset.acknowledge}>CONTINUE</ActionButton>
            </div>
          ) : null}
          {!connected ? (
            <div className="supply-handoff">
              <p className="supply-kicker">SUPPLY</p>
              <h2 className="supply-title">Connect a wallet</h2>
              <p className="supply-lede">A connected wallet is required to supply ovrfloToken liquidity.</p>
            </div>
          ) : null}
          {connected && !walletReset.walletChanged && stage === "select-market" ? (
            <>
              <SelectMarket
                state={marketSelectState}
                markets={marketOptions}
                selected={selectedMarket}
                unavailable={unavailable}
                onSelect={onSelectMarket}
              />
              {marketSelectState === "ready" ? (
                selectedMarket ? (
                  <ActionButton variant="primary" onClick={() => setStage("amount-rate")}>
                    CONTINUE
                  </ActionButton>
                ) : (
                  <ActionButton disabled disabledReason="SELECT A MARKET">
                    CONTINUE
                  </ActionButton>
                )
              ) : null}
            </>
          ) : null}
          {connected && !walletReset.walletChanged && stage === "amount-rate" && market ? (
            <>
              <MarketContext
                underlyingSymbol={underlyingSymbol}
                expiry={market.expiryCached}
                onChange={onChangeMarket}
              />
              {unavailable?.reason === "tick-config-changed" ? (
                <MarketUnavailable name={unavailable.name} reason={unavailable.reason} />
              ) : null}
              <AmountStep
                value={amountRaw}
                unit={supplySymbol}
                error={amountError}
                maxDisabled={balanceLoading || walletBalance === null}
                minLiquidity={minLiquidity}
                onChange={(next) => {
                  setAmountRaw(next);
                  setApprovedAmount(0n);
                }}
                onMax={onMax}
              />
              <TokenUsdSwitch
                mode={usdMode}
                tokenLabel={supplySymbol}
                usdAvailable={usdAvailable}
                onChange={setUsdMode}
              />
              {parsedAmount.ok ? (
                <Amount
                  token={weiToAmountInput(parsedAmount.value)}
                  symbol={supplySymbol}
                  usd={usdDisplay}
                  usdAvailable={usdAvailable}
                  mode={usdMode}
                />
              ) : null}
              <RateStep
                windowState={windowState}
                window={windowModel}
                selectedAprBps={selectedAprBps}
                underlyingSymbol={supplySymbol}
                allRatesOpen={allRatesOpen}
                ladder={ladder}
                onSelect={(apr) => {
                  setSelectedAprBps(apr);
                  if (unavailable?.reason === "tick-config-changed") setUnavailable(null);
                }}
                onStep={(direction) => {
                  if (!ladder || selectedAprBps === null) return;
                  const next = stepWindow(ladder, selectedAprBps, direction, bounds);
                  if (next.selected !== null) setSelectedAprBps(next.selected);
                }}
                onOpenAllRates={() => setAllRatesOpen(true)}
                onCloseAllRates={() => setAllRatesOpen(false)}
              />
              {parsedAmount.ok && selectedAprBps !== null ? (
                <QueuePlace ahead={ahead} amount={amountWei} unit={supplySymbol} state={queueState} />
              ) : null}
              {parsedAmount.ok && selectedAprBps !== null && !amountError ? (
                <SupplyFacts
                  amount={amountWei}
                  aprBps={selectedAprBps}
                  expiry={market.expiryCached}
                  ahead={ahead}
                  underlyingSymbol={supplySymbol}
                />
              ) : null}
              {canContinue ? (
                <ActionButton variant="primary" onClick={onReview}>
                  REVIEW SUPPLY
                </ActionButton>
              ) : (
                <ActionButton disabled disabledReason={continueReason(windowState, amountError)}>
                  REVIEW SUPPLY
                </ActionButton>
              )}
            </>
          ) : null}
          {connected &&
          !walletReset.walletChanged &&
          stage === "review" &&
          market &&
          frozen &&
          liveSnapshot &&
          selectedAprBps !== null &&
          lending ? (
            <>
              {chainGuard.wrongChain ? (
                <ActionButton variant="primary" onClick={chainGuard.switchChain} busy={chainGuard.isSwitching}>
                  SWITCH NETWORK
                </ActionButton>
              ) : null}
              <ReviewHandoff
                frozen={frozen}
                live={liveSnapshot}
                drifted={drifted || actionTx.needsReview || stale.staleRecovery}
                checkpoint={checkpoint}
                steps={ackTrace.steps}
                underlyingSymbol={supplySymbol}
                expiry={market.expiryCached}
                operator={lending}
                tokenApproved={tokenApproved}
                acknowledged={ack.acknowledged}
                signingBlockedReason={signingBlocked}
                approveBusy={approveSubmitting || approveTx.isSigning || approveTx.isConfirming || approveTx.isInFlight}
                approveCooldown={approveCooldown}
                clearing={zeroFirst.clearing}
                supplyBusy={actionSubmitting || actionTx.isSigning || actionTx.isInFlight || actionTx.isConfirming}
                txHash={actionTx.hash ? String(actionTx.hash) : undefined}
                positionId={receipt?.positionId}
                errorCopy={
                  decoded && !isUserRejection(actionTx.error) && !isUserRejection(approveTx.error)
                    ? decoded.copy
                    : isUserRejection(approveTx.error)
                      ? "SIGNATURE REJECTED — SELECTIONS KEPT"
                      : undefined
                }
                recoveryLabel={decoded?.recovery.label}
                onAcknowledge={ack.acknowledge}
                onApprove={onApprove}
                onSupply={onSupply}
                onRelatch={onRelatch}
                onRecovery={() => {
                  if (
                    decoded?.recovery.id === "change-tick" ||
                    decoded?.name === "InvalidTick" ||
                    decoded?.name === "SpacingUnset"
                  ) {
                    goRateSelect();
                  } else if (decoded?.name === "SeriesMatured" || decoded?.name === "MarketExpired") {
                    setUnavailable({ name: underlyingSymbol, reason: "matured-or-inactive" });
                    setStage("select-market");
                    setFrozen(null);
                  } else if (decoded?.recovery.id === "change-amount") {
                    goRateSelect();
                  } else {
                    onRelatch();
                  }
                }}
                onViewPosition={(positionId) =>
                  router.push(`/?lens=supplied&position=${positionId.toString()}`)
                }
              />
            </>
          ) : null}
        </div>
      </ModalErrorBoundary>
    </Shell>
  );
}

function continueReason(windowState: string, amountError?: string): string {
  if (amountError) return amountError;
  if (windowState === "unavailable") return "RATES UNAVAILABLE";
  if (windowState === "loading") return "LOADING RATES";
  return "ENTER AMOUNT AND RATE";
}

function marketSelectStatus(
  marketsStatus: "loading" | "ready" | "unavailable",
  activeCount: number,
): "loading" | "ready" | "empty" | "unavailable" {
  if (marketsStatus === "unavailable") return "unavailable";
  if (marketsStatus === "loading") return "loading";
  if (activeCount === 0) return "empty";
  return "ready";
}

function deriveCheckpoint(input: {
  stage: Stage;
  ackReady: boolean;
  acknowledged: boolean;
  tokenApproved: boolean;
  isSigning: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
}): SupplyCheckpoint {
  if (input.stage !== "review") return "review";
  if (input.isConfirmed) return "confirmed";
  if (input.isConfirming) return "pending";
  if (input.isSigning) return "sign";
  if (!input.ackReady) return "review";
  if (!input.acknowledged) return "acknowledge";
  if (!input.tokenApproved) return "approve";
  return "sign";
}

function parseSupplied(
  logs: readonly Log[] | undefined,
  lending: Address | null,
): { positionId: bigint; amount: bigint; aprBps: number } | null {
  if (!logs || !lending) return null;
  const lendingKey = lending.toLowerCase();
  const [created] = parseEventLogs({
    abi: ovrfloLendingAbi,
    eventName: "Supplied",
    logs: logs.filter((log) => log.address.toLowerCase() === lendingKey),
  });
  if (!created) return null;
  return {
    positionId: created.args.positionId,
    amount: created.args.amount,
    aprBps: created.args.aprBps,
  };
}
