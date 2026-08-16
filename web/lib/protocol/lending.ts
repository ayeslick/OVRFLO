import type { Address, PublicClient } from "viem";
import { ovrfloLendingAbi } from "@/lib/abis";
import { STREAM_PAGE_SIZE } from "@/lib/lending-math";
import { nextPageParam, windowStop } from "@/lib/stream-book";
import {
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
} from "@/lib/read-outcome";

export const LOANS_OF_PAGE = 64n;

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
    if (used.size > 1_024) return { pairs, truncated: true };
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
    } catch (error) {
      return unavailableOutcome([transportFailure("loadLenderPage", error)], {}, {
        positions,
        sourceCount,
      });
    }
  }
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
      return unavailableOutcome([transportFailure("loadBorrowerPage", error)], {}, {
        loans,
        sourceCount,
      });
    }
  }
  return readyOutcome({ loans, sourceCount });
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
      if (page.status !== "ready") {
        return unavailableOutcome([
          readFailure(input.source, "incomplete", "lending window did not resolve"),
        ]);
      }
      pages.push(page.data);
    }
    cursor += count;
  }
  return readyOutcome(input.merge(pages, total));
}

export function lendingNextPageParam(lastPageParam: bigint, sourceCount: bigint): bigint | undefined {
  return nextPageParam(lastPageParam, sourceCount, STREAM_PAGE_SIZE);
}
