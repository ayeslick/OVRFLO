import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LENS_PROVENANCE, ovrfloStreamLensAbi } from "@/lib/generated/lens-bytecode";
import {
  formatStaleCreationMessage,
  parseEmbeddedLens,
} from "../../../scripts/check-lens-bytecode.mjs";
import { compareBytecodes } from "../../../scripts/check-ovrflo-stream-bytecode.mjs";

const webRoot = join(import.meta.dirname, "../../..");
const gate = join(webRoot, "scripts/check-lens-bytecode.mjs");

function streamViewComponents() {
  const batch = ovrfloStreamLensAbi.find(
    (entry) => entry.type === "function" && entry.name === "streamsOfOwner",
  );
  if (!batch || batch.type !== "function") throw new Error("streamsOfOwner missing from lens ABI");
  const output = batch.outputs[0];
  if (!output || !("components" in output) || !output.components) {
    throw new Error("StreamView components missing");
  }
  return output.components.map((component) => component.name);
}

describe("lens bytecode drift gate", () => {
  it("embeds contract StreamView fields, not the stale plan Interface block", () => {
    const names = streamViewComponents();
    expect(names).toContain("withdrawableAmount");
    expect(names).not.toContain("withdrawable");
    expect(names.indexOf("isDepleted")).toBeGreaterThan(-1);
    expect(names.indexOf("wasCanceled")).toBeGreaterThan(-1);
    expect(names.indexOf("ok")).toBeGreaterThan(names.indexOf("wasCanceled"));
    expect(names.indexOf("isDepleted")).toBeLessThan(names.indexOf("ok"));
  });

  it("stamps solc 0.8.36, optimizer 200, via-IR, and a source hash", () => {
    expect(LENS_PROVENANCE.solc).toBe("0.8.36");
    expect(LENS_PROVENANCE.optimizerRuns).toBe(200);
    expect(LENS_PROVENANCE.viaIr).toBe(true);
    expect(LENS_PROVENANCE.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const embedded = parseEmbeddedLens(readFileSync(join(webRoot, "lib/generated/lens-bytecode.ts"), "utf8"));
    expect(embedded.sourceSha256).toBe(LENS_PROVENANCE.sourceSha256);
  });

  it("fails loudly when embedded creation bytecode is stale", () => {
    const result = compareBytecodes("0xaaa", "0xbbb");
    expect(result.equal).toBe(false);
    expect(formatStaleCreationMessage(result)).toMatch(/stale/i);

    const spawned = spawnSync(process.execPath, [gate], {
      cwd: webRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CHECK_LENS_SKIP_BUILD: "1",
        CHECK_LENS_REBUILT_BYTECODE: "0x00",
      },
    });
    expect(spawned.status).toBe(1);
    expect(`${spawned.stdout}\n${spawned.stderr}`).toMatch(/stale/i);
  });

  it("is wired into web pretest so npx vitest cannot skip it", () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as {
      scripts: { pretest: string };
    };
    expect(pkg.scripts.pretest).toContain("scripts/check-lens-bytecode.mjs");
  });
});
