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
import { sablierLockupAbi } from "@/lib/abis";
import { ZERO_ADDRESS } from "@/lib/config";
import { callPin, type BlockPin, type PinMode } from "./pin";
import {
  DEFAULT_DEPLOYLESS_PROVIDER_KEY,
  ensureDeploylessCapability,
  isDeploylessCapabilityMiss,
  lensPolicyOverride,
  setDeploylessCapability,
  type DeploylessLensId,
} from "./pin-probe";
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

type LensBatchName = DeploylessLensId;

export type StreamReadOptions = {
  signal?: AbortSignal;
  pinMode?: PinMode;
  providerKey?: string;
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
  const providerKey = options?.providerKey ?? DEFAULT_DEPLOYLESS_PROVIDER_KEY;
  const supported = await ensureDeploylessCapability(client, pin, providerKey, functionName);
  if (!supported) {
    return plainLensCall(client, pin, functionName, args, options);
  }

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
      stateOverride: [lensPolicyOverride(functionName)],
      ...callPin(pin, options?.pinMode ?? "hash"),
      ...(options?.signal ? { requestOptions: { signal: options.signal } } : {}),
    });
    data = result.data;
  } catch (error) {
    if (isDeploylessCapabilityMiss(error)) {
      setDeploylessCapability(providerKey, functionName, false);
      return plainLensCall(client, pin, functionName, args, options);
    }
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

const LOCKUP_STATUS_CANCELED = 3;
const LOCKUP_STATUS_DEPLETED = 4;

function failedStreamView(streamId: bigint): StreamView {
  return {
    streamId,
    owner: ZERO_ADDRESS,
    sender: ZERO_ADDRESS,
    asset: ZERO_ADDRESS,
    startTime: 0,
    cliffTime: 0,
    endTime: 0,
    deposited: 0n,
    withdrawn: 0n,
    refunded: 0n,
    withdrawableAmount: 0n,
    status: 0,
    isCancelable: false,
    isDepleted: false,
    wasCanceled: false,
    ok: false,
  };
}

async function plainHydrateOne(
  client: StreamReadClient,
  lockup: Address,
  streamId: bigint,
  pin: BlockPin,
  options?: StreamReadOptions,
): Promise<StreamView> {
  const pinArgs = callPin(pin, options?.pinMode ?? "hash");
  const request = options?.signal ? { requestOptions: { signal: options.signal } } : {};
  try {
    const stream = await client.readContract({
      address: lockup,
      abi: sablierLockupAbi,
      functionName: "getStream",
      args: [streamId],
      ...pinArgs,
      ...request,
    });
    const owner = await client.readContract({
      address: lockup,
      abi: sablierLockupAbi,
      functionName: "ownerOf",
      args: [streamId],
      ...pinArgs,
      ...request,
    });
    const withdrawableAmount = await client.readContract({
      address: lockup,
      abi: sablierLockupAbi,
      functionName: "withdrawableAmountOf",
      args: [streamId],
      ...pinArgs,
      ...request,
    });
    const status = await client.readContract({
      address: lockup,
      abi: sablierLockupAbi,
      functionName: "statusOf",
      args: [streamId],
      ...pinArgs,
      ...request,
    });
    const statusCode = Number(status);
    return {
      streamId,
      owner,
      sender: stream.sender,
      asset: stream.asset,
      startTime: Number(stream.startTime),
      cliffTime: Number(stream.cliffTime),
      endTime: Number(stream.endTime),
      deposited: stream.amounts.deposited,
      withdrawn: stream.amounts.withdrawn,
      refunded: stream.amounts.refunded,
      withdrawableAmount,
      status: statusCode,
      isCancelable: stream.isCancelable,
      isDepleted: statusCode === LOCKUP_STATUS_DEPLETED,
      wasCanceled: statusCode === LOCKUP_STATUS_CANCELED,
      ok: true,
    };
  } catch {
    return failedStreamView(streamId);
  }
}

async function plainLensCall(
  client: StreamReadClient,
  pin: BlockPin,
  functionName: LensBatchName,
  args: readonly unknown[],
  options?: StreamReadOptions,
): Promise<{ rows: StreamView[] } | { failure: ReadFailure }> {
  const lockup = args[0] as Address;
  const owner = args[1] as Address;
  const pinArgs = callPin(pin, options?.pinMode ?? "hash");
  const request = options?.signal ? { requestOptions: { signal: options.signal } } : {};
  try {
    let start = 0n;
    let stop = 0n;
    if (functionName === "streamsOfOwnerIn") {
      start = args[2] as bigint;
      stop = args[3] as bigint;
    } else {
      const counted = await readBalance(client, lockup, owner, pin, options);
      if ("failure" in counted) return counted;
      if (counted.balance === 0n) return { rows: [] };
      start = 0n;
      stop = counted.balance;
    }
    const ids = await client.readContract({
      address: lockup,
      abi: sablierLockupAbi,
      functionName: "tokensOfOwnerIn",
      args: [owner, start, stop],
      ...pinArgs,
      ...request,
    });
    const rows: StreamView[] = [];
    for (const streamId of ids) {
      rows.push(await plainHydrateOne(client, lockup, streamId, pin, options));
    }
    return { rows };
  } catch (error) {
    return { failure: transportFailure("lockup", error) };
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

/**
 * Confirm current lockup ownership for log-derived candidate ids.
 * A Transfer that names an old owner loses to ownerOf. One failed
 * ownerOf leaves the rest and returns partialOutcome.
 */
export async function hydrateStreamCandidates(
  client: StreamReadClient,
  lockup: Address,
  owner: Address,
  candidateIds: readonly bigint[],
  pin: BlockPin,
  options?: StreamReadOptions,
): Promise<ReadOutcome<{ streamIds: readonly bigint[] }>> {
  const unique = uniquePositiveIds(candidateIds);
  if (unique.length === 0) {
    return protocolReady({ streamIds: [] }, protocolStamp(pin));
  }

  const owned: bigint[] = [];
  const failures: ReadFailure[] = [];
  for (const streamId of unique) {
    try {
      const current = await client.readContract({
        address: lockup,
        abi: sablierLockupAbi,
        functionName: "ownerOf",
        args: [streamId],
        ...callPin(pin, options?.pinMode ?? "hash"),
      });
      if (isAddressEqual(current, owner)) owned.push(streamId);
    } catch (error) {
      failures.push(
        readFailure("hydration", "subcall", error, {
          retryable: true,
          entityId: streamId.toString(),
        }),
      );
    }
  }

  const stamp = protocolStamp(pin);
  if (failures.length > 0) {
    return protocolPartial({ streamIds: owned }, failures, stamp);
  }
  return protocolReady({ streamIds: owned }, stamp);
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
