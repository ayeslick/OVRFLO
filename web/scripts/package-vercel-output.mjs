#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HASHED_HEADERS_PATH } from "./csp-hash-inline.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");
export const VERCEL_OUTPUT = resolve(WEB_ROOT, ".vercel", "output");
export const PACKAGE_RECEIPT = resolve(VERCEL_OUTPUT, ".ovrflo-package.json");

export function packageVercelOutput({
  outputDir = VERCEL_OUTPUT,
  headersPath = HASHED_HEADERS_PATH,
} = {}) {
  const configPath = resolve(outputDir, "config.json");
  if (!existsSync(configPath)) {
    throw new Error("package-vercel-output: .vercel/output/config.json is missing; run vercel build first");
  }
  if (!existsSync(headersPath)) {
    throw new Error("package-vercel-output: hashed headers are missing; run the immutable build first");
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.version !== 3) throw new Error("package-vercel-output: Build Output API version must be 3");
  const originalRoutes = config.routes ?? [];
  const headers = Object.fromEntries(
    JSON.parse(readFileSync(headersPath, "utf8")).map(({ key, value }) => [key, value]),
  );
  const headerRoute = { src: "/(.*)", headers, continue: true };
  config.routes = [headerRoute, ...originalRoutes];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const receipt = {
    formatVersion: 1,
    originalRoutesDigest: digestJson(originalRoutes),
    packagedHeadersDigest: digestJson(headers),
  };
  writeFileSync(resolve(outputDir, ".ovrflo-package.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = packageVercelOutput();
  process.stdout.write(
    `package-vercel-output: preserved routes ${receipt.originalRoutesDigest} and attached verified headers\n`,
  );
}
