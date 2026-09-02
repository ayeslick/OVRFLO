import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { createLiveExecutionPlan } from "@/lib/live-action-plan";
import type { ReadyProtocolBootstrap } from "@/lib/protocol-bootstrap";

const account = "0x0000000000000000000000000000000000000a11" as Address;
const factory = "0x0000000000000000000000000000000000000f00" as Address;
const vault = "0x0000000000000000000000000000000000000d44" as Address;
const lending = "0x0000000000000000000000000000000000000b22" as Address;
const otherLending = "0x0000000000000000000000000000000000000b99" as Address;
const stream = "0x0000000000000000000000000000000000000999" as Address;
const otherStream = "0x0000000000000000000000000000000000000888" as Address;
const otherVault = "0x0000000000000000000000000000000000000eee" as Address;
const market = "0x0000000000000000000000000000000000000c33" as Address;
const token = "0x0000000000000000000000000000000000000c33" as Address;
const reserve = "0x0000000000000000000000000000000000000c44" as Address;

const bootstrap: ReadyProtocolBootstrap = {
  status: "ready",
  factory,
  stream,
  blockNumber: 1n,
  vaults: [
    {
      vault,
      treasury: token,
      underlying: token,
      ovrfloToken: token,
      reserve,
      lending,
      retiredLendings: [],
    },
  ],
};

const vaultOnlyBootstrap: ReadyProtocolBootstrap = {
  status: "ready",
  factory,
  stream,
  blockNumber: 1n,
  vaults: [
    {
      vault,
      treasury: token,
      underlying: token,
      ovrfloToken: token,
      reserve,
      lending: null,
      retiredLendings: [],
    },
  ],
};

const client = {
  getBlock: vi.fn(),
  readContract: vi.fn(),
  simulateContract: vi.fn(),
};

const scope = {
  vault,
  lending,
  market,
  underlying: token,
  ovrfloToken: token,
  ptToken: token,
  expiryCached: 1_000n,
  sablier: stream,
  reserve,
};

describe("createLiveExecutionPlan signing destinations", () => {
  it("returns unregistered-target when the vault is not in the bootstrap registry", async () => {
    const result = await createLiveExecutionPlan(
      {
        address: lending,
        functionName: "supply",
        args: [market, 1_000, 10n],
      },
      { account, chainId: 1 },
      { ...scope, vault: otherVault },
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
    expect(client.getBlock).not.toHaveBeenCalled();
  });

  it("returns unregistered-target on lending mismatch", async () => {
    const result = await createLiveExecutionPlan(
      {
        address: otherLending,
        functionName: "supply",
        args: [market, 1_000, 10n],
      },
      { account, chainId: 1 },
      { ...scope, lending: otherLending },
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
  });

  it("returns unregistered-target on stream mismatch", async () => {
    const result = await createLiveExecutionPlan(
      {
        address: lending,
        functionName: "supply",
        args: [market, 1_000, 10n],
      },
      { account, chainId: 1 },
      { ...scope, sablier: otherStream },
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
  });

  it("allows vault-only writes when registered.lending is null", async () => {
    client.getBlock.mockResolvedValue({
      number: 10n,
      hash: `0x${"11".repeat(32)}`,
      timestamp: 1_800_000_000n,
    });
    client.readContract.mockResolvedValue(0n);
    const result = await createLiveExecutionPlan(
      {
        address: reserve,
        functionName: "wrap",
        args: [10n],
      },
      { account, chainId: 1 },
      { ...scope, lending: null, sablier: stream },
      client,
      { bootstrap: vaultOnlyBootstrap },
    );
    expect(result).not.toEqual(
      expect.objectContaining({
        status: "invalid",
        errors: [expect.objectContaining({ code: "unregistered-target" })],
      }),
    );
  });

  it("refuses an unparsed market-scoped write that is not approve", async () => {
    const result = await createLiveExecutionPlan(
      {
        address: lending,
        functionName: "unknownThing",
        args: [],
      },
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
  });

  it("refuses approve when the spender is not lending or stream", async () => {
    const result = await createLiveExecutionPlan(
      {
        address: token,
        functionName: "approve",
        args: [otherVault, 10n],
      },
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
  });

  it("returns null for a verified approve so the legacy adapter can sign", async () => {
    const result = await createLiveExecutionPlan(
      {
        address: token,
        functionName: "approve",
        args: [lending, 10n],
      },
      { account, chainId: 1 },
      scope,
      client,
      { bootstrap },
    );
    expect(result).toBeNull();
  });
});

