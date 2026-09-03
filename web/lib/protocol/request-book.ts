import { isAddressEqual, type Address, type PublicClient } from "viem";
import { ovrfloFactoryAbi, ovrfloLendingAbi, ovrfloRequestBookAbi } from "@/lib/abis";
import { ZERO_ADDRESS } from "@/lib/config";
import { STREAM_PAGE_SIZE } from "@/lib/lending-math";
import {
  partialOutcome,
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
} from "@/lib/read-outcome";
import { nextPageParam, windowStop } from "@/lib/stream-book";
import { callPin, type BlockPin, type PinMode } from "./pin";

export type RequestBookReadClient = Pick<PublicClient, "readContract" | "getCode">;

export type RestingRequestRow = {
  requestId: bigint;
  book: Address;
  lending: Address;
  borrower: Address;
  market: Address;
  aprBps: number;
  targetBorrow: bigint;
  minAcceptable: bigint;
  streamId: bigint;
};

export type RequestBookPage = {
  requests: readonly RestingRequestRow[];
  sourceCount: bigint;
};

export type RequestBookReadOptions = {
  signal?: AbortSignal;
  pin?: BlockPin;
  pinMode?: PinMode;
};

function transportFailure(source: string, error: unknown): ReadFailure {
  return readFailure(source, "transport", error);
}

function abortedFailure(source: string): ReadFailure {
  return readFailure(source, "cancelled", "enumeration aborted", { retryable: true });
}

function pinned(options?: RequestBookReadOptions) {
  return options?.pin ? callPin(options.pin, options.pinMode ?? "hash") : {};
}

function decodeRequestRow(row: unknown): {
  borrower: Address;
  market: Address;
  aprBps: number;
  targetBorrow: bigint;
  minAcceptable: bigint;
  streamId: bigint;
} {
  if (Array.isArray(row)) {
    return {
      borrower: row[0] as Address,
      market: row[1] as Address,
      aprBps: Number(row[2]),
      targetBorrow: row[3] as bigint,
      minAcceptable: row[4] as bigint,
      streamId: row[5] as bigint,
    };
  }
  const named = row as {
    borrower: Address;
    market: Address;
    aprBps: number;
    targetBorrow: bigint;
    minAcceptable: bigint;
    streamId: bigint;
  };
  return {
    borrower: named.borrower,
    market: named.market,
    aprBps: Number(named.aprBps),
    targetBorrow: named.targetBorrow,
    minAcceptable: named.minAcceptable,
    streamId: named.streamId,
  };
}

function assertOpen(signal: AbortSignal | undefined, source: string): ReadFailure | null {
  if (signal?.aborted) return abortedFailure(source);
  return null;
}

export function isLiveRouter(router: Address | null | undefined): boolean {
  return Boolean(router && !isAddressEqual(router, ZERO_ADDRESS));
}

function hasContractCode(code: string | undefined): boolean {
  return Boolean(code && code !== "0x");
}

export async function readLendingRouter(
  client: RequestBookReadClient,
  lending: Address,
  options?: RequestBookReadOptions,
): Promise<{ router: Address } | { failure: ReadFailure }> {
  try {
    const router = await client.readContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "router",
      ...pinned(options),
    });
    return { router };
  } catch (error) {
    return { failure: transportFailure("lending.router", error) };
  }
}

export async function readPriorRouters(
  client: RequestBookReadClient,
  factory: Address,
  lending: Address,
  options?: RequestBookReadOptions,
): Promise<{ routers: Address[] } | { failure: ReadFailure }> {
  try {
    const count = await client.readContract({
      address: factory,
      abi: ovrfloFactoryAbi,
      functionName: "priorRouterCount",
      args: [lending],
      ...pinned(options),
    });
    const routers: Address[] = [];
    for (let index = 0n; index < count; index++) {
      const router = await client.readContract({
        address: factory,
        abi: ovrfloFactoryAbi,
        functionName: "priorRouterAt",
        args: [lending, index],
        ...pinned(options),
      });
      routers.push(router);
    }
    return { routers };
  } catch (error) {
    return { failure: transportFailure("factory.priorRouterAt", error) };
  }
}

