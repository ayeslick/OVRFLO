import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REAL_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as const;
const OVRFLO_ADDRESS = "0x2234567890abcdef1234567890abcdef12345678" as const;
const LENDING_ADDRESS = "0x3234567890abcdef1234567890abcdef12345678" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
const LENDING_BLOCK_HASH = `0x${"cd".repeat(32)}` as const;

// lib/config.ts parses process.env at module-evaluation time (top-level
// `parseChainId(env.chainId)` etc.), so exercising the parsing/enforcement
// paths requires a fresh module instance per scenario via resetModules + a
// dynamic import — including for isConfiguredAddress, which is otherwise
// pure. A *static* top-of-file import would evaluate lib/config.ts against
// whatever the real, un-stubbed ambient env happens to be at file-collection
// time, before any vi.stubEnv call runs; if that ambient env is invalid
// (e.g. a real NEXT_PUBLIC_CHAIN_ID=31337 from a local-fork .env), the import
// throws and the entire file collapses to "0 tests" instead of failing one
// assertion.
async function loadConfig() {
  vi.resetModules();
  return import("@/lib/config");
}

// Every runtime/build var lib/config.ts reads, stubbed to unset before every test so no
// test's outcome depends on the ambient environment — each test then
// overrides only the variables it is exercising.
const ENV_KEYS = [
  "NEXT_PUBLIC_RUNTIME_PROFILE",
  "NEXT_PUBLIC_CHAIN_ID",
  "NEXT_PUBLIC_OVRFLO_FACTORY",
  "NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK",
  "NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH",
  "NEXT_PUBLIC_OVRFLO_ADDRESS",
  "NEXT_PUBLIC_OVRFLO_LENDING",
  "NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK",
  "NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH",
  "NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION",
  "NEXT_PUBLIC_ABI_VERSION",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_RPC_FALLBACK_URLS",
  "NEXT_PUBLIC_HISTORICAL_RPC_URL",
  "NEXT_PUBLIC_REOWN_PROJECT_ID",
  "NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS",
  "VERCEL_ENV",
  "OVRFLO_DEPLOYABLE_BUILD",
] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function stubValidProduction() {
  vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "production");
  vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1");
  vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", REAL_ADDRESS);
  vi.stubEnv("NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK", "123456");
  vi.stubEnv("NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH", BLOCK_HASH);
  vi.stubEnv("NEXT_PUBLIC_OVRFLO_ADDRESS", OVRFLO_ADDRESS);
  vi.stubEnv("NEXT_PUBLIC_OVRFLO_LENDING", LENDING_ADDRESS);
  vi.stubEnv("NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK", "123460");
  vi.stubEnv("NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH", LENDING_BLOCK_HASH);
  vi.stubEnv("NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION", "1");
  vi.stubEnv("NEXT_PUBLIC_ABI_VERSION", "1");
  vi.stubEnv("NEXT_PUBLIC_RPC_URL", "https://eth-mainnet.g.alchemy.com/v2/public-browser-key");
  vi.stubEnv(
    "NEXT_PUBLIC_RPC_FALLBACK_URLS",
    "https://rpc.example.com,https://rpc-backup.example.com",
  );
  vi.stubEnv("NEXT_PUBLIC_HISTORICAL_RPC_URL", "https://history.example.com");
  vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "1234567890abcdef1234567890abcdef");
  vi.stubEnv("NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS", REAL_ADDRESS);
}

describe("isConfiguredAddress", () => {
  it("is false for null, undefined, and the zero address; true otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    const mod = await loadConfig();
    expect(mod.isConfiguredAddress(null)).toBe(false);
    expect(mod.isConfiguredAddress(undefined)).toBe(false);
    expect(mod.isConfiguredAddress(ZERO_ADDRESS)).toBe(false);
    expect(mod.isConfiguredAddress(REAL_ADDRESS)).toBe(true);
  });
});

describe("chain id enforcement", () => {
  it("rejects a missing production chain id instead of assuming mainnet", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", undefined);
    await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_CHAIN_ID.*required/i);
  });

  it("accepts an explicit chain id of 1", async () => {
    stubValidProduction();
    const mod = await loadConfig();
    expect(mod.chainId).toBe(1);
  });

  it("throws for any non-mainnet chain id, including local-fork chain ids someone might guess", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "31337");
    await expect(loadConfig()).rejects.toThrow(/requires chain id 1/);
  });

  it("throws on an empty string instead of silently falling back to the mainnet default", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "");
    await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_CHAIN_ID.*required/i);
  });
});

