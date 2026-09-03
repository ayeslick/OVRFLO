"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, usePublicClient, useReadContracts } from "wagmi";
import { isAddressEqual, parseEventLogs, type Address, type Log } from "viem";
import { WalletButton } from "wallet-runtime";
import { CreateStageFrame } from "@/components/create/CreateStageFrame";
import { compileCreateIntent } from "@/lib/create-intent";
import {
  autoFillChoices,
  previousVisibleStage,
  stageVisibility,
  type CreateChoices,
  type CreateStage,
} from "@/lib/create-stages";
import { buildFixedCreateContext, marketByTerm } from "@/lib/create-flow-context";
import { getDisclosure, subscribeDisclosure } from "@/lib/disclosure";
import { ActionButton } from "@/components/kit/ActionButton";
import { Amount } from "@/components/kit/Amount";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { TokenUsdSwitch } from "@/components/kit/TokenUsdSwitch";
import { ModalErrorBoundary } from "@/components/ModalErrorBoundary";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { useAcknowledgeRiskTrace } from "@/components/first-run/useAcknowledgeRiskTrace";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { useCreateGraphQueue } from "@/hooks/useCreateGraphQueue";
import { useProtocolBootstrap } from "@/hooks/useProtocolBootstrap";
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
import {
  compileActionGraph,
  GRAPH_STEP_CLEAR_TO_ZERO,
  GRAPH_STEP_SET_ALLOWANCE,
  GRAPH_STEP_SUPPLY,
  sameStepEconomics,
  withGraphId,
  type ActionGraph,
} from "@/lib/action-graph";
import { chainId, factoryAddress } from "@/lib/config";
import { confirmedStepIds } from "@/lib/composite-recovery";
import { allocateGraphId } from "@/lib/graph-id";
import { buildAuthStepPlan, rebuildProtocolGraphStep, reuseOrAllocateGraphId } from "@/lib/graph-step-plan";
import { defaultRecoveryCopy, type RecoveryCopy } from "@/lib/recovery-copy";
import { listStepEvidence, readCurrentAttempt, writeCurrentAttempt } from "@/lib/step-evidence";
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
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [graph, setGraph] = useState<ActionGraph | null>(null);
  const [recoveryCopy, setRecoveryCopy] = useState<RecoveryCopy | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [bodyKey, setBodyKey] = useState(0);
  const bootstrap = useProtocolBootstrap();
  const publicClient = usePublicClient({ chainId });
  const identity =
    account && connection.chainId !== undefined
      ? { account, chainId: connection.chainId }
      : null;
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
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);
  const ladderModel = ladderOutcome.status === "ready" ? ladderOutcome.data.model : null;
  const pickableKey = ladderModel?.pickable.map((rung) => rung.aprBps).join(",") ?? "";
  const createContext = useMemo(
    () =>
      buildFixedCreateContext({
        markets: marketsResult.markets,
        selectedUnderlying: market?.underlying.toLowerCase() ?? null,
        pickableAprs: pickableKey === "" ? [] : pickableKey.split(",").map(Number),
        now,
      }),
    [market?.underlying, marketsResult.markets, now, pickableKey],
  );
  const createChoices: CreateChoices = {
    sourceId: "wallet",
    underlyingId: market?.underlying.toLowerCase() ?? null,
    amount: amountRaw || null,
    termId: market?.market.toLowerCase() ?? null,
    outcomeId: selectedAprBps === null ? null : String(selectedAprBps),
  };
  const filledChoices = autoFillChoices(createContext, createChoices);
  const visibility = stageVisibility(createContext, filledChoices);
  const { decision, go: goDecision } = useFlowDecisionHistory({
    hasFrozenSnapshot: frozen !== null,
    context: createContext,
    choices: filledChoices,
  });
  const stage: CreateStage = decision;
  const setStage = useCallback(
    (next: CreateStage, mode: "push" | "replace" = "push") => {
      goDecision(next, mode);
    },
    [goDecision],
  );

  const resetForm = useCallback(() => {
    goDecision("source", "replace");
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
    const auto = marketByTerm(marketsResult.markets, filledChoices.termId);
    if (auto && selectedMarket === null) setSelectedMarket(auto.market);
  }, [filledChoices.termId, marketsResult.markets, selectedMarket]);

  useEffect(() => {
    if (selectedAprBps !== null || !ladderModel) return;
    if (ladderModel.pickable.length !== 1) return;
    setSelectedAprBps(ladderModel.pickable[0]!.aprBps);
  }, [ladderModel, selectedAprBps]);

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
    const storedAttempt = readCurrentAttempt(factoryAddress, chainId, account, "supply");
    if (storedAttempt?.accepted) {
      setAttemptId(storedAttempt.graphId);
      if (storedAttempt.graph) setGraph(storedAttempt.graph);
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
  const graphQueue = useCreateGraphQueue({
    identity,
    factory: factoryAddress,
    graph,
    confirm: actionTx.confirmPlan,
    retryRefresh: actionTx.retryRefresh,
    client: publicClient,
    rebuild: async (tx, nextIdentity) => {
      if (tx.kind !== "graph-step") throw new Error("Supply queue accepts graph steps only");
      if (!lending || !market || !frozen) throw new Error("Supply rebuild inputs are missing");
      if (tx.semanticId === GRAPH_STEP_CLEAR_TO_ZERO || tx.semanticId === GRAPH_STEP_SET_ALLOWANCE) {
        return {
          status: "ready",
          plan: buildAuthStepPlan({
            identity: nextIdentity,
            semanticId: tx.semanticId,
            actionType: "supply",
            token: market.ovrfloToken,
            spender: lending,
            amount: tx.semanticId === GRAPH_STEP_CLEAR_TO_ZERO ? 0n : frozen.amount,
            contract: "erc20",
          }),
        };
      }
      if (tx.semanticId !== GRAPH_STEP_SUPPLY) throw new Error("Unsupported supply graph step");
      if (!publicClient || bootstrap.status !== "ready") {
        throw new Error("Supply rebuild cannot run without a ready protocol client");
      }
      return rebuildProtocolGraphStep({
        raw: {
          address: lending,
          functionName: "supply",
          args: [market.market, frozen.aprBps, frozen.amount],
        },
        identity: nextIdentity,
        scope: { ...market, sablier: bootstrap.stream },
        client: publicClient,
        bootstrap,
      });
    },
  });
  const checkpoint = deriveCheckpoint({
    stage,
    ackReady: ack.ready,
    acknowledged: ack.acknowledged,
    tokenApproved,
    isSigning: actionTx.isSigning || graphQueue.running,
    isConfirming: actionTx.isConfirming,
    isConfirmed: actionTx.isConfirmed,
    unknown: graphQueue.unknown,
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

  useEffect(() => {
    if (!graph || !account) {
      setRecoveryCopy(null);
      return;
    }
    const stored = listStepEvidence(factoryAddress, chainId, account);
    const confirmed = confirmedStepIds(graph, stored);
    const remaining = graph.steps
      .map((step) => step.stepId)
      .filter((stepId) => !confirmed.includes(stepId));
    setRecoveryCopy(defaultRecoveryCopy({ confirmed, remaining }));
  }, [account, graph, graphQueue.rows]);

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
    if (!market || stage === "underlying" || stage === "term" || stage === "source") return;
    if (now >= market.expiryCached) {
      setUnavailable({ name: underlyingSymbol, reason: "matured-or-inactive" });
      setStage("term");
      setFrozen(null);
      setSelectedAprBps(null);
    }
  }, [market, now, stage, underlyingSymbol]);

  useEffect(() => {
    if (stage === "source" || stage === "underlying" || stage === "term") return;
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
      setStage("outcome");
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

  useEffect(() => {
    if (stage !== "review" || frozen !== null) return;
    if (!liveSnapshot || amountError || !canContinue) return;
    setFrozen(snapshotSupply(liveSnapshot));
  }, [amountError, canContinue, frozen, liveSnapshot, stage]);

  let signingBlocked: string | undefined;
  if (!signingAllowed) signingBlocked = "EVENTS STALE — SIGNING DISABLED";
  if (chainGuard.wrongChain) signingBlocked = "SWITCH NETWORK";
  if (stale.staleRecovery) signingBlocked = "ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN";
  if (graphQueue.unknown) signingBlocked = "A TRANSACTION MAY ALREADY BE IN PROGRESS";

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
    setStage("term");
    setFrozen(null);
    setApprovedAmount(0n);
  }

  function onMax() {
    if (displayBalance !== null && displayBalance > 0n) setAmountRaw(weiToAmountInput(displayBalance));
  }

  function onReview() {
    if (!liveSnapshot || amountError || !canContinue || !market || !lending) return;
    setFrozen(snapshotSupply(liveSnapshot));
    const storedAttempt = account ? readCurrentAttempt(factoryAddress, chainId, account, "supply") : null;
    const storedRows = account ? listStepEvidence(factoryAddress, chainId, account) : [];
    const storedComplete = storedRows.some(
      (row) => row.graphId === storedAttempt?.graphId && row.graphComplete,
    );
    const intent = compileCreateIntent({
      positionType: "fixed",
      disclosure,
      context: createContext,
      choices: filledChoices,
      amount: amountRaw,
      aprBps: selectedAprBps ?? undefined,
    });
    if (intent.type !== "supply") return;
    const compiled = compileActionGraph({
      graphId: storedAttempt?.graphId ?? "pending",
      chainId,
      kind: "supply",
      token: market.ovrfloToken,
      amount: liveSnapshot.amount.toString(),
      allowance: {
        token: market.ovrfloToken,
        spender: lending,
        current: allowance,
        required: liveSnapshot.amount,
      },
      borrowExecutable: false,
      cs3Available: false,
    });
    if (compiled.status !== "ready") return;
    const graphId = reuseOrAllocateGraphId({
      storedGraphId: storedAttempt?.accepted ? storedAttempt.graphId : null,
      storedKind: storedAttempt?.kind,
      requestedKind: "supply",
      storedComplete,
      sameEconomics: sameStepEconomics(storedAttempt?.graph?.steps, compiled.graph.steps),
      allocate: allocateGraphId,
    });
    const nextGraph = withGraphId(compiled.graph, graphId);
    setGraph(nextGraph);
    setAttemptId(graphId);
    if (account) {
      writeCurrentAttempt(factoryAddress, chainId, account, {
        graphId,
        kind: "supply",
        accepted: true,
        graph: nextGraph,
      });
    }
    setStage("review");
  }

  function onRelatch() {
    if (!liveSnapshot) return;
    setFrozen(snapshotSupply(liveSnapshot));
    stale.setStaleRecovery(false);
  }

  function onApprove() {
    if (!lending || !market || !frozen || chainGuard.wrongChain || !signingAllowed) return;
    if (graphQueue.unknown) return;
    if (graph) {
      setApproveSubmitting(true);
      graphQueue.startRemaining();
      return;
    }
    setApproveSubmitting(true);
    zeroFirst.submit(market.ovrfloToken, lending, frozen.amount, allowance);
  }

  function onSupply() {
    if (!lending || !market || !frozen || drifted || chainGuard.wrongChain || !signingAllowed) return;
    if (graphQueue.unknown) return;
    setPreTxBalance(walletBalance);
    if (graph) {
      setActionSubmitting(true);
      graphQueue.startRemaining();
      return;
    }
    setActionSubmitting(true);
    actionTx.writeContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "supply",
      args: [market.market, frozen.aprBps, frozen.amount],
    });
  }

  function goRateSelect() {
    setStage("outcome");
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
      currentNav="create"
      wallet={<WalletButton />}
      status={<StatusLine status={freshness.kind} asOf={asOf} usdUnavailable={usdUnavailable} />}
    >
      <ModalErrorBoundary control="UI-REVIEW-ERROR-BOUNDARY" onReset={() => setBodyKey((key) => key + 1)}>
        <div className="supply-flow" data-split={stage === "review" ? "true" : "false"} data-graph-id={attemptId ?? undefined} key={bodyKey}>
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
          {connected && !walletReset.walletChanged ? (
            <CreateStageFrame
              stage={stage}
              visibility={visibility}
              choices={filledChoices}
              labels={{
                outcomeId: selectedAprBps === null ? undefined : String(selectedAprBps),
              }}
              compact={compact}
              onBack={
                previousVisibleStage(stage, visibility)
                  ? () => {
                      const previous = previousVisibleStage(stage, visibility);
                      if (!previous) return;
                      setFrozen(null);
                      setStage(previous);
                    }
                  : undefined
              }
            >
          {(stage === "source" || stage === "underlying" || stage === "term") ? (
            <>
              <SelectMarket
                state={marketSelectState}
                markets={marketOptions}
                selected={selectedMarket}
                unavailable={unavailable}
                onSelect={onSelectMarket}
                disclosure={disclosure}
              />
              {marketSelectState === "ready" ? (
                selectedMarket ? (
                  <ActionButton variant="primary" onClick={() => setStage("amount")}>
                    CONTINUE
                  </ActionButton>
                ) : (
                  <ActionButton disabled disabledReason={disclosure === "default" ? "SELECT A TERM" : "SELECT A MARKET"}>
                    CONTINUE
                  </ActionButton>
                )
              ) : null}
            </>
          ) : null}
          {connected && !walletReset.walletChanged && (stage === "amount" || stage === "outcome") && market ? (
            <>
              <MarketContext
                underlyingSymbol={underlyingSymbol}
                expiry={market.expiryCached}
                onChange={onChangeMarket}
                disclosure={disclosure}
              />
              {unavailable?.reason === "tick-config-changed" ? (
                <MarketUnavailable
                  name={unavailable.name}
                  reason={unavailable.reason}
                  disclosure={disclosure}
                />
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
              {stage === "amount" ? (
                <ActionButton variant="primary" onClick={() => setStage("outcome")}>
                  CONTINUE
                </ActionButton>
              ) : null}
              {stage === "outcome" && disclosure !== "default" ? (
              <TokenUsdSwitch
                mode={usdMode}
                tokenLabel={supplySymbol}
                usdAvailable={usdAvailable}
                onChange={setUsdMode}
              />
              ) : null}
              {parsedAmount.ok ? (
                <Amount
                  token={weiToAmountInput(parsedAmount.value)}
                  symbol={supplySymbol}
                  usd={usdDisplay}
                  usdAvailable={usdAvailable}
                  mode={usdMode}
                />
              ) : null}
              {stage === "outcome" ? (
              <RateStep
                windowState={windowState}
                window={windowModel}
                selectedAprBps={selectedAprBps}
                underlyingSymbol={supplySymbol}
                allRatesOpen={disclosure === "advanced" && allRatesOpen}
                ladder={disclosure === "advanced" ? ladder : null}
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
              ) : null}
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
                approveBusy={
                  graphQueue.running ||
                  approveSubmitting ||
                  approveTx.isSigning ||
                  approveTx.isConfirming ||
                  approveTx.isInFlight
                }
                approveCooldown={approveCooldown}
                clearing={zeroFirst.clearing}
                supplyBusy={
                  graphQueue.running ||
                  actionSubmitting ||
                  actionTx.isSigning ||
                  actionTx.isInFlight ||
                  actionTx.isConfirming
                }
                recoveryCopy={recoveryCopy}
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
                    setStage("term");
                    setFrozen(null);
                  } else if (decoded?.recovery.id === "change-amount") {
                    goRateSelect();
                  } else {
                    onRelatch();
                  }
                }}
                onViewPosition={(positionId) =>
                  router.push(
                    lending ? `/?lending=${lending}&position=${positionId.toString()}` : "/",
                  )
                }
              />
            </>
          ) : null}
            </CreateStageFrame>
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
  stage: CreateStage;
  ackReady: boolean;
  acknowledged: boolean;
  tokenApproved: boolean;
  isSigning: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  unknown?: boolean;
}): SupplyCheckpoint {
  if (input.stage !== "review") return "review";
  if (input.isConfirmed) return "confirmed";
  if (input.unknown) return "pending";
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

function subscribeCompact(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getCompact() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}
