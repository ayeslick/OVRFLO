"use client";

import type { Address } from "viem";
import { EntityRow } from "@/components/kit/EntityRow";
import { LensTabs, type LensId, type LensTab } from "@/components/kit/LensTabs";
import { RollingNumber } from "@/components/kit/RollingNumber";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { RestingRequestRow } from "@/lib/protocol/request-book";
import type { BookPager, HydratedStream } from "@/hooks/useStreams";
import { formatAddress, formatTruncatedDecimal } from "@/lib/format";
import type { StreamSchedule } from "@/lib/payoff";
import type { WatchLens } from "@/lib/parse";
import type { CollectionSort, UnderlyingTotal } from "@/lib/portfolio-status";
import {
  compareCollectionRows,
  loanLifecycle,
  supplyLifecycle,
} from "@/lib/portfolio-status";
import { CollectionTotals } from "./PortfolioViews";
import type { EntryBook } from "@/lib/watch-entry";
import { selectionMatchesRow, type WatchSelection } from "@/lib/watch-url";
import {
  borrowedRowState,
  borrowedStateLine,
  displayedOutstanding,
  fraction01,
  loanCoverAt,
  positionClaimable,
  positionFilled,
  streamRowState,
  streamStateLine,
  suppliedMatchState,
  suppliedStateLine,
} from "@/lib/watch-rows";
import "./watch.css";

export type WallTab = LensTab;

export function Wall({
  tabs,
  lens,
  onSelectLens,
  positions,
  loans,
  streams,
  pledgedByStream,
  loanStreams,
  nowSeconds,
  nowMs,
  lastReadAt,
  selection,
  onSelect,
  streamsDegraded,
  panelStatus = "ready",
  pager,
  mode = "lenses",
  collectionType,
  sort = "id",
  onSort,
  retired,
  totals,
  waitingRequests = [],
}: {
  tabs: readonly WallTab[];
  lens: LensId;
  onSelectLens: (id: LensId) => void;
  positions: readonly LenderPositionRow[];
  loans: readonly BorrowerLoanRow[];
  streams: readonly HydratedStream[];
  pledgedByStream: ReadonlyMap<string, { lending: Address; id: bigint }>;
  loanStreams: ReadonlyMap<string, { withdrawable: bigint; schedule: StreamSchedule }>;
  nowSeconds: bigint;
  nowMs: number;
  lastReadAt: bigint;
  selection: WatchSelection;
  onSelect: (selection: WatchSelection) => void;
  streamsDegraded: "pending" | "could-not-ask" | null;
  panelStatus?: "loading" | "empty" | "ready";
  pager?: BookPager;
  mode?: "lenses" | "collection";
  collectionType?: "loan" | "fixed";
  sort?: CollectionSort;
  onSort?: (sort: CollectionSort) => void;
  retired?: ReadonlySet<string>;
  totals?: readonly UnderlyingTotal[];
  waitingRequests?: readonly RestingRequestRow[];
}) {
  const collection = mode === "collection";
  const shownLoans = collection
    ? [...loans].sort((left, right) =>
        compareCollectionRows(
          { id: left.id, status: loanLifecycle(left), amount: left.outstanding },
          { id: right.id, status: loanLifecycle(right), amount: right.outstanding },
          sort,
        ),
      )
    : loans;
  const shownPositions = collection
    ? [...positions].sort((left, right) =>
        compareCollectionRows(
          {
            id: left.id,
            status: supplyLifecycle(left),
            amount: positionFilled(left) + left.availableLiquidity,
          },
          {
            id: right.id,
            status: supplyLifecycle(right),
            amount: positionFilled(right) + right.availableLiquidity,
          },
          sort,
        ),
      )
    : positions;
  const showLoans = collection ? collectionType === "loan" : lens === "borrowed";
  const showPositions = collection ? collectionType === "fixed" : lens === "supplied";
  const showStreams = !collection && lens === "streams";

  return (
    <section
      className="watch-wall"
      data-ui={collection ? "UI-WATCH-COLLECTION" : "UI-WATCH-WALL"}
      data-region="watch-wall"
      data-lens={collection ? collectionType : lens}
    >
      {collection ? (
        <div className="watch-collection-head">
          <h2 tabIndex={-1} data-surface-heading className="watch-kicker kit-surface-heading">
            {collectionType === "loan" ? "Self-Repaying Loans" : "Fixed Returns"} ·{" "}
            {collectionType === "loan" ? loans.length + waitingRequests.length : positions.length}
          </h2>
          {onSort ? (
            <label className="watch-collection-sort">
              Sort
              <select
                value={sort}
                onChange={(event) => onSort(event.target.value as CollectionSort)}
              >
                <option value="id">Identity</option>
                <option value="status">Status</option>
                <option value="amount">Amount</option>
              </select>
            </label>
          ) : null}
          {totals ? <CollectionTotals totals={totals} /> : null}
        </div>
      ) : (
        <>
          <h2 tabIndex={-1} data-surface-heading className="kit-surface-heading kit-vh">
            Your OVRFLO
          </h2>
          <LensTabs tabs={tabs} selected={lens} onSelect={onSelectLens} />
        </>
      )}
      <div
        role={collection ? "list" : "tabpanel"}
        id={collection ? undefined : `lens-panel-${lens}`}
        aria-labelledby={collection ? undefined : `lens-tab-${lens}`}
      >
        {panelStatus === "ready" && showPositions
          ? shownPositions.map((position) => (
              <SuppliedRow
                key={`${position.lending}-${position.id.toString()}`}
                position={position}
                retired={retired?.has(position.lending.toLowerCase()) ?? false}
                selected={selectionMatchesRow(selection, "position", position)}
                onSelect={() =>
                  onSelect({ kind: "position", lending: position.lending, id: position.id })
                }
              />
            ))
          : null}
        {panelStatus === "ready" && showLoans
          ? waitingRequests.map((request) => (
              <WaitingRequestRow
                key={`${request.book}-${request.requestId.toString()}`}
                request={request}
                selected={selection.kind === "stream" && selection.id === request.streamId}
                onSelect={() => onSelect({ kind: "stream", id: request.streamId })}
              />
            ))
          : null}
        {panelStatus === "ready" && showLoans
          ? shownLoans.map((loan) => (
              <BorrowedRow
                key={`${loan.lending}-${loan.id.toString()}`}
                loan={loan}
                retired={retired?.has(loan.lending.toLowerCase()) ?? false}
                truth={loanStreams.get(loan.streamId.toString())}
                nowSeconds={nowSeconds}
                nowMs={nowMs}
                lastReadAt={lastReadAt}
                selected={selectionMatchesRow(selection, "loan", loan)}
                onSelect={() => onSelect({ kind: "loan", lending: loan.lending, id: loan.id })}
              />
            ))
          : null}
        {showStreams && streamsDegraded ? (
          <StreamsDegraded kind={streamsDegraded} />
        ) : null}
        {panelStatus === "ready" && showStreams && (streams.length > 0 || !streamsDegraded)
          ? streams.map((stream) => (
              <StreamRow
                key={stream.streamId.toString()}
                stream={stream}
                pledgedLoanId={pledgedByStream.get(stream.streamId.toString())?.id}
                nowMs={nowMs}
                selected={selection.kind === "stream" && selection.id === stream.streamId}
                onSelect={() => onSelect({ kind: "stream", id: stream.streamId })}
              />
            ))
          : null}
        {!collection && (pager?.hasNextPage || pager?.isFetchingNextPage) ? (
          <LoadMore
            fetching={Boolean(pager.isFetchingNextPage)}
            onLoadMore={() => pager.fetchNextPage()}
          />
        ) : null}
      </div>
    </section>
  );
}

