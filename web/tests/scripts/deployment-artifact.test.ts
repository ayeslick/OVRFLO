import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  jsonRpcRequest,
  verifyAndWriteDeploymentArtifact,
} from "../../../tools/scripts/write-deployment-artifact.mjs";

const FACTORY = "0x1234567890abcdef1234567890abcdef12345678";
const OVRFLO = "0x2234567890abcdef1234567890abcdef12345678";
const LENDING = "0x3234567890abcdef1234567890abcdef12345678";
const STREAM = "0x4234567890abcdef1234567890abcdef12345678";
const FACTORY_HASH = `0x${"ab".repeat(32)}`;
const LENDING_HASH = `0x${"cd".repeat(32)}`;
// keccak256("LendingRegistered(address,address)") — mirrors the constant recomputed in
// tools/scripts/write-deployment-artifact.mjs after the factory rename from LendingDeployed.
const LENDING_REGISTERED_TOPIC =
  "0x4fe43074b419acbe41e8428df134258612acf6435f32c53db0f6a4ba665b4e41";
const SABLIER_LL_SELECTOR = "0x94cd301a";
const SABLIER_SELECTOR = "0x482879aa";
const temporaryDirectories: string[] = [];

function paddedAddress(address: string) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function streamAwareRequest(inner: (url: string, method: string, params: unknown[]) => Promise<unknown>) {
  return async (url: string, method: string, params: unknown[]) => {
    if (method === "eth_call") {
      const [{ to, data }] = params as [{ to: string; data: string }];
      const selector = data.toLowerCase();
      if (to.toLowerCase() === OVRFLO.toLowerCase() && selector === SABLIER_LL_SELECTOR) {
        return paddedAddress(STREAM);
      }
      if (to.toLowerCase() === LENDING.toLowerCase() && selector === SABLIER_SELECTOR) {
        return paddedAddress(STREAM);
      }
      throw new Error(`unexpected eth_call ${to} ${data}`);
    }
    if (method === "eth_getCode") {
      const [address] = params as [string, string];
      if (address.toLowerCase() === STREAM.toLowerCase()) return "0x6000";
    }
    return inner(url, method, params);
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
  vi.unstubAllGlobals();
});

