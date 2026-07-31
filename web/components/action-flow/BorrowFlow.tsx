"use client";

import { useEffect, useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { useApprovalWriteFlows } from "@/hooks/useApprovalWriteFlows";
import { useBorrowDemand } from "@/hooks/useBorrowDemand";
import { useClearOnConfirm } from "@/hooks/useClearOnConfirm";
import { useHeldStreams } from "@/hooks/useHeldStreams";
import { useLending } from "@/hooks/useLending";
import { useLendingLiquidity } from "@/hooks/useLendingLiquidity";
import { symbolFor } from "@/hooks/useMarketSymbols";
import { useNowSeconds } from "@/hooks/useNowSeconds";
import { useStaleRecovery } from "@/hooks/useStaleRecovery";
import { useWalletChangeReset } from "@/hooks/useWalletChangeReset";
import { useQueryClient } from "@tanstack/react-query";
import { ovrfloLendingAbi, sablierLockupAbi } from "@/lib/abis";
import { SABLIER_LOCKUP_ADDRESS } from "@/lib/config";
import { userFacingError } from "@/lib/errors";
import { formatAprBps, formatId, formatTokenAmount } from "@/lib/format";
import {
  borrowReceiptSummary,
  classifyBorrowError,
  parseSlippageBps,
  planSelectedBorrow,
  resolveSelectedTick,
  SLIPPAGE_DEFAULT_PCT,
} from "@/lib/borrow";
import { applySlippageDown, isSeriesMatchedStream } from "@/lib/modal-logic";
import { aprChoices, formatBpsPct, upfrontBps } from "@/lib/lending-math";
import { buildLadder, selectHydratedRoute } from "@/lib/router";
import { RateLadder } from "../RateLadder";
import type { ActionFlowProps } from "./ActionFlowShell";
import {
  ActionFlowShell,
  AmountInput,
  ApproveTxState,
  CloseButton,
  DemandAnnotation,
  RefreshTxState,
  StepIndicator,
  WalletChangedNotice,
  accentClass,
  parseAmount,
} from "./ActionFlowShell";

export type BorrowOutcome =
  | "preparing"
  | "partial"
  | "unavailable"
  | "stale-route"
  | "fragmented"
  | "insufficient"
  | "true-zero";

const BORROW_OUTCOME_COPY: Record<BorrowOutcome, string> = {
  preparing: "LIQUIDITY IS PREPARING — ROUTE CHECKS ARE STILL RUNNING",
  partial: "PARTIAL LIQUIDITY AVAILABLE — THE BORROW MAY BE SMALLER THAN REQUESTED",
  unavailable: "LIQUIDITY DATA IS UNAVAILABLE — RETRY WHEN THE ROUTE IS READY",
  "stale-route": "THE ROUTE CHANGED — REVIEW THE FRESH LIQUIDITY BEFORE CONFIRMING",
  fragmented: "LIQUIDITY IS TOO FRAGMENTED FOR THE BOUNDED ROUTE",
  insufficient: "EXECUTABLE LIQUIDITY IS INSUFFICIENT FOR THIS AMOUNT",
  "true-zero": "NO EXECUTABLE LIQUIDITY IS AVAILABLE AT THIS TIME",
};

export function BorrowOutcomeNotice({ outcome }: { outcome: BorrowOutcome }) {
  return (
    <div
      className="label mono status-warning"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-borrow-outcome={outcome}
    >
      {BORROW_OUTCOME_COPY[outcome]}
    </div>
  );
}

function resolveBorrowOutcome({
  staleRoute,
  unavailable,
  preparing,
  routeStatus,
  partial,
  target,
  hasLiquidTicks,
  hasOwnLiquidity,
}: {
  staleRoute: boolean;
  unavailable: boolean;
  preparing: boolean;
  routeStatus:
    | "ready"
    | "insufficient"
    | "fragmented"
    | "conservation-failed"
    | undefined;
  partial: boolean;
  target: bigint;
  hasLiquidTicks: boolean;
  hasOwnLiquidity: boolean;
}): BorrowOutcome | null {
  if (staleRoute) return "stale-route";
  if (unavailable) return "unavailable";
  if (preparing) return "preparing";
  if (routeStatus === "fragmented") return "fragmented";
  if (
    routeStatus === "insufficient" ||
    routeStatus === "conservation-failed"
  ) {
    return "insufficient";
  }
  if (partial && target > 0n) return "partial";
  if (target > 0n && !hasLiquidTicks) {
    return hasOwnLiquidity ? "insufficient" : "true-zero";
  }
  return null;
}

// --- Borrow form ---

export function BorrowFlow({
  market,
  user,
  action,
  symbols,
  accent,
  onClose,
}: ActionFlowProps) {
  const connection = useConnection();
  const queryClient = useQueryClient();
  const lending = useLending(market.lending);
  const liquidity = useLendingLiquidity(market.lending, market.market);
  const streams = useHeldStreams(user);
  const eligibleStreams = streams.streams.filter((stream) => isSeriesMatchedStream(stream, market));

  const [selectedStreamId, setSelectedStreamId] = useState<bigint | null>(action.streamId ?? null);
  const [raw, setRaw] = useState("");
  const [slippageRaw, setSlippageRaw] = useState(SLIPPAGE_DEFAULT_PCT);
  const [selectedAprRaw, setSelectedAprRaw] = useState<number | null>(null);
  const [showAlternative, setShowAlternative] = useState(false);
  const [streamApprovedId, setStreamApprovedId] = useState<bigint | null>(null);
  const [submitted, setSubmitted] = useState<{ target: bigint; quotedNet: bigint } | null>(null);
  // Known on the very first render, so a matured market is gated before the
  // ladder or router ever run — not even for a frame.
  const nowSeconds = useNowSeconds(true);

  const target = parseAmount(raw);
  const connectedAddress = connection.addresses?.[0];
  const underlyingSymbol = symbolFor(symbols, market.underlying);
  const ovrfloSymbol = symbolFor(symbols, market.ovrfloToken);
  const feeBps = lending.params.feeBps;
  const demandState = useBorrowDemand(
    market.lending,
    market.market,
    connectedAddress,
  );

  // Maturity gate: past maturity neither the ladder nor the router ever runs
  // Contract quote and action validation also reject expired series.
  const matured = nowSeconds >= market.expiryCached;
  const ttmSeconds = matured ? 0n : market.expiryCached - nowSeconds;

  const ticks = [
    ...new Set([
      ...aprChoices(lending.params.aprMinBps, lending.params.aprMaxBps),
      ...liquidity.liquidity
        .filter((position) => position.market.toLowerCase() === market.market.toLowerCase())
        .map((position) => position.aprBps),
    ]),
  ].sort((left, right) => left - right);
  const ladder = buildLadder(liquidity.liquidity, market.market, ticks, connectedAddress);
  const liquidTicks = ladder.filter((tick) => tick.total > 0n);
  const selectedApr = resolveSelectedTick(ladder, selectedAprRaw);
  const bestApr = resolveSelectedTick(ladder, null);
  const hasOwnLiquidity = ladder.some((tick) => tick.own > 0n);
  const plan = selectedApr !== null ? planSelectedBorrow(ladder, selectedApr, target) : null;

  const { approveTx, actionTx, zeroFirst, busy } = useApprovalWriteFlows(connectedAddress, market);

  const guard = useWalletChangeReset(connectedAddress, () => {
    setSelectedStreamId(action.streamId ?? null);
    setRaw("");
    setSlippageRaw(SLIPPAGE_DEFAULT_PCT);
    setSelectedAprRaw(null);
    setShowAlternative(false);
    setStreamApprovedId(null);
    setStaleRecovery(false);
    setSubmitted(null);
  });

  const recipient = useReadContract({
    address: SABLIER_LOCKUP_ADDRESS,
    abi: sablierLockupAbi,
    functionName: "getRecipient",
    args: selectedStreamId ? [selectedStreamId] : undefined,
    query: { enabled: selectedStreamId !== null },
  });

  const quoteEnabled = Boolean(market.lending && selectedStreamId && selectedApr !== null && !matured);
  // Full-borrow quote (borrowAmount = 0) for the stream's grossPrice — the cap
  // the price-blind ladder plan is clamped to before quoting the actual fill.
  const fullQuote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: quoteEnabled ? [market.market, selectedStreamId!, selectedApr!, 0n] : undefined,
    query: { enabled: quoteEnabled },
  });
  const fullQuoteData = fullQuote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const grossPrice = fullQuoteData?.[0];

  const planFill = plan?.fill ?? 0n;
  const fill = grossPrice !== undefined && grossPrice < planFill ? grossPrice : planFill;
  const priceCapped = target > 0n && grossPrice !== undefined && grossPrice < planFill;

  const fillEnabled = quoteEnabled && fill > 0n;
  const fillQuote = useReadContract({
    address: market.lending ?? undefined,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: fillEnabled ? [market.market, selectedStreamId!, selectedApr!, fill] : undefined,
    query: { enabled: fillEnabled },
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

  useEffect(() => {
    if (approveTx.hasFailed) setStreamApprovedId(null);
  }, [approveTx.hasFailed]);

  // A liquidity race is recoverable: refresh every on-chain read so the ladder
  // and quotes reflect the new depth, then ask for one explicit re-confirm.
  const { errorKind, terminal, staleRecovery, setStaleRecovery } = useStaleRecovery(
    actionTx.error,
    classifyBorrowError,
    queryClient,
    connectedAddress,
  );

  // A terminal error is terminal for the *stream*, not the form — picking a
  // different stream clears the failed transaction and re-arms the button.
  const resetActionTx = actionTx.reset;
  useEffect(() => {
    resetActionTx();
    setStaleRecovery(false);
  }, [selectedStreamId, resetActionTx, setStaleRecovery]);

  useClearOnConfirm(actionTx.isConfirmed, () => setRaw(""));

  if (guard.walletChanged) return <WalletChangedNotice onContinue={guard.acknowledge} />;
  if (matured) {
    return (
      <div className="form-grid">
        <div className="label mono status-negative">MARKET MATURED — BORROWING CLOSED</div>
        <CloseButton onClose={onClose} />
      </div>
    );
  }

  const quoteData = fillQuote.data as [bigint, bigint, bigint, bigint, bigint] | undefined;
  const projectedTick =
    selectedApr === null
      ? []
      : liquidity.liquidity.filter(
          (position) =>
            position.market.toLowerCase() === market.market.toLowerCase() &&
            position.aprBps === selectedApr,
        );
  const aggregateDepth =
    selectedApr !== null && liquidity.outcome.status === "ready"
      ? (liquidity.outcome.data.aggregateByApr.get(selectedApr) ?? 0n)
      : null;
  const freshRoute =
    fill > 0n &&
    aggregateDepth !== null &&
    connectedAddress &&
    lending.params.maxRouteIds > 0
      ? selectHydratedRoute({
          positions: projectedTick,
          borrower: connectedAddress,
          target: fill,
          aggregateDepth,
          maxRouteIds: lending.params.maxRouteIds,
        })
      : null;
  const routeIds =
    freshRoute?.status === "ready" ? freshRoute.selectedIds : [];

  const slippageBps = parseSlippageBps(slippageRaw);
  const minAcceptable =
    quoteData !== undefined && slippageBps !== null ? applySlippageDown(quoteData[3], slippageBps) : null;

  const recipientMatches =
    !selectedStreamId || recipient.data?.toLowerCase() === connectedAddress?.toLowerCase();

  const streamApproved =
    Boolean(selectedStreamId && streamApprovedId === selectedStreamId) ||
    Boolean(market.lending && approved.data?.toLowerCase() === market.lending.toLowerCase()) ||
    approvedForAll.data === true;

  const needsApproval = !streamApproved && selectedStreamId !== null;
  // Quotes validate collateral economics; projection + direct hydration
  // validates the route without the legacy on-chain gather helper.
  const readError = fullQuote.error ?? fillQuote.error;
  const sourceError = lending.error ?? liquidity.error ?? streams.error;
  const routeErrorKind = readError ? classifyBorrowError(readError) : null;
  const routePreparing =
    fullQuote.isLoading ||
    fullQuote.isFetching ||
    fillQuote.isLoading ||
    fillQuote.isFetching ||
    (fill > 0n && freshRoute === null);
  const disabled =
    !market.lending ||
    !selectedStreamId ||
    !recipientMatches ||
    target === 0n ||
    fill === 0n ||
    busy ||
    !quoteData ||
    minAcceptable === null ||
    routeIds.length === 0 ||
    actionTx.isConfirmed;

  const receiptSummary =
    actionTx.isConfirmed && actionTx.receipt && market.lending
      ? borrowReceiptSummary(actionTx.receipt.logs, feeBps, market.lending)
      : null;
  // The contract clamps the borrow to available liquidity, so a partial fill
  // can confirm without reverting — the receipt is the source of truth.
  const partialFillReceived =
    receiptSummary !== null && submitted !== null && receiptSummary.contributed < submitted.target;
  const receivedDiffers =
    receiptSummary !== null && submitted !== null && receiptSummary.net !== submitted.quotedNet;

  const borrowOutcome = resolveBorrowOutcome({
    staleRoute: staleRecovery || routeErrorKind === "stale",
    unavailable:
      streams.unavailable ||
      Boolean(sourceError) ||
      routeErrorKind === "retryable",
    preparing:
      streams.isLoading ||
      lending.isLoading ||
      liquidity.isLoading ||
      routePreparing,
    routeStatus: freshRoute?.status,
    partial: Boolean(plan?.partial),
    target,
    hasLiquidTicks: liquidTicks.length > 0,
    hasOwnLiquidity,
  });

  const steps = ["APPROVE STREAM", "SIGN", "CONFIRMED"];
  const activeIndex = actionTx.isConfirmed || actionTx.isConfirming ? 2 : streamApproved ? 1 : 0;

  return (
    <ActionFlowShell>
      {action.streamId === undefined ? (
        <>
          <label className="label mono" htmlFor="borrow-stream">
            COLLATERAL STREAM
          </label>
          <select
            id="borrow-stream"
            className="input mono"
            value={selectedStreamId?.toString() ?? ""}
            onChange={(e) => setSelectedStreamId(e.target.value ? BigInt(e.target.value) : null)}
          >
            <option value="">SELECT STREAM</option>
            {eligibleStreams.map((stream) => (
              <option key={stream.streamId.toString()} value={stream.streamId.toString()}>
                {stream.streamId.toString()} / {formatTokenAmount(stream.deposited - stream.withdrawn, ovrfloSymbol)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <div className="label mono">STREAM {formatId(selectedStreamId ?? undefined)}</div>
      )}

      <RateLadder
        label="BORROW RATE"
        rows={liquidTicks.map((tick) => ({
          aprBps: tick.aprBps,
          cells: [
            `UPFRONT ${formatBpsPct(upfrontBps(tick.aprBps, ttmSeconds, feeBps))}`,
            `DEPTH ${formatTokenAmount(tick.total, underlyingSymbol)}`,
          ],
          best: tick.aprBps === bestApr,
        }))}
        selectedAprBps={selectedApr}
        onSelect={(aprBps) => {
          setSelectedAprRaw(aprBps);
          setShowAlternative(false);
        }}
         emptyText="NO LIQUIDITY POSTED AT ANY RATE"
        footnote={hasOwnLiquidity ? "YOUR OWN SUPPLY IS EXCLUDED — YOU CANNOT BORROW AGAINST IT" : null}
      />
      {borrowOutcome && borrowOutcome !== "partial" && borrowOutcome !== "stale-route" ? (
        <BorrowOutcomeNotice outcome={borrowOutcome} />
      ) : null}
      {liquidTicks.length === 0 ? (
        // Empty ladder still shows recent borrower demand so a would-be lender
        // opening BORROW by mistake — or a borrower scouting — sees the market
        // isn't dead. Unreachable indexer stays distinct from zero borrows.
        demandState.status === "ok" ? (
          demandState.demand.length === 0 ? (
            <div className="label mono">NO LOANS IN 30 DAYS</div>
          ) : (
            demandState.demand.map((row) => (
              <div key={row.aprBps} className="label mono">
                RECENT DEMAND {formatAprBps(row.aprBps)} — {row.count} LOANS /{" "}
                {formatTokenAmount(row.amount, underlyingSymbol)} (30D)
              </div>
            ))
          )
        ) : (
          <DemandAnnotation status={demandState.status} />
        )
      ) : null}

      <AmountInput
        id="borrow-amount"
        label={`AMOUNT (${underlyingSymbol})`}
        value={raw}
        onChange={setRaw}
      />

      <label className="label mono" htmlFor="borrow-slippage">
        SLIPPAGE %
      </label>
      <input
        id="borrow-slippage"
        className={`input mono ${slippageBps === null ? "input-error" : ""}`}
        value={slippageRaw}
        onChange={(e) => setSlippageRaw(e.target.value)}
      />
      {slippageBps === null ? <div className="label mono status-negative">SLIPPAGE MUST BE 0.1–5%</div> : null}

      <div className="summary-row mono" aria-live="polite">
        {quoteData ? (
          <>
            NET {formatTokenAmount(quoteData[3], underlyingSymbol)} / OBLIGATION{" "}
            {formatTokenAmount(quoteData[1], ovrfloSymbol)} / RESIDUAL {formatTokenAmount(quoteData[4], ovrfloSymbol)}
          </>
        ) : target > 0n && fill > 0n ? (
          "LOADING"
        ) : (
          "—"
        )}
      </div>

      {plan?.partial && target > 0n ? (
        <>
          <BorrowOutcomeNotice outcome="partial" />
          <div className="label mono">
            PARTIAL FILL — {formatTokenAmount(fill, underlyingSymbol)} OF {formatTokenAmount(target, underlyingSymbol)}{" "}
            AVAILABLE AT {selectedApr !== null ? formatAprBps(selectedApr) : "—"}
          </div>
        </>
      ) : null}
      {priceCapped ? (
        <div className="label mono status-warning">AMOUNT EXCEEDS STREAM VALUE — QUOTING MAXIMUM</div>
      ) : null}
      {plan?.partial && target > 0n && plan.alternativeAprBps !== null ? (
        !showAlternative ? (
          <button className="button mono" type="button" onClick={() => setShowAlternative(true)}>
            SHOW OTHER OPTIONS
          </button>
        ) : (
          <button
            className="button mono"
            type="button"
            onClick={() => {
              setSelectedAprRaw(plan.alternativeAprBps);
              setShowAlternative(false);
            }}
          >
            SWITCH TO {formatAprBps(plan.alternativeAprBps)} — COVERS FULL AMOUNT
          </button>
        )
      ) : null}

      {selectedStreamId && !recipientMatches ? (
        <div className="label mono status-negative">CONNECTED WALLET IS NOT RECIPIENT</div>
      ) : null}
      {readError ? <div className="label mono status-negative">{userFacingError(readError)}</div> : null}

      <StepIndicator
        steps={steps}
        activeIndex={activeIndex}
        error={approveTx.hasFailed || actionTx.hasFailed}
        accent={accent}
      />

      {staleRecovery && !actionTx.isConfirmed && !busy ? (
        <>
          <BorrowOutcomeNotice outcome="stale-route" />
          <div className="label mono">
            LIQUIDITY CHANGED SINCE YOUR QUOTE — REVIEW THE NEW NUMBER AND RE-CONFIRM
          </div>
        </>
      ) : null}
      {terminal ? (
        <div className="label mono status-negative">{userFacingError(actionTx.error)}</div>
      ) : null}
      {actionTx.isReverted ? (
        <div className="label mono status-negative">TRANSACTION REVERTED ON-CHAIN</div>
      ) : null}

      {needsApproval ? (
        <button
          className={`button ${accentClass(accent)} mono`}
          disabled={!market.lending || !selectedStreamId || busy || terminal}
          type="button"
          onClick={() => {
            if (!market.lending || !selectedStreamId) return;
            approveTx.writeContract({
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
          disabled={disabled || terminal}
          type="button"
          onClick={() => {
            if (!market.lending || !selectedStreamId || !quoteData || minAcceptable === null || routeIds.length === 0)
              return;
            setStaleRecovery(false);
            setSubmitted({ target: fill, quotedNet: quoteData[3] });
            actionTx.writeContract({
              address: market.lending,
              abi: ovrfloLendingAbi,
              functionName: "createBorrowerLoanPool",
              args: [routeIds, selectedStreamId, fill, minAcceptable],
            });
          }}
        >
          {staleRecovery ? "RE-CONFIRM BORROW" : "BORROW"}
        </button>
      )}

      {zeroFirst.clearing ? (
        <div className="label mono status-warning" role="status">
          THIS TOKEN REQUIRES CLEARING ITS ALLOWANCE FIRST — APPROVE TWICE
        </div>
      ) : null}
      <ApproveTxState tx={approveTx} label="APPROVE STREAM" />
      {actionTx.isSigning ? <div className="label mono status-warning">BORROW: SIGNING</div> : null}
      {actionTx.isConfirming ? (
        <div className="label mono status-warning">BORROW: CONFIRMING {actionTx.hash?.slice(0, 10)}…</div>
      ) : null}
      <RefreshTxState
        tx={actionTx}
        refreshingLabel="BORROW: CONFIRMED — REFRESHING"
        failedLabel="BORROW CONFIRMED — REFRESH FAILED"
      />
      {actionTx.isConfirmed ? <div className="label mono status-positive">CONFIRMED</div> : null}
      {errorKind === "retryable" && !actionTx.refreshFailed ? (
        <div className="label mono status-negative">{userFacingError(actionTx.error)}</div>
      ) : null}

      {actionTx.isConfirmed && receiptSummary ? (
        <div className="summary-row mono" aria-live="polite">
          RECEIVED {formatTokenAmount(receiptSummary.net, underlyingSymbol)}
          {submitted && (partialFillReceived || receivedDiffers) ? (
            <span className="status-warning">
              {" "}
              — {partialFillReceived ? "PARTIAL FILL, " : ""}QUOTED{" "}
              {formatTokenAmount(submitted.quotedNet, underlyingSymbol)}
            </span>
          ) : null}
        </div>
      ) : null}
      {actionTx.isConfirmed ? <CloseButton onClose={onClose} /> : null}
    </ActionFlowShell>
  );
}
