import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = process.cwd();
const REPO_ROOT = join(WEB_ROOT, "..");

function frontmatterBlock(source: string): string {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  const body = match?.[1];
  if (!body) throw new Error("DESIGN.md frontmatter missing");
  return body;
}

describe("CS4-U1 visual tokens", () => {
  it("encodes DESIGN.md semantic colors and radii without JPEG-sampled hex", () => {
    const design = frontmatterBlock(readFileSync(join(REPO_ROOT, "DESIGN.md"), "utf8"));
    const globals = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");
    const required = [
      ["canvas", "#F6F8FC"],
      ["surface", "#FFFFFF"],
      ["ink", "#0B1F3A"],
      ["muted", "#627187"],
      ["border", "#D9E2EF"],
      ["primary", "#1769E0"],
      ["loan", "#2B7DE9"],
      ["fixed_return", "#218A62"],
    ];
    for (const [key, hex] of required) {
      expect(design).toContain(`${key}: "${hex}"`);
    }
    expect(globals).toContain("--canvas: #F6F8FC");
    expect(globals).toContain("--primary: #1769E0");
    expect(globals).toContain("--radius-control: 10px");
    expect(globals).toContain("--radius-card: 16px");
    expect(globals).toContain("--gold: var(--primary)");
  });

  it("uses one token system in kit.css for cards, actions, and Advanced density", () => {
    const css = readFileSync(join(WEB_ROOT, "components/kit/kit.css"), "utf8");
    expect(css).toContain("background: var(--canvas)");
    expect(css).toContain("background: var(--surface)");
    expect(css).toContain("border-radius: var(--radius-card)");
    expect(css).toContain("background: var(--primary)");
    expect(css).toContain(".kit-medallion");
    expect(css).toContain('[data-disclosure="advanced"]');
    expect(css).not.toMatch(/letter-spacing:\s*0\.1em/);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
  });

  it("ships a static-export create page", () => {
    const createPage = readFileSync(join(WEB_ROOT, "app/create/page.tsx"), "utf8");
    expect(createPage).toContain('currentNav="create"');
    expect(createPage).toContain("DefaultHub");
    expect(createPage).not.toContain("/activity/");
  });

  it("does not add compatibility redirects for pre-CS4 URL shapes", () => {
    const nextConfig = readFileSync(join(WEB_ROOT, "next.config.ts"), "utf8");
    expect(nextConfig).not.toMatch(/\bredirects\b/);
    expect(nextConfig).not.toMatch(/\brewrites\b/);
    expect(nextConfig).toContain("trailingSlash: true");
  });
});
