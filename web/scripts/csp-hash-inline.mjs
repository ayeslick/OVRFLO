#!/usr/bin/env node
/**
 * csp-hash-inline.mjs — R29 / M-17
 *
 * Adds the exported HTML's inline-script hashes to `script-src`, so the CSP
 * can permit exactly the scripts Next emits without `'unsafe-inline'`.
 *
 * This has to run AFTER `next build`, which is the whole reason it is a
 * separate script. `build-csp.mjs` runs first and writes `public/_headers`,
 * which Next copies into `out/` during export — a hash computed there could
 * never match the HTML it guards, because that HTML does not exist yet.
 * Writing to `public/_headers` after the export is equally useless: the copy
 * already happened, so it would only take effect on the *next* build.
 *
 * So this rewrites the built artifacts in place: `out/_headers` and
 * `web/vercel.json`.
 *
 * One header block applies to every path on both hosts, so `script-src`
 * carries the union of hashes across every exported page.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(WEB_ROOT, "out");

if (!existsSync(OUT_DIR)) {
  throw new Error("csp-hash-inline: out/ not found — run this after `next build`.");
}

function htmlFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlFilesUnder(full));
    else if (entry.name.endsWith(".html")) found.push(full);
  }
  return found;
}

// Matches an inline <script> — one with no src attribute. A script with src is
// governed by an origin, not a hash.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

const hashes = new Set();
for (const file of htmlFilesUnder(OUT_DIR)) {
  const html = readFileSync(file, "utf8");
  for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
    // Hash the body exactly as it appears — CSP hashes the raw bytes between
    // the tags, so any normalisation here would produce a hash the browser
    // never computes.
    if (body.length === 0) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
}

if (hashes.size === 0) {
  throw new Error(
    "csp-hash-inline: found no inline scripts in out/. Next emits hydration " +
      "scripts inline, so zero almost certainly means the HTML shape changed " +
      "and this script is now matching nothing — failing rather than shipping " +
      "a CSP that blocks hydration."
  );
}

const scriptSrc = `script-src 'self' ${[...hashes].sort().join(" ")}`;

function withHashedScriptSrc(csp) {
  if (!csp.includes("script-src")) throw new Error("csp-hash-inline: no script-src directive to rewrite.");
  return csp
    .split(";")
    .map((directive) => (directive.trim().startsWith("script-src") ? ` ${scriptSrc}` : directive))
    .join(";")
    .trim();
}

// Cloudflare Pages / Netlify: out/_headers
const headersPath = join(OUT_DIR, "_headers");
if (existsSync(headersPath)) {
  const rewritten = readFileSync(headersPath, "utf8")
    .split("\n")
    .map((line) =>
      line.trim().startsWith("Content-Security-Policy:")
        ? `  Content-Security-Policy: ${withHashedScriptSrc(line.split("Content-Security-Policy:")[1].trim())}`
        : line,
    )
    .join("\n");
  writeFileSync(headersPath, rewritten);
}

// Vercel: web/vercel.json
const vercelPath = resolve(WEB_ROOT, "vercel.json");
if (existsSync(vercelPath)) {
  const config = JSON.parse(readFileSync(vercelPath, "utf8"));
  for (const rule of config.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key === "Content-Security-Policy") header.value = withHashedScriptSrc(header.value);
    }
  }
  writeFileSync(vercelPath, JSON.stringify(config, null, 2) + "\n");
}

console.log(`csp-hash-inline: hashed ${hashes.size} inline script(s) into script-src.`);
