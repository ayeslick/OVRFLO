import {
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  LENS_CREATION_BYTECODE,
  ovrfloStreamLensAbi,
} from "@/lib/generated/lens-bytecode";
import { callPin, type BlockPin, type PinMode } from "./pin";
import {
  protocolPartial,
  protocolReady,
  protocolStamp,
  protocolUnavailable,
  readFailure,
  type ProtocolStamp,
  type ReadFailure,
  type ReadOutcome,
} from "./read-outcome";

/**
 * Frontend policy: one `streamsOfOwner` call at or below this balance.
 * Well under the ~2000–2500 provider ceiling in plan 005. Not a Solidity constant.
 */
export const COMPLETE_SET_UNBOUNDED_MAX = 1500n;

/** Window width for `streamsOfOwnerIn` when the complete set pages. Lens-tested. */
export const COMPLETE_SET_WINDOW = 500n;

const lockupBalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type StreamReadClient = Pick<PublicClient, "call" | "readContract">;

export type StreamView = {
  streamId: bigint;
  owner: Address;
  sender: Address;
  asset: Address;
  startTime: number;
  cliffTime: number;
  endTime: number;
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
  withdrawableAmount: bigint;
  status: number;
  isCancelable: boolean;
  isDepleted: boolean;
  wasCanceled: boolean;
  ok: boolean;
};

export type StreamPage = {
  streams: readonly StreamView[];
};

type LensBatchName = "streamsOfOwner" | "streamsOfOwnerIn";

export type StreamReadOptions = {
  signal?: AbortSignal;
  pinMode?: PinMode;
};

function transportFailure(source: string, error: unknown): ReadFailure {
  return readFailure(source, "transport", error);
}

function invalidFailure(source: string, message: string): ReadFailure {
  return readFailure(source, "invalid", message, { retryable: false });
}

function incompleteFailure(source: string, message: string, entityId?: string): ReadFailure {
  return readFailure(source, "incomplete", message, { retryable: false, entityId });
}

async function lensCall(
  client: StreamReadClient,
  pin: BlockPin,
  functionName: LensBatchName,
  args: readonly unknown[],
  options?: StreamReadOptions,
): Promise<{ rows: StreamView[] } | { failure: ReadFailure }> {
  let data: Hex | undefined;
  try {
    const encoded = encodeFunctionData({
      abi: ovrfloStreamLensAbi,
      functionName,
      args: args as never,
    });
    const result = await client.call({
      code: LENS_CREATION_BYTECODE,
      data: encoded,
      ...callPin(pin, options?.pinMode ?? "hash"),
      ...(options?.signal ? { requestOptions: { signal: options.signal } } : {}),
    });
    data = result.data;
  } catch (error) {
    return { failure: transportFailure("lens", error) };
  }
  if (!data || data === "0x") {
    return { failure: invalidFailure("lens", `${functionName} returned empty data`) };
  }
  try {
    const rows = decodeFunctionResult({
      abi: ovrfloStreamLensAbi,
      functionName,
      data,
    }) as StreamView[];
    return { rows };
  } catch (error) {
    return { failure: invalidFailure("lens", error instanceof Error ? error.message : String(error)) };
  }
}

function ownershipFailures(rows: readonly StreamView[], owner: Address): ReadFailure[] {
  const failures: ReadFailure[] = [];
  for (const row of rows) {
    if (!row.ok) continue;
    if (!isAddressEqual(row.owner, owner)) {
      failures.push(
        incompleteFailure(
          "lens",
          `ok row owner ${row.owner} differs from requested ${owner}`,
          row.streamId.toString(),
        ),
      );
    }
  }
  return failures;
}

function leafFailures(rows: readonly StreamView[]): ReadFailure[] {
  const failures: ReadFailure[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.ok) continue;
    failures.push(
      readFailure("lens", "subcall", `stream ${row.streamId.toString()} failed hydration`, {
        retryable: false,
        index,
        entityId: row.streamId.toString(),
      }),
    );
  }
  return failures;
}

function finalizePage(
  rows: StreamView[],
  owner: Address,
  stamp: ProtocolStamp,
  mode: "page" | "complete",
): ReadOutcome<StreamPage> {
  const ownership = ownershipFailures(rows, owner);
  if (ownership.length > 0) {
    return protocolUnavailable(ownership, stamp, { streams: rows });
  }
  const leaves = leafFailures(rows);
  if (leaves.length > 0) {
    if (mode === "complete") {
      return protocolUnavailable(leaves, stamp, { streams: rows });
    }
    return protocolPartial({ streams: rows }, leaves, stamp);
  }
  return protocolReady({ streams: rows }, stamp);
}

