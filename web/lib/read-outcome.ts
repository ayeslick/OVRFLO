export type ReadFreshness = "fresh" | "stale";

export type ReadFailureCode =
  | "transport"
  | "subcall"
  | "incomplete"
  | "cancelled"
  | "fragmented"
  | "invalid";

export type ReadFailure = {
  source: string;
  code: ReadFailureCode;
  message: string;
  retryable: boolean;
  index?: number;
  entityId?: string;
};

export const MAX_READ_FAILURES = 32;

export type ReadOutcomeMetadata = {
  scopeKey?: string;
  blockNumber?: bigint;
  blockHash?: `0x${string}`;
  /** Timestamp of the pinned block, when the enumeration stamp carries one. */
  blockTimestamp?: bigint;
  /** TanStack / wagmi success timestamp (ms). Threads into freshness asOf. */
  dataUpdatedAt?: number;
};

type OutcomeBase = {
  failures: readonly ReadFailure[];
  metadata: ReadOutcomeMetadata;
};

export type LoadingReadOutcome<T> = OutcomeBase & {
  status: "loading";
  complete: false;
  data?: T;
};

export type ReadyReadOutcome<T> = OutcomeBase & {
  status: "ready";
  complete: true;
  freshness: ReadFreshness;
  data: T;
};

export type PartialReadOutcome<T> = OutcomeBase & {
  status: "partial";
  complete: false;
  freshness: ReadFreshness;
  data: T;
};

export type UnavailableReadOutcome<T> = OutcomeBase & {
  status: "unavailable";
  complete: false;
  data?: T;
};

export type ReadOutcome<T> =
  | LoadingReadOutcome<T>
  | ReadyReadOutcome<T>
  | PartialReadOutcome<T>
  | UnavailableReadOutcome<T>;

type FailureDetails = {
  retryable?: boolean;
  index?: number;
  entityId?: string | number | bigint;
};

export function readFailure(
  source: string,
  code: ReadFailureCode,
  error: unknown,
  details: FailureDetails = {},
): ReadFailure {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown read failure";
  return {
    source,
    code,
    message,
    retryable: details.retryable ?? code === "transport",
    ...(details.index === undefined ? {} : { index: details.index }),
    ...(details.entityId === undefined ? {} : { entityId: String(details.entityId) }),
  };
}

export function loadingOutcome<T>(
  data?: T,
  metadata: ReadOutcomeMetadata = {},
): LoadingReadOutcome<T> {
  return {
    status: "loading",
    complete: false,
    data,
    failures: [],
    metadata,
  };
}

export function readyOutcome<T>(
  data: T,
  metadata: ReadOutcomeMetadata = {},
  freshness: ReadFreshness = "fresh",
  failures: readonly ReadFailure[] = [],
): ReadyReadOutcome<T> {
  return {
    status: "ready",
    complete: true,
    freshness,
    data,
    failures,
    metadata,
  };
}

export function partialOutcome<T>(
  data: T,
  failures: readonly ReadFailure[],
  metadata: ReadOutcomeMetadata = {},
  freshness: ReadFreshness = "fresh",
): PartialReadOutcome<T> {
  if (failures.length === 0) {
    throw new Error("A partial read outcome requires failure metadata");
  }
  return {
    status: "partial",
    complete: false,
    freshness,
    data,
    failures,
    metadata,
  };
}

export function unavailableOutcome<T>(
  failures: readonly ReadFailure[],
  metadata: ReadOutcomeMetadata = {},
  data?: T,
): UnavailableReadOutcome<T> {
  if (failures.length === 0) {
    throw new Error("An unavailable read outcome requires failure metadata");
  }
  return {
    status: "unavailable",
    complete: false,
    data,
    failures,
    metadata,
  };
}

export function refreshFailureOutcome<T>(
  previous: ReadOutcome<T> | undefined,
  failure: ReadFailure,
): ReadOutcome<T> {
  const appendFailure = (failures: readonly ReadFailure[]) => {
    const latest = failures.at(-1);
    if (
      latest?.source === failure.source &&
      latest.code === failure.code &&
      latest.message === failure.message &&
      latest.retryable === failure.retryable &&
      latest.index === failure.index &&
      latest.entityId === failure.entityId
    ) {
      return failures;
    }
    return [...failures, failure].slice(-MAX_READ_FAILURES);
  };

  if (previous?.status === "ready") {
    const failures = appendFailure(previous.failures);
    if (previous.freshness === "stale" && failures === previous.failures) {
      return previous;
    }
    return readyOutcome(
      previous.data,
      previous.metadata,
      "stale",
      failures,
    );
  }
  if (previous?.status === "partial") {
    const failures = appendFailure(previous.failures);
    if (previous.freshness === "stale" && failures === previous.failures) {
      return previous;
    }
    return partialOutcome(
      previous.data,
      failures,
      previous.metadata,
      "stale",
    );
  }
  if (previous?.status === "loading" && previous.data !== undefined) {
    return partialOutcome(previous.data, [failure], previous.metadata, "stale");
  }
  if (previous?.status === "unavailable") {
    const failures = appendFailure(previous.failures);
    if (failures === previous.failures) return previous;
    return unavailableOutcome(failures, previous.metadata, previous.data);
  }
  return unavailableOutcome([failure], previous?.metadata);
}

export function isFreshReady<T>(
  outcome: ReadOutcome<T>,
): outcome is ReadyReadOutcome<T> & { freshness: "fresh" } {
  return outcome.status === "ready" && outcome.freshness === "fresh";
}
