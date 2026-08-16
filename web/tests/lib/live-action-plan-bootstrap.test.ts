import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { createLiveExecutionPlan } from "@/lib/live-action-plan";
import type { ReadyProtocolBootstrap } from "@/lib/protocol-bootstrap";

const account = "0x0000000000000000000000000000000000000a11" as Address;
const factory = "0x0000000000000000000000000000000000000f00" as Address;
const vault = "0x0000000000000000000000000000000000000d44" as Address;
const lending = "0x0000000000000000000000000000000000000b22" as Address;
const stream = "0x0000000000000000000000000000000000000999" as Address;
const otherVault = "0x0000000000000000000000000000000000000eee" as Address;
const market = "0x0000000000000000000000000000000000000c33" as Address;
const token = "0x0000000000000000000000000000000000000c33" as Address;

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
      lending,
    },
  ],
};

const client = {
  getBlock: vi.fn(),
  readContract: vi.fn(),
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
      {
        vault: otherVault,
        lending,
        market,
        underlying: token,
        ovrfloToken: token,
        ptToken: token,
        expiryCached: 1_000n,
        sablier: stream,
      },
      client,
      { bootstrap },
    );
    expect(result).toEqual({
      status: "invalid",
      errors: [expect.objectContaining({ code: "unregistered-target" })],
    });
    expect(client.getBlock).not.toHaveBeenCalled();
  });
});
