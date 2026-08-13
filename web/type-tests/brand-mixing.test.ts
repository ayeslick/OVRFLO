import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { add, wei } from "@/lib/units";

describe("brand mixing (KTD8)", () => {
  it("allows matching brands at runtime", () => {
    expect(add(wei(1n), wei(2n))).toBe(3n);
  });

  it("keeps a type-level test that rejects cross-brand helper arguments", () => {
    const source = readFileSync(resolve(process.cwd(), "type-tests/brand-mixing.ts"), "utf8");
    expect(source).toMatch(/@ts-expect-error KTD8: Wei and WstethWei/);
    expect(source).toMatch(/add\(wei\(1n\),\s*wstethWei\(1n\)\)/);
    expect(source).toMatch(/add\(wstethWei\(1n\),\s*usd8\(1n\)\)/);
    expect(source).toMatch(/sub\(ovrfloWei\(2n\),\s*wei\(1n\)\)/);
    expect(source).toMatch(/add\(bps\(1n\),\s*wei\(1n\)\)/);
    expect(source).toMatch(/min\(usd8\(1n\),\s*ovrfloWei\(1n\)\)/);
  });
});
