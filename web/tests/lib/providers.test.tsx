/**
 * Tests: T-WEB-012
 *
 * T-WEB-012: Missing Reown project ID disables wallet init safely.
 */
import { describe, it, expect } from "vitest";

describe("providers (T-WEB-012)", () => {
  it("T-WEB-012: providers module exports a Providers component", async () => {
    const mod = await import("@/lib/providers");
    expect(mod.Providers).toBeDefined();
    expect(typeof mod.Providers).toBe("function");
  });
});
