import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import {
  parseDeploymentArtifact,
  verifyDeploymentArtifact,
  type DeploymentArtifact,
} from "@/lib/deployment";

const FACTORY = "0x1234567890abcdef1234567890abcdef12345678" as Address;
const OVRFLO = "0x2234567890abcdef1234567890abcdef12345678" as Address;
const LENDING = "0x3234567890abcdef1234567890abcdef12345678" as Address;
const FACTORY_HASH = `0x${"ab".repeat(32)}` as Hash;
const LENDING_HASH = `0x${"cd".repeat(32)}` as Hash;

const artifact: DeploymentArtifact = {
  formatVersion: 1,
  projectionSchemaVersion: 1,
  abiVersion: 1,
  freshGeneration: true,
  chainId: 1,
  factory: FACTORY,
  factoryDeploymentBlock: 100n,
  factoryDeploymentBlockHash: FACTORY_HASH,
  ovrflo: OVRFLO,
  lending: LENDING,
  lendingDeploymentBlock: 105n,
  lendingDeploymentBlockHash: LENDING_HASH,
};

describe("deployment artifacts", () => {
  it("parses a self-identifying fresh-generation artifact", () => {
    expect(
      parseDeploymentArtifact({
        ...artifact,
        factoryDeploymentBlock: "100",
        lendingDeploymentBlock: "105",
      }),
    ).toEqual(artifact);
  });

  it("rejects reused or incomplete generations", () => {
    expect(() => parseDeploymentArtifact({ ...artifact, freshGeneration: false })).toThrow(/freshGeneration/i);
    expect(() => parseDeploymentArtifact({ ...artifact, factoryDeploymentBlockHash: undefined })).toThrow(
      /factoryDeploymentBlockHash/,
    );
  });

  it("rejects a future factory anchor before discovery starts", async () => {
    const client = fakeClient({ latest: 99n });
    await expect(verifyDeploymentArtifact(client, artifact)).rejects.toThrow(/future/i);
  });

  it("rejects a factory block-hash mismatch before discovery starts", async () => {
    const client = fakeClient({ factoryHash: `0x${"ee".repeat(32)}` as Hash });
    await expect(verifyDeploymentArtifact(client, artifact)).rejects.toThrow(/factory.*hash/i);
  });

  it("rejects a future or hash-mismatched lending anchor", async () => {
    await expect(
      verifyDeploymentArtifact(fakeClient({ latest: 104n }), artifact),
    ).rejects.toThrow(/lending.*future/i);
    await expect(
      verifyDeploymentArtifact(
        fakeClient({ lendingHash: `0x${"ee".repeat(32)}` as Hash }),
        artifact,
      ),
    ).rejects.toThrow(/lending.*hash/i);
  });

  it("rejects missing deployment code and mismatched lending events", async () => {
    await expect(
      verifyDeploymentArtifact(fakeClient({ emptyCodeAt: FACTORY }), artifact),
    ).rejects.toThrow(/factory.*no code/i);
    await expect(
      verifyDeploymentArtifact(fakeClient({ emptyCodeAt: LENDING }), artifact),
    ).rejects.toThrow(/lending.*no code/i);
    await expect(
      verifyDeploymentArtifact(fakeClient({ eventLending: FACTORY }), artifact),
    ).rejects.toThrow(/LendingDeployed/i);
  });

  it("derives and verifies lending identity from the factory LendingDeployed event", async () => {
    const client = fakeClient();
    await expect(verifyDeploymentArtifact(client, artifact)).resolves.toEqual({
      factoryBlockHash: FACTORY_HASH,
      lendingBlockHash: LENDING_HASH,
    });
    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FACTORY,
        fromBlock: 105n,
        toBlock: 105n,
      }),
    );
  });
});

function fakeClient(
  overrides: {
    latest?: bigint;
    factoryHash?: Hash;
    lendingHash?: Hash;
    emptyCodeAt?: Address;
    eventLending?: Address;
  } = {},
) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(overrides.latest ?? 200n),
    getBlock: vi.fn(({ blockNumber }: { blockNumber: bigint }) =>
      Promise.resolve({
        hash:
          blockNumber === 100n
            ? (overrides.factoryHash ?? FACTORY_HASH)
            : (overrides.lendingHash ?? LENDING_HASH),
      }),
    ),
    getCode: vi.fn(({ address }: { address: Address }) =>
      Promise.resolve<`0x${string}`>(address === overrides.emptyCodeAt ? "0x" : "0x6000"),
    ),
    getLogs: vi.fn().mockResolvedValue([
      {
        args: { ovrflo: OVRFLO, lending: overrides.eventLending ?? LENDING },
        blockNumber: 105n,
        blockHash: LENDING_HASH,
      },
    ]),
  };
}
