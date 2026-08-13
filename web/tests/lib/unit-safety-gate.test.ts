import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const U5_LIBS = [
  "lib/units.ts",
  "lib/parse.ts",
  "lib/ladder.ts",
  "lib/payoff.ts",
  "lib/lending-math.ts",
  "lib/errors.ts",
  "lib/format.ts",
  "lib/usd.ts",
  "lib/freshness.ts",
] as const;

const CAST_ALLOW = new Set(["lib/units.ts", "lib/parse.ts", "lib/generated.ts"]);
const BRAND_CAST =
  /\bas (?:Wei|WstethWei|OvrfloWei|Usd8|Bps|TickBps)\b|\bas Amount</;

const REACT_IMPORT =
  /from\s+["'](?:react|react-dom|react\/[^"']+|next\/[^"']+|@\/hooks\/|@\/components\/|@\/app\/)/;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sourceFiles(path: string): string[] {
  const absolute = resolve(process.cwd(), path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

describe("U5 unit-safety operator gate", () => {
  it("keeps U5 lib modules free of React, Next, hooks, and component imports", () => {
    for (const path of U5_LIBS) {
      expect(source(path), path).not.toMatch(REACT_IMPORT);
    }
  });

  it("bans brand casts outside units.ts and parse.ts constructors", () => {
    const roots = ["lib", "hooks", "components", "app"].flatMap((root) => {
      try {
        return sourceFiles(root);
      } catch {
        return [];
      }
    });
    const violations: string[] = [];
    for (const path of roots) {
      if (CAST_ALLOW.has(path)) continue;
      const text = source(path);
      for (const [index, line] of text.split("\n").entries()) {
        if (BRAND_CAST.test(line)) violations.push(`${path}:${index + 1}:${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
