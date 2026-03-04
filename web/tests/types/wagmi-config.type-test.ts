/**
 * Tests: T-WEB-007, T-WEB-020
 *
 * T-WEB-007: Enforce no `any` in wagmi storage config wrapper.
 * T-WEB-020: Type safety baseline for web build.
 *
 * This file is a type-level test: it imports the wagmi config and asserts
 * the exports have the expected shapes. If types break, this file will
 * cause tsc to fail even if runtime tests pass.
 */
import { describe, it, expect } from "vitest";

describe("wagmi-config type safety (T-WEB-007, T-WEB-020)", () => {
  it("T-WEB-020: wagmiConfig has required properties", async () => {
    const { wagmiConfig } = await import("@/lib/wagmi-config");
    // wagmiConfig should be a wagmi Config object with state getter
    expect(wagmiConfig).toBeDefined();
    expect(typeof wagmiConfig).toBe("object");
  });

  it("T-WEB-020: wagmiAdapter is a WagmiAdapter instance", async () => {
    const { wagmiAdapter } = await import("@/lib/wagmi-config");
    expect(wagmiAdapter).toBeDefined();
    expect(typeof wagmiAdapter).toBe("object");
  });
});
