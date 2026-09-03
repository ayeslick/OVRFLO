import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PENDLE_PRICE_IMPACT_BPS, PENDLE_SLIPPAGE_BPS } from "@/lib/default/policy";

describe("Hosted Convert policy ownership", () => {
  it("defines the two constants once in the policy module", () => {
    expect(PENDLE_SLIPPAGE_BPS).toBe(50n);
    expect(MAX_PENDLE_PRICE_IMPACT_BPS).toBe(100n);
    const policy = readFileSync(resolve(process.cwd(), "lib/default/policy.ts"), "utf8");
    expect(policy).toMatch(/PENDLE_SLIPPAGE_BPS = 50n/);
    expect(policy).toMatch(/MAX_PENDLE_PRICE_IMPACT_BPS = 100n/);
    const modal = readFileSync(resolve(process.cwd(), "lib/modal-logic.ts"), "utf8");
    expect(modal).toMatch(/from "\.\/default\/policy"/);
    expect(modal).not.toMatch(/const DEFAULT_SLIPPAGE_BPS = 50n/);
  });
});
