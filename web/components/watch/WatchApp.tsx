"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { WalletButton } from "wallet-runtime";
import { Footer } from "@/components/Footer";
import { FirstRun } from "@/components/first-run/FirstRun";
import { RegionErrorBoundary } from "@/components/ModalErrorBoundary";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { TokenUsdSwitch, type TokenUsdMode } from "@/components/kit/TokenUsdSwitch";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useBorrowerBook } from "@/hooks/useBorrowerBook";
import { useClockHydrationSafe } from "@/hooks/useClock";
import { sourceFromOutcome, useFreshness } from "@/hooks/useFreshness";
import { useLenderBook } from "@/hooks/useLenderBook";
import { symbolFor, useMarketSymbols } from "@/hooks/useMarketSymbols";
import { useOvrflos } from "@/hooks/useOvrflos";
import { useStreams, type HydratedStream } from "@/hooks/useStreams";
import { useUsdPrice } from "@/hooks/useUsdPrice";
import { chainId, factoryDeployment, isConfiguredAddress } from "@/lib/config";
import { formatUsd } from "@/lib/format";
import type { Freshness } from "@/lib/freshness";
import { parseUsdMode, parseWatchLens, type WatchLens } from "@/lib/parse";
import type { ReadOutcome } from "@/lib/read-outcome";
import { queryClient } from "@/lib/query-client";
import { classifySurfaceState } from "@/lib/surface-state";
import { lensKey, storageGet, storageSet, usdModeKey } from "@/lib/storage";
import { tokenUsd8 } from "@/lib/usd";
import type { Usd8 } from "@/lib/units";
import { classifyEntry, streamsDegradedKind, type EntryBook } from "@/lib/watch-entry";
import { sortBorrowedLoans } from "@/lib/watch-rows";
import { inferredLens, writeWatchSearch, type WatchSelection } from "@/lib/watch-url";
import { BorrowedDetail } from "./BorrowedDetail";
import { ClosedLoanDetail } from "./ClosedLoanDetail";
import { StreamClosedDetail, StreamDetail } from "./StreamDetail";
import { SuppliedDetail } from "./SuppliedDetail";
import { useLoanStreams } from "./useLoanStreams";
import { useNarrowViewport } from "./useNarrowViewport";
import { useWatchUrl } from "./useWatchUrl";
import { visibleLensTabs, Wall } from "./Wall";
import "./watch.css";