describe("deployment artifact generator", () => {
  // The lending contract's code-deployment transaction (forge create, block 7) and the
  // factory's registerLending call (cast send, block 9) are separate transactions under
  // the register-don't-construct factory. The artifact anchors to the registration event
  // (block 9); code existing strictly earlier (eventBlock >= codeBlock) must still pass.
  it("discovers code anchors and verifies LendingRegistered before writing versions, tolerating an earlier lending code block", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-deployment-"));
    temporaryDirectories.push(root);
    const artifactPath = join(root, "local.json");
    writeFileSync(
      artifactPath,
      JSON.stringify({
        formatVersion: 1,
        projectionSchemaVersion: 1,
        abiVersion: 1,
        freshGeneration: true,
        chainId: 1,
        factory: FACTORY,
      }),
    );

    const request = streamAwareRequest(
      vi.fn(async (_url: string, method: string, params: unknown[]) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_getCode") {
        const [address, block] = params as [string, string];
        const firstBlock = address.toLowerCase() === FACTORY.toLowerCase() ? 5n : 7n;
        return BigInt(block) >= firstBlock ? "0x6000" : "0x";
      }
      if (method === "eth_getBlockByNumber") {
        return { hash: BigInt(params[0] as string) === 5n ? FACTORY_HASH : LENDING_HASH };
      }
      if (method === "eth_getLogs") {
        return [
          {
            address: FACTORY,
            blockNumber: "0x9",
            blockHash: LENDING_HASH,
            topics: [
              LENDING_REGISTERED_TOPIC,
              `0x${OVRFLO.slice(2).padStart(64, "0")}`,
              `0x${LENDING.slice(2).padStart(64, "0")}`,
            ],
          },
        ];
      }
      throw new Error(`unexpected ${method}`);
    }),
    );

    await verifyAndWriteDeploymentArtifact({
      artifactPath,
      rpcUrl: "https://redacted.example",
      request,
    });
    const written = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(written).toMatchObject({
      formatVersion: 1,
      projectionSchemaVersion: 1,
      abiVersion: 1,
      freshGeneration: true,
      ovrflo: OVRFLO,
      lending: LENDING,
      factoryDeploymentBlock: "5",
      factoryDeploymentBlockHash: FACTORY_HASH,
      // lendingDeploymentBlock anchors to the registration event (block 9), not the
      // lending's own code-deployment block (7) — the two-transaction case this
      // scenario pins.
      lendingDeploymentBlock: "9",
      lendingDeploymentBlockHash: LENDING_HASH,
      stream: STREAM,
    });
  });

  it("rejects a supplied stream that does not match the vault and lending bindings", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-deployment-"));
    temporaryDirectories.push(root);
    const artifactPath = join(root, "local.json");
    writeFileSync(
      artifactPath,
      JSON.stringify({
        formatVersion: 1,
        projectionSchemaVersion: 1,
        abiVersion: 1,
        freshGeneration: true,
        chainId: 1,
        factory: FACTORY,
        ovrflo: OVRFLO,
        lending: LENDING,
        stream: "0x9999999999999999999999999999999999999999",
      }),
    );

    const request = streamAwareRequest(
      vi.fn(async (_url: string, method: string, params: unknown[]) => {
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_blockNumber") return "0x10";
        if (method === "eth_getCode") {
          const [address, block] = params as [string, string];
          const firstBlock = address.toLowerCase() === FACTORY.toLowerCase() ? 5n : 7n;
          return BigInt(block) >= firstBlock ? "0x6000" : "0x";
        }
        if (method === "eth_getBlockByNumber") {
          return { hash: BigInt(params[0] as string) === 5n ? FACTORY_HASH : LENDING_HASH };
        }
        if (method === "eth_getLogs") {
          return [
            {
              address: FACTORY,
              blockNumber: "0x9",
              blockHash: LENDING_HASH,
              topics: [
                LENDING_REGISTERED_TOPIC,
                `0x${OVRFLO.slice(2).padStart(64, "0")}`,
                `0x${LENDING.slice(2).padStart(64, "0")}`,
              ],
            },
          ];
        }
        throw new Error(`unexpected ${method}`);
      }),
    );

    await expect(
      verifyAndWriteDeploymentArtifact({
        artifactPath,
        rpcUrl: "https://redacted.example",
        request,
      }),
    ).rejects.toThrow(/supplied stream/i);
  });

  it("rejects when the expected LendingRegistered event is missing at the anchored block", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-deployment-"));
    temporaryDirectories.push(root);
    const artifactPath = join(root, "local.json");
    writeFileSync(
      artifactPath,
      JSON.stringify({
        formatVersion: 1,
        projectionSchemaVersion: 1,
        abiVersion: 1,
        freshGeneration: true,
        chainId: 1,
        factory: FACTORY,
        ovrflo: OVRFLO,
        lending: LENDING,
      }),
    );

    const request = vi.fn(async (_url: string, method: string, params: unknown[]) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_getCode") {
        const [address, block] = params as [string, string];
        const firstBlock = address.toLowerCase() === FACTORY.toLowerCase() ? 5n : 7n;
        return BigInt(block) >= firstBlock ? "0x6000" : "0x";
      }
      if (method === "eth_getLogs") return [];
      throw new Error(`unexpected ${method}`);
    });

    await expect(
      verifyAndWriteDeploymentArtifact({
        artifactPath,
        rpcUrl: "https://redacted.example",
        request,
      }),
    ).rejects.toThrow(/LendingRegistered/i);
  });

  it("does not put a credential-bearing URL in RPC failure messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-deployment-"));
    temporaryDirectories.push(root);
    const artifactPath = join(root, "local.json");
    writeFileSync(
      artifactPath,
      JSON.stringify({
        formatVersion: 1,
        projectionSchemaVersion: 1,
        abiVersion: 1,
        freshGeneration: true,
        chainId: 1,
        factory: FACTORY,
        ovrflo: OVRFLO,
        lending: LENDING,
      }),
    );
    const rpcUrl = "https://history.example/v2/secret-key";
    await expect(
      verifyAndWriteDeploymentArtifact({
        artifactPath,
        rpcUrl,
        request: vi.fn().mockRejectedValue(new Error("transport unavailable")),
      }),
    ).rejects.not.toThrow(/secret-key/);
  });

  it("rejects an artifact that claims a reused generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-deployment-"));
    temporaryDirectories.push(root);
    const artifactPath = join(root, "local.json");
    writeFileSync(
      artifactPath,
      JSON.stringify({
        formatVersion: 1,
        projectionSchemaVersion: 1,
        abiVersion: 1,
        freshGeneration: false,
        chainId: 1,
        factory: FACTORY,
        ovrflo: OVRFLO,
        lending: LENDING,
      }),
    );
    await expect(
      verifyAndWriteDeploymentArtifact({
        artifactPath,
        rpcUrl: "https://redacted.example",
        request: vi.fn(),
      }),
    ).rejects.toThrow(/freshGeneration/i);
  });

  it("redacts provider-controlled JSON-RPC error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            error: {
              code: -32000,
              message: "request rejected for https://history.example/v2/secret-key",
            },
          }),
      }),
    );
    await expect(
      jsonRpcRequest("https://history.example/v2/secret-key", "eth_blockNumber", []),
    ).rejects.not.toThrow(/secret-key/);
  });

  it("bounds a non-responsive deployment RPC request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ),
    );
    await expect(
      jsonRpcRequest("https://history.example/v2/key", "eth_blockNumber", [], 1),
    ).rejects.toThrow(/transport failed/i);
  });
});