export async function readBookLending(
  client: RequestBookReadClient,
  book: Address,
  options?: RequestBookReadOptions,
): Promise<{ lending: Address } | { failure: ReadFailure }> {
  try {
    const lending = await client.readContract({
      address: book,
      abi: ovrfloRequestBookAbi,
      functionName: "lending",
      ...pinned(options),
    });
    return { lending };
  } catch (error) {
    return { failure: transportFailure("book.lending", error) };
  }
}

async function readBookCode(
  client: RequestBookReadClient,
  book: Address,
  options?: RequestBookReadOptions,
): Promise<{ code: string | undefined } | { failure: ReadFailure }> {
  try {
    const code = await client.getCode({
      address: book,
      ...pinned(options),
    });
    return { code };
  } catch (error) {
    return { failure: transportFailure("book.getCode", error) };
  }
}

export async function hydrateRequest(
  client: RequestBookReadClient,
  book: Address,
  requestId: bigint,
  options?: RequestBookReadOptions,
): Promise<
  | {
      borrower: Address;
      market: Address;
      aprBps: number;
      targetBorrow: bigint;
      minAcceptable: bigint;
      streamId: bigint;
    }
  | { failure: ReadFailure }
> {
  try {
    const row = await client.readContract({
      address: book,
      abi: ovrfloRequestBookAbi,
      functionName: "requests",
      args: [requestId],
      ...pinned(options),
    });
    return decodeRequestRow(row);
  } catch (error) {
    return { failure: transportFailure("requests", error) };
  }
}

type BookTarget = {
  book: Address;
  lending: Address;
  count: bigint;
};

async function readRequestCount(
  client: RequestBookReadClient,
  book: Address,
  account: Address,
  options?: RequestBookReadOptions,
): Promise<{ count: bigint } | { failure: ReadFailure }> {
  try {
    const count = await client.readContract({
      address: book,
      abi: ovrfloRequestBookAbi,
      functionName: "requestCount",
      args: [account],
      ...pinned(options),
    });
    return { count };
  } catch (error) {
    return { failure: transportFailure("requestCount", error) };
  }
}

async function resolveBookTargets(
  client: RequestBookReadClient,
  factory: Address,
  lendings: readonly Address[],
  account: Address,
  options?: RequestBookReadOptions,
): Promise<{ targets: BookTarget[]; total: bigint } | { failure: ReadFailure }> {
  const targets: BookTarget[] = [];
  const seen = new Set<string>();
  let total = 0n;
  for (const lending of lendings) {
    const aborted = assertOpen(options?.signal, "resolveBookTargets");
    if (aborted) return { failure: aborted };
    const current = await readLendingRouter(client, lending, options);
    if ("failure" in current) return { failure: current.failure };
    const priors = await readPriorRouters(client, factory, lending, options);
    if ("failure" in priors) return { failure: priors.failure };
    const candidates = [current.router, ...priors.routers];
    for (const book of candidates) {
      if (!isLiveRouter(book)) continue;
      const key = book.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const code = await readBookCode(client, book, options);
      if ("failure" in code) return { failure: code.failure };
      if (!hasContractCode(code.code)) continue;
      const bound = await readBookLending(client, book, options);
      if ("failure" in bound) return { failure: bound.failure };
      const counted = await readRequestCount(client, book, account, options);
      if ("failure" in counted) return { failure: counted.failure };
      targets.push({ book, lending: bound.lending, count: counted.count });
      total += counted.count;
    }
  }
  return { targets, total };
}

/**
 * Read one window of this wallet's resting requests on one book.
 * The book list is `requestCount` / `requestAt`. Those ids swap-compact,
 * so the caller must pin every read in one walk to one block.
 */