function SuppliedRow({
  position,
  selected,
  onSelect,
  retired = false,
}: {
  position: LenderPositionRow;
  selected: boolean;
  onSelect: () => void;
  retired?: boolean;
}) {
  const filled = positionFilled(position);
  const unfilled = position.availableLiquidity;
  const supplied = filled + unfilled;
  const claimable = positionClaimable(position);
  const match = suppliedMatchState(filled, unfilled);
  const decisive =
    match === "resting" ? (
      formatTruncatedDecimal(unfilled, 18, 5)
    ) : claimable > 0n ? (
      <RollingNumber value={claimable} ticking displayDecimals={6} />
    ) : (
      formatTruncatedDecimal(filled, 18, 5)
    );
  return (
    <EntityRow
      state={match}
      identity={`SUPPLY #${position.id.toString()} · ${formatAddress(position.market)}`}
      stateLine={suppliedStateLine({ match, filled, unfilled, aprBps: position.aprBps })}
      decisive={decisive}
      selected={selected}
      miniband={{ filled: fraction01(filled, supplied) }}
      badge={retired ? "retired market" : match === "resting" ? "Waiting" : undefined}
      onSelect={onSelect}
    />
  );
}

function WaitingRequestRow({
  request,
  selected,
  onSelect,
}: {
  request: RestingRequestRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <EntityRow
      state="resting"
      identity={`WAITING · STREAM #${request.streamId.toString()}`}
      stateLine="Waiting for liquidity"
      decisive={formatTruncatedDecimal(request.targetBorrow, 18, 5)}
      selected={selected}
      badge="Waiting"
      onSelect={onSelect}
    />
  );
}

