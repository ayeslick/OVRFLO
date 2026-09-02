import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, hexToString, type Hex } from "viem";
import type { BlockPin } from "@/lib/protocol/pin";
import {
  DEFAULT_DEPLOYLESS_PROVIDER_KEY,
  getDeploylessCapability,
  invalidateDeploylessCapability,
  lensPolicyOverride,
  pastPinError,
  PIN_PROBE_CREATION_BYTECODE,
  PIN_PROBE_LAG_BLOCKS,
  pinProbeAbi,
  probeHashPin,
  probeLensPolicy,
  resetDeploylessCapabilityCache,
  selectPastPin,
  setDeploylessCapability,
  ensureDeploylessCapability,
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

describe("provider and lens policy probes", () => {
  afterEach(() => {
    resetDeploylessCapabilityCache();
  });

  function pinClient(call: PinProbeClient["call"]): PinProbeClient {
    return {
      getBlockNumber: async () => LATEST,
      getBlock: async () => ({ hash: PAST.blockHash, number: PAST.blockNumber }),
      call,
    } as unknown as PinProbeClient;
  }

  it("gates off a provider that returns the hash pin but rejects the real policy probe", async () => {
    const hashClient = pinClient(async () => ({ data: encodeNumber(PAST.blockNumber) }));
    const hashResult = await probeHashPin(hashClient, PAST);
    expect(hashResult.supported).toBe(true);

    const lensClient = pinClient(async (args) => {
      const override = (args as { stateOverride?: unknown }).stateOverride;
      if (override) throw new Error("state override not supported");
      return { data: encodeNumber(PAST.blockNumber) };
    });
    const lensResult = await probeLensPolicy(lensClient, PAST, "streamsOfOwnerIn");
    expect(lensResult.supported).toBe(false);

    await ensureDeploylessCapability(hashClient, PAST, "provider-a", "hash-pin");
    await ensureDeploylessCapability(lensClient, PAST, "provider-a", "streamsOfOwnerIn");
    expect(getDeploylessCapability("provider-a", "hash-pin")).toBe(true);
    expect(getDeploylessCapability("provider-a", "streamsOfOwnerIn")).toBe(false);
  });

  it("does not treat one passing lens as support for a different lens on the same provider", async () => {
    const client = pinClient(async (args) => {
      const override = (args as { stateOverride?: readonly { code?: Hex }[] }).stateOverride;
      const code = override?.[0]?.code;
      if (!code) throw new Error("policy sentinel missing");
      const encoded = hexToString(code);
      if (encoded.includes("streamsOfOwnerIn")) throw new Error("lens not supported");
      return { data: encodeNumber(PAST.blockNumber) };
    });

    expect((await probeLensPolicy(client, PAST, "streamsOfOwner")).supported).toBe(true);
    expect((await probeLensPolicy(client, PAST, "streamsOfOwnerIn")).supported).toBe(false);

    await ensureDeploylessCapability(client, PAST, "provider-a", "streamsOfOwner");
    await ensureDeploylessCapability(client, PAST, "provider-a", "streamsOfOwnerIn");
    expect(getDeploylessCapability("provider-a", "streamsOfOwner")).toBe(true);
    expect(getDeploylessCapability("provider-a", "streamsOfOwnerIn")).toBe(false);
  });

  it("treats probe timeout and malformed replies as unsupported", async () => {
    const hanging = pinClient(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const timedOut = await probeLensPolicy(hanging, PAST, "streamsOfOwner", { timeoutMs: 20 });
    expect(timedOut.supported).toBe(false);
    expect(timedOut.error).toMatch(/timed out/i);

    const empty = pinClient(async () => ({ data: "0x" as Hex }));
    expect((await probeLensPolicy(empty, PAST, "streamsOfOwner")).supported).toBe(false);

    const garbage = pinClient(async () => ({ data: "0xdead" as Hex }));
    expect((await probeLensPolicy(garbage, PAST, "streamsOfOwner")).supported).toBe(false);
  });

  it("caches capability booleans and never stores the returned block as authority", async () => {
    const client = pinClient(async () => ({ data: encodeNumber(PAST.blockNumber) }));
    const result = await probeLensPolicy(client, PAST, "streamsOfOwner");
    expect(result.returnedBlockNumber).toBe(PAST.blockNumber);

    const supported = await ensureDeploylessCapability(client, PAST, "provider-a", "streamsOfOwner");
    expect(supported).toBe(true);
    expect(getDeploylessCapability("provider-a", "streamsOfOwner")).toBe(true);
    expect(getDeploylessCapability("provider-a", "streamsOfOwner")).not.toBe(PAST.blockNumber);
  });

  it("sends real viem-dlc policy() state override on the lens probe", async () => {
    const calls: unknown[] = [];
    const client = pinClient(async (args) => {
      calls.push(args);
      return { data: encodeNumber(PAST.blockNumber) };
    });
    await probeLensPolicy(client, PAST, "streamsOfOwnerIn");
    const args = calls[0] as {
      code: Hex;
      stateOverride: unknown;
      blockHash: Hex;
      requireCanonical: boolean;
    };
    expect(args.code).toBe(PIN_PROBE_CREATION_BYTECODE);
    expect(args.blockHash).toBe(PAST.blockHash);
    expect(args.requireCanonical).toBe(true);
    expect(args.stateOverride).toEqual([lensPolicyOverride("streamsOfOwnerIn")]);
  });

  it("disables only the failed provider/lens pair when hash-pin passed", async () => {
    setDeploylessCapability("provider-a", "hash-pin", true);
    setDeploylessCapability("provider-a", "streamsOfOwner", true);
    setDeploylessCapability("provider-a", "streamsOfOwnerIn", false);
    setDeploylessCapability("provider-b", "streamsOfOwnerIn", true);

    expect(getDeploylessCapability("provider-a", "hash-pin")).toBe(true);
    expect(getDeploylessCapability("provider-a", "streamsOfOwner")).toBe(true);
    expect(getDeploylessCapability("provider-a", "streamsOfOwnerIn")).toBe(false);
    expect(getDeploylessCapability("provider-b", "streamsOfOwnerIn")).toBe(true);

    invalidateDeploylessCapability("provider-a", "streamsOfOwnerIn");
    expect(getDeploylessCapability("provider-a", "streamsOfOwnerIn")).toBeUndefined();
    expect(getDeploylessCapability("provider-a", "streamsOfOwner")).toBe(true);
    expect(DEFAULT_DEPLOYLESS_PROVIDER_KEY).toBe("public-read");
  });
});
