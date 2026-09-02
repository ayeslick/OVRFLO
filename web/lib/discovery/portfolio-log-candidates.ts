import { parseAbiItem, type Address, type Hex, type Log } from "viem";
import { publicReadProviderPolicy } from "@/lib/rpc";
import {
  partialOutcome,
  readFailure,
  readyOutcome,
  type ReadFailure,
  type ReadOutcome,
} from "@/lib/read-outcome";

// Named CS5-U2 discovery owner. Stream and lending modules hydrate ids and
// never call getLogs. Output is a candidate set (projection), never a gate.

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const depositedEvent = parseAbiItem(
  "event Deposited(address indexed user, address indexed market, uint256 ptAmount, uint256 toUser, uint256 toStream, uint256 streamId)",
);
const borrowedEvent = parseAbiItem(
  "event Borrowed(uint256 indexed loanId, address indexed borrower, address indexed market, uint16 aprBps, uint32 epoch, uint64 seq, uint64 fillStart, uint64 fillEnd, uint128 actualBorrow, uint128 feeAmount, uint128 obligation, uint256 streamId)",
);
const suppliedEvent = parseAbiItem(
  "event Supplied(uint256 indexed positionId, address indexed lender, address indexed market, uint16 aprBps, uint32 epoch, uint32 leafIndex, uint128 amount)",
);

export type PortfolioLogQuery = {
  address: Address | readonly Address[];
  event: unknown;
  args?: Record<string, Address>;
  fromBlock: bigint;
  toBlock: bigint;
};

export type PortfolioLogClient = {
  getLogs(query: PortfolioLogQuery): Promise<readonly Log[]>;
};

export type PortfolioLogScanInput = {
  account: Address;
  lockup: Address;
  vaults: readonly Address[];
  lendings: readonly Address[];
  fromBlock: bigint;
  toBlock: bigint;
  maxBlockRange?: number;
};

export type MarketLogCandidate = {
  lending: Address;
  id: bigint;
};

export type PortfolioActivityKind = "deposited" | "borrowed" | "supplied";

export type PortfolioActivityRow = {
  kind: PortfolioActivityKind;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  id: bigint;
  address: Address;
};

export type PortfolioLogCandidates = {
  streamIds: readonly bigint[];
  loans: readonly MarketLogCandidate[];
  positions: readonly MarketLogCandidate[];
  activity: readonly PortfolioActivityRow[];
};

export function divideLogRanges(
  fromBlock: bigint,
  toBlock: bigint,
  maxBlockRange: number,
): Array<{ fromBlock: bigint; toBlock: bigint }> {
  if (fromBlock > toBlock) return [];
  if (maxBlockRange < 1) {
    throw new Error("maxBlockRange must be at least 1");
  }
  const step = BigInt(maxBlockRange);
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  let current = fromBlock;
  while (current <= toBlock) {
    const chunkEnd = current + step - 1n;
    ranges.push({
      fromBlock: current,
      toBlock: chunkEnd < toBlock ? chunkEnd : toBlock,
    });
    current = chunkEnd + 1n;
  }
  return ranges;
}

