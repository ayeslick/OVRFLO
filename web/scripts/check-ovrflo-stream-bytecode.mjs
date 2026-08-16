#!/usr/bin/env node
/**
 * SC11 — provenance gate for artifacts/OVRFLOStream.json.
 *
 * Chain (008 / zFi-adopted):
 *   fork source commit → compiler settings → artifact hash → ABI hash →
 *   creation + runtime bytecode hashes → vendored artifact → rebuild match.
 *
 * Precedent: check-wagmi-dedupe.mjs (fail the gate, do not warn).
 *
 * Fork path: OVRFLO_STREAMS_PATH, else sibling ../OVRFLO-Streams from repo root.
 * Builds in a detached temporary worktree at the stamped commit so the
 * developer's checkout HEAD does not need to match — but the worktree HEAD
 * must equal the stamped commit or the gate fails.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const ARTIFACT = join(REPO_ROOT, "artifacts/OVRFLOStream.json");
const PROVENANCE = join(REPO_ROOT, "artifacts/OVRFLOStream.provenance.md");

function fail(message) {
  console.error(`check-ovrflo-stream-bytecode: ${message}`);
  process.exit(1);
}

function parseProvenance(text) {
  const commit = /Fork commit:\s*`([0-9a-f]{40})`/i.exec(text)?.[1];
  if (!commit) fail("OVRFLOStream.provenance.md missing full 40-char Fork commit stamp");

  const solc = /solc:\s*`([^`]+)`/i.exec(text)?.[1];
  const runs = /optimizer:\s*enabled,\s*runs\s*`(\d+)`/i.exec(text)?.[1];
  const viaIrRaw = /via_ir:\s*`([^`]+)`/i.exec(text)?.[1];
  const evm = /EVM:\s*`([^`]+)`/i.exec(text)?.[1];
  const bytecodeHash = /bytecode_hash:\s*`([^`]+)`/i.exec(text)?.[1];
  const profile = /Foundry profile:\s*`([^`]+)`/i.exec(text)?.[1];

  const artifactSha = /Artifact sha256:\s*`([0-9a-f]{64})`/i.exec(text)?.[1];
  const abiSha = /ABI sha256:\s*`([0-9a-f]{64})`/i.exec(text)?.[1];
  const creationSha = /Creation-bytecode sha256:\s*`([0-9a-f]{64})`/i.exec(text)?.[1];
  const runtimeSha = /Runtime-bytecode sha256:\s*`([0-9a-f]{64})`/i.exec(text)?.[1];

  if (!solc || !runs || !viaIrRaw || !evm || !bytecodeHash || !profile) {
    fail("OVRFLOStream.provenance.md missing compiler settings stamps");
  }
  if (!artifactSha || !abiSha || !creationSha || !runtimeSha) {
    fail("OVRFLOStream.provenance.md missing provenance hash stamps");
  }

  return {
    commit,
    solc,
    optimizerRuns: Number(runs),
    viaIr: viaIrRaw === "true",
    evm,
    bytecodeHash,
    profile,
    artifactSha,
    abiSha,
    creationSha,
    runtimeSha,
  };
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

function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function bytecodeObject(field) {
  return typeof field === "string" ? field : field.object;
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

export function hashVendoredArtifact(artifactRaw, artifactJson) {
  const creation = normalizeBytecode(bytecodeObject(artifactJson.bytecode));
  const runtime = normalizeBytecode(bytecodeObject(artifactJson.deployedBytecode));
  return {
    artifactSha: sha256Bytes(artifactRaw),
    abiSha: sha256Bytes(Buffer.from(JSON.stringify(artifactJson.abi), "utf8")),
    creationSha: sha256Hex(creation),
    runtimeSha: sha256Hex(runtime),
    creation,
    runtime,
  };
}

function assertHash(label, expected, actual) {
  if (expected !== actual) {
    fail(`${label} mismatch\n  stamped: ${expected}\n  actual:  ${actual}`);
  }
}

function main() {
  if (!existsSync(ARTIFACT) || !existsSync(PROVENANCE)) {
    fail("missing artifacts/OVRFLOStream.json or provenance");
  }

  const stamp = parseProvenance(readFileSync(PROVENANCE, "utf8"));
  const artifactRaw = readFileSync(ARTIFACT);
  const committed = JSON.parse(artifactRaw.toString("utf8"));

  const metaHash = committed.metadata?.settings?.metadata?.bytecodeHash;
  if (metaHash !== "none") {
    fail(`committed artifact bytecode_hash must be "none" (got ${metaHash})`);
  }

  const solc = committed.metadata?.compiler?.version;
  const runs = committed.metadata?.settings?.optimizer?.runs;
  const enabled = committed.metadata?.settings?.optimizer?.enabled;
  const viaIr = Boolean(committed.metadata?.settings?.viaIR);
  const evm = committed.metadata?.settings?.evmVersion;

  if (solc !== stamp.solc) fail(`solc mismatch (stamped ${stamp.solc}, artifact ${solc})`);
  if (!enabled) fail("committed artifact optimizer must be enabled");
  if (runs !== stamp.optimizerRuns) {
    fail(`optimizer runs mismatch (stamped ${stamp.optimizerRuns}, artifact ${runs})`);
  }
  if (viaIr !== stamp.viaIr) {
    fail(`via_ir mismatch (stamped ${stamp.viaIr}, artifact ${viaIr})`);
  }
  if (evm !== stamp.evm) fail(`EVM mismatch (stamped ${stamp.evm}, artifact ${evm})`);
  if (stamp.bytecodeHash !== "none") fail(`stamped bytecode_hash must be "none" (got ${stamp.bytecodeHash})`);
  if (stamp.profile !== "default") {
    fail(`stamped Foundry profile must be "default" (got ${stamp.profile})`);
  }

  const hashes = hashVendoredArtifact(artifactRaw, committed);
  assertHash("Artifact sha256", stamp.artifactSha, hashes.artifactSha);
  assertHash("ABI sha256", stamp.abiSha, hashes.abiSha);
  assertHash("Creation-bytecode sha256", stamp.creationSha, hashes.creationSha);
  assertHash("Runtime-bytecode sha256", stamp.runtimeSha, hashes.runtimeSha);

  console.log(
    `check-ovrflo-stream-bytecode: provenance hashes ok (runtime ${hashes.runtime.length / 2} bytes)`,
  );

  const forkPath = resolveForkPath();
  if (!existsSync(join(forkPath, "foundry.toml"))) {
    fail(
      `fork not found at ${forkPath}\n` +
        "Set OVRFLO_STREAMS_PATH to the OVRFLO-Streams checkout.",
    );
  }

  execFileSync("git", ["-C", forkPath, "cat-file", "-e", `${stamp.commit}^{commit}`], {
    stdio: "ignore",
  });

  const worktree = join(tmpdir(), `ovrflo-sc11-${stamp.commit.slice(0, 12)}`);
  rmSync(worktree, { recursive: true, force: true });
  const outDir = join(worktree, "out-sc11");

  try {
    console.log(
      `check-ovrflo-stream-bytecode: worktree at ${stamp.commit} from ${forkPath}…`,
    );
    execFileSync("git", ["-C", forkPath, "worktree", "add", "--detach", worktree, stamp.commit], {
      stdio: "inherit",
    });

    const worktreeHead = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    if (worktreeHead !== stamp.commit) {
      fail(
        `fork worktree HEAD mismatch\n  stamped: ${stamp.commit}\n  worktree: ${worktreeHead}`,
      );
    }

    const forkModules = join(forkPath, "node_modules");
    const worktreeModules = join(worktree, "node_modules");
    if (!existsSync(forkModules)) {
      fail(`${forkModules} missing — run npm install in the fork`);
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
      fail(`rebuild artifact missing at ${rebuiltPath}`);
    }
    const rebuilt = JSON.parse(readFileSync(rebuiltPath, "utf8"));
    const rebuiltHashSetting = rebuilt.metadata?.settings?.metadata?.bytecodeHash;
    if (rebuiltHashSetting !== "none") {
      fail(`fork rebuild bytecode_hash must be "none" (got ${rebuiltHashSetting})`);
    }

    const result = compareBytecodes(
      bytecodeObject(committed.deployedBytecode),
      bytecodeObject(rebuilt.deployedBytecode),
    );
    if (!result.equal) {
      console.error("check-ovrflo-stream-bytecode: deployedBytecode mismatch");
      console.error(`  committed sha256: ${result.committedHash} (${result.committedLen} bytes)`);
      console.error(`  rebuilt   sha256: ${result.rebuiltHash} (${result.rebuiltLen} bytes)`);
      process.exit(1);
    }

    if (result.committedHash !== stamp.runtimeSha) {
      fail(
        `rebuild runtime hash drifted from stamp\n  stamped: ${stamp.runtimeSha}\n  rebuild: ${result.committedHash}`,
      );
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
