import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDirectories: string[] = [];
const guard = join(process.cwd(), "scripts", "check-banned-patterns.sh");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "ovrflo-banned-patterns-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "check-banned-patterns.sh"), readFileSync(guard, "utf8"));

  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, contents);
  }
  return root;
}

function runGuard(root: string, forceGrep = false) {
  return spawnSync("/bin/bash", [join(root, "scripts", "check-banned-patterns.sh")], {
    cwd: root,
    encoding: "utf8",
    env: forceGrep ? { ...process.env, PATH: "/usr/bin:/bin" } : process.env,
  });
}

describe("banned-pattern guard exception scope", () => {
  it("allows historical access only in the exact reviewed owners", async () => {
    const root = await fixture({
      "lib/discovery/scanner.ts": "const marker = FACTORY_FROM_BLOCK;\n",
      "lib/deployment.ts": "const marker = FACTORY_FROM_BLOCK;\n",
    });

    expect(runGuard(root).status).toBe(0);
  });

  it("still bans generic regressions inside discovery", async () => {
    const root = await fixture({
      "lib/discovery/projection.ts": "const market = useApprovedMarkets;\n",
    });

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("useApprovedMarkets");
  });

  it("bans product framing OVRFLO does not implement", async () => {
    const root = await fixture({
      "components/RiskBadge.tsx": "export const healthFactor = 1;\n",
    });

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("healthFactor");
  });

  it("bans the same framing in copy, in the grep fallback too", async () => {
    const root = await fixture({
      "components/LoanCard.tsx": 'export const label = "HEALTH FACTOR";\n',
    });

    const result = runGuard(root, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HEALTH FACTOR");
  });

  it("uses the same exact exception scope in the grep fallback", async () => {
    const root = await fixture({
      "hooks/nested/lib/discovery/scanner.ts": "const marker = FACTORY_FROM_BLOCK;\n",
    });

    const result = runGuard(root, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FACTORY_FROM_BLOCK");
  });
});

// The money-cast entry sat inert for its whole life: the array separator was
// "|", which truncated the pattern mid-alternation into an uncompilable regex,
// and a regex that fails to compile was counted as "no matches".  These cover
// both halves so neither can regress silently.
describe("banned-pattern guard alternation entries", () => {
  it("bans casting a token amount through Number", async () => {
    const root = await fixture({
      "lib/format.ts": "export const shown = Number(position.amount);\n",
    });

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("keep money values as bigint");
  });

  it("bans the camelCase form the codebase actually writes", async () => {
    const root = await fixture({
      "components/PositionRow.tsx": "const shown = Number(marketAmount);\n",
    });

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("keep money values as bigint");
  });

  it("bans it in the grep fallback too", async () => {
    const root = await fixture({
      "hooks/useLoan.ts": "const shown = Number(totalObligation);\n",
    });

    const result = runGuard(root, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("keep money values as bigint");
  });

  it("leaves non-money Number casts alone", async () => {
    const root = await fixture({
      "lib/time.ts": "const seconds = Number(stream.endTime);\n",
    });

    expect(runGuard(root).status).toBe(0);
  });

  it("fails loudly when a pattern does not compile", async () => {
    const root = await fixture({});
    const script = join(root, "scripts", "check-banned-patterns.sh");
    writeFileSync(
      script,
      readFileSync(script, "utf8").replace(
        "'nativeUsd:::",
        "'unclosed\\([group:::",
      ),
    );
    mkdirSync(join(root, "lib"), { recursive: true });

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("search failed for pattern");
  });
});
