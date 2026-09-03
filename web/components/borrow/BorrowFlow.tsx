"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, usePublicClient, useReadContracts } from "wagmi";
import { CreateStageFrame } from "@/components/create/CreateStageFrame";
import { compileCreateIntent } from "@/lib/create-intent";
import {
  autoFillChoices,
  firstRequiredOrBlockingStage,
  previousVisibleStage,
  stageVisibility,
  type CreateChoices,
  type CreateStage,
} from "@/lib/create-stages";
import { buildLoanCreateContext, parseStreamSourceId, streamSourceId } from "@/lib/create-flow-context";
import { getDisclosure, subscribeDisclosure } from "@/lib/disclosure";
import { formatAprBps, formatUsd } from "@/lib/format";
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
import { useCreateGraphQueue } from "@/hooks/useCreateGraphQueue";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useChainGuard } from "@/hooks/useChainGuard";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { sourceFromOutcome, useFreshness } from "@/hooks/useFreshness";
import { useFlowDecisionHistory } from "@/hooks/useFlowDecisionHistory";
import { useLadder } from "@/hooks/useLadder";
import { useMarketSymbols, symbolFor } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useOvrflos } from "@/hooks/useOvrflos";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import { useCompleteStreams } from "@/hooks/useCompleteStreams";
import { type HydratedStream } from "@/hooks/useStreams";
import { useUsdPrice } from "@/hooks/useUsdPrice";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import {
  compileActionGraph,
  GRAPH_STEP_BORROW,
  GRAPH_STEP_SET_APPROVAL,
  sameStepEconomics,
  withGraphId,
  type ActionGraph,
} from "@/lib/action-graph";
import { classifyBorrowError } from "@/lib/borrow";
import { assertBorrowRebuildInputs } from "@/lib/borrow-rebuild";
import { chainId, factoryAddress, ZERO_ADDRESS } from "@/lib/config";
import { confirmedStepIds } from "@/lib/composite-recovery";
import { allocateGraphId } from "@/lib/graph-id";
import { buildAuthStepPlan, buildCallStepPlan, reuseOrAllocateGraphId } from "@/lib/graph-step-plan";
import { cs3ContinuationAvailable, depositPlusBorrowLiquidityGate } from "@/lib/no-liquidity-gate";
import { defaultRecoveryCopy, type RecoveryCopy } from "@/lib/recovery-copy";
import { listStepEvidence, readCurrentAttempt, writeCurrentAttempt } from "@/lib/step-evidence";
import { useProtocolBootstrap } from "@/hooks/useProtocolBootstrap";
import { decodeContractError, isUserRejection } from "@/lib/errors";
import { stepWindow, tickWindow, type LadderModel } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, MIN_STREAM_AMOUNT } from "@/lib/lending-math";
import { borrowKeys } from "@/lib/query-keys";
import { parseDecimalInput, parseEntityId } from "@/lib/parse";
import { classifySurfaceState } from "@/lib/surface-state";
import { writeReceipt } from "@/lib/receipts";
import { flowDraftKey, readFlowDraft, writeFlowDraft } from "@/lib/storage";
import { tokenUsd8 } from "@/lib/usd";
import { AmountStep, amountErrorCopy } from "./AmountStep";
import { BorrowFacts } from "./Facts";
import { PoolBand } from "./PoolBand";
import { RateStep } from "./RateStep";
import { ReviewHandoff, borrowTrace, type BorrowCheckpoint } from "./ReviewHandoff";
import { NoStream, SelectStream } from "./SelectStream";
import { StreamContext } from "./StreamContext";
import {
  fullRepayCoverPreview,
  liveTickCopy,
  loanCover,
  quoteDrift,
  snapshotQuote,
  tickDepthWei,
  useBorrowPreview,
  weiToAmountInput,
  type BorrowQuote,
  type BorrowQuoteSnapshot,
} from "./quote";
import "./borrow.css";

function draftKey(account: string) {
  return flowDraftKey("borrow", factoryAddress, chainId, account);
}

