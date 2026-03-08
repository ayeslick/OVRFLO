/**
 * Tests: T-WEB-011
 *
 * T-WEB-011: Missing required env (factory/chain) fails with clear diagnostics.
 *
 * Note: The env is currently stubbed in tests/setup.ts so the module loads.
 * These tests verify the behavior of the constants module with controlled env.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";

const DEFAULT_ENV = {
  NEXT_PUBLIC_OVRFLO_FACTORY: "0x0000000000000000000000000000000000000001",
  NEXT_PUBLIC_CHAIN_ID: "1",
  NEXT_PUBLIC_REOWN_PROJECT_ID: "test-project-id",
};

async function importFreshConstants() {
  vi.resetModules();
  return import("@/lib/constants");
}

beforeEach(() => {
  Object.entries(DEFAULT_ENV).forEach(([key, value]) => vi.stubEnv(key, value));
});

describe("constants (T-WEB-011)", () => {
  it("T-WEB-011: SABLIER_LOCKUP is a valid address string", async () => {
    const { SABLIER_LOCKUP } = await importFreshConstants();
    expect(SABLIER_LOCKUP).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("T-WEB-011: CHAIN_ID is pinned to mainnet when env is '1'", async () => {
    const { CHAIN_ID, CHAIN_NAME } = await importFreshConstants();
    expect(CHAIN_ID).toBe(1);
    expect(CHAIN_NAME).toBe("Ethereum Mainnet");
  });

  it("T-WEB-011: SABLIER_ENVIO_URL is a valid URL", async () => {
    const { SABLIER_ENVIO_URL, PENDLE_ORACLE } = await importFreshConstants();
    expect(SABLIER_ENVIO_URL).toMatch(/^https:\/\//);
    expect(PENDLE_ORACLE).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("T-WEB-011: NEXT_PUBLIC_RPC_URL is optional", async () => {
    delete process.env.NEXT_PUBLIC_RPC_URL;

    const { OVRFLO_FACTORY } = await importFreshConstants();
    expect(OVRFLO_FACTORY).toBe(DEFAULT_ENV.NEXT_PUBLIC_OVRFLO_FACTORY);
  });

  it("T-WEB-011: OVRFLO_FACTORY is defined from env", async () => {
    const { OVRFLO_FACTORY } = await importFreshConstants();
    expect(OVRFLO_FACTORY).toBeTruthy();
    expect(typeof OVRFLO_FACTORY).toBe("string");
  });

  it("T-WEB-011: rejects non-mainnet NEXT_PUBLIC_CHAIN_ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "11155111");

    await expect(importFreshConstants()).rejects.toThrow("mainnet");
  });

  it("T-WEB-011: rejects an invalid factory address", async () => {
    vi.stubEnv("NEXT_PUBLIC_OVRFLO_FACTORY", "not-an-address");

    await expect(importFreshConstants()).rejects.toThrow(
      "Invalid factory address list"
    );
  });
});
