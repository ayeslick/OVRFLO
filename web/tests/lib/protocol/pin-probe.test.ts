import { describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
} from "viem";
import type { BlockPin } from "@/lib/protocol/pin";
import {
  pastPinError,
  PIN_PROBE_CREATION_BYTECODE,
  PIN_PROBE_LAG_BLOCKS,
  pinProbeAbi,
  probeHashPin,
  selectPastPin,
  type PinProbeClient,
} from "@/lib/protocol/pin-probe";

const PAST: BlockPin = {
  blockNumber: 1_000_000n,
  blockHash: `0x${"11".repeat(32)}`,
};
const LATEST = 1_000_064n;

function encodeNumber(value: bigint) {
  return encodeFunctionResult({
    abi: pinProbeAbi,
    functionName: "blockNumber",
    result: value,
  });
}

describe("pin capability probe", () => {
  it("rejects a pin at latest — that probe is block-independent", () => {
    expect(pastPinError(LATEST, { blockNumber: LATEST, blockHash: PAST.blockHash })).toMatch(
      /not a past block/,
    );
    expect(pastPinError(LATEST, PAST)).toBeUndefined();
  });

  it("selects a past pin lagged from latest, never the head", async () => {
    const client = {
      getBlockNumber: async () => LATEST,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
        expect(blockNumber).toBe(LATEST - PIN_PROBE_LAG_BLOCKS);
        return { hash: PAST.blockHash, number: blockNumber };
      },
      call: vi.fn(),
    } as unknown as PinProbeClient;
    const selected = await selectPastPin(client);
    expect(selected).toEqual({ pin: { blockNumber: LATEST - PIN_PROBE_LAG_BLOCKS, blockHash: PAST.blockHash } });
  });

  it("reports supported only when the deployless call returns the pinned height", async () => {
    const calls: unknown[] = [];
    const client = {
      getBlockNumber: async () => LATEST,
      getBlock: async () => ({ hash: PAST.blockHash, number: PAST.blockNumber }),
      call: async (args: unknown) => {
        calls.push(args);
        return { data: encodeNumber(PAST.blockNumber) };
      },
    } as unknown as PinProbeClient;

    const result = await probeHashPin(client, PAST);
    expect(result).toEqual({ supported: true, returnedBlockNumber: PAST.blockNumber });

    const args = calls[0] as {
      code: Hex;
      data: Hex;
      blockHash: Hex;
      requireCanonical: boolean;
      blockNumber?: bigint;
    };
    expect(args.code).toBe(PIN_PROBE_CREATION_BYTECODE);
    expect(args.blockHash).toBe(PAST.blockHash);
    expect(args.requireCanonical).toBe(true);
    expect(args.blockNumber).toBeUndefined();
    expect(decodeFunctionData({ abi: pinProbeAbi, data: args.data }).functionName).toBe("blockNumber");
  });

  it("does not treat a latest-height reply as a passing hash pin", async () => {
    const client = {
      getBlockNumber: async () => LATEST,
      getBlock: async () => ({ hash: PAST.blockHash, number: PAST.blockNumber }),
      call: async () => ({ data: encodeNumber(LATEST) }),
    } as unknown as PinProbeClient;
    const result = await probeHashPin(client, PAST);
    expect(result.supported).toBe(false);
    expect(result.returnedBlockNumber).toBe(LATEST);
  });
});
