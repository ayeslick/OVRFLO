import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REAL_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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

// All six vars lib/config.ts reads, stubbed to unset before every test so no
// test's outcome depends on the ambient environment — each test then
// overrides only the one (or two) variables it's actually exercising.
const ENV_KEYS = [
  "NEXT_PUBLIC_CHAIN_ID",
  "NEXT_PUBLIC_OVRFLO_FACTORY",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_REOWN_PROJECT_ID",
  "NEXT_PUBLIC_PONDER_URL",
  "NEXT_PUBLIC_SABLIER_INDEXER_URL",
] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isConfiguredAddress", () => {
  it("is false for null, undefined, and the zero address; true otherwise", async () => {
    const mod = await loadConfig();
    expect(mod.isConfiguredAddress(null)).toBe(false);
    expect(mod.isConfiguredAddress(undefined)).toBe(false);
    expect(mod.isConfiguredAddress(ZERO_ADDRESS)).toBe(false);
    expect(mod.isConfiguredAddress(REAL_ADDRESS)).toBe(true);
  });
});

describe("chain id enforcement", () => {
  it("defaults to mainnet (1) when NEXT_PUBLIC_CHAIN_ID is unset", async () => {
    const mod = await loadConfig();
    expect(mod.chainId).toBe(1);
  });

  it("accepts an explicit chain id of 1", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "1");
    const mod = await loadConfig();
    expect(mod.chainId).toBe(1);
  });

  it("throws for any non-mainnet chain id, including local-fork chain ids someone might guess", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "31337");
    await expect(loadConfig()).rejects.toThrow(/requires chain id 1/);
  });

  it("throws on an empty string instead of silently falling back to the mainnet default", async () => {
    // "" is not `undefined`, so the `raw = "1"` default parameter never
    // kicks in — Number.parseInt("", 10) is NaN, which fails the mainnet
    // check. Pinned because it would be easy to "fix" this into a silent
    // default with a `raw || "1"` change that reads equivalent at a glance.
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "");
    await expect(loadConfig()).rejects.toThrow(/requires chain id 1/);
  });
});

describe("factory address parsing", () => {
  it("defaults to the zero address when unset", async () => {
    const mod = await loadConfig();
    expect(mod.factoryAddress).toBe(ZERO_ADDRESS);
  });

  it("accepts a valid checksummed address", async () => {
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", REAL_ADDRESS);
    const mod = await loadConfig();
    expect(mod.factoryAddress).toBe(REAL_ADDRESS);
  });

  it("throws on a malformed address instead of silently deploying against garbage", async () => {
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", "not-an-address");
    await expect(loadConfig()).rejects.toThrow(/must be a valid address/);
  });
});

describe("optional URL fields", () => {
  it("leaves rpcUrl undefined when unset (falls back to wagmi's default transport)", async () => {
    const mod = await loadConfig();
    expect(mod.rpcUrl).toBeUndefined();
  });

  it("normalizes a set rpcUrl through the URL constructor", async () => {
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "http://127.0.0.1:8545");
    const mod = await loadConfig();
    expect(mod.rpcUrl).toBe("http://127.0.0.1:8545/");
  });

  it("throws on a malformed rpcUrl instead of silently pointing wagmi at garbage", async () => {
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "not a url");
    await expect(loadConfig()).rejects.toThrow();
  });

  it("falls back to the legacy sablier-indexer URL when ponderUrl is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SABLIER_INDEXER_URL", "http://localhost:42069/sql");
    const mod = await loadConfig();
    expect(mod.ponderUrl).toBe("http://localhost:42069/sql");
  });

  it("prefers the current ponderUrl var over the legacy fallback when both are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_PONDER_URL", "http://localhost:42069/sql");
    vi.stubEnv("NEXT_PUBLIC_SABLIER_INDEXER_URL", "http://localhost:9999/legacy");
    const mod = await loadConfig();
    expect(mod.ponderUrl).toBe("http://localhost:42069/sql");
  });
});

describe("reownProjectId", () => {
  it("falls back to the 32-zero placeholder when unset", async () => {
    const mod = await loadConfig();
    expect(mod.reownProjectId).toBe("00000000000000000000000000000000");
  });

  it("falls back to the placeholder for an empty string too (|| catches falsy, not just unset)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "");
    const mod = await loadConfig();
    expect(mod.reownProjectId).toBe("00000000000000000000000000000000");
  });
});
