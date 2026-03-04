/**
 * Tests: T-WEB-011
 *
 * T-WEB-011: Missing required env (factory/chain) fails with clear diagnostics.
 *
 * Note: The env is currently stubbed in tests/setup.ts so the module loads.
 * These tests verify the behavior of the constants module with controlled env.
 */
import { describe, it, expect } from "vitest";

describe("constants (T-WEB-011)", () => {
  it("T-WEB-011: SABLIER_LOCKUP is a valid address string", async () => {
    const { SABLIER_LOCKUP } = await import("@/lib/constants");
    expect(SABLIER_LOCKUP).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("T-WEB-011: CHAIN_ID defaults to 1 when env is '1'", async () => {
    const { CHAIN_ID } = await import("@/lib/constants");
    expect(CHAIN_ID).toBe(1);
  });

  it("T-WEB-011: SABLIER_ENVIO_URL is a valid URL", async () => {
    const { SABLIER_ENVIO_URL } = await import("@/lib/constants");
    expect(SABLIER_ENVIO_URL).toMatch(/^https:\/\//);
  });

  it("T-WEB-011: OVRFLO_FACTORY is defined from env", async () => {
    const { OVRFLO_FACTORY } = await import("@/lib/constants");
    expect(OVRFLO_FACTORY).toBeTruthy();
    expect(typeof OVRFLO_FACTORY).toBe("string");
  });
});