describe("factory address parsing", () => {
  it("rejects a missing production factory", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", undefined);
    await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_OVRFLO_FACTORY.*required/i);
  });

  it("rejects a zero production factory", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", ZERO_ADDRESS);
    await expect(loadConfig()).rejects.toThrow(/must not be the zero address/i);
  });

  it("accepts a valid production address", async () => {
    stubValidProduction();
    const mod = await loadConfig();
    expect(mod.factoryAddress).toBe(REAL_ADDRESS);
  });

  it("throws on a malformed address instead of silently deploying against garbage", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", "not-an-address");
    await expect(loadConfig()).rejects.toThrow(/must be a valid address/);
  });
});

describe("deployment anchor parsing", () => {
  it("accepts a complete versioned deployment anchor", async () => {
    stubValidProduction();
    const mod = await loadConfig();
    expect(mod.factoryDeployment).toEqual({
      address: REAL_ADDRESS,
      blockNumber: 123456n,
      blockHash: BLOCK_HASH,
      ovrflo: OVRFLO_ADDRESS,
      lending: LENDING_ADDRESS,
      lendingBlockNumber: 123460n,
      lendingBlockHash: LENDING_BLOCK_HASH,
      projectionSchemaVersion: 1,
      abiVersion: 1,
    });
  });

  it.each([
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK", undefined],
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK", "-1"],
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH", undefined],
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH", "0x1234"],
    ["NEXT_PUBLIC_OVRFLO_ADDRESS", undefined],
    ["NEXT_PUBLIC_OVRFLO_LENDING", ZERO_ADDRESS],
    ["NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK", "-1"],
    ["NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH", "0x1234"],
    ["NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION", "2"],
    ["NEXT_PUBLIC_ABI_VERSION", "2"],
  ] as const)("rejects an invalid %s value", async (key, value) => {
    stubValidProduction();
    vi.stubEnv(key, value);
    await expect(loadConfig()).rejects.toThrow();
  });
});

describe("RPC configuration", () => {
  it("keeps the primary and fallbacks in operator order and a separate historical transport", async () => {
    stubValidProduction();
    const mod = await loadConfig();
    expect(mod.rpcUrls).toEqual([
      "https://eth-mainnet.g.alchemy.com/v2/public-browser-key",
      "https://rpc.example.com/",
      "https://rpc-backup.example.com/",
    ]);
    expect(mod.historicalRpcUrl).toBe("https://history.example.com/");
  });

  it("rejects missing production RPC configuration instead of adding a public fallback", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", undefined);
    await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_RPC_URL.*required/i);
  });

  it("throws on a malformed rpcUrl instead of silently pointing wagmi at garbage", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "not a url");
    await expect(loadConfig()).rejects.toThrow();
  });

  it.each([
    "https://eth-mainnet.alchemyapi.io/v2/key",
    "https://mainnet.alchemyapi.io/v2/key",
  ])("rejects deprecated Alchemy hosts: %s", async (url) => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", url);
    await expect(loadConfig()).rejects.toThrow(/alchemyapi\.io/i);
  });

  it("rejects localhost origins in the production profile", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "http://127.0.0.1:8545");
    await expect(loadConfig()).rejects.toThrow(/production.*localhost|local.*production/i);
  });
});

describe("reownProjectId", () => {
  it("rejects a missing production project id", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", undefined);
    await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_REOWN_PROJECT_ID.*required/i);
  });

  it.each(["", "00000000000000000000000000000000", "not-a-project-id"])(
    "rejects invalid production project id %j",
    async (projectId) => {
      stubValidProduction();
      vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", projectId);
      await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_REOWN_PROJECT_ID/i);
    },
  );
});

describe("local-only profile", () => {
  it("allows explicit local defaults outside a production deployment", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    const mod = await loadConfig();
    expect(mod.chainId).toBe(1);
    expect(mod.factoryAddress).toBe(ZERO_ADDRESS);
    expect(mod.rpcUrls).toEqual(["http://127.0.0.1:8545/"]);
  });

  it("cannot activate on a Vercel production deployment", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(loadConfig()).rejects.toThrow(/local.*production/i);
  });

  it("cannot activate in any deployable production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("OVRFLO_DEPLOYABLE_BUILD", "1");
    await expect(loadConfig()).rejects.toThrow(/local.*production/i);
  });
});
