import { isAddressEqual, type Address, type PublicClient } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { windowStop } from "@/lib/stream-book";
import {
  partialOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
} from "@/lib/read-outcome";

export const LOANS_OF_PAGE = 64n;
export const LOANS_OF_FOLLOW_CAP = 1_024;

export type LoanShare = {
  loanId: bigint;
  contribution: bigint;
  claimable: bigint;
};

export type LenderPositionRow = {
  id: bigint;
  lending: Address;
  lender: Address;
  market: Address;
  aprBps: number;
  availableLiquidity: bigint;
  intervalStart: bigint;
  intervalEnd: bigint;
  pairs: readonly LoanShare[];
  pairsTruncated: boolean;
};

export type BorrowerLoanRow = {
  id: bigint;
  lending: Address;
  market: Address;
  borrower: Address;
  streamId: bigint;
  obligation: bigint;
  drawn: bigint;
  repaid: bigint;
  closed: boolean;
  outstanding: bigint;
};

export type LenderPage = {
  positions: readonly LenderPositionRow[];
  sourceCount: bigint;
};

export type BorrowerPage = {
  loans: readonly BorrowerLoanRow[];
  sourceCount: bigint;
};

/** Plain market views. Deployless lenses live in streams.ts behind pin-probe. */
export type LendingReadClient = Pick<PublicClient, "readContract">;

export type LendingReadOptions = {
  signal?: AbortSignal;
};

function transportFailure(source: string, error: unknown): ReadFailure {
  return readFailure(source, "transport", error);
}

function abortedFailure(source: string): ReadFailure {
  return readFailure(source, "cancelled", "enumeration aborted", { retryable: true });
}

function truncatedLoansFailure(source: string, id: bigint): ReadFailure {
  return readFailure(source, "incomplete", `loansOf truncated for position ${id.toString()}`, {
    retryable: true,
    entityId: id.toString(),
  });
}

function assertOpen(signal: AbortSignal | undefined, source: string): ReadFailure | null {
  if (signal?.aborted) return abortedFailure(source);
  return null;
}

/**
 * Follow `nextSeq` from 0 until exhaustion. Never reuses a foreign `startSeq`.
 */
export async function paginateLoansOf(
  fetchPage: (
    startSeq: bigint,
  ) => Promise<{ entries: readonly LoanShare[]; nextSeq: bigint }>,
): Promise<{ pairs: LoanShare[]; truncated: boolean }> {
  const pairs: LoanShare[] = [];
  let startSeq = 0n;
  const used = new Set<string>();
  for (;;) {
    const { entries, nextSeq } = await fetchPage(startSeq);
    for (const entry of entries) pairs.push({ ...entry });
    if (nextSeq === 0n) return { pairs, truncated: false };
    const key = nextSeq.toString();
    if (used.has(key)) {
      throw new Error("loansOf nextSeq reused");
    }
    used.add(key);
    startSeq = nextSeq;
    if (used.size > LOANS_OF_FOLLOW_CAP) return { pairs, truncated: true };
  }
}

async function readCount(
  client: LendingReadClient,
  lending: Address,
  account: Address,
  functionName: "lenderPositionCount" | "borrowerLoanCount",
): Promise<{ count: bigint } | { failure: ReadFailure }> {
  try {
    const count = await client.readContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName,
      args: [account],
    });
    return { count };
  } catch (error) {
    return { failure: transportFailure(functionName, error) };
  }
}