/**
 * Windowed hydration: `streamsOfOwnerIn(lockup, owner, start, stop)` at `pin`.
 * Caller supplies the enumeration window. Leaf `ok: false` rows are partial.
 */
export async function loadStreamPage(
  client: StreamReadClient,
  lockup: Address,
  owner: Address,
  start: bigint,
  stop: bigint,
  pin: BlockPin,
  options?: StreamReadOptions,
): Promise<ReadOutcome<StreamPage>> {
  const called = await lensCall(
    client,
    pin,
    "streamsOfOwnerIn",
    [lockup, owner, start, stop],
    options,
  );
  if ("failure" in called) {
    return protocolUnavailable([called.failure]);
  }
  return finalizePage(called.rows, owner, protocolStamp(pin), "page");
}

async function readBalance(
  client: StreamReadClient,
  lockup: Address,
  owner: Address,
  pin: BlockPin,
  options?: StreamReadOptions,
): Promise<{ balance: bigint } | { failure: ReadFailure }> {
  try {
    const balance = await client.readContract({
      address: lockup,
      abi: lockupBalanceAbi,
      functionName: "balanceOf",
      args: [owner],
      ...callPin(pin, options?.pinMode ?? "hash"),
    });
    return { balance };
  } catch (error) {
    return { failure: transportFailure("lockup", error) };
  }
}

/**
 * Complete set at one pin. `balanceOf <= COMPLETE_SET_UNBOUNDED_MAX` uses one
 * `streamsOfOwner` call. Above that, merge `streamsOfOwnerIn` windows of
 * `COMPLETE_SET_WINDOW`. Any `ok: false` or ownership miss is unavailable.
 */
export async function loadCompleteStreams(
  client: StreamReadClient,
  lockup: Address,
  owner: Address,
  pin: BlockPin,
  options?: StreamReadOptions,
): Promise<ReadOutcome<StreamPage>> {
  const counted = await readBalance(client, lockup, owner, pin, options);
  if ("failure" in counted) {
    return protocolUnavailable([counted.failure]);
  }
  const { balance } = counted;

  if (balance === 0n) {
    return protocolReady({ streams: [] }, protocolStamp(pin));
  }

  if (balance <= COMPLETE_SET_UNBOUNDED_MAX) {
    const called = await lensCall(client, pin, "streamsOfOwner", [lockup, owner], options);
    if ("failure" in called) {
      return protocolUnavailable([called.failure]);
    }
    const stamped = protocolStamp(pin);
    if (BigInt(called.rows.length) !== balance) {
      return protocolUnavailable(
        [
          incompleteFailure(
            "lens",
            `streamsOfOwner length ${called.rows.length.toString()} !== balanceOf ${balance.toString()}`,
          ),
        ],
        stamped,
        { streams: called.rows },
      );
    }
    return finalizePage(called.rows, owner, stamped, "complete");
  }

  const merged: StreamView[] = [];
  let stamp: ProtocolStamp | undefined;
  for (let start = 0n; start < balance; start += COMPLETE_SET_WINDOW) {
    const windowStop = start + COMPLETE_SET_WINDOW;
    const stop = windowStop > balance ? balance : windowStop;
    const expected = stop - start;
    const page = await loadStreamPage(client, lockup, owner, start, stop, pin, options);
    if (page.status === "unavailable") {
      return page;
    }
    if (page.status !== "ready" && page.status !== "partial") {
      return protocolUnavailable([
        incompleteFailure("lens", `complete-set window [${start.toString()}, ${stop.toString()}) did not resolve`),
      ]);
    }
    stamp = protocolStamp(
      pin,
      "fetchedAtMs" in page.metadata && typeof page.metadata.fetchedAtMs === "number"
        ? page.metadata.fetchedAtMs
        : Date.now(),
    );
    if (page.status === "partial") {
      return protocolUnavailable(page.failures, stamp, {
        streams: [...merged, ...page.data.streams],
      });
    }
    if (BigInt(page.data.streams.length) !== expected) {
      return protocolUnavailable(
        [
          incompleteFailure(
            "lens",
            `window [${start.toString()}, ${stop.toString()}) length ${page.data.streams.length.toString()} !== ${expected.toString()}`,
          ),
        ],
        stamp,
        { streams: [...merged, ...page.data.streams] },
      );
    }
    merged.push(...page.data.streams);
  }

  if (!stamp) {
    return protocolUnavailable([incompleteFailure("lens", "complete-set produced no stamp")]);
  }
  if (BigInt(merged.length) !== balance) {
    return protocolUnavailable(
      [
        incompleteFailure(
          "lens",
          `merged length ${merged.length.toString()} !== balanceOf ${balance.toString()}`,
        ),
      ],
      stamp,
      { streams: merged },
    );
  }
  return finalizePage(merged, owner, stamp, "complete");
}
