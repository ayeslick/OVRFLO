"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { WalletButton } from "wallet-runtime";
import { Footer } from "@/components/Footer";
import { RegionErrorBoundary } from "@/components/ModalErrorBoundary";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { SurfaceState } from "@/components/kit/SurfaceState";
import { TokenUsdSwitch, type TokenUsdMode } from "@/components/kit/TokenUsdSwitch";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useBorrowerBook } from "@/hooks/useBorrowerBook";
import { useClockHydrationSafe } from "@/hooks/useClock";
import { sourceFromOutcome, useFreshness } from "@/hooks/useFreshness";
import { useFixedReturnTerms } from "@/hooks/useFixedReturnTerms";
import { useLenderBook } from "@/hooks/useLenderBook";
import { symbolFor, useMarketSymbols } from "@/hooks/useMarketSymbols";
import { useOvrflos } from "@/hooks/useOvrflos";
import { useStreams, type BookPager, type HydratedStream } from "@/hooks/useStreams";
import { useUsdPrice } from "@/hooks/useUsdPrice";
import { chainId } from "@/lib/config";
import { getDisclosure, subscribeDisclosure } from "@/lib/disclosure";
import { formatUsd } from "@/lib/format";
import type { Freshness } from "@/lib/freshness";
import { parseUsdMode, parseWatchLens, type PortfolioType, type WatchLens } from "@/lib/parse";
import {
  applyPortfolioSearch,
  classifyPortfolio,
  type PortfolioHydration,
} from "@/lib/portfolio-matrix";
import { groupTotalsByUnderlying, type CollectionSort } from "@/lib/portfolio-status";
import type { ReadOutcome } from "@/lib/read-outcome";
import { queryClient } from "@/lib/query-client";
import { classifySurfaceState } from "@/lib/surface-state";
import { lensKey, storageGet, storageSet, usdModeKey } from "@/lib/storage";
import { tokenUsd8 } from "@/lib/usd";
import type { Usd8 } from "@/lib/units";
import { classifyEntry, streamsDegradedKind, type EntryBook } from "@/lib/watch-entry";
import {
  isRetiredLending,
  marketForLending,
  retiredLendingSet,
  uniqueLendings,
} from "@/lib/watch-lendings";
import { positionFilled, sortBorrowedLoans } from "@/lib/watch-rows";
import { streamBookKeys } from "@/lib/query-keys";
import {
  inferredLens,
  selectionMatchesRow,
  writeWatchSearch,
  type WatchSelection,
} from "@/lib/watch-url";
import { BorrowedDetail } from "./BorrowedDetail";
import { ClosedLoanDetail } from "./ClosedLoanDetail";
import {
  PortfolioEmpty,
  PortfolioHub,
  PortfolioIncomplete,
} from "./PortfolioViews";
import { StreamClosedDetail, StreamDetail } from "./StreamDetail";
import { SuppliedDetail } from "./SuppliedDetail";
import { useLoanStreams } from "./useLoanStreams";
import { useNarrowViewport } from "./useNarrowViewport";
import { useWatchUrl } from "./useWatchUrl";
import { StreamsDegraded, visibleLensTabs, Wall } from "./Wall";
import "./watch.css";