export async function loadLenderPage(
  client: LendingReadClient,
  lending: Address,
  account: Address,
  start: bigint,
  stop: bigint,
  options?: LendingReadOptions,
): Promise<ReadOutcome<LenderPage>> {
  const aborted = assertOpen(options?.signal, "loadLenderPage");
  if (aborted) return unavailableOutcome([aborted]);
  const counted = await readCount(client, lending, account, "lenderPositionCount");
  if ("failure" in counted) return unavailableOutcome([counted.failure]);
  const sourceCount = counted.count;
  const windowEnd = windowStop(start, sourceCount);
  const clampedStop = stop < windowEnd ? stop : windowEnd;
  if (start >= clampedStop) {
    return readyOutcome({ positions: [], sourceCount });
  }

  const positions: LenderPositionRow[] = [];
  const failures: ReadFailure[] = [];
  for (let index = start; index < clampedStop; index++) {
    const again = assertOpen(options?.signal, "loadLenderPage");
    if (again) return unavailableOutcome([again], {}, { positions, sourceCount });
    try {
      const id = await client.readContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "lenderPositionAt",
        args: [account, index],
      });
      if (id === 0n) continue;
      const [position, intervalStart, intervalEnd, unfilled] = await client.readContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "positionState",
        args: [id],
      });
      const pairs = await paginateLoansOf(async (startSeq) => {
        const [entries, nextSeq] = await client.readContract({
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "loansOf",
          args: [id, startSeq, LOANS_OF_PAGE],
        });
        return {
          entries: entries.map((entry) => ({
            loanId: entry.loanId,
            contribution: entry.contribution,
            claimable: entry.claimable,
          })),
          nextSeq,
        };
      });
      positions.push({
        id,
        lending,
        lender: position.lender,
        market: position.market,
        aprBps: position.aprBps,
        availableLiquidity: unfilled,
        intervalStart,
        intervalEnd,
        pairs: pairs.pairs,
        pairsTruncated: pairs.truncated,
      });
      if (pairs.truncated) failures.push(truncatedLoansFailure("loadLenderPage", id));
    } catch (error) {
      failures.push(transportFailure("loadLenderPage", error));
      return partialOutcome({ positions, sourceCount }, failures);
    }
  }
  if (failures.length > 0) return partialOutcome({ positions, sourceCount }, failures);
  return readyOutcome({ positions, sourceCount });
}

export async function loadBorrowerPage(
  client: LendingReadClient,
  lending: Address,
  account: Address,
  start: bigint,
  stop: bigint,
  options?: LendingReadOptions,
): Promise<ReadOutcome<BorrowerPage>> {
  const aborted = assertOpen(options?.signal, "loadBorrowerPage");
  if (aborted) return unavailableOutcome([aborted]);
  const counted = await readCount(client, lending, account, "borrowerLoanCount");
  if ("failure" in counted) return unavailableOutcome([counted.failure]);
  const sourceCount = counted.count;
  const windowEnd = windowStop(start, sourceCount);
  const clampedStop = stop < windowEnd ? stop : windowEnd;
  if (start >= clampedStop) {
    return readyOutcome({ loans: [], sourceCount });
  }

  const loans: BorrowerLoanRow[] = [];
  for (let index = start; index < clampedStop; index++) {
    const again = assertOpen(options?.signal, "loadBorrowerPage");
    if (again) return unavailableOutcome([again], {}, { loans, sourceCount });
    try {
      const id = await client.readContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "borrowerLoanAt",
        args: [account, index],
      });
      if (id === 0n) continue;
      const [stored, outstanding] = await client.readContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "loanState",
        args: [id],
      });
      loans.push({
        id,
        lending,
        market: stored.market,
        borrower: stored.borrower,
        streamId: stored.streamId,
        obligation: stored.obligation,
        drawn: stored.drawn,
        repaid: stored.repaid,
        closed: stored.closed,
        outstanding,
      });
    } catch (error) {
      return partialOutcome({ loans, sourceCount }, [transportFailure("loadBorrowerPage", error)]);
    }
  }
  return readyOutcome({ loans, sourceCount });
}

/**
 * Confirm current loan borrower for log-derived candidate ids on one lending.
 * Callers group MarketLogCandidate rows by lending before this call.
 * A Borrowed log that names an old borrower loses to loanState.
 */
