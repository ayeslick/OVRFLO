import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

describe("U9 live discovery cutover", () => {
  it("keeps gatherLiquidity out of every live, fixture, stress, and walkthrough consumer", () => {
    const consumers = [
      ...sourceFiles("components"),
      ...sourceFiles("hooks"),
      ...sourceFiles("lib").filter(
        (path) =>
          path !== "lib/generated.ts" &&
          path !== "lib/discovery/parity-instrumentation.ts",
      ),
      ...sourceFiles("tests/e2e"),
      "../script/local-stress-test.sh",
      "../tools/scripts/walkthrough-local.sh",
    ];

    for (const consumer of consumers) {
      expect(source(consumer), consumer).not.toContain("gatherLiquidity");
    }
  });

  it("routes the legacy indexer through parity instrumentation only", () => {
    const liveConsumers = [
      ...sourceFiles("components"),
      ...sourceFiles("hooks").filter(
        (path) => path !== "hooks/useIndexerSync.ts",
      ),
      ...sourceFiles("tests/e2e"),
    ];

    for (const consumer of liveConsumers) {
      expect(source(consumer), consumer).not.toMatch(
        /from ["']@?\/?.*(?:ponder|useIndexerSync)["']/,
      );
    }
    const parity = source("lib/discovery/parity-instrumentation.ts");
    expect(parity).toContain("fetchBorrowDemand");
    expect(parity).toContain("fetchHeldStreamIds");
  });
});
