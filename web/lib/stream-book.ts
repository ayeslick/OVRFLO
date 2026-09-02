import { STREAM_PAGE_SIZE } from "@/lib/lending-math";
import {
  partialOutcome,
  readFailure,
  readyOutcome,
  type ReadFailure,
  type ReadFreshness,
  type ReadOutcome,
  type ReadOutcomeMetadata,
} from "@/lib/read-outcome";

/** Sequential auto-fetch on all-ineligible pages, then LOAD MORE. */
export const AUTO_INELIGIBLE_PAGE_CAP = 4;

export type BookFields = {
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  confirmedEmpty: boolean;
};

export function windowStop(start: bigint, sourceCount: bigint, pageSize: bigint = STREAM_PAGE_SIZE): bigint {
  const stop = start + pageSize;
  return stop > sourceCount ? sourceCount : stop;
}

/**
 * Source-coordinate cursor. Advances by the window inspected, even when the
 * window produced zero render-eligible rows.
 */
export function nextPageParam(
  lastPageParam: bigint,
  sourceCount: bigint,
  pageSize: bigint = STREAM_PAGE_SIZE,
): bigint | undefined {
  if (sourceCount === 0n) return undefined;
  const next = lastPageParam + pageSize;
  return next < sourceCount ? next : undefined;
}

export function duplicateStreamFailure(streamId: bigint): ReadFailure {
  return readFailure(
    "stream-book",
    "incomplete",
    `duplicate stream id ${streamId.toString()} in one snapshot`,
    { retryable: false, entityId: streamId.toString() },
  );
}

export function unreadBookFailure(source: string): ReadFailure {
  return readFailure(source, "incomplete", "book has unread pages", { retryable: true });
}

/**
 * Outer ready means the book is complete. An incomplete book is partial.
 * Ready plus inner complete:false cannot be constructed here.
 */
export function presentBook<T extends BookFields>(
  book: T,
  failures: readonly ReadFailure[],
  metadata: ReadOutcomeMetadata = {},
  freshness: ReadFreshness = "fresh",
): ReadOutcome<T> {
  if (book.complete) {
    return readyOutcome(book, metadata, freshness);
  }
  const listed = failures.length > 0 ? failures : [unreadBookFailure("book")];
  return partialOutcome(book, listed, metadata, freshness);
}

/**
 * Walk pages in source order. A second occurrence of an id is an invariant
 * miss — the function keeps the full list, including the duplicate, and does
 * not unique with a Set.
 */
export function foldStreamIds(
  pages: readonly { streams: readonly { streamId: bigint }[] }[],
): { ids: bigint[]; duplicate: bigint | null } {
  const ids: bigint[] = [];
  let duplicate: bigint | null = null;
  for (const page of pages) {
    for (const row of page.streams) {
      if (duplicate === null) {
        for (const seen of ids) {
          if (seen === row.streamId) {
            duplicate = row.streamId;
            break;
          }
        }
      }
      ids.push(row.streamId);
    }
  }
  return { ids, duplicate };
}

export function bookFields(input: {
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  unresolvedFailures: boolean;
}): BookFields {
  const confirmedEmpty =
    !input.unresolvedFailures &&
    (input.sourceCount === 0n || (input.complete && input.renderCount === 0));
  return {
    sourceCount: input.sourceCount,
    renderCount: input.renderCount,
    complete: input.complete,
    confirmedEmpty,
  };
}