export function mergeCandidateIds(groups: readonly (readonly bigint[])[]): bigint[] {
  const seen = new Map<string, bigint>();
  for (const group of groups) {
    for (const id of group) {
      if (id === 0n) continue;
      const key = id.toString();
      if (!seen.has(key)) seen.set(key, id);
    }
  }
  return [...seen.values()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function mergeMarketCandidates(
  groups: readonly (readonly MarketLogCandidate[])[],
): MarketLogCandidate[] {
  const seen = new Map<string, MarketLogCandidate>();
  for (const group of groups) {
    for (const row of group) {
      if (row.id === 0n) continue;
      const key = `${row.lending.toLowerCase()}:${row.id.toString()}`;
      if (!seen.has(key)) seen.set(key, { lending: row.lending, id: row.id });
    }
  }
  return [...seen.values()].sort((left, right) => {
    const byLending = left.lending.toLowerCase().localeCompare(right.lending.toLowerCase());
    if (byLending !== 0) return byLending;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function sortActivityNewestFirst(
  rows: readonly PortfolioActivityRow[],
): PortfolioActivityRow[] {
  return [...rows].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber < right.blockNumber ? 1 : -1;
    }
    if (left.logIndex !== right.logIndex) return right.logIndex - left.logIndex;
    return left.transactionHash.toLowerCase().localeCompare(right.transactionHash.toLowerCase());
  });
}

/**
 * Bounded log-candidate discovery for the connected wallet. Logs name ids to
 * ask about. They do not name the current owner, borrower, or lender.
 */
export async function discoverPortfolioLogCandidates(
  client: PortfolioLogClient,
  input: PortfolioLogScanInput,
): Promise<ReadOutcome<PortfolioLogCandidates>> {
  const maxBlockRange = input.maxBlockRange ?? publicReadProviderPolicy.maxBlockRange;
  const ranges = divideLogRanges(input.fromBlock, input.toBlock, maxBlockRange);
  const streamGroups: Array<readonly bigint[]> = [];
  const loanGroups: Array<readonly MarketLogCandidate[]> = [];
  const positionGroups: Array<readonly MarketLogCandidate[]> = [];
  const activityGroups: Array<readonly PortfolioActivityRow[]> = [];
  const failures: ReadFailure[] = [];

  for (const range of ranges) {
    const page = await scanRange(client, input, range.fromBlock, range.toBlock);
    streamGroups.push(page.streamIds);
    loanGroups.push(page.loans);
    positionGroups.push(page.positions);
    activityGroups.push(page.activity);
    for (const failure of page.failures) failures.push(failure);
  }

  const data: PortfolioLogCandidates = {
    streamIds: mergeCandidateIds(streamGroups),
    loans: mergeMarketCandidates(loanGroups),
    positions: mergeMarketCandidates(positionGroups),
    activity: sortActivityNewestFirst(activityGroups.flat()),
  };
  if (failures.length > 0) {
    return partialOutcome(data, failures);
  }
  return readyOutcome(data);
}

async function scanRange(
  client: PortfolioLogClient,
  input: PortfolioLogScanInput,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<PortfolioLogCandidates & { failures: ReadFailure[] }> {
  const jobs: Array<Promise<ScanHits>> = [
    collectStreams(client, {
      address: input.lockup,
      event: transferEvent,
      args: { to: input.account },
      fromBlock,
      toBlock,
    }, "tokenId"),
    collectStreams(client, {
      address: input.lockup,
      event: transferEvent,
      args: { from: input.account },
      fromBlock,
      toBlock,
    }, "tokenId"),
  ];
  if (input.vaults.length > 0) {
    jobs.push(
      collectDeposits(client, {
        address: input.vaults,
        event: depositedEvent,
        args: { user: input.account },
        fromBlock,
        toBlock,
      }),
    );
  }
  if (input.lendings.length > 0) {
    jobs.push(
      collectMarket(
        client,
        "loan",
        {
          address: input.lendings,
          event: borrowedEvent,
          args: { borrower: input.account },
          fromBlock,
          toBlock,
        },
        "loanId",
      ),
    );
    jobs.push(
      collectMarket(
        client,
        "position",
        {
          address: input.lendings,
          event: suppliedEvent,
          args: { lender: input.account },
          fromBlock,
          toBlock,
        },
        "positionId",
      ),
    );
  }

  const settled = await Promise.allSettled(jobs);
  const streamIds: bigint[] = [];
  const loans: MarketLogCandidate[] = [];
  const positions: MarketLogCandidate[] = [];
  const activity: PortfolioActivityRow[] = [];
  const failures: ReadFailure[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      if (result.value.kind === "stream") streamIds.push(...result.value.ids);
      if (result.value.kind === "deposit") {
        streamIds.push(...result.value.ids);
        activity.push(...result.value.activity);
      }
      if (result.value.kind === "loan") {
        loans.push(...result.value.rows);
        activity.push(...result.value.activity);
      }
      if (result.value.kind === "position") {
        positions.push(...result.value.rows);
        activity.push(...result.value.activity);
      }
      continue;
    }
    failures.push(
      readFailure(
        "portfolio-log-candidates",
        "transport",
        result.reason instanceof Error ? result.reason : "log page failed",
        { retryable: true },
      ),
    );
  }
  return { streamIds, loans, positions, activity, failures };
}

type ScanHits =
  | { kind: "stream"; ids: bigint[] }
  | { kind: "deposit"; ids: bigint[]; activity: PortfolioActivityRow[] }
  | { kind: "loan" | "position"; rows: MarketLogCandidate[]; activity: PortfolioActivityRow[] };

async function collectStreams(
  client: PortfolioLogClient,
  query: PortfolioLogQuery,
  field: string,
): Promise<ScanHits> {
  const logs = await client.getLogs(query);
  const ids: bigint[] = [];
  for (const log of logs) {
    const id = idFromLog(log, field);
    if (id !== null) ids.push(id);
  }
  return { kind: "stream", ids };
}

async function collectDeposits(
  client: PortfolioLogClient,
  query: PortfolioLogQuery,
): Promise<ScanHits> {
  const logs = await client.getLogs(query);
  const ids: bigint[] = [];
  const activity: PortfolioActivityRow[] = [];
  for (const log of logs) {
    const id = idFromLog(log, "streamId");
    if (id !== null) ids.push(id);
    const row = activityFromLog(log, "deposited");
    if (row) activity.push(row);
  }
  return { kind: "deposit", ids, activity };
}

async function collectMarket(
  client: PortfolioLogClient,
  kind: "loan" | "position",
  query: PortfolioLogQuery,
  field: string,
): Promise<ScanHits> {
  const logs = await client.getLogs(query);
  const rows: MarketLogCandidate[] = [];
  const activity: PortfolioActivityRow[] = [];
  for (const log of logs) {
    const id = idFromLog(log, field);
    if (id === null) continue;
    rows.push({ lending: log.address, id });
    const row = activityFromLog(log, kind === "loan" ? "borrowed" : "supplied");
    if (row) activity.push(row);
  }
  return { kind, rows, activity };
}

function activityFromLog(log: Log, kind: PortfolioActivityKind): PortfolioActivityRow | null {
  const field = kind === "deposited" ? "streamId" : kind === "borrowed" ? "loanId" : "positionId";
  const id = idFromLog(log, field);
  if (id === null) return null;
  if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) return null;
  return {
    kind,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
    id,
    address: log.address,
  };
}

function idFromLog(log: Log, field: string): bigint | null {
  const args = "args" in log ? (log as Log & { args?: Record<string, unknown> }).args : undefined;
  const value = args?.[field];
  return typeof value === "bigint" ? value : null;
}
