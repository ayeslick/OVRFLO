import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// U7 presence gate. The gate itself lives with the other repo-level tooling in
// tools/scripts/; this wrapper keeps it inside the normal `npm --prefix web run
// test` path so it cannot rot unnoticed.
const gate = join(process.cwd(), "..", "tools", "scripts", "check-maps-presence.sh");
const fixtures = join(process.cwd(), "tests", "fixtures");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function scratchDir() {
  const root = await mkdtemp(join(tmpdir(), "ovrflo-maps-presence-"));
  temporaryDirectories.push(root);
  return root;
}

function runGate(args: string[], stdin?: string) {
  return spawnSync("/bin/bash", [gate, ...args], {
    encoding: "utf8",
    input: stdin,
  });
}

function runOnPaths(paths: string[], extraArgs: string[] = []) {
  return runGate(["--files-from", "-", ...extraArgs], `${paths.join("\n")}\n`);
}

describe("maps presence gate — documented fixtures", () => {
  it("fails a UI change carrying no companion artifact", () => {
    const result = runGate([
      "--files-from",
      join(fixtures, "maps-presence-ui-change-no-companion.txt"),
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UI change without a companion map artifact");
    expect(result.stderr).toContain("web/components/MarketsApp.tsx");
  });

  it("passes a docs-only charter edit with no UI code and no scratch", () => {
    const result = runGate([
      "--files-from",
      join(fixtures, "maps-presence-docs-only-charter-edit.txt"),
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("clean");
  });
});

describe("maps presence gate — companion rules", () => {
  it("accepts a region brief as the companion", () => {
    expect(runOnPaths(["web/components/MarketsApp.tsx", "docs/maps/ui/header.md"]).status).toBe(0);
  });

  it("accepts a numbered summary ADR as the companion", () => {
    // .scratch/ is gitignored in its entirety, so the tracked ADR — not the
    // scratch YAML — is the artifact this gate can observe.
    expect(runOnPaths(["web/hooks/useThing.ts", "docs/adr/0007-thing.md"]).status).toBe(0);
  });

  it("does not accept the ADR process doc as a companion", () => {
    const result = runOnPaths(["web/hooks/useThing.ts", "docs/adr/README.md"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UI change without a companion map artifact");
  });

  it("requires the regenerated function index when state keys change", () => {
    const result = runOnPaths(["docs/maps/state/keys/view-state.md"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/maps/state/functions/INDEX.md");
  });

  it("passes when the state-key change carries the regenerated index", () => {
    expect(
      runOnPaths([
        "docs/maps/state/keys/view-state.md",
        "docs/maps/state/functions/INDEX.md",
      ]).status,
    ).toBe(0);
  });

  it("does not trigger on a directory that merely looks like a UI root", () => {
    expect(runOnPaths(["web/components-old/Legacy.tsx"]).status).toBe(0);
  });
});

describe("maps presence gate — exemption scope", () => {
  async function exemptionList(contents: string) {
    const root = await scratchDir();
    const path = join(root, "exemptions.txt");
    writeFileSync(path, contents);
    return path;
  }

  it("exempts only the exact path listed", async () => {
    const list = await exemptionList("web/components/Legacy.tsx # frozen shim, no brief\n");

    expect(runOnPaths(["web/components/Legacy.tsx"], ["--exemptions", list]).status).toBe(0);
  });

  it("does not extend an exemption to a nested lookalike path", async () => {
    // Prefix/fuzzy matching re-creates the risk documented in
    // docs/solutions/security-issues/discovery-security-guard-exemptions-must-be-exact-path-only.md
    const list = await exemptionList("web/components/Legacy.tsx # frozen shim, no brief\n");

    const result = runOnPaths(
      ["web/components/Legacy.tsx/nested/Sneaky.tsx"],
      ["--exemptions", list],
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Sneaky.tsx");
  });

  it("does not extend an exemption to a sibling with the same prefix", async () => {
    const list = await exemptionList("web/components/Legacy.tsx # frozen shim, no brief\n");

    expect(runOnPaths(["web/components/Legacy.tsx.bak"], ["--exemptions", list]).status).toBe(1);
  });

  it("refuses to run on an exemption with no reason", async () => {
    const list = await exemptionList("web/components/Legacy.tsx\n");

    const result = runOnPaths(["web/components/Legacy.tsx"], ["--exemptions", list]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("needs a reason");
  });
});

describe("maps presence gate — ADR structure", () => {
  async function repoWithAdr(contents: string) {
    const root = await scratchDir();
    mkdirSync(join(root, "docs", "adr"), { recursive: true });
    writeFileSync(join(root, "docs", "adr", "0001-example.md"), contents);
    return root;
  }

  const wellFormed = [
    "# ADR-0001 — Example",
    "",
    "Date: 2026-08-03",
    "Status: accepted",
    "Scratch: .scratch/decisions/example.yaml",
    "",
    "## Context",
    "x",
    "",
    "## Decision",
    "y",
    "",
    "## Consequences",
    "z",
    "",
  ].join("\n");

  it("passes a well-formed ADR", async () => {
    const root = await repoWithAdr(wellFormed);

    expect(runOnPaths(["docs/adr/0001-example.md"], ["--root", root]).status).toBe(0);
  });

  it("fails an ADR missing required sections", async () => {
    const root = await repoWithAdr("# ADR-0001 — Example\n\n## Context\nx\n");

    const result = runOnPaths(["docs/adr/0001-example.md"], ["--root", root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("## Decision");
    expect(result.stderr).toContain("## Consequences");
  });

  it("does not require a Scratch pointer, which git cannot see", async () => {
    const root = await repoWithAdr(wellFormed.replace(/^Scratch:.*\n/m, ""));

    expect(runOnPaths(["docs/adr/0001-example.md"], ["--root", root]).status).toBe(0);
  });
});

describe("maps presence gate — mechanical only", () => {
  it("reaches the same verdict for UI paths that do not exist on disk", () => {
    // Proof it judges paths, not source content: a file that was never written
    // fails exactly like a real one. There is nothing here to read semantically.
    const result = runOnPaths(["web/components/DoesNotExistAnywhere.tsx"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UI change without a companion map artifact");
  });

  it("runs from a path list alone, with no repository and no network", async () => {
    const root = await scratchDir();

    const result = runOnPaths(["docs/maps/README.md"], ["--root", root]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
