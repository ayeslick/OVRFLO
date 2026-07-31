#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  digestJson,
  PACKAGE_RECEIPT,
  VERCEL_OUTPUT,
} from "./package-vercel-output.mjs";
import { collectInlineScriptHashes } from "./csp-hash-inline.mjs";

export function verifyVercelOutput({
  outputDir = VERCEL_OUTPUT,
  receiptPath = PACKAGE_RECEIPT,
} = {}) {
  const configPath = resolve(outputDir, "config.json");
  if (!existsSync(configPath) || !existsSync(receiptPath)) {
    throw new Error("verify-vercel-output: packaged config or receipt is missing");
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const [headerRoute, ...preservedRoutes] = config.routes ?? [];
  if (
    headerRoute?.src !== "/(.*)" ||
    headerRoute?.continue !== true ||
    !headerRoute.headers?.["Content-Security-Policy"]
  ) {
    throw new Error("verify-vercel-output: enforcing CSP route is missing");
  }
  const csp = headerRoute.headers["Content-Security-Policy"];
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(csp)) {
    throw new Error("verify-vercel-output: production CSP contains localhost");
  }
  if (!/script-src 'self' 'sha256-/.test(csp) || /script-src[^;]*'unsafe-inline'/.test(csp)) {
    throw new Error("verify-vercel-output: script-src hashes are incomplete or unsafe");
  }
  const packagedHashes = [...csp.matchAll(/'sha256-[^']+'/g)].map(([hash]) => hash).sort();
  const staticHashes = collectInlineScriptHashes(resolve(outputDir, "static"));
  if (JSON.stringify(packagedHashes) !== JSON.stringify(staticHashes)) {
    throw new Error("verify-vercel-output: CSP hashes do not match packaged inline scripts");
  }
  if (digestJson(preservedRoutes) !== receipt.originalRoutesDigest) {
    throw new Error("verify-vercel-output: adapter routes changed during packaging");
  }
  if (digestJson(headerRoute.headers) !== receipt.packagedHeadersDigest) {
    throw new Error("verify-vercel-output: packaged headers differ from the recorded artifact");
  }
  const staticDir = resolve(outputDir, "static");
  if (!existsSync(staticDir) || filesUnder(staticDir).length === 0) {
    throw new Error("verify-vercel-output: static output is empty");
  }
  return {
    artifactDigest: digestDirectory(outputDir),
    preservedRouteCount: preservedRoutes.length,
  };
}

function filesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".ovrflo-package.json") continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found.sort();
}

function digestDirectory(directory) {
  const hash = createHash("sha256");
  for (const file of filesUnder(directory)) {
    hash.update(file.slice(directory.length));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = verifyVercelOutput();
  process.stdout.write(
    `verify-vercel-output: ${result.preservedRouteCount} routes preserved; artifact sha256=${result.artifactDigest}\n`,
  );
}
