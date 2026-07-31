#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(WEB_ROOT, "..");

const before = trackedDiff();
let failed = null;
try {
  run(process.execPath, [resolve(SCRIPT_DIR, "verify-deployment-input.mjs")]);
  run("npm", ["run", "typegen"]);
  run(process.execPath, [resolve(SCRIPT_DIR, "build-csp.mjs")]);
  run("npm", ["exec", "--", "next", "build"]);
  run(process.execPath, [resolve(SCRIPT_DIR, "csp-hash-inline.mjs")]);
  run(process.execPath, [resolve(SCRIPT_DIR, "verify-static-export.mjs")]);
} catch (error) {
  failed = error;
}
const after = trackedDiff();
if (before !== after) {
  throw new Error(
    "immutable-build: tracked inputs changed during the build. Generated security data must remain under build/, out/, or .vercel/output/.",
    { cause: failed ?? undefined },
  );
}
if (failed) throw failed;
process.stdout.write("immutable-build: tracked inputs remained byte-identical\n");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: WEB_ROOT,
    env: { ...process.env, OVRFLO_DEPLOYABLE_BUILD: "1" },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`immutable-build: ${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function trackedDiff() {
  const result = spawnSync("git", ["diff", "--binary", "--", "."], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("immutable-build: could not inspect tracked inputs");
  return result.stdout;
}
