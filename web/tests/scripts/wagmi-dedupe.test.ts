import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWagmiDedupe } from "../../scripts/check-wagmi-dedupe.mjs";

// A dedupe guard that cannot fail is worse than no guard: it reports green
// while the split it exists to catch is present. These build the duplicate
// layouts npm actually produces — a nested copy under a dependant, and a
// second scoped copy — and assert the guard goes red for each.

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function scratchModules() {
  const root = await mkdtemp(join(tmpdir(), "ovrflo-wagmi-dedupe-"));
  temporaryDirectories.push(root);
  return join(root, "node_modules");
}

function installPackage(modulesDir: string, name: string, version: string) {
  const dir = join(modulesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
}

describe("check-wagmi-dedupe", () => {
  it("passes when every guarded package resolves to one version", async () => {
    const modules = await scratchModules();
    installPackage(modules, "@wagmi/core", "3.6.3");
    installPackage(modules, "@wagmi/connectors", "8.0.24");

    expect(checkWagmiDedupe(modules)).toEqual([]);
  });

  it("fails on a nested duplicate, the layout npm produces for a peer range", async () => {
    const modules = await scratchModules();
    installPackage(modules, "@wagmi/core", "3.6.3");
    // What the Reown adapter's `@wagmi/core: ">=2.21.2"` peer produced before
    // the overrides block: its own copy, nested under the dependant.
    installPackage(join(modules, "@reown", "appkit-adapter-wagmi", "node_modules"), "@wagmi/core", "3.4.0");

    const violations = checkWagmiDedupe(modules);
    expect(violations).toHaveLength(1);
    const [violation] = violations;
    expect(violation?.pkg).toBe("@wagmi/core");
    expect([...(violation?.installs.keys() ?? [])].sort()).toEqual(["3.4.0", "3.6.3"]);
  });

  it("reports each guarded package independently", async () => {
    const modules = await scratchModules();
    installPackage(modules, "@wagmi/core", "3.6.3");
    installPackage(modules, "@wagmi/connectors", "8.0.24");
    installPackage(join(modules, "wagmi", "node_modules"), "@wagmi/core", "3.4.0");
    installPackage(join(modules, "wagmi", "node_modules"), "@wagmi/connectors", "7.2.1");

    const violations = checkWagmiDedupe(modules);
    expect(violations.map((entry) => entry.pkg).sort()).toEqual(["@wagmi/connectors", "@wagmi/core"]);
  });
});
