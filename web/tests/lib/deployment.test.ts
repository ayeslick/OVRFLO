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
    ).rejects.toThrow(/LendingRegistered/i);
  });

  it("derives and verifies lending identity from the factory LendingRegistered event", async () => {
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

  // Under the register-don't-construct factory, the lending's code-deployment transaction
  // (forge create) and the LendingRegistered registration (cast send) are separate
  // transactions in separate blocks. The artifact anchors to the registration event
  // (block 105); the lending's code having existed since an earlier block (102) — rather
  // than appearing exactly at the anchor — must still pass (eventBlock >= codeBlock).
  it("passes when the lending's code predates the registration anchor", async () => {
    const client = fakeClient({ lendingCodeFirstBlock: 102n });
    await expect(verifyDeploymentArtifact(client, artifact)).resolves.toEqual({
      factoryBlockHash: FACTORY_HASH,
      lendingBlockHash: LENDING_HASH,
    });
  });
});

function fakeClient(
  overrides: {
    latest?: bigint;
    factoryHash?: Hash;
    lendingHash?: Hash;
    emptyCodeAt?: Address;
    eventLending?: Address;
    lendingCodeFirstBlock?: bigint;
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
    getCode: vi.fn(({ address, blockNumber }: { address: Address; blockNumber: bigint }) => {
      if (address === overrides.emptyCodeAt) return Promise.resolve<`0x${string}`>("0x");
      if (
        address === LENDING &&
        overrides.lendingCodeFirstBlock !== undefined &&
        blockNumber < overrides.lendingCodeFirstBlock
      ) {
        return Promise.resolve<`0x${string}`>("0x");
      }
      return Promise.resolve<`0x${string}`>("0x6000");
    }),
    getLogs: vi.fn().mockResolvedValue([
      {
        args: { ovrflo: OVRFLO, lending: overrides.eventLending ?? LENDING },
        blockNumber: 105n,
        blockHash: LENDING_HASH,
      },
    ]),
  };
}
