import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REAL_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;

async function loadConfig() {
  vi.resetModules();
  return import("@/lib/config");
}

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
  "NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS",
  "NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION",
  "NEXT_PUBLIC_ABI_VERSION",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_RPC_FALLBACK_URLS",
  "NEXT_PUBLIC_HISTORICAL_RPC_URL",
  "NEXT_PUBLIC_REOWN_PROJECT_ID",
  "VERCEL_ENV",
  "OVRFLO_DEPLOYABLE_BUILD",
  "NODE_ENV",
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
  vi.stubEnv("NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION", "1");
  vi.stubEnv("NEXT_PUBLIC_ABI_VERSION", "1");
  vi.stubEnv("NEXT_PUBLIC_RPC_URL", "https://eth-mainnet.g.alchemy.com/v2/public-browser-key");
  vi.stubEnv(
    "NEXT_PUBLIC_RPC_FALLBACK_URLS",
    "https://rpc.example.com,https://rpc-backup.example.com",
  );
  vi.stubEnv("NEXT_PUBLIC_HISTORICAL_RPC_URL", "https://history.example.com");
  vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "1234567890abcdef1234567890abcdef");
}

describe("isConfiguredAddress", () => {
  it("is false for null, undefined, and the zero address; true otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", REAL_ADDRESS);
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

  it("rejects a missing local factory instead of degrading to the zero address", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", undefined);
    await expect(loadConfig()).rejects.toThrow(/NEXT_PUBLIC_OVRFLO_FACTORY.*required/i);
  });

  it("rejects a zero factory in both profiles", async () => {
    stubValidProduction();
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", ZERO_ADDRESS);
    await expect(loadConfig()).rejects.toThrow(/must not be the zero address/i);

    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
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
  it("accepts a factory-only versioned deployment anchor", async () => {
    stubValidProduction();
    const mod = await loadConfig();
    expect(mod.factoryDeployment).toEqual({
      address: REAL_ADDRESS,
      blockNumber: 123456n,
      blockHash: BLOCK_HASH,
      projectionSchemaVersion: 1,
      abiVersion: 1,
    });
  });

  it.each([
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK", undefined],
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK", "-1"],
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH", undefined],
    ["NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH", "0x1234"],
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

describe("obsolete derived address env vars", () => {
  it("loads without requiring stream, vault, or lending env vars", async () => {
    stubValidProduction();
    const mod = await loadConfig();
    expect(mod.factoryAddress).toBe(REAL_ADDRESS);
    expect("SABLIER_LOCKUP_ADDRESS" in mod).toBe(false);
  });

  it("emits a dev-mode warning when an obsolete var is present", async () => {
    stubValidProduction();
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS", REAL_ADDRESS);
    await loadConfig();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS is obsolete"),
    );
    warn.mockRestore();
  });
});

describe("local-only profile", () => {
  it("requires an explicit factory and keeps mainnet chain id", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", REAL_ADDRESS);
    const mod = await loadConfig();
    expect(mod.chainId).toBe(1);
    expect(mod.factoryAddress).toBe(REAL_ADDRESS);
    expect(mod.rpcUrls).toEqual(["http://127.0.0.1:8545/"]);
  });

  it("cannot activate on a Vercel production deployment", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", REAL_ADDRESS);
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(loadConfig()).rejects.toThrow(/local.*production/i);
  });

  it("cannot activate when OVRFLO_DEPLOYABLE_BUILD is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_RUNTIME_PROFILE", "local");
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", REAL_ADDRESS);
    vi.stubEnv("OVRFLO_DEPLOYABLE_BUILD", "1");
    await expect(loadConfig()).rejects.toThrow(/local.*production/i);
  });
});
