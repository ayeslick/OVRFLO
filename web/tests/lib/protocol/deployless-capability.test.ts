import { afterEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { LENS_CREATION_BYTECODE } from "@/lib/generated/lens-bytecode";
import type { BlockPin } from "@/lib/protocol/pin";
import {
  DEFAULT_DEPLOYLESS_PROVIDER_KEY,
  invalidateDeploylessCapability,
  resetDeploylessCapabilityCache,
  setDeploylessCapability,
} from "@/lib/protocol/pin-probe";
import {
  loadStreamPage,
  type StreamReadClient,
  type StreamView,
} from "@/lib/protocol/streams";

const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const SENDER = "0x00000000000000000000000000000000000000c3" as Address;
const ASSET = "0x00000000000000000000000000000000000000d4" as Address;
const LOCKUP = "0x0000000000000000000000000000000000000e55" as Address;
const PIN: BlockPin = {
  blockNumber: 1_000n,
  blockHash: `0x${"ab".repeat(32)}`,
};

function streamTuple() {
  return {
    sender: SENDER,
    startTime: 1,
    cliffTime: 1,
    isCancelable: false,
    wasCanceled: false,
    asset: ASSET,
    endTime: 2,
    isDepleted: false,
    isStream: true,
    isTransferable: true,
    amounts: { deposited: 10n, withdrawn: 0n, refunded: 0n },
  };
}

function makeMixedClient(input: {
  rejectLens?: boolean;
  lensError?: string;
}): {
  client: StreamReadClient;
  calls: Array<{ code?: Hex; data: Hex; stateOverride?: unknown }>;
  reads: Array<{ functionName: string }>;
} {
  const calls: Array<{ code?: Hex; data: Hex; stateOverride?: unknown }> = [];
  const reads: Array<{ functionName: string }> = [];
  const client = {
    async call(args: { code?: Hex; data: Hex; stateOverride?: unknown }) {
      calls.push(args);
      if (args.stateOverride && args.code !== LENS_CREATION_BYTECODE) {
        throw new Error("probe should be cached in these tests");
      }
      if (input.rejectLens || input.lensError) {
        throw new Error(input.lensError ?? "state override not supported");
      }
      throw new Error("deployless lens must not run");
    },
    async readContract(args: { functionName: string; args?: readonly unknown[] }) {
      reads.push({ functionName: args.functionName });
      switch (args.functionName) {
        case "tokensOfOwnerIn":
          return [7n, 8n];
        case "getStream":
          return streamTuple();
        case "ownerOf":
          return OWNER;
        case "withdrawableAmountOf":
          return 10n;
        case "statusOf":
          return 1;
        default:
          throw new Error(args.functionName);
      }
    },
  } as unknown as StreamReadClient;
  return { client, calls, reads };
}

describe("deployless lens capability gating", () => {
  afterEach(() => {
    resetDeploylessCapabilityCache();
  });

  it("uses same-pin plain reads when the provider/lens pair is gated off", async () => {
    setDeploylessCapability("provider-a", "streamsOfOwnerIn", false);
    const { client, calls, reads } = makeMixedClient({});
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN, {
      providerKey: "provider-a",
    });
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("expected ready");
    expect(outcome.data.streams.map((row: StreamView) => row.streamId)).toEqual([7n, 8n]);
    expect(outcome.metadata.blockHash).toBe(PIN.blockHash);
    expect(calls).toHaveLength(0);
    expect(reads.some((read) => read.functionName === "tokensOfOwnerIn")).toBe(true);
    expect(reads.some((read) => read.functionName === "getStream")).toBe(true);
  });

  it("does not enable streamsOfOwnerIn because streamsOfOwner passed on the same provider", async () => {
    setDeploylessCapability("provider-a", "streamsOfOwner", true);
    setDeploylessCapability("provider-a", "streamsOfOwnerIn", false);
    const { client, calls } = makeMixedClient({});
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN, {
      providerKey: "provider-a",
    });
    expect(outcome.status).toBe("ready");
    expect(calls).toHaveLength(0);
  });

  it("recovers later reads on the plain path after a mid-session capability miss", async () => {
    setDeploylessCapability(DEFAULT_DEPLOYLESS_PROVIDER_KEY, "streamsOfOwnerIn", true);
    const { client, calls, reads } = makeMixedClient({
      lensError: "state override not supported",
    });
    const first = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") throw new Error("expected ready");
    expect(first.data.streams).toHaveLength(2);
    expect(calls.some((call) => call.code === LENS_CREATION_BYTECODE)).toBe(true);
    expect(reads.some((read) => read.functionName === "tokensOfOwnerIn")).toBe(true);

    invalidateDeploylessCapability(DEFAULT_DEPLOYLESS_PROVIDER_KEY, "streamsOfOwnerIn");
    setDeploylessCapability(DEFAULT_DEPLOYLESS_PROVIDER_KEY, "streamsOfOwnerIn", false);
    const secondCalls = calls.length;
    const second = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN);
    expect(second.status).toBe("ready");
    expect(calls.length).toBe(secondCalls);
  });
});

describe("plain lockup hydration pin", () => {
  afterEach(() => {
    resetDeploylessCapabilityCache();
  });

  it("pins tokensOfOwnerIn with the same hash pin as the skipped lens", async () => {
    setDeploylessCapability("provider-a", "streamsOfOwnerIn", false);
    const pins: Array<{ blockHash?: Hex; requireCanonical?: boolean; blockNumber?: bigint }> = [];
    const client = {
      async call() {
        throw new Error("lens must not run");
      },
      async readContract(args: {
        functionName: string;
        blockHash?: Hex;
        requireCanonical?: boolean;
        blockNumber?: bigint;
      }) {
        pins.push({
          blockHash: args.blockHash,
          requireCanonical: args.requireCanonical,
          blockNumber: args.blockNumber,
        });
        if (args.functionName === "tokensOfOwnerIn") return [];
        throw new Error(args.functionName);
      },
    } as unknown as StreamReadClient;
    const outcome = await loadStreamPage(client, LOCKUP, OWNER, 0n, 2n, PIN, {
      providerKey: "provider-a",
    });
    expect(outcome.status).toBe("ready");
    expect(pins[0]).toEqual({
      blockHash: PIN.blockHash,
      requireCanonical: true,
      blockNumber: undefined,
    });
  });
});
