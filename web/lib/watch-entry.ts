export type BookStatus = "loading" | "ready" | "unavailable";

export type EntryBook = {
  status: BookStatus;
  count: number;
};

export type EntryInput = {
  connected: boolean;
  positions: EntryBook;
  loans: EntryBook;
  streams: EntryBook;
};

export type EntryKind =
  | "disconnected"
  | "syncing"
  | "first-run"
  | "watch"
  | "watch-streams-degraded";

/**
 * R12 entry gate. First-run only when positions, loans, AND stream discovery
 * are all confirmed-empty. Pending/could-not-ask with zero books is degraded
 * watch, never first-run.
 */
export function classifyEntry(input: EntryInput): EntryKind {
  if (!input.connected) return "disconnected";

  const booksLoading =
    input.positions.status === "loading" || input.loans.status === "loading";
  if (booksLoading) return "syncing";

  const positionsReadyZero = input.positions.status === "ready" && input.positions.count === 0;
  const loansReadyZero = input.loans.status === "ready" && input.loans.count === 0;
  const booksConfirmedEmpty = positionsReadyZero && loansReadyZero;
  const booksHaveItems =
    (input.positions.status === "ready" && input.positions.count > 0) ||
    (input.loans.status === "ready" && input.loans.count > 0);
  const streamsReadyHydrated = input.streams.status === "ready" && input.streams.count > 0;
  const streamsDegraded =
    input.streams.status === "loading" || input.streams.status === "unavailable";

  if (booksHaveItems || streamsReadyHydrated) {
    return streamsDegraded ? "watch-streams-degraded" : "watch";
  }

  if (booksConfirmedEmpty) {
    if (input.streams.status === "ready" && input.streams.count === 0) return "first-run";
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
