#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// The Reown adapter and wagmi each reach @wagmi/core and @wagmi/connectors
// through their own ranges. When npm resolves those to different versions, the
// adapter builds a `Config` with one copy and `WagmiProvider` consumes it with
// another: `Config` becomes two nominally distinct types, lib/wagmi.ts stops
// compiling without an `as unknown as` cast, and that cast then hides any real
// incompatibility between the two versions — at the one seam where a wallet
// connection either propagates to the app's hooks or silently does not.
//
// package.json `overrides` pins both to a single version. This check fails the
// build if a future install reintroduces the split, so the fix cannot regress
// unnoticed the way it arrived.

const GUARDED = ["@wagmi/core", "@wagmi/connectors"];

/** Every installed copy of `pkg`, keyed by version → install paths. */
function findInstalls(root, pkg) {
  const found = new Map();
  const seen = new Set();

  function visitModulesDir(modulesDir) {
    const manifest = join(modulesDir, pkg, "package.json");
    if (existsSync(manifest)) {
      const { version } = JSON.parse(readFileSync(manifest, "utf8"));
      if (!found.has(version)) found.set(version, []);
      found.get(version).push(join(modulesDir, pkg));
    }
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      descend(join(modulesDir, entry.name));
    }
  }

  function descend(dir) {
    if (seen.has(dir)) return;
    seen.add(dir);
    const nested = join(dir, "node_modules");
    if (existsSync(nested) && statSync(nested).isDirectory()) {
      visitModulesDir(nested);
    }
    // Scoped dirs (@reown/…) hold packages, not node_modules, so step through.
    if (dir.split("/").pop()?.startsWith("@")) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) descend(join(dir, entry.name));
      }
    }
  }

  visitModulesDir(root);
  return found;
}

export function checkWagmiDedupe(root = resolve(process.cwd(), "node_modules")) {
  const violations = [];
  for (const pkg of GUARDED) {
    const installs = findInstalls(root, pkg);
    if (installs.size > 1) {
      violations.push({ pkg, installs });
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = checkWagmiDedupe();
  if (violations.length === 0) {
    console.log("check-wagmi-dedupe: ok — one copy each of " + GUARDED.join(", "));
    process.exit(0);
  }
  for (const { pkg, installs } of violations) {
    console.error(`check-wagmi-dedupe: ${pkg} resolved to ${installs.size} versions:`);
    for (const [version, paths] of installs) {
      console.error(`  ${version}`);
      for (const path of paths) console.error(`    ${path}`);
    }
  }
  console.error(
    "\nPin the duplicate in package.json `overrides`, then re-run `npm install`.\n" +
      "See the comment above `wagmiConfig` in lib/wagmi.ts for why this matters.",
  );
  process.exit(1);
}