export function BorrowFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const bootstrap = useProtocolBootstrap();
  const lockup = bootstrap.status === "ready" ? bootstrap.stream : ZERO_ADDRESS;
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const connected = connection.status === "connected" && Boolean(account);
  const chainGuard = useChainGuard();
  const ack = useAcknowledgment();
  const now = useNowSeconds(true);
  const ovrflos = useOvrflos();
  const marketsResult = useAllMarkets();
  const symbols = useMarketSymbols(marketsResult.markets);
  const usd = useUsdPrice();
  const [usdMode, setUsdMode] = useState<"token" | "usd">("token");
  const [selectedStreamId, setSelectedStreamId] = useState<bigint | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [selectedAprBps, setSelectedAprBps] = useState<number | null>(null);
  const [allRatesOpen, setAllRatesOpen] = useState(false);
  const [feeOpen, setFeeOpen] = useState(false);
  const [frozen, setFrozen] = useState<BorrowQuoteSnapshot | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [graph, setGraph] = useState<ActionGraph | null>(null);
  const [recoveryCopy, setRecoveryCopy] = useState<RecoveryCopy | null>(null);
  const [liquidityBlocked, setLiquidityBlocked] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [bodyKey, setBodyKey] = useState(0);
  const publicClient = usePublicClient({ chainId });
  const identity =
    account && connection.chainId !== undefined
      ? { account, chainId: connection.chainId }
      : null;

  const streams = useCompleteStreams({
    account,
    vaults: ovrflos.status === "ready" ? ovrflos.vaults : [],
    markets: marketsResult.markets,
    registryComplete: marketsResult.status === "ready" && ovrflos.status === "ready",
    now,
    stream: ovrflos.status === "ready" ? ovrflos.stream : undefined,
  });

  const eligible = useMemo(() => {
    if (streams.status !== "ready") return [];
    return streams.data.streams.filter((row) => row.borrowRouteEligible);
  }, [streams]);

  const selectedStream = eligible.find((row) => row.streamId === selectedStreamId) ?? null;
  const market = useMemo(
    () =>
      selectedStream?.market
        ? marketsResult.markets.find((row) => isAddressEqual(row.market, selectedStream.market!)) ?? null
        : null,
    [marketsResult.markets, selectedStream],
  );
  const lending = market?.lending ?? null;
  const ladderOutcome = useLadder(lending, market?.market);
  const { approveTx, actionTx } = useApprovalWriteFlows(account, market ?? []);
  // Borrow signing uses the streams lens truth; ladder is a separate gate in continue.
  const { freshness, signingAllowed } = useFreshness([sourceFromOutcome(streams)]);
  const stale = useStaleRecovery(actionTx.error, classifyBorrowError, queryClient, account);
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);

  const ladder: LadderModel | null = ladderOutcome.status === "ready" ? ladderOutcome.data.model : null;
  const pickableKey = ladder?.pickable.map((rung) => rung.aprBps).join(",") ?? "";
  const createContext = useMemo(
    () =>
      buildLoanCreateContext({
        streams: eligible,
        markets: selectedStream
          ? marketsResult.markets.filter((row) => selectedStream.market && isAddressEqual(row.market, selectedStream.market))
          : marketsResult.markets,
        selectedUnderlying: market?.underlying.toLowerCase() ?? null,
        pickableAprs: pickableKey === "" ? [] : pickableKey.split(",").map(Number),
        now,
      }),
    [eligible, market?.underlying, marketsResult.markets, now, pickableKey, selectedStream],
  );
  const createChoices: CreateChoices = {
    sourceId: selectedStreamId === null ? null : streamSourceId(selectedStreamId),
    underlyingId: market?.underlying.toLowerCase() ?? null,
    amount: selectedStream ? "fixed" : amountRaw || null,
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
    setSelectedStreamId(null);
    setAmountRaw("");
    setSelectedAprBps(null);
    setFrozen(null);
    setAllRatesOpen(false);
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
      const streamId = parseEntityId(stored.selectedStreamId);
      if (streamId !== null) setSelectedStreamId(streamId);
    }
    const seeded = parseEntityId(new URLSearchParams(window.location.search).get("stream"));
    if (seeded !== null) setSelectedStreamId(seeded);
    const storedAttempt =
      readCurrentAttempt(factoryAddress, chainId, account, "borrow") ??
      readCurrentAttempt(factoryAddress, chainId, account, "deposit-plus-borrow");
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
      selectedStreamId: selectedStreamId === null ? null : selectedStreamId.toString(),
      selectedMarket: market?.market ?? null,
    });
  }, [account, amountRaw, draftReady, market?.market, selectedAprBps, selectedStreamId]);

  const nftEnabled = Boolean(account && lending && selectedStream && bootstrap.status === "ready");
  const nftReads = useReadContracts({
    allowFailure: true,
    contracts:
      nftEnabled && account && lending && selectedStream
        ? [
            {
              address: lockup,
              abi: sablierLockupAbi,
              functionName: "getApproved",
              args: [selectedStream.streamId],
            },
            {
              address: lockup,
              abi: sablierLockupAbi,
              functionName: "isApprovedForAll",
              args: [account, lending],
            },
            {
              address: lending,
              abi: ovrfloLendingAbi,
              functionName: "router",
            },
          ]
        : [],
    query: { enabled: nftEnabled },
  });
  const approvedOperator =
    nftReads.data?.[0]?.status === "success" ? (nftReads.data[0].result as Address) : ZERO_ADDRESS;
  const approvedForAll = nftReads.data?.[1]?.status === "success" ? Boolean(nftReads.data[1].result) : false;
  const routerAddress =
    nftReads.data?.[2]?.status === "success" ? (nftReads.data[2].result as Address) : null;
  const streamApproved =
    Boolean(lending) &&
    (approvedForAll || isAddressEqual(approvedOperator, lending ?? ZERO_ADDRESS));

  const lendingConfig = ladderOutcome.status === "ready" ? ladderOutcome.data.config : null;
  const bounds = {
    aprMin: lendingConfig?.aprMinBps ?? 0,
    aprMax: lendingConfig?.aprMaxBps ?? 0,
  };
  const windowModel = ladder
    ? tickWindow(ladder, selectedAprBps, bounds)
    : tickWindow({ rungs: [], pickable: [], emptyLadder: true, bestDepth: null }, null, bounds);

  useEffect(() => {
    if (createContext.sources.length === 1 && selectedStreamId === null) {
      const only = parseStreamSourceId(createContext.sources[0]!.id);
      if (only !== null) setSelectedStreamId(only);
    }
  }, [createContext.sources, selectedStreamId]);

  useEffect(() => {
    if (!selectedStream) return;
    if (amountRaw === "") setAmountRaw(weiToAmountInput(selectedStream.remaining));
  }, [amountRaw, selectedStream]);

  useEffect(() => {
    if (selectedAprBps !== null || !ladder) return;
    if (ladder.pickable.length !== 1) return;
    setSelectedAprBps(ladder.pickable[0]!.aprBps);
  }, [ladder, selectedAprBps]);

  const ovrfloSymbol = market ? symbolFor(symbols, market.ovrfloToken) : "the market's ovrflo token";
  const underlyingSymbol = market ? symbolFor(symbols, market.underlying) : "underlying";
  const depth = tickDepthWei(ladder, selectedAprBps, lendingConfig?.minLiquidityAmount);
  const parsedAmount = parseDecimalInput(amountRaw);
  const remaining = selectedStream?.remaining ?? 0n;
  const preview = useBorrowPreview({
    lending,
    market: market?.market ?? null,
    streamId: selectedStreamId,
    aprBps: selectedAprBps,
    amountRaw,
    streamRemaining: remaining,
    depth,
    minLiquidity: lendingConfig?.minLiquidityAmount ?? MIN_LIQUIDITY_AMOUNT,
  });
  const quote = preview.quote;
  const cap = preview.cap;
  const amountError = amountFieldError(
    amountRaw,
    parsedAmount,
    cap,
    lendingConfig?.minLiquidityAmount,
  );
  const windowState =
    !market || ladderOutcome.status === "loading"
      ? "loading"
      : ladderOutcome.status === "unavailable"
        ? "unavailable"
        : ladder && (ladder.emptyLadder || ladder.pickable.length === 0)
          ? "empty"
          : "ready";
  const selectedRung = ladder?.rungs.find((rung) => rung.aprBps === selectedAprBps);
  const emptyTick = Boolean(preview.emptyTick || quote?.emptyTick || selectedRung?.kind === "empty");
  const liveCopy = ladder ? liveTickCopy(ladder) : "NO LIVE TICKS HAVE RESTING LIQUIDITY";
  const emptyTickCopy =
    emptyTick && selectedAprBps !== null && windowState === "ready"
      ? `NO DEPTH AT ${formatAprBps(selectedAprBps)}. ${liveCopy}`
      : undefined;

  const schedule = selectedStream
    ? {
        start: selectedStream.schedule.start,
        end: selectedStream.schedule.end,
        deposited: selectedStream.schedule.deposited,
        withdrawn: selectedStream.schedule.withdrawn,
        refunded: selectedStream.schedule.refunded,
      }
    : null;
  const cover = quote && schedule ? loanCover(schedule, quote.obligation, now) : { status: "uncovered" as const };
  const repayDates =
    quote && schedule ? fullRepayCoverPreview(schedule, quote.obligation, now) : { current: cover, next: cover };

  useEffect(() => {
    if (stage !== "review" || frozen !== null) return;
    if (!quote || emptyTick || amountError || preview.isStale || quote.fill <= 0n) return;
    setFrozen(snapshotQuote(quote));
  }, [amountError, emptyTick, frozen, preview.isStale, quote, stage]);

  const drifted = Boolean(frozen && quote && quoteDrift(frozen, quote));
  const receipt = parseBorrowed(actionTx.receipt?.logs, lending);
  const graphQueue = useCreateGraphQueue({
    identity,
    factory: factoryAddress,
    graph,
    confirm: actionTx.confirmPlan,
    retryRefresh: actionTx.retryRefresh,
    client: publicClient,
    rebuild: async (tx, nextIdentity) => {
      if (tx.kind !== "graph-step") throw new Error("Borrow queue accepts graph steps only");
      if (tx.semanticId === GRAPH_STEP_SET_APPROVAL) {
        if (!lending || !selectedStream) throw new Error("NFT approval rebuild is missing the stream");
        return {
          status: "ready",
          plan: buildAuthStepPlan({
            identity: nextIdentity,
            semanticId: GRAPH_STEP_SET_APPROVAL,
            actionType: "borrow",
            token: lockup,
            spender: lending,
            amount: selectedStream.streamId,
            contract: "sablier",
          }),
        };
      }
      if (tx.semanticId !== GRAPH_STEP_BORROW) throw new Error("Unsupported borrow graph step");
      if (!lending || !market || !selectedStream || !frozen || selectedAprBps === null) {
        throw new Error("Borrow rebuild inputs are missing");
      }
      const rebuildRead = assertBorrowRebuildInputs({
        routedDepth: depth,
        eligibility: selectedStream.borrowRouteEligible ? "eligible" : "ineligible",
        router: routerAddress,
        request: "none",
      });
      if (rebuildRead.status === "invalid") {
        throw new Error(`Borrow rebuild used a placeholder (${rebuildRead.reason})`);
      }
      return {
        status: "ready",
        plan: buildCallStepPlan({
          identity: nextIdentity,
          actionType: "borrow",
          semanticId: GRAPH_STEP_BORROW,
          target: lending,
          contract: "lending",
          functionName: "borrow",
          callArgs: [
            market.market,
            selectedAprBps,
            frozen.actualBorrow,
            selectedStream.streamId,
            frozen.minAcceptable,
            nextIdentity.account,
          ],
        }),
      };
    },
  });
  const checkpoint = deriveCheckpoint({
    stage,
    ackReady: ack.ready,
    acknowledged: ack.acknowledged,
    streamApproved,
    isSigning: actionTx.isSigning || graphQueue.running,
    isConfirming: actionTx.isConfirming,
    isConfirmed: actionTx.isConfirmed,
    unknown: graphQueue.unknown,
  });

  const belowMinContext = {
    remaining,
    minStreamAmount: lendingConfig?.minStreamAmount ?? MIN_STREAM_AMOUNT,
    actualBorrow: quote?.fill,
    minLiquidity: lendingConfig?.minLiquidityAmount ?? MIN_LIQUIDITY_AMOUNT,
  };
  const decoded = actionTx.error
    ? decodeContractError(actionTx.error, belowMinContext)
    : approveTx.error && !isUserRejection(approveTx.error)
      ? decodeContractError(approveTx.error, belowMinContext)
      : null;

  const ackTrace = useAcknowledgeRiskTrace(borrowTrace(checkpoint, streamApproved, true));

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
    if (confirmed.length === 0 && remaining.length === 0) {
      setRecoveryCopy(null);
      return;
    }
    setRecoveryCopy(defaultRecoveryCopy({ confirmed, remaining }));
  }, [account, graph, graphQueue.rows]);

  useEffect(() => {
    if (actionTx.isConfirmed) {
      void queryClient.invalidateQueries({ queryKey: borrowKeys.all });
    }
  }, [actionTx.isConfirmed, queryClient]);

  useEffect(() => {
    if (!actionTx.hash) return;
    if (!actionTx.isConfirming && !actionTx.isConfirmed) return;
    writeReceipt(factoryAddress, {
      hash: actionTx.hash,
      status: actionTx.isConfirmed ? "confirmed" : "pending",
      entityKind: "loan",
      entityId: receipt?.loanId?.toString() ?? null,
      preTxBalances: {},
    });
  }, [actionTx.hash, actionTx.isConfirmed, actionTx.isConfirming, receipt?.loanId]);

  function onSelectStream(id: bigint) {
    setSelectedStreamId(id);
    setFrozen(null);
    stale.setStaleRecovery(false);
  }

  function onChangeStream() {
    setStage("source");
    setFrozen(null);
  }

  function onMax() {
    if (cap !== undefined && cap > 0n) setAmountRaw(weiToAmountInput(cap));
  }

  function goNextStage() {
    const next = firstRequiredOrBlockingStage(createContext, filledChoices);
    if (next === "review") {
      onReview();
      return;
    }
    setStage(next);
  }

  function onReview() {
    if (!quote || emptyTick || amountError || preview.isStale || quote.fill <= 0n) return;
    setFrozen(snapshotQuote(quote));
    const intent = compileCreateIntent({
      positionType: "loan",
      disclosure,
      context: createContext,
      choices: filledChoices,
      streamId: selectedStreamId ?? 0n,
      amount: amountRaw,
      aprBps: selectedAprBps ?? undefined,
    });
    const kind = intent.type === "deposit" ? "deposit-plus-borrow" : "borrow";
    const storedAttempt = account
      ? readCurrentAttempt(factoryAddress, chainId, account, kind)
      : null;
    const storedRows = account ? listStepEvidence(factoryAddress, chainId, account) : [];
    const storedComplete = storedRows.some(
      (row) => row.graphId === storedAttempt?.graphId && row.graphComplete,
    );
    if (kind === "deposit-plus-borrow") {
      const gate = depositPlusBorrowLiquidityGate({
        borrowExecutable: depth >= quote.fill,
        cs3Available: cs3ContinuationAvailable(),
      });
      if (gate.status === "blocked") {
        setLiquidityBlocked(true);
        return;
      }
    }
    setLiquidityBlocked(false);
    const compiled = compileActionGraph({
      graphId: storedAttempt?.graphId ?? "pending",
      chainId,
      kind,
      token: market?.underlying ?? selectedStream?.asset ?? ZERO_ADDRESS,
      amount: quote.fill.toString(),
      allowance: null,
      nftApproval:
        selectedStream && lending
          ? {
              token: lockup,
              spender: lending,
              tokenId: selectedStream.streamId.toString(),
              needed: !streamApproved,
            }
          : undefined,
      borrowExecutable: depth >= quote.fill,
      cs3Available: cs3ContinuationAvailable(),
    });
    if (compiled.status === "blocked") {
      setLiquidityBlocked(true);
      return;
    }
    const graphId = reuseOrAllocateGraphId({
      storedGraphId: storedAttempt?.accepted ? storedAttempt.graphId : null,
      storedKind: storedAttempt?.kind,
      requestedKind: kind,
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
        kind,
        accepted: true,
        graph: nextGraph,
      });
    }
    setStage("review");
  }

  function onRelatch() {
    if (!quote || preview.isStale) return;
    setFrozen(snapshotQuote(quote));
    stale.setStaleRecovery(false);
  }

  function onApprove() {
    if (!lending || !selectedStream || chainGuard.wrongChain || !signingAllowed) return;
    if (graphQueue.unknown) return;
    if (graph) {
      graphQueue.startRemaining();
      return;
    }
    approveTx.writeContract({
      address: lockup,
      abi: sablierLockupAbi,
      functionName: "approve",
      args: [lending, selectedStream.streamId],
    });
  }

  function onBorrow() {
    if (!lending || !market || !selectedStream || !quote || !frozen || drifted || preview.isStale || chainGuard.wrongChain || !signingAllowed) return;
    if (graphQueue.unknown) return;
    if (graph) {
      graphQueue.startRemaining();
      return;
    }
    actionTx.writeContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "borrow",
      args: [market.market, selectedAprBps as number, frozen.actualBorrow, selectedStream.streamId, frozen.minAcceptable, account],
    });
  }

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

  const streamSelectState = streamSelectStatus(marketsResult.status, ovrflos.isLoading, streams);
  const canContinue =
    Boolean(quote) &&
    !amountError &&
    !emptyTick &&
    !preview.isStale &&
    windowState === "ready" &&
    quote !== null &&
    quote.fill >= (lendingConfig?.minLiquidityAmount ?? MIN_LIQUIDITY_AMOUNT);

  let signingBlocked: string | undefined;
  if (preview.isStale || stale.staleRecovery) signingBlocked = "QUOTE UPDATED — REVIEW AGAIN";
  if (!signingAllowed) signingBlocked = "EVENTS STALE — SIGNING DISABLED";
  if (chainGuard.wrongChain) signingBlocked = "SWITCH NETWORK";
  if (graphQueue.unknown) signingBlocked = "A TRANSACTION MAY ALREADY BE IN PROGRESS";
  if (liquidityBlocked) signingBlocked = "NO DEPTH FOR THIS LOAN";

  const usdUnavailable =
    usd.status === "unavailable" || (usd.status === "ready" && usd.data.status === "unavailable");

  const surface = classifySurfaceState({
    dataStatus:
      streamSelectState === "loading"
        ? "loading"
        : streamSelectState === "empty"
          ? "empty"
          : streamSelectState === "unavailable"
            ? "unavailable"
            : "ready",
    hasLastKnown: streamSelectState === "ready" || Boolean(selectedStream),
    stale: !signingAllowed || stale.staleRecovery || drifted || preview.isStale,
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
        <div className="borrow-flow" data-split={stage === "review" ? "true" : "false"} data-graph-id={attemptId ?? undefined} key={bodyKey}>
          <SurfaceState
            state={surface}
            topology="borrow"
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
            <div className="borrow-notice" role="alert">
              <p>WALLET CHANGED — RE-ENTER</p>
              <ActionButton onClick={walletReset.acknowledge}>CONTINUE</ActionButton>
            </div>
          ) : null}
          {!connected ? (
            <div className="borrow-handoff">
              <p className="borrow-kicker">BORROW</p>
              <h2 className="borrow-title">Connect a wallet</h2>
              <p className="borrow-lede">A connected wallet is required to list eligible streams.</p>
            </div>
          ) : null}
          {connected && !walletReset.walletChanged ? (
            <CreateStageFrame
              stage={stage}
              visibility={visibility}
              choices={filledChoices}
              labels={{
                sourceId: selectedStream ? `Stream ${selectedStream.streamId.toString()}` : undefined,
                outcomeId: selectedAprBps === null ? undefined : formatAprBps(selectedAprBps),
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
              {stage === "source" ? (
                <>
                  {streamSelectState === "empty" || createContext.sources.length === 0 ? (
                    <NoStream />
                  ) : (
                    <SelectStream
                      state={streamSelectState}
                      streams={eligible}
                      selectedId={selectedStreamId}
                      ovrfloSymbol={ovrfloSymbol}
                      onSelect={onSelectStream}
                    />
                  )}
                  {streamSelectState === "ready" && createContext.sources.length > 0 ? (
                    selectedStreamId ? (
                      <ActionButton
                        variant="primary"
                        onClick={goNextStage}
                      >
                        CONTINUE
                      </ActionButton>
                    ) : (
                      <ActionButton disabled disabledReason="SELECT A STREAM">
                        CONTINUE
                      </ActionButton>
                    )
                  ) : null}
                </>
              ) : null}
              {stage === "amount" && selectedStream ? (
                <>
                  <AmountStep
                    value={amountRaw}
                    unit={underlyingSymbol}
                    error={amountError}
                    onChange={setAmountRaw}
                    onMax={onMax}
                  />
                  <ActionButton
                    variant="primary"
                    onClick={goNextStage}
                  >
                    CONTINUE
                  </ActionButton>
                </>
              ) : null}
              {stage === "outcome" && selectedStream ? (
                <AmountRateBody
                  stream={selectedStream}
                  ovrfloSymbol={ovrfloSymbol}
                  underlyingSymbol={underlyingSymbol}
                  amountRaw={amountRaw}
                  amountError={amountError}
                  usdMode={usdMode}
                  usdAvailable={usdAvailable}
                  usdDisplay={usdDisplay}
                  windowState={windowState}
                  window={windowModel}
                  selectedAprBps={selectedAprBps}
                  allRatesOpen={disclosure === "advanced" && allRatesOpen}
                  ladder={disclosure === "advanced" ? ladder : null}
                  emptyTickCopy={emptyTickCopy}
                  quote={quote}
                  quoteStale={preview.isStale}
                  quoteDashes={preview.showDashes}
                  cover={cover}
                  feeOpen={feeOpen}
                  draw={parsedAmount.ok ? parsedAmount.value : 0n}
                  depth={depth}
                  canContinue={canContinue}
                  onChangeStream={onChangeStream}
                  onAmount={setAmountRaw}
                  onMax={onMax}
                  onUsdMode={setUsdMode}
                  onSelectTick={setSelectedAprBps}
                  onStep={(direction) => {
                    if (!ladder || selectedAprBps === null) return;
                    const next = stepWindow(ladder, selectedAprBps, direction, bounds);
                    if (next.selected !== null) setSelectedAprBps(next.selected);
                  }}
                  onOpenAllRates={() => {
                    if (disclosure === "advanced") setAllRatesOpen(true);
                  }}
                  onCloseAllRates={() => setAllRatesOpen(false)}
                  onToggleFee={() => setFeeOpen((open) => !open)}
                  onReview={onReview}
                  hideAmount
                  hideUsd={disclosure === "default"}
                />
              ) : null}
              {stage === "review" &&
              selectedStream &&
              quote &&
              frozen &&
              selectedAprBps !== null &&
              market?.lending ? (
                <>
                  {chainGuard.wrongChain ? (
                    <ActionButton variant="primary" onClick={chainGuard.switchChain} busy={chainGuard.isSwitching}>
                      SWITCH NETWORK
                    </ActionButton>
                  ) : null}
                  <ReviewHandoff
                    quote={quote}
                    frozen={frozen}
                    drifted={drifted || actionTx.needsReview}
                    checkpoint={checkpoint}
                    steps={ackTrace.steps}
                    underlyingSymbol={underlyingSymbol}
                    ovrfloSymbol={ovrfloSymbol}
                    aprBps={selectedAprBps}
                    streamId={selectedStream.streamId}
                    operator={market.lending}
                    cover={cover}
                    repayCurrent={repayDates.current}
                    repayNext={repayDates.next}
                    acknowledged={ack.acknowledged}
                    streamApproved={streamApproved}
                    signingBlockedReason={signingBlocked}
                    approveBusy={
                      graphQueue.running ||
                      approveTx.isSigning ||
                      approveTx.isConfirming ||
                      approveTx.isInFlight
                    }
                    borrowBusy={
                      graphQueue.running ||
                      actionTx.isSigning ||
                      actionTx.isConfirming ||
                      actionTx.isInFlight
                    }
                    txHash={actionTx.hash ? String(actionTx.hash) : undefined}
                    recoveryCopy={recoveryCopy}
                    loanId={receipt?.loanId}
                    actualNet={receipt?.net}
                    actualObligation={receipt?.obligation}
                    confirmedCover={receipt && schedule ? loanCover(schedule, receipt.obligation, now) : undefined}
                    errorCopy={
                      decoded && !isUserRejection(actionTx.error) && !isUserRejection(approveTx.error)
                        ? decoded.copy
                        : undefined
                    }
                    recoveryLabel={decoded?.recovery.label}
                    onAcknowledge={ack.acknowledge}
                    onApprove={onApprove}
                    onBorrow={onBorrow}
                    onRelatch={onRelatch}
                    onRecovery={() => {
                      if (decoded?.recovery.id === "change-tick" || decoded?.recovery.id === "change-amount") {
                        setStage("outcome");
                        setFrozen(null);
                      } else if (decoded?.recovery.id === "change-stream") {
                        onChangeStream();
                      } else {
                        onRelatch();
                      }
                    }}
                    onViewLoan={(loanId) =>
                      router.push(
                        lending ? `/?lending=${lending}&loan=${loanId.toString()}` : "/",
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

function AmountRateBody({
  stream,
  ovrfloSymbol,
  underlyingSymbol,
  amountRaw,
  amountError,
  usdMode,
  usdAvailable,
  usdDisplay,
  windowState,
  window,
  selectedAprBps,
  allRatesOpen,
  ladder,
  emptyTickCopy,
  quote,
  quoteStale,
  quoteDashes,
  cover,
  feeOpen,
  draw,
  depth,
  canContinue,
  onChangeStream,
  onAmount,
  onMax,
  onUsdMode,
  onSelectTick,
  onStep,
  onOpenAllRates,
  onCloseAllRates,
  onToggleFee,
  onReview,
  hideAmount = false,
  hideUsd = false,
}: {
  stream: HydratedStream;
  ovrfloSymbol: string;
  underlyingSymbol: string;
  amountRaw: string;
  amountError?: string;
  usdMode: "token" | "usd";
  usdAvailable: boolean;
  usdDisplay?: string;
  windowState: "loading" | "ready" | "empty" | "unavailable";
  window: ReturnType<typeof tickWindow>;
  selectedAprBps: number | null;
  allRatesOpen: boolean;
  ladder: LadderModel | null;
  emptyTickCopy?: string;
  quote: BorrowQuote | null;
  quoteStale: boolean;
  quoteDashes: boolean;
  cover: ReturnType<typeof loanCover>;
  feeOpen: boolean;
  draw: bigint;
  depth: bigint;
  canContinue: boolean;
  onChangeStream: () => void;
  onAmount: (next: string) => void;
  onMax: () => void;
  onUsdMode: (mode: "token" | "usd") => void;
  onSelectTick: (aprBps: number) => void;
  onStep: (direction: -1 | 1) => void;
  onOpenAllRates: () => void;
  onCloseAllRates: () => void;
  onToggleFee: () => void;
  onReview: () => void;
  hideAmount?: boolean;
  hideUsd?: boolean;
}) {
  const poolState =
    windowState === "loading"
      ? "loading"
      : windowState === "unavailable"
        ? "unavailable"
        : quote?.emptyTick
          ? "empty-tick"
          : quote?.partial
            ? "partial"
            : "fits";
  const preview = parseDecimalInput(amountRaw);

  return (
    <>
      <StreamContext stream={stream} ovrfloSymbol={ovrfloSymbol} onChange={onChangeStream} />
      {hideAmount ? null : (
        <AmountStep value={amountRaw} unit={underlyingSymbol} error={amountError} onChange={onAmount} onMax={onMax} />
      )}
      {hideUsd ? null : (
        <TokenUsdSwitch mode={usdMode} tokenLabel={underlyingSymbol} usdAvailable={usdAvailable} onChange={onUsdMode} />
      )}
      {preview.ok ? (
        <Amount
          token={weiToAmountInput(preview.value)}
          symbol={underlyingSymbol}
          usd={usdDisplay}
          usdAvailable={usdAvailable}
          mode={usdMode}
        />
      ) : null}
      <RateStep
        windowState={windowState}
        window={window}
        selectedAprBps={selectedAprBps}
        underlyingSymbol={underlyingSymbol}
        allRatesOpen={allRatesOpen}
        ladder={ladder}
        emptyTickCopy={emptyTickCopy}
        onSelect={onSelectTick}
        onStep={onStep}
        onOpenAllRates={onOpenAllRates}
        onCloseAllRates={onCloseAllRates}
      />
      {quote && amountRaw ? (
        <PoolBand draw={draw} depth={depth} unit={underlyingSymbol} state={poolState} />
      ) : null}
      {quoteDashes || (quote && (quote.fill > 0n || quoteStale) && !amountError) ? (
        <BorrowFacts
          quote={quote}
          stale={quoteStale}
          dashes={quoteDashes}
          underlyingSymbol={underlyingSymbol}
          ovrfloSymbol={ovrfloSymbol}
          cover={cover}
          feeOpen={feeOpen}
          onToggleFee={onToggleFee}
        />
      ) : null}
      {canContinue ? (
        <ActionButton variant="primary" onClick={onReview}>
          REVIEW BORROW
        </ActionButton>
      ) : (
        <ActionButton disabled disabledReason={continueReason(windowState, emptyTickCopy, amountError, quoteStale)}>
          REVIEW BORROW
        </ActionButton>
      )}
    </>
  );
}

function amountFieldError(
  raw: string,
  parsed: ReturnType<typeof parseDecimalInput>,
  cap: bigint | undefined,
  minLiquidity = MIN_LIQUIDITY_AMOUNT,
): string | undefined {
  if (raw.trim() === "") return undefined;
  if (!parsed.ok) return amountErrorCopy("malformed");
  if (parsed.value < minLiquidity) return amountErrorCopy("fill-floor");
  if (cap !== undefined && cap > 0n && parsed.value > cap) return amountErrorCopy("above-cap");
  return undefined;
}

function continueReason(
  windowState: string,
  emptyTickCopy?: string,
  amountError?: string,
  quoteStale?: boolean,
): string {
  if (quoteStale) return "UPDATING QUOTE";
  if (amountError) return amountError;
  if (emptyTickCopy) return emptyTickCopy;
  if (windowState === "empty") return "NO LIQUIDITY POSTED AT ANY RATE";
  if (windowState === "unavailable") return "RATES UNAVAILABLE";
  if (windowState === "loading") return "LOADING RATES";
  return "ENTER AMOUNT AND RATE";
}

function streamSelectStatus(
  marketsStatus: "loading" | "ready" | "unavailable",
  vaultsLoading: boolean,
  streams: ReturnType<typeof useCompleteStreams>,
): "loading" | "ready" | "empty" | "unavailable" {
  if (marketsStatus === "unavailable" || streams.status === "unavailable") {
    return "unavailable";
  }
  if (marketsStatus === "loading" || vaultsLoading || streams.status === "loading") {
    return "loading";
  }
  const eligibleCount =
    streams.status === "ready" || streams.status === "partial"
      ? streams.data.streams.filter((row) => row.borrowRouteEligible).length
      : 0;
  if ((streams.status === "partial" || (streams.status === "ready" && !streams.data.complete)) && eligibleCount === 0) {
    return "loading";
  }
  if (streams.status === "ready" && streams.data.complete && eligibleCount === 0) {
    return "empty";
  }
  return "ready";
}

function deriveCheckpoint(input: {
  stage: CreateStage;
  ackReady: boolean;
  acknowledged: boolean;
  streamApproved: boolean;
  isSigning: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  unknown?: boolean;
}): BorrowCheckpoint {
  if (input.stage !== "review") return "review";
  if (input.isConfirmed) return "confirmed";
  if (input.unknown) return "pending";
  if (input.isConfirming) return "pending";
  if (input.isSigning) return "sign";
  if (!input.ackReady) return "review";
  if (!input.acknowledged) return "acknowledge";
  if (!input.streamApproved) return "approve";
  return "sign";
}

function parseBorrowed(
  logs: readonly Log[] | undefined,
  lending: Address | null,
): { loanId: bigint; net: bigint; obligation: bigint } | null {
  if (!logs || !lending) return null;
  const lendingKey = lending.toLowerCase();
  const [created] = parseEventLogs({
    abi: ovrfloLendingAbi,
    eventName: "Borrowed",
    logs: logs.filter((log) => log.address.toLowerCase() === lendingKey),
  });
  if (!created) return null;
  return {
    loanId: created.args.loanId,
    net: created.args.actualBorrow - created.args.feeAmount,
    obligation: created.args.obligation,
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
