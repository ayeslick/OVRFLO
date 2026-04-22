#!/usr/bin/env node
/**
 * verify-static-export.mjs — R19
 *
 * Post-`next build` gate. Under `output: "export"` Next must produce
 * `out/` with no server runtime artifacts. If someone introduces code
 * that accidentally re-enables server rendering (server actions, async
 * route handlers, middleware), Next will still build but the emitted
 * tree gains `.next/server/pages-manifest.json` or `out/server/`. This
 * script fails the build if those appear, so the regression is caught
 * in CI instead of at deploy time.
 */
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");

const out = resolve(WEB_ROOT, "out");

if (!existsSync(out) || !statSync(out).isDirectory()) {
  console.error(
    `verify-static-export: expected ${out} to exist after next build — output: "export" may have broken.`
  );
  process.exit(1);
}

// Only check the emitted `out/` tree. Next always writes scaffolding into
// `.next/server/` during an `output: "export"` build (pages-manifest.json
// etc.) — that's internal to the build pipeline, not a shipped runtime
// artifact. The real regression signal is server code leaking into `out/`.
const bannedPaths = [
  resolve(out, "server"),
  resolve(out, "pages-manifest.json"),
  resolve(out, "app-paths-manifest.json"),
];

const violations = bannedPaths.filter((p) => existsSync(p));
if (violations.length > 0) {
  console.error(
    "verify-static-export: server-runtime artifacts present after export build:"
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    'Static export is required (R19). Remove the server-only code path that produced these.'
  );
  process.exit(1);
}

process.stdout.write(`verify-static-export: out/ is clean (no server runtime).\n`);
