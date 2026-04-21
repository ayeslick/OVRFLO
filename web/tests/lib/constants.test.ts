/**
 * Tests: T-WEB-011
 *
 * T-WEB-011: Missing required env (factory/chain) fails with clear diagnostics.
 *
 * Verifies the behavior of the config module with controlled env.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";

const DEFAULT_ENV = {
  NEXT_PUBLIC_OVRFLO_FACTORY: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_CHAIN_ID: "1",
  NEXT_PUBLIC_REOWN_PROJECT_ID: "test-project-id",
};

async function importFreshConfig() {
  vi.resetModules();
  return import("@/lib/config");
}

beforeEach(() => {
  Object.entries(DEFAULT_ENV).forEach(([key, value]) => vi.stubEnv(key, value));
});

describe("config (T-WEB-011)", () => {
  it("T-WEB-011: SABLIER_LOCKUP is a valid address string", async () => {
    const { SABLIER_LOCKUP } = await importFreshConfig();
    expect(SABLIER_LOCKUP).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("T-WEB-011: CHAIN_ID is pinned to mainnet when env is '1'", async () => {
    const { CHAIN_ID, CHAIN_NAME } = await importFreshConfig();
    expect(CHAIN_ID).toBe(1);
    expect(CHAIN_NAME).toBe("Ethereum Mainnet");
  });

  it("T-WEB-011: PENDLE_ORACLE and PRICE_API_URL resolve to sane defaults", async () => {
    const { PENDLE_ORACLE, PRICE_API_URL } = await importFreshConfig();
    expect(PENDLE_ORACLE).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(PRICE_API_URL).toMatch(/^https?:\/\//);
  });

  it("T-WEB-011: NEXT_PUBLIC_RPC_URL is optional", async () => {
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "");
    const { OVRFLO_FACTORY } = await importFreshConfig();
    expect(OVRFLO_FACTORY).toBe(DEFAULT_ENV.NEXT_PUBLIC_OVRFLO_FACTORY);
  });

  it("T-WEB-011: OVRFLO_FACTORY is defined from env", async () => {
    const { OVRFLO_FACTORY } = await importFreshConfig();
    expect(OVRFLO_FACTORY).toBeTruthy();
    expect(typeof OVRFLO_FACTORY).toBe("string");
  });

  it("T-WEB-011: FACTORY_FROM_BLOCK defaults to 0n when unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_FACTORY_FROM_BLOCK", "");
    const { FACTORY_FROM_BLOCK } = await importFreshConfig();
    expect(FACTORY_FROM_BLOCK).toBe(0n);
  });

  it("T-WEB-011: FACTORY_FROM_BLOCK parses a provided number", async () => {
    vi.stubEnv("NEXT_PUBLIC_FACTORY_FROM_BLOCK", "22000000");
    const { FACTORY_FROM_BLOCK } = await importFreshConfig();
    expect(FACTORY_FROM_BLOCK).toBe(22_000_000n);
  });

  it("T-WEB-011: rejects non-mainnet NEXT_PUBLIC_CHAIN_ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "11155111");
    await expect(importFreshConfig()).rejects.toThrow();
  });

  it("T-WEB-011: rejects an invalid factory address", async () => {
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", "not-an-address");
    await expect(importFreshConfig()).rejects.toThrow();
  });
});