export async function hydrateLoanCandidates(
  client: LendingReadClient,
  lending: Address,
  account: Address,
  candidateIds: readonly bigint[],
  options?: LendingReadOptions,
): Promise<ReadOutcome<BorrowerPage>> {
  const unique = uniquePositiveIds(candidateIds);
  const loans: BorrowerLoanRow[] = [];
  const failures: ReadFailure[] = [];
  for (const id of unique) {
    const aborted = assertOpen(options?.signal, "hydrateLoanCandidates");
    if (aborted) return partialOutcome({ loans, sourceCount: BigInt(unique.length) }, [aborted]);
    try {
      const [stored, outstanding] = await client.readContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "loanState",
        args: [id],
      });
      if (!isAddressEqual(stored.borrower, account)) continue;
      loans.push({
        id,
        lending,
        market: stored.market,
        borrower: stored.borrower,
        streamId: stored.streamId,
        obligation: stored.obligation,
        drawn: stored.drawn,
        repaid: stored.repaid,
        closed: stored.closed,
        outstanding,
      });
    } catch (error) {
      failures.push(
        readFailure("hydration", "subcall", error, {
          retryable: true,
          entityId: id.toString(),
        }),
      );
    }
  }
  const page = { loans, sourceCount: BigInt(unique.length) };
  if (failures.length > 0) return partialOutcome(page, failures);
  return readyOutcome(page);
}

/**
 * Confirm current lender for log-derived candidate ids on one lending.
 * Callers group MarketLogCandidate rows by lending before this call.
 * A Supplied log that names an old lender loses to positionState.
 */
export async function hydrateLenderCandidates(
  client: LendingReadClient,
  lending: Address,
  account: Address,
  candidateIds: readonly bigint[],
  options?: LendingReadOptions,
): Promise<ReadOutcome<LenderPage>> {
  const unique = uniquePositiveIds(candidateIds);
  const positions: LenderPositionRow[] = [];
  const failures: ReadFailure[] = [];
  for (const id of unique) {
    const aborted = assertOpen(options?.signal, "hydrateLenderCandidates");
    if (aborted) {
      return partialOutcome({ positions, sourceCount: BigInt(unique.length) }, [aborted]);
    }
    try {
      const [position, intervalStart, intervalEnd, unfilled] = await client.readContract({
        address: lending,
        abi: ovrfloLendingAbi,
        functionName: "positionState",
        args: [id],
      });
      if (!isAddressEqual(position.lender, account)) continue;
      const pairs = await paginateLoansOf(async (startSeq) => {
        const [entries, nextSeq] = await client.readContract({
          address: lending,
          abi: ovrfloLendingAbi,
          functionName: "loansOf",
          args: [id, startSeq, LOANS_OF_PAGE],
        });
        return {
          entries: entries.map((entry) => ({
            loanId: entry.loanId,
            contribution: entry.contribution,
            claimable: entry.claimable,
          })),
          nextSeq,
        };
      });
      positions.push({
        id,
        lending,
        lender: position.lender,
        market: position.market,
        aprBps: position.aprBps,
        availableLiquidity: unfilled,
        intervalStart,
        intervalEnd,
        pairs: pairs.pairs,
        pairsTruncated: pairs.truncated,
      });
      if (pairs.truncated) failures.push(truncatedLoansFailure("hydration", id));
    } catch (error) {
      failures.push(
        readFailure("hydration", "subcall", error, {
          retryable: true,
          entityId: id.toString(),
        }),
      );
    }
  }
  const page = { positions, sourceCount: BigInt(unique.length) };
  if (failures.length > 0) return partialOutcome(page, failures);
  return readyOutcome(page);
}

function uniquePositiveIds(ids: readonly bigint[]): bigint[] {
  const seen = new Map<string, bigint>();
  for (const id of ids) {
    if (id === 0n) continue;
    const key = id.toString();
    if (!seen.has(key)) seen.set(key, id);
  }
  return [...seen.values()];
}

