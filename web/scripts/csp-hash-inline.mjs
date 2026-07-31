#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASE_HEADERS_PATH } from "./build-csp.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_DIR = resolve(WEB_ROOT, "out");
export const HASHED_HEADERS_PATH = resolve(WEB_ROOT, "build", "security-headers.hashed.json");
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

export function hashInlineScripts({
  outDir = OUT_DIR,
  baseHeadersPath = BASE_HEADERS_PATH,
  hashedHeadersPath = HASHED_HEADERS_PATH,
} = {}) {
  if (!existsSync(outDir)) throw new Error("csp-hash-inline: out/ not found");
  if (!existsSync(baseHeadersPath)) {
    throw new Error("csp-hash-inline: staged base headers not found; run build-csp first");
  }
  const hashes = collectInlineScriptHashes(outDir);
  if (hashes.length === 0) throw new Error("csp-hash-inline: no inline scripts found");

  const headers = JSON.parse(readFileSync(baseHeadersPath, "utf8"));
  const cspHeader = headers.find((header) => header.key === "Content-Security-Policy");
  if (!cspHeader) throw new Error("csp-hash-inline: CSP header missing");
  cspHeader.value = replaceScriptSrc(cspHeader.value, hashes);

  mkdirSync(dirname(hashedHeadersPath), { recursive: true });
  writeFileSync(hashedHeadersPath, `${JSON.stringify(headers, null, 2)}\n`);
  writeFileSync(
    join(outDir, "_headers"),
    ["/*", ...headers.map(({ key, value }) => `  ${key}: ${value}`), ""].join("\n"),
  );
  return { hashes, headers };
}

export function collectInlineScriptHashes(directory) {
  const hashes = new Set();
  for (const file of htmlFilesUnder(directory)) {
    const html = readFileSync(file, "utf8");
    for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
      if (body.length === 0) continue;
      hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    }
  }
  return [...hashes].sort();
}

function replaceScriptSrc(csp, hashes) {
  if (!csp.includes("script-src")) throw new Error("csp-hash-inline: script-src missing");
  return csp
    .split(";")
    .map((directive) =>
      directive.trim().startsWith("script-src")
        ? ` script-src 'self' ${hashes.join(" ")}`
        : directive,
    )
    .join(";")
    .trim();
}

function htmlFilesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...htmlFilesUnder(full));
    else if (entry.name.endsWith(".html")) found.push(full);
  }
  return found;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = hashInlineScripts();
  process.stdout.write(
    `csp-hash-inline: wrote ${result.hashes.length} hashes only to generated artifacts\n`,
  );
}
