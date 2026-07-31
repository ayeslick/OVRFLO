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

  it("uses the same exact exception scope in the grep fallback", async () => {
    const root = await fixture({
      "hooks/nested/lib/discovery/scanner.ts": "const marker = FACTORY_FROM_BLOCK;\n",
    });

    const result = runGuard(root, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FACTORY_FROM_BLOCK");
  });
});
