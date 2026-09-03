import { isAddressEqual, type Address, type PublicClient } from "viem";
import { ovrfloLendingAbi, ovrfloRequestBookAbi } from "@/lib/abis";
import { ZERO_ADDRESS } from "@/lib/config";
import { MAX_ENUMERATION_IDS } from "@/lib/lending-math";
import {
  readFailure,
  readyOutcome,
  unavailableOutcome,
  type ReadFailure,
  type ReadOutcome,
} from "@/lib/read-outcome";

export type RequestBookReadClient = Pick<PublicClient, "readContract">;

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
  incomplete: boolean;
};

export type RequestBookReadOptions = {
  signal?: AbortSignal;
};

function transportFailure(source: string, error: unknown): ReadFailure {
  return readFailure(source, "transport", error);
}

function abortedFailure(source: string): ReadFailure {
  return readFailure(source, "cancelled", "enumeration aborted", { retryable: true });
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

export async function readLendingRouter(
  client: RequestBookReadClient,
  lending: Address,
): Promise<{ router: Address } | { failure: ReadFailure }> {
  try {
    const router = await client.readContract({
      address: lending,
      abi: ovrfloLendingAbi,
      functionName: "router",
    });
    return { router };
  } catch (error) {
    return { failure: transportFailure("lending.router", error) };
  }
}

export async function hydrateRequest(
  client: RequestBookReadClient,
  book: Address,
  requestId: bigint,
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
    });
    const decoded = decodeRequestRow(row);
    return decoded;
  } catch (error) {
    return { failure: transportFailure("requests", error) };
  }
}

/**
 * Enumerate resting requests for one book. Storage is zeroed after fill or
 * cancel. Keep rows where borrower matches and streamId is nonzero.
 */
export async function loadRequestBookPage(
  client: RequestBookReadClient,
  book: Address,
  lending: Address,
  account: Address,
  options?: RequestBookReadOptions,
): Promise<ReadOutcome<RequestBookPage>> {
  const aborted = assertOpen(options?.signal, "loadRequestBookPage");
  if (aborted) return unavailableOutcome([aborted]);
  let nextRequestId: bigint;
  try {
    nextRequestId = await client.readContract({
      address: book,
      abi: ovrfloRequestBookAbi,
      functionName: "nextRequestId",
    });
  } catch (error) {
    return unavailableOutcome([transportFailure("nextRequestId", error)]);
  }
  const lastId = nextRequestId > 1n ? nextRequestId - 1n : 0n;
  const cap = lastId > MAX_ENUMERATION_IDS ? MAX_ENUMERATION_IDS : lastId;
  const incomplete = lastId > MAX_ENUMERATION_IDS;
  const requests: RestingRequestRow[] = [];
  const failures: ReadFailure[] = [];
  for (let requestId = 1n; requestId <= cap; requestId++) {
    const again = assertOpen(options?.signal, "loadRequestBookPage");
    if (again) return unavailableOutcome([again], {}, { requests, sourceCount: lastId, incomplete });
    const row = await hydrateRequest(client, book, requestId);
    if ("failure" in row) {
      failures.push(row.failure);
      continue;
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
  }
  if (failures.length > 0) {
    return unavailableOutcome(failures, {}, { requests, sourceCount: lastId, incomplete });
  }
  return readyOutcome({ requests, sourceCount: lastId, incomplete });
}

export async function loadFactoryRequestBook(
  client: RequestBookReadClient,
  lendings: readonly Address[],
  account: Address,
  options?: RequestBookReadOptions,
): Promise<ReadOutcome<{ requests: readonly RestingRequestRow[]; incomplete: boolean }>> {
  const requests: RestingRequestRow[] = [];
  const failures: ReadFailure[] = [];
  let incomplete = false;
  for (const lending of lendings) {
    const aborted = assertOpen(options?.signal, "loadFactoryRequestBook");
    if (aborted) return unavailableOutcome([aborted], {}, { requests, incomplete });
    const router = await readLendingRouter(client, lending);
    if ("failure" in router) {
      failures.push(router.failure);
      continue;
    }
    if (!isLiveRouter(router.router)) continue;
    const page = await loadRequestBookPage(client, router.router, lending, account, options);
    if (page.status === "unavailable") {
      failures.push(...page.failures);
      if (page.data) {
        requests.push(...page.data.requests);
        incomplete = incomplete || page.data.incomplete;
      }
      continue;
    }
    if (page.status === "ready" || page.status === "partial") {
      requests.push(...page.data.requests);
      incomplete = incomplete || page.data.incomplete;
    }
  }
  if (failures.length > 0) {
    return unavailableOutcome(failures, {}, { requests, incomplete });
  }
  return readyOutcome({ requests, incomplete });
}