export function WatchApp() {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const connected = connection.status === "connected" && Boolean(account);
  const clock = useClockHydrationSafe();
  const nowSeconds = clock?.adjustedNow ?? 0n;
  const nowMs = clock ? Number(clock.adjustedNow) * 1000 : Date.now();
  const watchBackRef = useRef<HTMLButtonElement>(null);

  const ovrflos = useOvrflos();
  const markets = useAllMarkets();
  const symbols = useMarketSymbols(markets.markets);
  const lending = isConfiguredAddress(factoryDeployment.lending) ? factoryDeployment.lending : markets.markets[0]?.lending ?? null;

  const lender = useLenderBook(lending, account);
  const borrower = useBorrowerBook(lending, account);
  const streams = useStreams({
    account,
    vaults: ovrflos.vaults,
    markets: markets.markets,
    registryComplete: !ovrflos.isLoading && markets.status !== "loading",
    now: nowSeconds,
  });

  const lenderData = useLastKnown(lender);
  const borrowerData = useLastKnown(borrower);
  const streamData = useLastKnown(streams);

  const positions = lenderData?.positions ?? [];
  const loans = sortBorrowedLoans(borrowerData?.loans ?? []);
  const ownedStreams = streamData?.streams ?? [];

  const streamIds = useMemo(
    () => loans.map((loan) => loan.streamId),
    [loans],
  );
  const loanStreams = useLoanStreams(streamIds);

  const pledgedByStream = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const loan of loans) {
      if (!loan.closed && loan.outstanding > 0n) map.set(loan.streamId.toString(), loan.id);
    }
    return map;
  }, [loans]);

  const positionBook = toBook(lender, positions.length);
  const loanBook = toBook(borrower, loans.length);
  const streamBook = toBook(streams, ownedStreams.length);
  const entry = classifyEntry({
    connected,
    positions: positionBook,
    loans: loanBook,
    streams: streamBook,
  });
  const streamsDegraded = streamsDegradedKind(streamBook);

  const usd = useUsdPrice();
  // Caption and signingAllowed are per lens — not a merge of every source.
  const streamsFreshness = useFreshness([sourceFromOutcome(streams)]);
  const borrowedFreshness = useFreshness([sourceFromOutcome(borrower)]);
  const suppliedFreshness = useFreshness([sourceFromOutcome(lender)]);

  const url = useWatchUrl();
  const narrow = useNarrowViewport();
  const [memoryLens, setMemoryLens] = useState<WatchLens | null>(null);
  const [usdMode, setUsdMode] = useState<TokenUsdMode>("token");

  useEffect(() => {
    if (!account) {
      setMemoryLens(null);
      setUsdMode("token");
      return;
    }
    setMemoryLens(parseWatchLens(storageGet(lensKey(chainId, account))));
    setUsdMode(parseUsdMode(storageGet(usdModeKey(chainId, account))) ?? "token");
  }, [account]);

  const tabs = visibleLensTabs({
    positions: positionBook,
    loans: loanBook,
    streams: streamBook,
  });
  const visibleIds = tabs.filter((tab) => tab.visible).map((tab) => tab.id);
  const resolvedLens = resolveLens(url.lens, memoryLens, visibleIds, url.selection);
  const lensFreshness =
    resolvedLens === "streams"
      ? streamsFreshness
      : resolvedLens === "borrowed"
        ? borrowedFreshness
        : suppliedFreshness;

  useEffect(() => {
    if (entry !== "watch" && entry !== "watch-streams-degraded") return;
    if (url.lens === resolvedLens) return;
    writeWatchSearch({ lens: resolvedLens, selection: url.selection }, "replace");
  }, [entry, resolvedLens, url.lens, url.selection]);

  const lastReadAt = lensFreshness.freshness.asOf ?? nowSeconds;
  const usdQuote: Usd8 | null =
    usd.status === "ready" && usd.data.status === "available" ? usd.data.usd8 : null;
  const usdAvailable = usdQuote !== null;
  const tokenLabel = markets.markets[0]
    ? symbolFor(symbols, markets.markets[0].underlying)
    : "TOKEN";
  const asOf = formatStatusTime(lensFreshness.freshness);

  function onSelectLens(id: WatchLens) {
    if (account) storageSet(lensKey(chainId, account), id);
    setMemoryLens(id);
    url.setLens(id);
  }

  function onSelect(selection: WatchSelection) {
    writeWatchSearch({ lens: resolvedLens, selection }, "push");
  }

  const selectedPositionId = url.selection.kind === "position" ? url.selection.id : null;
  const selectedLoanId = url.selection.kind === "loan" ? url.selection.id : null;
  const selectedStreamId = url.selection.kind === "stream" ? url.selection.id : null;
  const selectedPosition =
    selectedPositionId !== null ? positions.find((row) => row.id === selectedPositionId) : undefined;
  const selectedPositionMarket = selectedPosition
    ? markets.markets.find((row) => row.market.toLowerCase() === selectedPosition.market.toLowerCase()) ??
      null
    : null;
  const selectedLoanFromUrl =
    selectedLoanId !== null ? loans.find((row) => row.id === selectedLoanId) : undefined;
  const selectedStream =
    selectedStreamId !== null
      ? ownedStreams.find((row) => row.streamId === selectedStreamId)
      : undefined;
  const lastSelectedStreamRef = useRef<HydratedStream | undefined>(undefined);
  if (selectedStream) lastSelectedStreamRef.current = selectedStream;

  const matchingOpenLoan =
    selectedStreamId !== null
      ? loans.find(
          (loan) =>
            !loan.closed && loan.outstanding > 0n && loan.streamId === selectedStreamId,
        )
      : undefined;
  const selectedLoan = selectedLoanFromUrl ?? matchingOpenLoan;

  const streamStamp = streams.metadata.dataUpdatedAt ?? 0;
  const borrowerStamp = borrower.metadata.dataUpdatedAt ?? 0;
  const borrowerCaughtUp =
    borrower.status === "ready" && (borrowerStamp >= streamStamp || streamStamp === 0);

  const matchingOpenLoanId = matchingOpenLoan?.id;

  const showWatch = entry === "watch" || entry === "watch-streams-degraded";
  const detailOpen = url.selection.kind !== "none";
  const wallBook =
    resolvedLens === "supplied" ? positionBook : resolvedLens === "borrowed" ? loanBook : streamBook;
  const wallSurface = classifySurfaceState({
    dataStatus:
      wallBook.status === "loading"
        ? "loading"
        : wallBook.status === "unavailable"
          ? "unavailable"
          : wallBook.count === 0
            ? "empty"
            : "ready",
    hasLastKnown:
      Boolean(lenderData) || Boolean(borrowerData) || Boolean(streamData) || wallBook.status !== "loading",
    stale: !lensFreshness.signingAllowed,
    signingAllowed: lensFreshness.signingAllowed,
  });
  const streamBookReady = streamBook.status === "ready" || streamBook.status === "unavailable";
  const showStreamClosed =
    selectedStreamId !== null &&
    !selectedStream &&
    !matchingOpenLoan &&
    streamBookReady &&
    Boolean(streamData || streamBook.status === "ready") &&
    (lastSelectedStreamRef.current === undefined || borrowerCaughtUp);
  const stickyStream =
    !selectedStream && !showStreamClosed && !matchingOpenLoan
      ? lastSelectedStreamRef.current
      : undefined;
  const streamForDetail = selectedStream ?? stickyStream;

  useEffect(() => {
    if (matchingOpenLoanId === undefined || selectedStreamId === null) return;
    writeWatchSearch(
      { lens: "borrowed", selection: { kind: "loan", id: matchingOpenLoanId } },
      "replace",
    );
  }, [matchingOpenLoanId, selectedStreamId]);

  useEffect(() => {
    if (!narrow || !detailOpen) return;
    watchBackRef.current?.focus();
  }, [narrow, detailOpen, url.selection]);

  return (
    <Shell
      currentNav={null}
      wallet={<WalletButton />}
      status={
        <div className="watch-status-row">
          {connected ? (
            <StatusLine
              status={lensFreshness.freshness.kind}
              asOf={asOf}
              usdUnavailable={!usdAvailable}
            />
          ) : (
            <span />
          )}
          <TokenUsdSwitch
            mode={usdMode}
            tokenLabel={tokenLabel}
            usdAvailable={usdAvailable}
            onChange={(mode) => {
              setUsdMode(mode);
              if (account) storageSet(usdModeKey(chainId, account), mode);
            }}
          />
        </div>
      }
      onHome={() => {
        url.goHome();
      }}
    >
      <div className="watch-milestone" aria-live="polite" />
      {entry === "disconnected" ? <DisconnectedEntry /> : null}
      {entry === "syncing" ? (
        <section data-region="entry-syncing" aria-live="polite">
          <p className="watch-kicker">CHECKING…</p>
        </section>
      ) : null}
      {entry === "first-run" ? (
        <RegionErrorBoundary region="first-run">
          <FirstRun />
        </RegionErrorBoundary>
      ) : null}
      {showWatch ? (
        <div className="watch-split" data-region="watch" data-narrow-detail={narrow && detailOpen ? "true" : "false"}>
          {narrow && detailOpen ? (
            <button
              ref={watchBackRef}
              type="button"
              className="watch-back"
              aria-label={`Back to ${resolvedLens}`}
              onClick={() => url.deselect()}
            >
              ←
            </button>
          ) : null}
          <RegionErrorBoundary region="watch-wall">
            <SurfaceState
              state={wallSurface}
              topology="watch"
              onRefresh={
                wallSurface === "STALE"
                  ? () => {
                      void queryClient.invalidateQueries();
                    }
                  : undefined
              }
            />
            <Wall
              tabs={tabs}
              lens={resolvedLens}
              onSelectLens={onSelectLens}
              positions={wallSurface === "LOADING" ? [] : positions}
              loans={wallSurface === "LOADING" ? [] : loans}
              streams={wallSurface === "LOADING" ? [] : ownedStreams}
              panelStatus={wallSurface === "LOADING" ? "loading" : wallSurface === "EMPTY" ? "empty" : "ready"}
              pledgedByStream={pledgedByStream}
              loanStreams={loanStreams}
              nowSeconds={nowSeconds}
              nowMs={nowMs}
              lastReadAt={lastReadAt}
              selection={url.selection}
              onSelect={onSelect}
              streamsDegraded={resolvedLens === "streams" ? streamsDegraded : null}
            />
          </RegionErrorBoundary>
          <RegionErrorBoundary region="watch-detail">
            <div className="watch-detail">
            {selectedPosition ? (
              <SuppliedDetail
                position={selectedPosition}
                symbol={symbolFor(
                  symbols,
                  selectedPositionMarket?.ovrfloToken ?? selectedPosition.market,
                )}
                underlyingSymbol={
                  selectedPositionMarket
                    ? symbolFor(symbols, selectedPositionMarket.underlying)
                    : tokenLabel
                }
                market={selectedPositionMarket}
                lending={lending}
                nowMs={nowMs}
                freshness={lensFreshness.freshness}
                signingAllowed={lensFreshness.signingAllowed}
                usdMode={usdMode}
                usdAvailable={usdAvailable}
                usdText={usdTextFor(positionClaimableSafe(selectedPosition), usdQuote)}
              />
            ) : null}
            {selectedLoan && (selectedLoan.closed || selectedLoan.outstanding === 0n) ? (
              <ClosedLoanDetail
                loan={selectedLoan}
                symbol={tokenLabel}
                freshness={lensFreshness.freshness}
                streamPresent={loanStreams.has(selectedLoan.streamId.toString())}
                onSelectStream={(streamId) => onSelect({ kind: "stream", id: streamId })}
              />
            ) : null}
            {selectedLoan && !selectedLoan.closed && selectedLoan.outstanding > 0n ? (
              <BorrowedDetail
                loan={selectedLoan}
                symbol={
                  markets.markets[0]
                    ? symbolFor(symbols, markets.markets[0].ovrfloToken)
                    : tokenLabel
                }
                underlyingSymbol={tokenLabel}
                market={markets.markets[0] ?? null}
                lending={lending}
                nowSeconds={nowSeconds}
                nowMs={nowMs}
                lastReadAt={lastReadAt}
                schedule={loanStreams.get(selectedLoan.streamId.toString())?.schedule}
                withdrawable={loanStreams.get(selectedLoan.streamId.toString())?.withdrawable}
                freshness={lensFreshness.freshness}
                signingAllowed={lensFreshness.signingAllowed}
                usdMode={usdMode}
                usdAvailable={usdAvailable}
                usdText={usdTextFor(selectedLoan.outstanding, usdQuote)}
                onSelectStream={(streamId) => onSelect({ kind: "stream", id: streamId })}
              />
            ) : null}
            {streamForDetail ? (
              <StreamDetail
                stream={streamForDetail}
                symbol={symbolFor(symbols, streamForDetail.asset)}
                pledgedLoanId={pledgedByStream.get(streamForDetail.streamId.toString())}
                nowSeconds={nowSeconds}
                nowMs={nowMs}
                lastReadAt={lastReadAt}
                freshness={lensFreshness.freshness}
                signingAllowed={lensFreshness.signingAllowed}
                usdMode={usdMode}
                usdAvailable={usdAvailable}
                usdText={usdTextFor(streamForDetail.withdrawable, usdQuote)}
                onSelectLoan={(loanId) => onSelect({ kind: "loan", id: loanId })}
              />
            ) : null}
            {showStreamClosed && selectedStreamId !== null ? (
              <StreamClosedDetail streamId={selectedStreamId} />
            ) : null}
            </div>
          </RegionErrorBoundary>
        </div>
      ) : null}
      <Footer />
    </Shell>
  );
}

