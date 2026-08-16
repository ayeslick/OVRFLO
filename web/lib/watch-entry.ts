export type BookStatus = "loading" | "ready" | "unavailable";

export type EntryBook = {
  status: BookStatus;
  sourceCount: bigint;
  renderCount: number;
  complete: boolean;
  confirmedEmpty: boolean;
};

export type EntryInput = {
  connected: boolean;
  positions: EntryBook;
  loans: EntryBook;
  streams: EntryBook;
  /** Factory bootstrap failure — never classify as syncing / CHECKING…. */
  protocolUnavailable?: boolean;
};

export type EntryKind =
  | "disconnected"
  | "syncing"
  | "unavailable"
  | "first-run"
  | "watch"
  | "watch-streams-degraded";

export function emptyEntryBook(status: BookStatus = "ready"): EntryBook {
  return {
    status,
    sourceCount: 0n,
    renderCount: 0,
    complete: status === "ready",
    confirmedEmpty: status === "ready",
  };
}

/** Test and wall helper: one book from status plus loaded row count. */
export function entryBook(status: BookStatus, renderCount: number): EntryBook {
  return {
    status,
    sourceCount: BigInt(renderCount),
    renderCount,
    complete: status === "ready",
    confirmedEmpty: status === "ready" && renderCount === 0,
  };
}

/**
 * R12 entry gate. First-run only when positions, loans, AND stream discovery
 * are all confirmed-empty. Pending/could-not-ask with zero books is degraded
 * watch, never first-run. A failed factory bootstrap is unavailable, never
 * syncing.
 */
export function classifyEntry(input: EntryInput): EntryKind {
  if (!input.connected) return "disconnected";
  if (input.protocolUnavailable) return "unavailable";

  const booksLoading =
    input.positions.status === "loading" || input.loans.status === "loading";
  if (booksLoading) return "syncing";

  const booksConfirmedEmpty = input.positions.confirmedEmpty && input.loans.confirmedEmpty;
  const booksHaveItems =
    (input.positions.status === "ready" && input.positions.renderCount > 0) ||
    (input.loans.status === "ready" && input.loans.renderCount > 0);
  const streamsReadyHydrated = input.streams.status === "ready" && input.streams.renderCount > 0;
  const streamsDegraded =
    input.streams.status === "loading" || input.streams.status === "unavailable";

  if (booksHaveItems || streamsReadyHydrated) {
    return streamsDegraded ? "watch-streams-degraded" : "watch";
  }

  if (booksConfirmedEmpty) {
    if (input.streams.confirmedEmpty) return "first-run";
    if (streamsDegraded) return "watch-streams-degraded";
  }

  if (input.positions.status === "unavailable" || input.loans.status === "unavailable") {
    return streamsDegraded ? "watch-streams-degraded" : "watch";
  }

  return "syncing";
}

export function streamsDegradedKind(
  streams: EntryBook,
): "pending" | "could-not-ask" | null {
  if (streams.status === "loading") return "pending";
  if (streams.status === "unavailable") return "could-not-ask";
  return null;
}
