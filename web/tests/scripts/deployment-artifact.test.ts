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
const FACTORY_HASH = `0x${"ab".repeat(32)}`;
const LENDING_HASH = `0x${"cd".repeat(32)}`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
  vi.unstubAllGlobals();
});

describe("deployment artifact generator", () => {
  it("discovers code anchors and verifies LendingDeployed before writing versions", async () => {
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

    const request = vi.fn(async (_url: string, method: string, params: unknown[]) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_getCode") {
        const [address, block] = params as [string, string];
        const firstBlock = address.toLowerCase() === FACTORY.toLowerCase() ? 5n : 9n;
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
              "0x56aab5483cc40d7e4e6b3ce2831f55ce79d54c537d1c695c2d86656ce7a84307",
              `0x${OVRFLO.slice(2).padStart(64, "0")}`,
              `0x${LENDING.slice(2).padStart(64, "0")}`,
            ],
          },
        ];
      }
      throw new Error(`unexpected ${method}`);
    });

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
      lendingDeploymentBlock: "9",
      lendingDeploymentBlockHash: LENDING_HASH,
    });
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