export async function loadRequestBookPage(
  client: RequestBookReadClient,
  book: Address,
  lending: Address,
  account: Address,
  start: bigint,
  stop: bigint,
  options?: RequestBookReadOptions,
): Promise<ReadOutcome<RequestBookPage>> {
  const aborted = assertOpen(options?.signal, "loadRequestBookPage");
  if (aborted) return unavailableOutcome([aborted]);
  const counted = await readRequestCount(client, book, account, options);
  if ("failure" in counted) return unavailableOutcome([counted.failure]);
  const sourceCount = counted.count;
  const windowEnd = windowStop(start, sourceCount);
  const clampedStop = stop < windowEnd ? stop : windowEnd;
  if (start >= clampedStop) {
    return readyOutcome({ requests: [], sourceCount });
  }

  const requests: RestingRequestRow[] = [];
  for (let index = start; index < clampedStop; index++) {
    const again = assertOpen(options?.signal, "loadRequestBookPage");
    if (again) return unavailableOutcome([again], {}, { requests, sourceCount });
    try {
      const requestId = await client.readContract({
        address: book,
        abi: ovrfloRequestBookAbi,
        functionName: "requestAt",
        args: [account, index],
        ...pinned(options),
      });
      if (requestId === 0n) continue;
      const row = await hydrateRequest(client, book, requestId, options);
      if ("failure" in row) {
        return partialOutcome({ requests, sourceCount }, [row.failure]);
      }
      if (row.streamId === 0n || !isAddressEqual(row.borrower, account)) continue;
      requests.push({
        requestId,
        book,
        lending,
        borrower: row.borrower,
        market: row.market,
        aprBps: row.aprBps,
        targetBorrow: row.targetBorrow,
        minAcceptable: row.minAcceptable,
        streamId: row.streamId,
      });
    } catch (error) {
      return partialOutcome({ requests, sourceCount }, [transportFailure("loadRequestBookPage", error)]);
    }
  }
  return readyOutcome({ requests, sourceCount });
}

/**
 * Page resting requests across each lending's current router and every
 * `priorRouterAt` book. Completeness follows the summed `requestCount`.
 */
export async function loadFactoryRequestBookPage(
  client: RequestBookReadClient,
  factory: Address,
  lendings: readonly Address[],
  account: Address,
  start: bigint,
  stop: bigint,
  options?: RequestBookReadOptions,
): Promise<ReadOutcome<RequestBookPage>> {
  const aborted = assertOpen(options?.signal, "loadFactoryRequestBookPage");
  if (aborted) return unavailableOutcome([aborted]);
  if (lendings.length === 0) {
    return readyOutcome({ requests: [], sourceCount: 0n });
  }

  const resolved = await resolveBookTargets(client, factory, lendings, account, options);
  if ("failure" in resolved) return unavailableOutcome([resolved.failure]);
  const { targets, total } = resolved;
  if (start >= total) {
    return readyOutcome({ requests: [], sourceCount: total });
  }

  const pages: RequestBookPage[] = [];
  const windowFailures: ReadFailure[] = [];
  let cursor = 0n;
  for (const target of targets) {
    const localStart = start > cursor ? start - cursor : 0n;
    const localStop = stop > cursor ? stop - cursor : 0n;
    const clampedLocalStop = localStop > target.count ? target.count : localStop;
    if (localStart < clampedLocalStop) {
      const page = await loadRequestBookPage(
        client,
        target.book,
        target.lending,
        account,
        localStart,
        clampedLocalStop,
        options,
      );
      if (page.status === "unavailable") {
        return unavailableOutcome(page.failures, {}, page.data);
      }
      if (page.status === "partial") {
        pages.push(page.data);
        windowFailures.push(...page.failures);
      } else if (page.status !== "ready") {
        windowFailures.push(
          readFailure("loadFactoryRequestBookPage", "incomplete", "request window did not resolve"),
        );
      } else {
        pages.push(page.data);
      }
    }
    cursor += target.count;
  }
  const merged: RequestBookPage = {
    requests: pages.flatMap((page) => [...page.requests]),
    sourceCount: total,
  };
  if (windowFailures.length > 0) {
    return partialOutcome(merged, windowFailures);
  }
  return readyOutcome(merged);
}

export function requestBookNextPageParam(lastPageParam: bigint, sourceCount: bigint): bigint | undefined {
  return nextPageParam(lastPageParam, sourceCount, STREAM_PAGE_SIZE);
}
