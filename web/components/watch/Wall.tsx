"use client";

import type { Address } from "viem";
import { EntityRow } from "@/components/kit/EntityRow";
import { LensTabs, type LensId, type LensTab } from "@/components/kit/LensTabs";
import { RollingNumber } from "@/components/kit/RollingNumber";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { BookPager, HydratedStream } from "@/hooks/useStreams";
import { formatAddress, formatTruncatedDecimal } from "@/lib/format";
import type { StreamSchedule } from "@/lib/payoff";
import type { WatchLens } from "@/lib/parse";
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
}) {
  return (
    <section className="watch-wall" data-ui="UI-WATCH-WALL" data-region="watch-wall" data-lens={lens}>
      <LensTabs tabs={tabs} selected={lens} onSelect={onSelectLens} />
      <div role="tabpanel" id={`lens-panel-${lens}`} aria-labelledby={`lens-tab-${lens}`}>
        {panelStatus === "ready" && lens === "supplied"
          ? positions.map((position) => (
              <SuppliedRow
                key={`${position.lending}-${position.id.toString()}`}
                position={position}
                selected={selectionMatchesRow(selection, "position", position)}
                onSelect={() =>
                  onSelect({ kind: "position", lending: position.lending, id: position.id })
                }
              />
            ))
          : null}
        {panelStatus === "ready" && lens === "borrowed"
          ? loans.map((loan) => (
              <BorrowedRow
                key={`${loan.lending}-${loan.id.toString()}`}
                loan={loan}
                truth={loanStreams.get(loan.streamId.toString())}
                nowSeconds={nowSeconds}
                nowMs={nowMs}
                lastReadAt={lastReadAt}
                selected={selectionMatchesRow(selection, "loan", loan)}
                onSelect={() => onSelect({ kind: "loan", lending: loan.lending, id: loan.id })}
              />
            ))
          : null}
        {lens === "streams" && streamsDegraded ? (
          <StreamsDegraded kind={streamsDegraded} />
        ) : null}
        {panelStatus === "ready" && lens === "streams" && (streams.length > 0 || !streamsDegraded)
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
        {pager?.hasNextPage || pager?.isFetchingNextPage ? (
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
}: {
  position: LenderPositionRow;
  selected: boolean;
  onSelect: () => void;
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
}: {
  loan: BorrowerLoanRow;
  truth?: { withdrawable: bigint; schedule: StreamSchedule };
  nowSeconds: bigint;
  nowMs: number;
  lastReadAt: bigint;
  selected: boolean;
  onSelect: () => void;
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
      badge={state === "settled" ? "SETTLED" : undefined}
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