function DisconnectedEntry() {
  return (
    <section className="watch-entry" data-ui="UI-WATCH-ENTRY-DISCONNECTED" data-region="entry-disconnected">
      <p className="watch-kicker">ENTRY</p>
      <p>
        Once a wallet is connected, this home becomes the instruments you can watch:
        earnings rolling up, debt rolling down to a known done-date, and streams vesting.
      </p>
      <p>Borrow and Supply launch from here. They do not require a book to start.</p>
    </section>
  );
}

function resolveLens(
  urlLens: WatchLens | null,
  memoryLens: WatchLens | null,
  visible: readonly WatchLens[],
  selection: WatchSelection,
): WatchLens {
  if (urlLens && visible.includes(urlLens)) return urlLens;
  const inferred = inferredLens(selection);
  if (inferred && visible.includes(inferred)) return inferred;
  if (memoryLens && visible.includes(memoryLens)) return memoryLens;
  if (visible.includes("supplied")) return "supplied";
  return visible[0] ?? "supplied";
}

function toBook(outcome: ReadOutcome<unknown>, count: number): EntryBook {
  if (outcome.status === "loading") return { status: "loading", count };
  if (outcome.status === "unavailable") return { status: "unavailable", count };
  return { status: "ready", count };
}

function useLastKnown<T>(outcome: ReadOutcome<T>): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (outcome.status === "ready" || outcome.status === "partial") {
    ref.current = outcome.data;
  }
  if (outcome.status === "unavailable") return ref.current;
  return outcome.data ?? ref.current;
}

function formatStatusTime(freshness: Freshness) {
  if (freshness.asOf === null) return undefined;
  const date = new Date(Number(freshness.asOf) * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
}

function usdTextFor(amount: bigint, usd8: Usd8 | null) {
  if (usd8 === null) return undefined;
  return formatUsd(tokenUsd8(amount, usd8));
}

function positionClaimableSafe(position: { pairs: readonly { claimable: bigint }[] }) {
  return position.pairs.reduce((sum, pair) => sum + pair.claimable, 0n);
}
