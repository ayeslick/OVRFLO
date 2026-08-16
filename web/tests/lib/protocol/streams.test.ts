import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Address,
  type Hex,
} from "viem";
import { ovrfloStreamLensAbi } from "@/lib/generated/lens-bytecode";
import type { BlockPin } from "@/lib/protocol/pin";
import {
  COMPLETE_SET_UNBOUNDED_MAX,
  COMPLETE_SET_WINDOW,
  loadCompleteStreams,
  loadStreamPage,
  type StreamReadClient,
  type StreamView,
} from "@/lib/protocol/streams";

const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const OTHER = "0x00000000000000000000000000000000000000b2" as Address;
const SENDER = "0x00000000000000000000000000000000000000c3" as Address;
const ASSET = "0x00000000000000000000000000000000000000d4" as Address;
const LOCKUP = "0x0000000000000000000000000000000000000e55" as Address;

const PIN: BlockPin = {
  blockNumber: 1_000n,
  blockHash: `0x${"ab".repeat(32)}`,
};

function view(overrides: Partial<StreamView> & Pick<StreamView, "streamId">): StreamView {
  return {
    owner: OWNER,
    sender: SENDER,
    asset: ASSET,
    startTime: 1,
    cliffTime: 1,
    endTime: 2,
    deposited: 10n,
    withdrawn: 0n,
    refunded: 0n,
    withdrawableAmount: 10n,
    status: 1,
    isCancelable: false,
    isDepleted: false,
    wasCanceled: false,
    ok: true,
    ...overrides,
  };
}

function failed(streamId: bigint): StreamView {
  return view({
    streamId,
    owner: "0x0000000000000000000000000000000000000000",
    sender: "0x0000000000000000000000000000000000000000",
    asset: "0x0000000000000000000000000000000000000000",
    startTime: 0,
    cliffTime: 0,
    endTime: 0,
    deposited: 0n,
    withdrawableAmount: 0n,
    status: 0,
    ok: false,
  });
}

function encodeLens(
  functionName: "streamsOfOwner" | "streamsOfOwnerIn",
  rows: readonly StreamView[],
) {
  return encodeFunctionResult({
    abi: ovrfloStreamLensAbi,
    functionName,
    result: rows,
  });
}

type CallArgs = {
  code: Hex;
  data: Hex;
  blockNumber?: bigint;
  blockHash?: Hex;
};

function decodeLens(data: Hex) {
  return decodeFunctionData({ abi: ovrfloStreamLensAbi, data });
}

function makeClient(input: {
  balance?: bigint;
  page?: (args: { start: bigint; stop: bigint }) => StreamView[];
  complete?: StreamView[];
  callError?: unknown;
  servedHash?: Hex | null;
  getBlockError?: unknown;
}): { client: StreamReadClient; calls: CallArgs[] } {
  const calls: CallArgs[] = [];
  const client = {
    async call(args: CallArgs) {
      calls.push(args);
      if (input.callError) throw input.callError;
      const decoded = decodeLens(args.data);
      if (decoded.functionName === "streamsOfOwner") {
        return { data: encodeLens("streamsOfOwner", input.complete ?? []) };
      }
      if (decoded.functionName === "streamsOfOwnerIn") {
        const start = decoded.args[2];
        const stop = decoded.args[3];
        const rows = input.page?.({ start, stop }) ?? [];
        return { data: encodeLens("streamsOfOwnerIn", rows) };
      }
      throw new Error(`unexpected lens function ${decoded.functionName}`);
    },
    async readContract() {
      return input.balance ?? 0n;
    },
    async getBlock() {
      if (input.getBlockError) throw input.getBlockError;
      return { hash: input.servedHash === undefined ? PIN.blockHash : input.servedHash, number: PIN.blockNumber };
    },
  } as unknown as StreamReadClient;
  return { client, calls };
}