export async function loadFactoryLenderPage(
  client: LendingReadClient,
  lendings: readonly Address[],
  account: Address,
  start: bigint,
  stop: bigint,
  options?: LendingReadOptions,
): Promise<ReadOutcome<LenderPage>> {
  return loadFactoryWindow({
    client,
    lendings,
    account,
    start,
    stop,
    options,
    source: "loadFactoryLenderPage",
    countName: "lenderPositionCount",
    load: loadLenderPage,
    empty: (sourceCount) => ({ positions: [], sourceCount }),
    merge: (pages, sourceCount) => ({
      positions: pages.flatMap((page) => [...page.positions]),
      sourceCount,
    }),
  });
}

export async function loadFactoryBorrowerPage(
  client: LendingReadClient,
  lendings: readonly Address[],
  account: Address,
  start: bigint,
  stop: bigint,
  options?: LendingReadOptions,
): Promise<ReadOutcome<BorrowerPage>> {
  return loadFactoryWindow({
    client,
    lendings,
    account,
    start,
    stop,
    options,
    source: "loadFactoryBorrowerPage",
    countName: "borrowerLoanCount",
    load: loadBorrowerPage,
    empty: (sourceCount) => ({ loans: [], sourceCount }),
    merge: (pages, sourceCount) => ({
      loans: pages.flatMap((page) => [...page.loans]),
      sourceCount,
    }),
  });
}

async function loadFactoryWindow<T extends { sourceCount: bigint }>(input: {
  client: LendingReadClient;
  lendings: readonly Address[];
  account: Address;
  start: bigint;
  stop: bigint;
  options?: LendingReadOptions;
  source: string;
  countName: "lenderPositionCount" | "borrowerLoanCount";
  load: (
    client: LendingReadClient,
    lending: Address,
    account: Address,
    start: bigint,
    stop: bigint,
    options?: LendingReadOptions,
  ) => Promise<ReadOutcome<T>>;
  empty: (sourceCount: bigint) => T;
  merge: (pages: T[], sourceCount: bigint) => T;
}): Promise<ReadOutcome<T>> {
  const aborted = assertOpen(input.options?.signal, input.source);
  if (aborted) return unavailableOutcome([aborted]);
  if (input.lendings.length === 0) {
    return readyOutcome(input.empty(0n));
  }

  const counts: bigint[] = [];
  let total = 0n;
  for (const lending of input.lendings) {
    const again = assertOpen(input.options?.signal, input.source);
    if (again) return unavailableOutcome([again]);
    const counted = await readCount(input.client, lending, input.account, input.countName);
    if ("failure" in counted) return unavailableOutcome([counted.failure]);
    counts.push(counted.count);
    total += counted.count;
  }

  if (input.start >= total) {
    return readyOutcome(input.empty(total));
  }

  const pages: T[] = [];
  const windowFailures: ReadFailure[] = [];
  let cursor = 0n;
  for (const [index, lending] of input.lendings.entries()) {
    const count = counts[index] ?? 0n;
    const localStart = input.start > cursor ? input.start - cursor : 0n;
    const localStop = input.stop > cursor ? input.stop - cursor : 0n;
    const clampedLocalStop = localStop > count ? count : localStop;
    if (localStart < clampedLocalStop) {
      const page = await input.load(
        input.client,
        lending,
        input.account,
        localStart,
        clampedLocalStop,
        input.options,
      );
      if (page.status === "unavailable") {
        return unavailableOutcome(page.failures, {}, page.data);
      }
      if (page.status === "partial") {
        pages.push(page.data);
        windowFailures.push(...page.failures);
      } else if (page.status !== "ready") {
        windowFailures.push(
          readFailure(input.source, "incomplete", "lending window did not resolve"),
        );
      } else {
        pages.push(page.data);
      }
    }
    cursor += count;
  }
  const merged = input.merge(pages, total);
  if (windowFailures.length > 0) {
    return partialOutcome(merged, windowFailures);
  }
  return readyOutcome(merged);
}
