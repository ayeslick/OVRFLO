import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOW_SPEC_ITEMS, PLAN_ADDITIONS } from "./fixtures";

const WEB_ROOT = join(process.cwd());
const INVENTORY_DIR = join(WEB_ROOT, "tests", "inventory");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(tsx?|css)$/.test(name)) acc.push(path);
  }
  return acc;
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("inventory — product truth", () => {
  it("CHECKLIST.md cites every flow-spec render and plan addition", () => {
    const checklist = read(join(INVENTORY_DIR, "CHECKLIST.md"));
    const pr = read(join(INVENTORY_DIR, "PR-CHECKLIST.md"));
    for (const item of FLOW_SPEC_ITEMS) {
      expect(checklist, item).toContain(item);
      expect(pr, item).toContain(item);
    }
    for (const item of PLAN_ADDITIONS) {
      expect(checklist, item).toContain(item);
      expect(pr, item).toContain(item);
    }
  });

  it("no health-factor language in shipped UI copy except the first-run denial", () => {
    const files = [
      ...walk(join(WEB_ROOT, "components")),
      ...walk(join(WEB_ROOT, "app")),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = read(file);
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (!/health[\s-]?factor/i.test(line)) return;
        if (/no health factors/i.test(line)) return;
        hits.push(`${relative(WEB_ROOT, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("no engagement-mechanic copy in shipped UI", () => {
    const files = [
      ...walk(join(WEB_ROOT, "components")),
      ...walk(join(WEB_ROOT, "app")),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = read(file);
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (!/\b(streaks?|daily digest|manufactured urgency|gamif)/i.test(line)) return;
        hits.push(`${relative(WEB_ROOT, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("watch disconnected entry does not invent TVL", () => {
    const source = read(join(WEB_ROOT, "components", "watch", "WatchApp.tsx"));
    const start = source.indexOf("function DisconnectedEntry");
    expect(start).toBeGreaterThan(-1);
    const slice = source.slice(start, start + 1200);
    expect(slice).not.toMatch(/TVL/i);
    expect(slice).not.toMatch(/health factor/i);
    expect(slice).toMatch(/earnings rolling up/i);
  });

  it("projection never appears as a write gate in watch writes or action builders", () => {
    const actionDir = join(WEB_ROOT, "lib", "actions");
    const files = [
      join(WEB_ROOT, "components", "watch", "WatchWrite.tsx"),
      ...walk(actionDir),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = read(file);
      if (!/\bprojection\b/i.test(text)) continue;
      hits.push(relative(WEB_ROOT, file));
    }
    expect(hits).toEqual([]);
  });

  it("gold heroes use display scale and warning copy is ink", () => {
    const hero = read(join(WEB_ROOT, "components", "kit", "hero-rolling.css"));
    expect(hero).toMatch(/font-size:\s*36px/);
    const warning = read(join(WEB_ROOT, "app", "status-warning.css"));
    expect(warning).toMatch(/color:\s*var\(--ink\)/);
  });
});
