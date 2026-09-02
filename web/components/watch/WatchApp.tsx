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
import { chainId } from "@/lib/config";
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
import { uniqueLendings } from "@/lib/watch-lendings";
import { sortBorrowedLoans } from "@/lib/watch-rows";
import { streamBookKeys } from "@/lib/query-keys";
import {
  inferredLens,
  selectionMatchesRow,
  writeWatchSearch,
  type WatchSelection,
} from "@/lib/watch-url";
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
  const readyVaults = ovrflos.status === "ready" ? ovrflos.vaults : [];
  const registryComplete = ovrflos.status === "ready" && markets.status !== "loading";
  const lendings = uniqueLendings(markets.markets);

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


  const lastReadAt =
    resolvedLens === "streams" && streams.metadata.blockTimestamp !== undefined
      ? streams.metadata.blockTimestamp
      : (lensFreshness.freshness.asOf ?? nowSeconds);
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
  }

  function onSelect(selection: WatchSelection) {
    writeWatchSearch({ selection }, "push");
  }

  const selectedStreamId = url.selection.kind === "stream" ? url.selection.id : null;
  const selectedPosition =
    url.selection.kind === "position"
      ? positions.find((row) => selectionMatchesRow(url.selection, "position", row))
      : undefined;
  const selectedPositionMarket = selectedPosition
    ? markets.markets.find((row) => row.market.toLowerCase() === selectedPosition.market.toLowerCase()) ??
      null
    : null;
  const selectedLoanFromUrl =
    url.selection.kind === "loan"
      ? loans.find((row) => selectionMatchesRow(url.selection, "loan", row))
      : undefined;
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
  const selectedLoanMarket = selectedLoan
    ? markets.markets.find(
        (row) => row.lending?.toLowerCase() === selectedLoan.lending.toLowerCase(),
      ) ?? null
    : null;
  const matchingOpenLoanId = matchingOpenLoan?.id;
  const matchingOpenLoanLending = matchingOpenLoan?.lending;

  const showWatch = entry === "watch" || entry === "watch-streams-degraded";
  const detailOpen = url.selection.kind !== "none";
  const wallBook =
    resolvedLens === "supplied" ? positionBook : resolvedLens === "borrowed" ? loanBook : streamBook;
  const wallPager =
    resolvedLens === "supplied" ? lender : resolvedLens === "borrowed" ? borrower : streams;
  const wallSurface = classifySurfaceState({
    dataStatus: wallDataStatus(wallBook),
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
    streamBook.complete &&
    streamBookReady &&
    Boolean(streamData || streamBook.status === "ready");
  const stickyStream =
    !selectedStream && !showStreamClosed && !matchingOpenLoan
      ? lastSelectedStreamRef.current
      : undefined;
  const streamForDetail = selectedStream ?? stickyStream;

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
    if (!narrow || !detailOpen) return;
    watchBackRef.current?.focus();
  }, [narrow, detailOpen, url.selection]);

  return (
    <Shell
      currentNav="home"
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
    >
      <div className="watch-milestone" aria-live="polite" />
      {entry === "disconnected" ? <DisconnectedEntry /> : null}
      {entry === "syncing" ? (
        <section data-region="entry-syncing" aria-live="polite">
          <p className="watch-kicker">CHECKING…</p>
        </section>
      ) : null}
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
                      void streams.advancePin();
                      void queryClient.invalidateQueries({
                        predicate: (query) => query.queryKey[0] !== streamBookKeys.all[0],
                      });
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
              pager={{
                hasNextPage: wallPager.hasNextPage,
                isFetchingNextPage: wallPager.isFetchingNextPage,
                fetchNextPage: wallPager.fetchNextPage,
              }}
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
                lending={selectedPosition.lending}
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
                symbol={
                  selectedLoanMarket
                    ? symbolFor(symbols, selectedLoanMarket.ovrfloToken)
                    : tokenLabel
                }
                freshness={lensFreshness.freshness}
                streamPresent={loanStreams.has(selectedLoan.streamId.toString())}
                onSelectStream={(streamId) => onSelect({ kind: "stream", id: streamId })}
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
                pledgedLoanId={pledgedByStream.get(streamForDetail.streamId.toString())?.id}
                nowSeconds={nowSeconds}
                nowMs={nowMs}
                lastReadAt={lastReadAt}
                freshness={lensFreshness.freshness}
                signingAllowed={lensFreshness.signingAllowed}
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
    complete: true,
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

function useLastKnown<T extends { renderCount: number }>(outcome: ReadOutcome<T>): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (outcome.status === "ready" || outcome.status === "partial") {
    ref.current = outcome.data;
  }
  if (outcome.status === "unavailable") {
    // A zero-row book attached to a failure must not erase last-ready rows.
    const incoming =
      outcome.data !== undefined && outcome.data.renderCount > 0 ? outcome.data : undefined;
    const kept = incoming ?? ref.current;
    if (kept !== undefined) ref.current = kept;
    return kept;
  }
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
