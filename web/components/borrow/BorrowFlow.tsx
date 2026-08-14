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
import { useMarketSymbols, symbolFor } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useOvrflos } from "@/hooks/useOvrflos";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import { useStreams, type HydratedStream } from "@/hooks/useStreams";
import { useUsdPrice } from "@/hooks/useUsdPrice";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { classifyBorrowError } from "@/lib/borrow";
import { chainId, factoryAddress, SABLIER_LOCKUP_ADDRESS, ZERO_ADDRESS } from "@/lib/config";
import { decodeContractError, isUserRejection } from "@/lib/errors";
import { formatAprBps, formatUsd } from "@/lib/format";
import { bestDepthTick, stepWindow, tickWindow, type LadderModel } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, MIN_STREAM_AMOUNT } from "@/lib/lending-math";
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
  quoteBorrow,
  quoteDrift,
  snapshotQuote,
  streamDerivedCap,
  tickDepthWei,
  ttmSeconds,
  weiToAmountInput,
  type BorrowQuote,
  type QuoteSnapshot,
} from "./quote";
import "./borrow.css";

type Stage = "select-stream" | "amount-rate" | "review";

function draftKey(account: string) {
  return flowDraftKey("borrow", factoryAddress, chainId, account);
}

export function BorrowFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const [frozen, setFrozen] = useState<QuoteSnapshot | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [bodyKey, setBodyKey] = useState(0);

  const streams = useStreams({
    account,
    vaults: ovrflos.vaults,
    markets: marketsResult.markets,
    registryComplete: marketsResult.status === "ready" && !ovrflos.isLoading,
    now,
  });

  const eligible = useMemo(() => {
    if (streams.truth.status !== "ready") return [];
    return streams.truth.data.streams.filter((row) => row.borrowRouteEligible);
  }, [streams.truth]);

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
  const { freshness, signingAllowed } = useFreshness([
    sourceFromOutcome(streams.truth),
    sourceFromOutcome(ladderOutcome),
  ]);
  const stale = useStaleRecovery(actionTx.error, classifyBorrowError, queryClient, account);

  const { decision, go: goDecision } = useFlowDecisionHistory({
    hasFrozenSnapshot: frozen !== null,
    hasSelection: selectedStreamId !== null,
  });
  const stage: Stage =
    decision === "select" ? "select-stream" : decision === "amount-rate" ? "amount-rate" : "review";
  const setStage = useCallback(
    (next: Stage, mode: "push" | "replace" = "push") => {
      goDecision(
        next === "select-stream" ? "select" : next === "amount-rate" ? "amount-rate" : "review",
        mode,
      );
    },
    [goDecision],
  );

  const resetForm = useCallback(() => {
    goDecision("select", "replace");
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

  const nftEnabled = Boolean(account && lending && selectedStream);
  const nftReads = useReadContracts({
    allowFailure: true,
    contracts:
      nftEnabled && account && lending && selectedStream
        ? [
            {
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "getApproved",
              args: [selectedStream.streamId],
            },
            {
              address: SABLIER_LOCKUP_ADDRESS,
              abi: sablierLockupAbi,
              functionName: "isApprovedForAll",
              args: [account, lending],
            },
          ]
        : [],
    query: { enabled: nftEnabled },
  });
  const approvedOperator =
    nftReads.data?.[0]?.status === "success" ? (nftReads.data[0].result as Address) : ZERO_ADDRESS;
  const approvedForAll = nftReads.data?.[1]?.status === "success" ? Boolean(nftReads.data[1].result) : false;
  const streamApproved =
    Boolean(lending) &&
    (approvedForAll || isAddressEqual(approvedOperator, lending ?? ZERO_ADDRESS));

  const ladder: LadderModel | null = ladderOutcome.status === "ready" ? ladderOutcome.data.model : null;
  const lendingConfig = ladderOutcome.status === "ready" ? ladderOutcome.data.config : null;
  const bounds = {
    aprMin: lendingConfig?.aprMinBps ?? 0,
    aprMax: lendingConfig?.aprMaxBps ?? 0,
  };
  const windowModel = ladder
    ? tickWindow(ladder, selectedAprBps, bounds)
    : tickWindow({ rungs: [], pickable: [], emptyLadder: true, bestDepth: null }, null, bounds);

  useEffect(() => {
    if (selectedAprBps !== null || !ladder) return;
    const best = bestDepthTick(ladder);
    if (best !== null) setSelectedAprBps(best);
  }, [ladder, selectedAprBps]);

  const ovrfloSymbol = market ? symbolFor(symbols, market.ovrfloToken) : "the market's ovrflo token";
  const underlyingSymbol = market ? symbolFor(symbols, market.underlying) : "underlying";
  const depth = tickDepthWei(ladder, selectedAprBps, lendingConfig?.minLiquidityAmount);
  const parsedAmount = parseDecimalInput(amountRaw);
  const remaining = selectedStream?.remaining ?? 0n;
  const ttm = selectedStream ? ttmSeconds(selectedStream.schedule.end, now) : 0n;
  const cap =
    selectedStream && selectedAprBps !== null
      ? streamDerivedCap(remaining, selectedAprBps, ttm, lendingConfig?.unit)
      : 0n;
  const target = parsedAmount.ok ? parsedAmount.value : 0n;
  const quote: BorrowQuote | null =
    selectedStream && selectedAprBps !== null && lendingConfig
      ? quoteBorrow({
          remaining,
          aprBps: selectedAprBps,
          ttmSeconds: ttm,
          feeBps: lendingConfig.feeBps,
          target,
          depth,
          unit: lendingConfig.unit,
          minLiquidity: lendingConfig.minLiquidityAmount,
        })
      : null;

  const amountError = amountFieldError(amountRaw, parsedAmount, cap, lendingConfig?.minLiquidityAmount);
  const windowState =
    !market || ladderOutcome.status === "loading"
      ? "loading"
      : ladderOutcome.status === "unavailable"
        ? "unavailable"
        : ladder && (ladder.emptyLadder || ladder.pickable.length === 0)
          ? "empty"
          : "ready";
  const selectedRung = ladder?.rungs.find((rung) => rung.aprBps === selectedAprBps);
  const emptyTick = Boolean(quote?.emptyTick || selectedRung?.kind === "empty");
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

  const drifted = Boolean(frozen && quote && quoteDrift(frozen, quote));
  const receipt = parseBorrowed(actionTx.receipt?.logs, lending);
  const checkpoint = deriveCheckpoint({
    stage,
    ackReady: ack.ready,
    acknowledged: ack.acknowledged,
    streamApproved,
    isSigning: actionTx.isSigning,
    isConfirming: actionTx.isConfirming,
    isConfirmed: actionTx.isConfirmed,
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
    const next = eligible.find((row) => row.streamId === id);
    if (next && parsedAmount.ok) {
      const nextCap = streamDerivedCap(
        next.remaining,
        selectedAprBps ?? 0,
        ttmSeconds(next.schedule.end, now),
        lendingConfig?.unit,
      );
      if (parsedAmount.value > nextCap) setAmountRaw("");
    }
    setSelectedStreamId(id);
    setFrozen(null);
    stale.setStaleRecovery(false);
  }

  function onChangeStream() {
    setStage("select-stream");
    setFrozen(null);
  }

  function onMax() {
    if (cap > 0n) setAmountRaw(weiToAmountInput(cap));
  }

  function onReview() {
    if (!quote || emptyTick || amountError || quote.fill <= 0n) return;
    setFrozen(snapshotQuote(quote, selectedAprBps ?? 0));
    setStage("review");
  }

  function onRelatch() {
    if (!quote) return;
    setFrozen(snapshotQuote(quote, selectedAprBps ?? 0));
    stale.setStaleRecovery(false);
  }

  function onApprove() {
    if (!lending || !selectedStream || chainGuard.wrongChain || !signingAllowed) return;
    approveTx.writeContract({
      address: SABLIER_LOCKUP_ADDRESS,
      abi: sablierLockupAbi,
      functionName: "approve",
      args: [lending, selectedStream.streamId],
    });
  }

  function onBorrow() {
    if (!lending || !market || !selectedStream || !quote || !frozen || drifted || chainGuard.wrongChain || !signingAllowed) return;
    actionTx.writeContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "borrow",
      args: [market.market, selectedAprBps as number, frozen.fill, selectedStream.streamId, frozen.minAcceptable],
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
    windowState === "ready" &&
    quote !== null &&
    quote.fill >= (lendingConfig?.minLiquidityAmount ?? MIN_LIQUIDITY_AMOUNT);

  let signingBlocked: string | undefined;
  if (!signingAllowed) signingBlocked = "EVENTS STALE — SIGNING DISABLED";
  if (chainGuard.wrongChain) signingBlocked = "SWITCH NETWORK";
  if (stale.staleRecovery) signingBlocked = "QUOTE UPDATED — REVIEW AGAIN";

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
    stale: !signingAllowed || stale.staleRecovery || drifted,
    signingAllowed,
    isSigning: actionTx.isSigning || approveTx.isSigning,
    isConfirming: actionTx.isConfirming,
    isConfirmed: actionTx.isConfirmed,
    error: Boolean(decoded && !isUserRejection(actionTx.error) && !isUserRejection(approveTx.error)),
  });

  return (
    <Shell
      currentNav="borrow"
      wallet={<WalletButton />}
      status={<StatusLine status={freshness.kind} asOf={asOf} usdUnavailable={usdUnavailable} />}
      onHome={() => router.push("/")}
    >
      <ModalErrorBoundary control="UI-REVIEW-ERROR-BOUNDARY" onReset={() => setBodyKey((key) => key + 1)}>
        <div className="borrow-flow" data-split={stage === "review" ? "true" : "false"} key={bodyKey}>
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
          {connected && !walletReset.walletChanged && stage === "select-stream" ? (
            <>
              {streamSelectState === "empty" ? (
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
              {streamSelectState === "ready" ? (
                selectedStreamId ? (
                  <ActionButton variant="primary" onClick={() => setStage("amount-rate")}>
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
          {connected && !walletReset.walletChanged && stage === "amount-rate" && selectedStream ? (
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
              allRatesOpen={allRatesOpen}
              ladder={ladder}
              emptyTickCopy={emptyTickCopy}
              quote={quote}
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
              onOpenAllRates={() => setAllRatesOpen(true)}
              onCloseAllRates={() => setAllRatesOpen(false)}
              onToggleFee={() => setFeeOpen((open) => !open)}
              onReview={onReview}
            />
          ) : null}
          {connected &&
          !walletReset.walletChanged &&
          stage === "review" &&
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
                approveBusy={approveTx.isSigning || approveTx.isConfirming || approveTx.isInFlight}
                borrowBusy={actionTx.isSigning || actionTx.isConfirming || actionTx.isInFlight}
                txHash={actionTx.hash ? String(actionTx.hash) : undefined}
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
                    setStage("amount-rate");
                    setFrozen(null);
                  } else if (decoded?.recovery.id === "change-stream") {
                    onChangeStream();
                  } else {
                    onRelatch();
                  }
                }}
                onViewLoan={(loanId) => router.push(`/?lens=borrowed&loan=${loanId.toString()}`)}
              />
            </>
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
      <AmountStep value={amountRaw} unit={underlyingSymbol} error={amountError} onChange={onAmount} onMax={onMax} />
      <TokenUsdSwitch mode={usdMode} tokenLabel={underlyingSymbol} usdAvailable={usdAvailable} onChange={onUsdMode} />
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
      {quote && quote.fill > 0n && !amountError ? (
        <BorrowFacts
          quote={quote}
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
        <ActionButton disabled disabledReason={continueReason(windowState, emptyTickCopy, amountError)}>
          REVIEW BORROW
        </ActionButton>
      )}
    </>
  );
}

function amountFieldError(
  raw: string,
  parsed: ReturnType<typeof parseDecimalInput>,
  cap: bigint,
  minLiquidity = MIN_LIQUIDITY_AMOUNT,
): string | undefined {
  if (raw.trim() === "") return undefined;
  if (!parsed.ok) return amountErrorCopy("malformed");
  if (parsed.value < minLiquidity) return amountErrorCopy("fill-floor");
  if (cap > 0n && parsed.value > cap) return amountErrorCopy("above-cap");
  return undefined;
}

function continueReason(windowState: string, emptyTickCopy?: string, amountError?: string): string {
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
  streams: ReturnType<typeof useStreams>,
): "loading" | "ready" | "empty" | "unavailable" {
  if (
    marketsStatus === "unavailable" ||
    streams.candidates.status === "unavailable" ||
    streams.truth.status === "unavailable"
  ) {
    return "unavailable";
  }
  if (
    marketsStatus === "loading" ||
    vaultsLoading ||
    streams.candidates.status === "loading" ||
    streams.truth.status === "loading"
  ) {
    return "loading";
  }
  if (
    streams.truth.status === "ready" &&
    streams.truth.data.streams.filter((row) => row.borrowRouteEligible).length === 0
  ) {
    return "empty";
  }
  return "ready";
}

function deriveCheckpoint(input: {
  stage: Stage;
  ackReady: boolean;
  acknowledged: boolean;
  streamApproved: boolean;
  isSigning: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
}): BorrowCheckpoint {
  if (input.stage !== "review") return "review";
  if (input.isConfirmed) return "confirmed";
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
