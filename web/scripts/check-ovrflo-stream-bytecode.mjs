#!/usr/bin/env node
/**
 * SC11 — rebuild OVRFLOStream at the stamped fork commit and compare
 * deployedBytecode to artifacts/OVRFLOStream.json.
 *
 * Precedent: check-wagmi-dedupe.mjs (fail the gate, do not warn).
 *
 * Fork path: OVRFLO_STREAMS_PATH, else sibling ../OVRFLO-Streams from repo root.
 * Builds in a detached temporary worktree at the stamped commit so the
 * developer's checkout HEAD does not need to match.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const ARTIFACT = join(REPO_ROOT, "artifacts/OVRFLOStream.json");
const PROVENANCE = join(REPO_ROOT, "artifacts/OVRFLOStream.provenance.md");

function parseProvenance(text) {
  const commit = /Fork commit:\s*`([0-9a-f]{7,40})`/i.exec(text)?.[1];
  if (!commit) throw new Error("OVRFLOStream.provenance.md missing Fork commit stamp");
  return { commit };
}

function resolveForkPath() {
  if (process.env.OVRFLO_STREAMS_PATH) return resolve(process.env.OVRFLO_STREAMS_PATH);
  return resolve(REPO_ROOT, "../OVRFLO-Streams");
}

function strip0x(hex) {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

function normalizeBytecode(raw) {
  const hex = strip0x(String(raw)).toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex) || hex.length === 0) {
    throw new Error("Bytecode is empty or not hex");
  }
  return hex;
}

function sha256Hex(hex) {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

export function compareBytecodes(committedHex, rebuiltHex) {
  const a = normalizeBytecode(committedHex);
  const b = normalizeBytecode(rebuiltHex);
  return {
    equal: a === b,
    committedHash: sha256Hex(a),
    rebuiltHash: sha256Hex(b),
    committedLen: a.length / 2,
    rebuiltLen: b.length / 2,
  };
}

function main() {
  if (!existsSync(ARTIFACT) || !existsSync(PROVENANCE)) {
    console.error("check-ovrflo-stream-bytecode: missing artifacts/OVRFLOStream.json or provenance");
    process.exit(1);
  }

  const { commit } = parseProvenance(readFileSync(PROVENANCE, "utf8"));
  const committed = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const metaHash = committed.metadata?.settings?.metadata?.bytecodeHash;
  if (metaHash !== "none") {
    console.error(
      `check-ovrflo-stream-bytecode: committed artifact bytecode_hash must be "none" (got ${metaHash})`,
    );
    process.exit(1);
  }

  const forkPath = resolveForkPath();
  if (!existsSync(join(forkPath, "foundry.toml"))) {
    console.error(
      `check-ovrflo-stream-bytecode: fork not found at ${forkPath}\n` +
        "Set OVRFLO_STREAMS_PATH to the OVRFLO-Streams checkout.",
    );
    process.exit(1);
  }

  execFileSync("git", ["-C", forkPath, "cat-file", "-e", `${commit}^{commit}`], {
    stdio: "ignore",
  });

  const worktree = join(tmpdir(), `ovrflo-sc11-${commit.slice(0, 12)}`);
  rmSync(worktree, { recursive: true, force: true });
  const outDir = join(worktree, "out-sc11");

  try {
    console.log(
      `check-ovrflo-stream-bytecode: worktree at ${commit} from ${forkPath}…`,
    );
    execFileSync("git", ["-C", forkPath, "worktree", "add", "--detach", worktree, commit], {
      stdio: "inherit",
    });

    const forkModules = join(forkPath, "node_modules");
    const worktreeModules = join(worktree, "node_modules");
    if (!existsSync(forkModules)) {
      console.error(
        `check-ovrflo-stream-bytecode: ${forkModules} missing — run npm install in the fork`,
      );
      process.exit(1);
    }
    if (!existsSync(worktreeModules)) {
      execFileSync("ln", ["-s", forkModules, worktreeModules], { stdio: "inherit" });
    }

    console.log("check-ovrflo-stream-bytecode: forge build…");
    execFileSync("forge", ["build", "--skip", "test", "--out", outDir], {
      cwd: worktree,
      stdio: "inherit",
    });

    const rebuiltPath = join(outDir, "SablierV2LockupLinear.sol/SablierV2LockupLinear.json");
    if (!existsSync(rebuiltPath)) {
      console.error(`check-ovrflo-stream-bytecode: rebuild artifact missing at ${rebuiltPath}`);
      process.exit(1);
    }
    const rebuilt = JSON.parse(readFileSync(rebuiltPath, "utf8"));
    const rebuiltHashSetting = rebuilt.metadata?.settings?.metadata?.bytecodeHash;
    if (rebuiltHashSetting !== "none") {
      console.error(
        `check-ovrflo-stream-bytecode: fork rebuild bytecode_hash must be "none" (got ${rebuiltHashSetting})`,
      );
      process.exit(1);
    }

    const committedObject =
      typeof committed.deployedBytecode === "string"
        ? committed.deployedBytecode
        : committed.deployedBytecode.object;
    const rebuiltObject =
      typeof rebuilt.deployedBytecode === "string"
        ? rebuilt.deployedBytecode
        : rebuilt.deployedBytecode.object;

    const result = compareBytecodes(committedObject, rebuiltObject);
    if (!result.equal) {
      console.error("check-ovrflo-stream-bytecode: deployedBytecode mismatch");
      console.error(`  committed sha256: ${result.committedHash} (${result.committedLen} bytes)`);
      console.error(`  rebuilt   sha256: ${result.rebuiltHash} (${result.rebuiltLen} bytes)`);
      process.exit(1);
    }

    console.log(
      `check-ovrflo-stream-bytecode: ok — deployedBytecode matches (${result.committedLen} bytes, sha256 ${result.committedHash})`,
    );
  } finally {
    try {
      execFileSync("git", ["-C", forkPath, "worktree", "remove", "--force", worktree], {
        stdio: "ignore",
      });
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect) {
  main();
}
