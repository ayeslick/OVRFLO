import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSecurityHeaders } from "../../scripts/build-csp.mjs";
import { hashInlineScripts } from "../../scripts/csp-hash-inline.mjs";
import { packageVercelOutput } from "../../scripts/package-vercel-output.mjs";
import { verifyVercelOutput } from "../../scripts/verify-vercel-output.mjs";
import { verifyDeploymentBuildInput } from "../../scripts/verify-deployment-input.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function productionEnvironment() {
  return {
    NEXT_PUBLIC_RUNTIME_PROFILE: "production",
    NEXT_PUBLIC_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/public-key",
    NEXT_PUBLIC_RPC_FALLBACK_URLS: "https://fallback.example.com",
    NEXT_PUBLIC_HISTORICAL_RPC_URL: "https://history.example.com",
  };
}

describe("CSP generation", () => {
  it("includes every approved production origin and excludes localhost", () => {
    const headers = buildSecurityHeaders(productionEnvironment());
    const csp = headers.find(({ key }: { key: string }) => key === "Content-Security-Policy")?.value;
    expect(csp).toContain("https://eth-mainnet.g.alchemy.com");
    expect(csp).toContain("https://fallback.example.com");
    expect(csp).toContain("https://history.example.com");
    expect(csp).toContain("https://api-v2.pendle.finance");
    expect(csp).not.toContain("ponder");
    expect(csp).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("rejects local origins in the production profile", () => {
    expect(() =>
      buildSecurityHeaders({
        ...productionEnvironment(),
        NEXT_PUBLIC_HISTORICAL_RPC_URL: "http://127.0.0.1:8545",
      }),
    ).toThrow(/production/i);
  });

  it("rejects the local profile for any deployable build", () => {
    expect(() =>
      buildSecurityHeaders({
        NEXT_PUBLIC_RUNTIME_PROFILE: "local",
        OVRFLO_DEPLOYABLE_BUILD: "1",
      }),
    ).toThrow(/deployable production/i);
  });
});

describe("deployment build input", () => {
  const verified = {
    factory: "0x1234567890abcdef1234567890abcdef12345678",
    factoryDeploymentBlock: "100",
    factoryDeploymentBlockHash: `0x${"ab".repeat(32)}`,
    ovrflo: "0x2234567890abcdef1234567890abcdef12345678",
    lending: "0x3234567890abcdef1234567890abcdef12345678",
    lendingDeploymentBlock: "105",
    lendingDeploymentBlockHash: `0x${"cd".repeat(32)}`,
    stream: "0x4234567890abcdef1234567890abcdef12345678",
    projectionSchemaVersion: 1,
    abiVersion: 1,
  };
  const environment = {
    NEXT_PUBLIC_RUNTIME_PROFILE: "production",
    OVRFLO_DEPLOYMENT_ARTIFACT: "../deployments/production.json",
    DEPLOYMENT_RPC_URL: "https://redacted.example",
    NEXT_PUBLIC_OVRFLO_FACTORY: verified.factory,
    NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK: verified.factoryDeploymentBlock,
    NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH: verified.factoryDeploymentBlockHash,
    NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION: "1",
    NEXT_PUBLIC_ABI_VERSION: "1",
  };

  it("binds every public deployment field to the chain-verified artifact", async () => {
    const verify = vi.fn().mockResolvedValue(verified);
    await expect(verifyDeploymentBuildInput(environment, verify)).resolves.toBe(verified);
    expect(verify).toHaveBeenCalledWith({
      artifactPath: "../deployments/production.json",
      rpcUrl: "https://redacted.example",
      requireExistingIdentity: true,
    });
  });

  it("fails before packaging when chain verification rejects the anchor", async () => {
    await expect(
      verifyDeploymentBuildInput(
        environment,
        vi.fn().mockRejectedValue(new Error("factory deployment block hash mismatch")),
      ),
    ).rejects.toThrow(/hash mismatch/i);
  });

  it("rejects an environment anchor that differs from the verified artifact", async () => {
    await expect(
      verifyDeploymentBuildInput(
        { ...environment, NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH: `0x${"ee".repeat(32)}` },
        vi.fn().mockResolvedValue(verified),
      ),
    ).rejects.toThrow(/NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH/);
  });
});

describe("immutable artifact packaging", () => {
  it("hashes exported HTML and preserves generated Vercel routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-csp-"));
    temporaryDirectories.push(root);
    const outDir = join(root, "out");
    const buildDir = join(root, "build");
    const vercelOutput = join(root, ".vercel", "output");
    mkdirSync(outDir, { recursive: true });
    mkdirSync(buildDir, { recursive: true });
    mkdirSync(join(vercelOutput, "static"), { recursive: true });
    writeFileSync(join(outDir, "index.html"), "<html><script>self.__next_f=[]</script></html>");
    const baseHeadersPath = join(buildDir, "base.json");
    const hashedHeadersPath = join(buildDir, "hashed.json");
    writeFileSync(baseHeadersPath, JSON.stringify(buildSecurityHeaders(productionEnvironment())));
    hashInlineScripts({ outDir, baseHeadersPath, hashedHeadersPath });

    const originalRoutes = [{ src: "/index", dest: "/index.html" }];
    writeFileSync(
      join(vercelOutput, "config.json"),
      JSON.stringify({ version: 3, routes: originalRoutes }),
    );
    writeFileSync(
      join(vercelOutput, "static", "index.html"),
      "<html><script>self.__next_f=[]</script>OVRFLO</html>",
    );
    const receipt = packageVercelOutput({ outputDir: vercelOutput, headersPath: hashedHeadersPath });
    const result = verifyVercelOutput({
      outputDir: vercelOutput,
      receiptPath: join(vercelOutput, ".ovrflo-package.json"),
    });

    const packaged = JSON.parse(readFileSync(join(vercelOutput, "config.json"), "utf8"));
    expect(packaged.routes.slice(1)).toEqual(originalRoutes);
    expect(packaged.routes[0].headers["Content-Security-Policy"]).toMatch(/script-src 'self' 'sha256-/);
    expect(receipt.originalRoutesDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.preservedRouteCount).toBe(1);
  });

  it("rejects CSP hashes copied from a different static artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "ovrflo-csp-"));
    temporaryDirectories.push(root);
    const outDir = join(root, "out");
    const buildDir = join(root, "build");
    const vercelOutput = join(root, ".vercel", "output");
    mkdirSync(outDir, { recursive: true });
    mkdirSync(buildDir, { recursive: true });
    mkdirSync(join(vercelOutput, "static"), { recursive: true });
    writeFileSync(join(outDir, "index.html"), "<script>artifactA()</script>");
    const baseHeadersPath = join(buildDir, "base.json");
    const hashedHeadersPath = join(buildDir, "hashed.json");
    writeFileSync(baseHeadersPath, JSON.stringify(buildSecurityHeaders(productionEnvironment())));
    hashInlineScripts({ outDir, baseHeadersPath, hashedHeadersPath });
    writeFileSync(
      join(vercelOutput, "config.json"),
      JSON.stringify({ version: 3, routes: [] }),
    );
    writeFileSync(join(vercelOutput, "static", "index.html"), "<script>artifactB()</script>");
    packageVercelOutput({ outputDir: vercelOutput, headersPath: hashedHeadersPath });

    expect(() =>
      verifyVercelOutput({
        outputDir: vercelOutput,
        receiptPath: join(vercelOutput, ".ovrflo-package.json"),
      }),
    ).toThrow(/hashes do not match/i);
  });
});