describe("loadStreamPage", () => {
  it("returns a ready page stamped with fetchedAtMs, blockNumber, and blockHash", async () => {
    const rows = [view({ streamId: 7n }), view({ streamId: 8n })];
    const { client, calls } = makeClient({
      page: () => rows,
    });
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.streams.map((row) => row.streamId)).toEqual([7n, 8n]);
    expect(outcome.metadata.blockNumber).toBe(PIN.blockNumber);
    expect(outcome.metadata.blockHash).toBe(PIN.blockHash);
    expect("fetchedAtMs" in outcome.metadata).toBe(true);
    expect(typeof (outcome.metadata as { fetchedAtMs: number }).fetchedAtMs).toBe("number");
    expect(calls[0]?.blockNumber).toBe(PIN.blockNumber);
    expect(calls[0]?.blockHash).toBeUndefined();
    expect(decodeLens(calls[0]!.data).functionName).toBe("streamsOfOwnerIn");
  });

  it("isolates a leaf ok:false row as partial", async () => {
    const rows = [view({ streamId: 1n }), failed(2n), view({ streamId: 3n })];
    const { client } = makeClient({ page: () => rows });
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 3n, PIN);
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") throw new Error("expected partial");
    expect(outcome.data.streams).toHaveLength(3);
    expect(outcome.failures.some((failure) => failure.code === "subcall" && failure.entityId === "2")).toBe(
      true,
    );
  });

  it("marks the whole page unavailable when an ok row has the wrong owner", async () => {
    const rows = [view({ streamId: 1n }), view({ streamId: 2n, owner: OTHER })];
    const { client } = makeClient({ page: () => rows });
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("expected unavailable");
    expect(outcome.failures[0]?.code).toBe("incomplete");
  });

  it("treats OOG and other call failures as unavailable, not a page of ok:false", async () => {
    const { client } = makeClient({ callError: new Error("out of gas") });
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 25n, PIN);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("expected unavailable");
    expect(outcome.failures[0]?.code).toBe("transport");
    expect(outcome.failures[0]?.message).toMatch(/out of gas/i);
    expect(outcome.data).toBeUndefined();
  });

  it("discards the page when the node serves a different block hash", async () => {
    const { client } = makeClient({
      page: () => [view({ streamId: 1n })],
      servedHash: `0x${"cd".repeat(32)}`,
    });
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 1n, PIN);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("expected unavailable");
    expect(outcome.failures[0]?.code).toBe("invalid");
    expect(outcome.failures[0]?.message).toMatch(/pin hash mismatch/);
  });

  it("allows wasCanceled and isDepleted together on an ok row", async () => {
    const rows = [view({ streamId: 9n, wasCanceled: true, isDepleted: true, status: 3 })];
    const { client } = makeClient({ page: () => rows });
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 1n, PIN);
    expect(outcome.status).toBe("ready");
  });
});

describe("loadCompleteStreams", () => {
  it("uses one streamsOfOwner call at the 1500 boundary", async () => {
    const rows = Array.from({ length: Number(COMPLETE_SET_UNBOUNDED_MAX) }, (_, index) =>
      view({ streamId: BigInt(index + 1) }),
    );
    const { client, calls } = makeClient({
      balance: COMPLETE_SET_UNBOUNDED_MAX,
      complete: rows,
    });
    const outcome = await loadCompleteStreams(client, LOCKUP, OWNER, PIN);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.streams).toHaveLength(Number(COMPLETE_SET_UNBOUNDED_MAX));
    expect(calls).toHaveLength(1);
    expect(decodeLens(calls[0]!.data).functionName).toBe("streamsOfOwner");
  });

  it("merges streamsOfOwnerIn windows above 1500 and does not call streamsOfOwner", async () => {
    const balance = COMPLETE_SET_UNBOUNDED_MAX + 1n;
    const { client, calls } = makeClient({
      balance,
      page: ({ start, stop }) => {
        const rows: StreamView[] = [];
        for (let id = start; id < stop; id++) {
          rows.push(view({ streamId: id + 1n }));
        }
        return rows;
      },
    });
    const outcome = await loadCompleteStreams(client, LOCKUP, OWNER, PIN);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.streams).toHaveLength(Number(balance));
    const names = calls.map((call) => decodeLens(call.data).functionName);
    expect(names.every((name) => name === "streamsOfOwnerIn")).toBe(true);
    expect(names).toHaveLength(4);
    expect(COMPLETE_SET_WINDOW).toBe(500n);
    const first = decodeLens(calls[0]!.data);
    expect(first.functionName).toBe("streamsOfOwnerIn");
    if (first.functionName !== "streamsOfOwnerIn") throw new Error("expected window");
    expect(first.args[2]).toBe(0n);
    expect(first.args[3]).toBe(500n);
    const last = decodeLens(calls[3]!.data);
    if (last.functionName !== "streamsOfOwnerIn") throw new Error("expected window");
    expect(last.args[2]).toBe(1500n);
    expect(last.args[3]).toBe(1501n);
  });

  it("treats a leaf ok:false row as unavailable for the complete set", async () => {
    const rows = [view({ streamId: 1n }), failed(2n)];
    const { client } = makeClient({ balance: 2n, complete: rows });
    const outcome = await loadCompleteStreams(client, LOCKUP, OWNER, PIN);
    expect(outcome.status).toBe("unavailable");
  });

  it("returns ready empty when balanceOf is zero without a lens call", async () => {
    const { client, calls } = makeClient({ balance: 0n });
    const outcome = await loadCompleteStreams(client, LOCKUP, OWNER, PIN);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.streams).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