export function WatchApp() {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const connected = connection.status === "connected" && Boolean(account);
  const clock = useClockHydrationSafe();
  const nowSeconds = clock?.adjustedNow ?? 0n;
  const nowMs = clock ? Number(clock.adjustedNow) * 1000 : Date.now();
  const watchBackRef = useRef<HTMLButtonElement>(null);
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);
  const isAdvanced = disclosure === "advanced";
  const [sort, setSort] = useState<CollectionSort>("id");

  const ovrflos = useOvrflos();
  const markets = useAllMarkets();
  const symbols = useMarketSymbols(markets.markets);
  const readyVaults = ovrflos.status === "ready" ? ovrflos.vaults : [];
  const registryComplete = ovrflos.status === "ready" && markets.status !== "loading";
  const lendings = uniqueLendings(markets.markets);
  const retired = useMemo(() => retiredLendingSet(markets.markets), [markets.markets]);

  const lender = useLenderBook(lendings, account, { enabled: registryComplete });
  const borrower = useBorrowerBook(lendings, account, { enabled: registryComplete });
  const streams = useStreams({
    account,
    vaults: readyVaults,
    markets: markets.markets,
    registryComplete,
    now: nowSeconds,
    stream: ovrflos.status === "ready" ? ovrflos.stream : undefined,
  });

  useDrainPager(connected && registryComplete, lender);
  useDrainPager(connected && registryComplete, borrower);
  useDrainPager(connected && registryComplete, streams);

  const lenderData = useLastKnown(lender, account);
  const borrowerData = useLastKnown(borrower, account);
  const streamData = useLastKnown(streams, account);

  const positions = lenderData?.positions ?? [];
  const loans = sortBorrowedLoans(borrowerData?.loans ?? []);
  const ownedStreams = streamData?.streams ?? [];

  const streamIds = useMemo(
    () => loans.map((loan) => loan.streamId),
    [loans],
  );
  const loanStreams = useLoanStreams(streamIds);

  const pledgedByStream = useMemo(() => {
    const map = new Map<string, { lending: typeof loans[number]["lending"]; id: bigint }>();
    for (const loan of loans) {
      if (!loan.closed && loan.outstanding > 0n) {
        map.set(loan.streamId.toString(), { lending: loan.lending, id: loan.id });
      }
    }
    return map;
  }, [loans]);

  const positionBook = toBook(lender);
  const loanBook = toBook(borrower);
  const streamBook = toBook(streams);
  const entry = classifyEntry({
    connected,
    positions: positionBook,
    loans: loanBook,
    streams: streamBook,
    protocolUnavailable:
      ovrflos.status === "unavailable" || markets.status === "unavailable",
  });
  const streamsDegraded = streamsDegradedKind(streamBook);
  const booksComplete = positionBook.complete && loanBook.complete;
  const streamsComplete =
    streamBook.complete && streamBook.status !== "loading" && streamBook.status !== "unavailable";
  const portfolioComplete = connected && registryComplete && booksComplete && streamsComplete;

  const usd = useUsdPrice();
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
  const hydration = useMemo<PortfolioHydration>(
    () => ({
      complete: portfolioComplete,
      loans: loans.map((row) => ({ lending: row.lending, id: row.id })),
      positions: positions.map((row) => ({ lending: row.lending, id: row.id })),
    }),
    [portfolioComplete, loans, positions],
  );
  const surface = classifyPortfolio(hydration, url);

  const lensFreshness =
    resolvedLens === "streams"
      ? streamsFreshness
      : resolvedLens === "borrowed"
        ? borrowedFreshness
        : suppliedFreshness;
  const surfaceFreshness =
    url.selection.kind === "stream"
      ? streamsFreshness
      : surface.kind === "detail" && surface.selection.kind === "loan"
        ? borrowedFreshness
        : surface.kind === "collection" && surface.type === "loan"
          ? borrowedFreshness
          : surface.kind === "detail" && surface.selection.kind === "position"
            ? suppliedFreshness
            : surface.kind === "collection" && surface.type === "fixed"
              ? suppliedFreshness
              : lensFreshness;

  const lastReadAt =
    resolvedLens === "streams" && streams.metadata.blockTimestamp !== undefined
      ? streams.metadata.blockTimestamp
      : (surfaceFreshness.freshness.asOf ?? nowSeconds);
  const usdQuote: Usd8 | null =
    usd.status === "ready" && usd.data.status === "available" ? usd.data.usd8 : null;
  const usdAvailable = usdQuote !== null;
  const tokenLabel = markets.markets[0]
    ? symbolFor(symbols, markets.markets[0].underlying)
    : "TOKEN";
  const asOf = formatStatusTime(surfaceFreshness.freshness);

  function onSelectLens(id: WatchLens) {
    if (account) storageSet(lensKey(chainId, account), id);
    setMemoryLens(id);
  }

  function onSelect(selection: WatchSelection) {
    writeWatchSearch({ selection }, "push");
  }

  function onOpenCollection(type: PortfolioType) {
    writeWatchSearch({ type, selection: { kind: "none" } }, "push");
  }

  const selectedStreamId = url.selection.kind === "stream" ? url.selection.id : null;
  const selectedPosition =
    url.selection.kind === "position"
      ? positions.find((row) => selectionMatchesRow(url.selection, "position", row))
      : undefined;
  const selectedPositionMarket = selectedPosition
    ? marketForLending(markets.markets, selectedPosition.lending, selectedPosition.market)
    : null;
  const lockup = ovrflos.status === "ready" ? ovrflos.stream : null;
  const loanTerms = useFixedReturnTerms(
    selectedPosition?.lending ?? null,
    lockup,
    selectedPosition?.pairs ?? [],
  );
  const selectedLoanFromUrl =
    url.selection.kind === "loan"
      ? loans.find((row) => selectionMatchesRow(url.selection, "loan", row))
      : undefined;
  const selectedStream =
    selectedStreamId !== null
      ? ownedStreams.find((row) => row.streamId === selectedStreamId)
      : undefined;
  const lastSelectedStreamRef = useRef<HydratedStream | undefined>(undefined);
  const lastStreamAccountRef = useRef(account?.toLowerCase() ?? "");
  const accountKey = account?.toLowerCase() ?? "";
  if (lastStreamAccountRef.current !== accountKey) {
    lastStreamAccountRef.current = accountKey;
    lastSelectedStreamRef.current = undefined;
  }
  if (selectedStream) lastSelectedStreamRef.current = selectedStream;

  const matchingOpenLoan =
    selectedStreamId !== null
      ? loans.find(
          (loan) =>
            !loan.closed && loan.outstanding > 0n && loan.streamId === selectedStreamId,
        )
      : undefined;
  const selectedLoan = selectedLoanFromUrl ?? matchingOpenLoan;
  const selectedLoanMarket = selectedLoan
    ? marketForLending(markets.markets, selectedLoan.lending, selectedLoan.market)
    : null;
  const matchingOpenLoanId = matchingOpenLoan?.id;
  const matchingOpenLoanLending = matchingOpenLoan?.lending;

  const wallBook =
    resolvedLens === "supplied" ? positionBook : resolvedLens === "borrowed" ? loanBook : streamBook;
  const wallPager =
    resolvedLens === "supplied" ? lender : resolvedLens === "borrowed" ? borrower : streams;
  const wallSurface = classifySurfaceState({
    dataStatus: wallDataStatus(wallBook),
    hasLastKnown:
      Boolean(lenderData) || Boolean(borrowerData) || Boolean(streamData) || wallBook.status !== "loading",
    stale: !surfaceFreshness.signingAllowed,
    signingAllowed: surfaceFreshness.signingAllowed,
  });
  const streamBookReady = streamBook.status === "ready" || streamBook.status === "unavailable";
  const showStreamClosed =
    selectedStreamId !== null &&
    !selectedStream &&
    !matchingOpenLoan &&
    streamBook.complete &&
    streamBookReady &&
    Boolean(streamData || streamBook.status === "ready");
  const stickyStream =
    !selectedStream && !showStreamClosed && !matchingOpenLoan
      ? lastSelectedStreamRef.current
      : undefined;
  const streamForDetail = selectedStream ?? stickyStream;
  const streamSelected = url.selection.kind === "stream";
  const detailOpen =
    url.selection.kind !== "none" ||
    surface.kind === "detail" ||
    Boolean(selectedLoan) ||
    Boolean(selectedPosition) ||
    Boolean(streamForDetail) ||
    showStreamClosed;
  const canLeaveDetail = isAdvanced || loans.length + positions.length > 1;

  useEffect(() => {
    if (!connected) return;
    const applied = applyPortfolioSearch(hydration, url);
    if (applied.action === "skip") return;
    writeWatchSearch({ type: applied.type, selection: applied.selection }, "replace");
  }, [connected, hydration, url]);

  useEffect(() => {
    if (matchingOpenLoanId === undefined || !matchingOpenLoanLending || selectedStreamId === null) {
      return;
    }
    writeWatchSearch(
      {
        selection: { kind: "loan", lending: matchingOpenLoanLending, id: matchingOpenLoanId },
      },
      "replace",
    );
  }, [matchingOpenLoanId, matchingOpenLoanLending, selectedStreamId]);

  useEffect(() => {
    if (!narrow || !detailOpen || !canLeaveDetail) return;
    watchBackRef.current?.focus();
  }, [narrow, detailOpen, canLeaveDetail, url.selection]);

  const loanTotals = groupTotalsByUnderlying(
    loans.map((loan) => {
      const market = marketForLending(markets.markets, loan.lending, loan.market);
      return {
        underlying: market?.underlying ?? loan.market,
        symbol: market ? symbolFor(symbols, market.underlying) : tokenLabel,
        amount: loan.outstanding,
      };
    }),
  );
  const supplyTotals = groupTotalsByUnderlying(
    positions.map((position) => {
      const market = marketForLending(markets.markets, position.lending, position.market);
      return {
        underlying: market?.underlying ?? position.market,
        symbol: market ? symbolFor(symbols, market.underlying) : tokenLabel,
        amount: positionFilled(position) + position.availableLiquidity,
      };
    }),
  );

  const details = (
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
          lending={selectedPosition.lending}
          nowMs={nowMs}
          freshness={surfaceFreshness.freshness}
          signingAllowed={surfaceFreshness.signingAllowed}
          usdMode={usdMode}
          usdAvailable={usdAvailable}
          usdText={usdTextFor(positionClaimableSafe(selectedPosition), usdQuote)}
          retired={isRetiredLending(markets.markets, selectedPosition.lending)}
          loanTerms={loanTerms}
        />
      ) : null}
      {selectedLoan && (selectedLoan.closed || selectedLoan.outstanding === 0n) ? (
        <ClosedLoanDetail
          loan={selectedLoan}
          symbol={
            selectedLoanMarket
              ? symbolFor(symbols, selectedLoanMarket.ovrfloToken)
              : tokenLabel
          }
          freshness={surfaceFreshness.freshness}
          streamPresent={loanStreams.has(selectedLoan.streamId.toString())}
          onSelectStream={(streamId) => onSelect({ kind: "stream", id: streamId })}
          retired={isRetiredLending(markets.markets, selectedLoan.lending)}
        />
      ) : null}
      {selectedLoan && !selectedLoan.closed && selectedLoan.outstanding > 0n ? (
        <BorrowedDetail
          loan={selectedLoan}
          symbol={
            selectedLoanMarket
              ? symbolFor(symbols, selectedLoanMarket.ovrfloToken)
              : tokenLabel
          }
          underlyingSymbol={
            selectedLoanMarket
              ? symbolFor(symbols, selectedLoanMarket.underlying)
              : tokenLabel
          }
          market={selectedLoanMarket}
          lending={selectedLoan.lending}
          nowSeconds={nowSeconds}
          nowMs={nowMs}
          lastReadAt={lastReadAt}
          schedule={loanStreams.get(selectedLoan.streamId.toString())?.schedule}
          withdrawable={loanStreams.get(selectedLoan.streamId.toString())?.withdrawable}
          freshness={surfaceFreshness.freshness}
          signingAllowed={surfaceFreshness.signingAllowed}
          usdMode={usdMode}
          usdAvailable={usdAvailable}
          usdText={usdTextFor(selectedLoan.outstanding, usdQuote)}
          onSelectStream={(streamId) => onSelect({ kind: "stream", id: streamId })}
          retired={isRetiredLending(markets.markets, selectedLoan.lending)}
        />
      ) : null}
      {streamForDetail ? (
        <StreamDetail
          stream={streamForDetail}
          symbol={symbolFor(symbols, streamForDetail.asset)}
          pledgedLoanId={pledgedByStream.get(streamForDetail.streamId.toString())?.id}
          nowSeconds={nowSeconds}
          nowMs={nowMs}
          lastReadAt={lastReadAt}
          freshness={surfaceFreshness.freshness}
          signingAllowed={surfaceFreshness.signingAllowed}
          usdMode={usdMode}
          usdAvailable={usdAvailable}
          usdText={usdTextFor(streamForDetail.withdrawable, usdQuote)}
          onSelectLoan={(loanId) => {
            const pledged = pledgedByStream.get(streamForDetail.streamId.toString());
            if (pledged) onSelect({ kind: "loan", lending: pledged.lending, id: pledged.id });
            else {
              const loan = loans.find((row) => row.id === loanId);
              if (loan) onSelect({ kind: "loan", lending: loan.lending, id: loan.id });
            }
          }}
        />
      ) : null}
      {showStreamClosed && selectedStreamId !== null ? (
        <StreamClosedDetail streamId={selectedStreamId} />
      ) : null}
    </div>
  );

  const wall = (
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
      pager={{
        hasNextPage: wallPager.hasNextPage,
        isFetchingNextPage: wallPager.isFetchingNextPage,
        fetchNextPage: wallPager.fetchNextPage,
      }}
      retired={retired}
    />
  );

  const collectionWall = (type: PortfolioType) => (
    <Wall
      tabs={tabs}
      lens={type === "loan" ? "borrowed" : "supplied"}
      onSelectLens={onSelectLens}
      positions={positions}
      loans={loans}
      streams={ownedStreams}
      panelStatus="ready"
      pledgedByStream={pledgedByStream}
      loanStreams={loanStreams}
      nowSeconds={nowSeconds}
      nowMs={nowMs}
      lastReadAt={lastReadAt}
      selection={url.selection}
      onSelect={onSelect}
      streamsDegraded={null}
      mode="collection"
      collectionType={type}
      sort={sort}
      onSort={setSort}
      retired={retired}
      totals={type === "loan" ? loanTotals : supplyTotals}
    />
  );

  const confirmedCards = (
    <>
      {loans.length > 0 ? collectionWall("loan") : null}
      {positions.length > 0 ? collectionWall("fixed") : null}
    </>
  );

  const defaultBody = !portfolioComplete ? (
    <PortfolioIncomplete
      streamsDegraded={streamsDegraded ? <StreamsDegraded kind={streamsDegraded} /> : null}
    >
      {confirmedCards}
    </PortfolioIncomplete>
  ) : streamSelected || surface.kind === "detail" ? (
    details
  ) : surface.kind === "empty" ? (
    <PortfolioEmpty />
  ) : surface.kind === "hub" ? (
    <PortfolioHub
      loanCount={loans.length}
      fixedCount={positions.length}
      onOpenCollection={onOpenCollection}
    />
  ) : surface.kind === "collection" ? (
    collectionWall(surface.type)
  ) : (
    details
  );

  const defaultSurfaceState =
    surface.kind === "empty" || surface.kind === "hub"
      ? wallSurface === "STALE"
        ? "STALE"
        : "READY"
      : wallSurface;

  const showWatchSplit = connected && isAdvanced && entry !== "unavailable";
  const showDefault = connected && !isAdvanced && entry !== "unavailable";
  const showBack =
    narrow &&
    detailOpen &&
    canLeaveDetail &&
    (showWatchSplit || (showDefault && (surface.kind === "detail" || streamSelected)));

  return (
    <Shell
      currentNav="home"
      wallet={<WalletButton />}
      status={
        <div className="watch-status-row">
          {connected ? (
            <StatusLine
              status={surfaceFreshness.freshness.kind}
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
    >
      <div className="watch-milestone" aria-live="polite" />
      {entry === "disconnected" ? <DisconnectedEntry /> : null}
      {entry === "unavailable" ? (
        <section data-region="entry-unavailable" aria-live="polite">
          <SurfaceState state="ERROR" topology="watch" />
          <p className="watch-kicker">PROTOCOL UNAVAILABLE</p>
          <p className="watch-note">
            {ovrflos.error?.message ??
              markets.error?.message ??
              "Factory bootstrap failed"}
          </p>
        </section>
      ) : null}
      {showDefault ? (
        <div
          className={surface.kind === "detail" || streamSelected ? "watch-split" : "watch-portfolio"}
          data-region="watch"
          data-narrow-detail={narrow && detailOpen && canLeaveDetail ? "true" : "false"}
        >
          {showBack ? (
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
              state={defaultSurfaceState}
              topology="watch"
              onRefresh={
                defaultSurfaceState === "STALE"
                  ? () => {
                      void streams.advancePin();
                      void queryClient.invalidateQueries({
                        predicate: (query) => query.queryKey[0] !== streamBookKeys.all[0],
                      });
                    }
                  : undefined
              }
            />
            {defaultBody}
          </RegionErrorBoundary>
        </div>
      ) : null}
      {showWatchSplit ? (
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
                      void streams.advancePin();
                      void queryClient.invalidateQueries({
                        predicate: (query) => query.queryKey[0] !== streamBookKeys.all[0],
                      });
                    }
                  : undefined
              }
            />
            {wall}
          </RegionErrorBoundary>
          <RegionErrorBoundary region="watch-detail">{details}</RegionErrorBoundary>
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
        Once a wallet is connected, this home becomes Your OVRFLO: positions
        you can watch.
      </p>
      <p>Create launches Self-Repaying Loans and Fixed Returns from here. They do not require a book to start.</p>
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

function toBook(
  outcome: ReadOutcome<{
    sourceCount: bigint;
    renderCount: number;
    complete: boolean;
    confirmedEmpty: boolean;
  }>,
): EntryBook {
  const sourceCount = outcome.data?.sourceCount ?? 0n;
  const renderCount = outcome.data?.renderCount ?? 0;
  if (outcome.status === "loading") {
    return {
      status: "loading",
      sourceCount,
      renderCount,
      complete: false,
      confirmedEmpty: false,
    };
  }
  if (outcome.status === "unavailable") {
    return {
      status: "unavailable",
      sourceCount,
      renderCount,
      complete: false,
      confirmedEmpty: false,
    };
  }
  if (outcome.status === "partial") {
    return {
      status: "ready",
      sourceCount,
      renderCount,
      complete: false,
      confirmedEmpty: false,
    };
  }
  return {
    status: "ready",
    sourceCount,
    renderCount,
    complete: Boolean(outcome.data?.complete),
    confirmedEmpty: Boolean(outcome.data?.confirmedEmpty),
  };
}

function wallDataStatus(book: EntryBook): "loading" | "empty" | "ready" | "unavailable" {
  if (book.status === "unavailable") return "unavailable";
  if (book.confirmedEmpty) return "empty";
  if (book.renderCount === 0 && !book.complete) return "loading";
  if (book.status === "loading") return "loading";
  return "ready";
}

function useLastKnown<T extends { renderCount: number }>(
  outcome: ReadOutcome<T>,
  account: Address | undefined,
): T | undefined {
  const accountKey = account?.toLowerCase() ?? "";
  const ref = useRef<{ account: string; data: T } | undefined>(undefined);
  if (ref.current !== undefined && ref.current.account !== accountKey) {
    ref.current = undefined;
  }
  if (outcome.status === "ready" || outcome.status === "partial") {
    if (outcome.data !== undefined) {
      ref.current = { account: accountKey, data: outcome.data };
    }
  }
  if (outcome.status === "unavailable") {
    const incoming =
      outcome.data !== undefined && outcome.data.renderCount > 0 ? outcome.data : undefined;
    const kept = incoming ?? ref.current?.data;
    if (kept !== undefined) ref.current = { account: accountKey, data: kept };
    return kept;
  }
  return outcome.data ?? ref.current?.data;
}

function useDrainPager(enabled: boolean, pager: BookPager) {
  const fetchRef = useRef(pager.fetchNextPage);
  fetchRef.current = pager.fetchNextPage;
  useEffect(() => {
    if (!enabled || !pager.hasNextPage || pager.isFetchingNextPage) return;
    fetchRef.current();
  }, [enabled, pager.hasNextPage, pager.isFetchingNextPage]);
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