function BorrowedRow({
  loan,
  truth,
  nowSeconds,
  nowMs,
  lastReadAt,
  selected,
  onSelect,
  retired = false,
}: {
  loan: BorrowerLoanRow;
  truth?: { withdrawable: bigint; schedule: StreamSchedule };
  nowSeconds: bigint;
  nowMs: number;
  lastReadAt: bigint;
  selected: boolean;
  onSelect: () => void;
  retired?: boolean;
}) {
  const state = borrowedRowState({ loan, withdrawable: truth?.withdrawable });
  const coverAt = truth ? loanCoverAt(truth.schedule, loan.outstanding, nowSeconds) : undefined;
  const outstanding = displayedOutstanding({
    schedule: truth?.schedule,
    lastOutstanding: loan.outstanding,
    lastReadAt,
    now: nowSeconds,
    closeReady: state === "close-ready",
  });
  return (
    <EntityRow
      state={state}
      identity={`LOAN #${loan.id.toString()} · ${formatAddress(loan.market)}`}
      stateLine={borrowedStateLine({
        state,
        streamId: loan.streamId,
        coverAt,
        scheduleHydrated: Boolean(truth),
        streamPresent: Boolean(truth),
      })}
      decisive={
        state === "settled" ? (
          "0"
        ) : (
          <RollingNumber
            value={outstanding}
            ticking={state === "repaying"}
            nowMs={nowMs}
            displayDecimals={8}
          />
        )
      }
      badge={retired ? "retired market" : state === "settled" ? "SETTLED" : undefined}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function StreamRow({
  stream,
  pledgedLoanId,
  nowMs,
  selected,
  onSelect,
}: {
  stream: HydratedStream;
  pledgedLoanId?: bigint;
  nowMs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const pledged = pledgedLoanId !== undefined;
  const state = streamRowState(stream, pledged);
  return (
    <EntityRow
      state={state}
      identity={`STREAM #${stream.streamId.toString()}`}
      stateLine={streamStateLine({ state, loanId: pledgedLoanId })}
      decisive={
        <RollingNumber
          schedule={{
            startMs: Number(stream.schedule.start) * 1000,
            endMs: Number(stream.schedule.end) * 1000,
            startAmount: 0n,
            endAmount: stream.schedule.deposited - stream.schedule.refunded,
          }}
          ticking
          nowMs={nowMs}
          displayDecimals={8}
        />
      }
      selected={selected}
      onSelect={onSelect}
    />
  );
}

export function StreamsDegraded({ kind }: { kind: "pending" | "could-not-ask" }) {
  if (kind === "pending") {
    return (
      <div className="watch-degraded" data-ui="UI-WATCH-STREAMS-DEGRADED" data-region="streams-degraded" data-state="pending">
        <p>CHECKING STREAMS…</p>
      </div>
    );
  }
  return (
    <div className="watch-degraded" data-ui="UI-WATCH-STREAMS-DEGRADED" data-region="streams-degraded" data-state="could-not-ask">
      <p>STREAM DISCOVERY IS UNAVAILABLE. YOUR STREAMS ARE UNAFFECTED.</p>
      <p>
        RECOVER WITH YOUR OVRFLOSTREAM ID ON THE BOUND LOCKUP. MARKETS LISTS HELD
        STREAMS VIA ENUMERABLE WHEN READS SUCCEED.
      </p>
    </div>
  );
}

export function visibleLensTabs(args: {
  positions: EntryBook;
  loans: EntryBook;
  streams: EntryBook;
}): WallTab[] {
  return [
    lensTab("supplied", "SUPPLIED", args.positions),
    lensTab("borrowed", "BORROWED", args.loans),
    lensTab("streams", "STREAMS", args.streams),
  ];
}

function lensTab(id: WatchLens, label: string, book: EntryBook): WallTab {
  if (book.status === "loading") {
    return { id, label, visible: true, state: "loading" };
  }
  if (book.status === "unavailable") {
    return { id, label, visible: true, state: "unavailable" };
  }
  if (book.confirmedEmpty) {
    return { id, label, visible: false, state: "ready" };
  }
  return { id, label, visible: true, state: "ready" };
}

function LoadMore({ fetching, onLoadMore }: { fetching: boolean; onLoadMore: () => void }) {
  return (
    <div className="watch-load-more">
      <button
        type="button"
        className="watch-load-more-button"
        data-ui="UI-WATCH-LOAD-MORE"
        disabled={fetching}
        onClick={onLoadMore}
      >
        LOAD MORE
      </button>
      <span className="watch-load-more-live" aria-live="polite">
        {fetching ? "LOADING MORE" : ""}
      </span>
    </div>
  );
}
