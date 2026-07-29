#!/usr/bin/env node
/**
 * build-csp.mjs — R20 + R21 + R19
 *
 * Generates the static-host security headers (Vercel + Cloudflare Pages /
 * Netlify) from a single CSP template parameterized by the same
 * NEXT_PUBLIC_* origins the browser bundle embeds at build time. The
 * `next.config.ts` `headers()` API is a no-op under `output: "export"`
 * (R19) — real CSP has to ship as deploy-target config, so this script
 * emits both formats so we can deploy to either surface with no rewrites.
 *
 * Reads from environment (all optional — script falls back to sensible
 * defaults so local `npm run build` without env still produces valid
 * output):
 *
 *   NEXT_PUBLIC_RPC_URL                 → connect-src origin for Ethereum RPC
 *   NEXT_PUBLIC_PONDER_URL              → connect-src origin for Ponder
 *
 * Static origins for WalletConnect / Reown and their WSS relays are baked
 * into the template since they're not environment-configurable.
 *
 * Emits:
 *   web/vercel.json          (Vercel's authoritative header format)
 *   web/public/_headers      (Cloudflare Pages / Netlify)
 *
 * R29/M-17: this used to substitute rpc.ankr.com and localhost when the
 * origins were missing, so a deploy could ship a CSP that blocked its own
 * RPC and indexer — silently, because the build stayed green. Missing
 * origins now fail the build. Local builds that genuinely want the
 * fallbacks opt in with CSP_ALLOW_FALLBACKS=1; forgetting it fails loudly
 * rather than shipping something broken.
 *
 * script-src carries no origins and no 'unsafe-inline' — scripts/csp-hash-inline.mjs
 * runs after `next build` and adds the exported HTML's inline-script hashes.
 * That step has to be post-build: this script runs first and writes
 * public/_headers, which Next copies into out/ during export, so a hash
 * computed here could never match the HTML it guards.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");

const WALLET_ORIGINS_HTTP = [
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
  "https://*.reown.com",
];
const WALLET_ORIGINS_WSS = [
  "wss://*.walletconnect.com",
  "wss://*.walletconnect.org",
  "wss://*.reown.com",
];

function originOf(rawUrl, envName) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    // Strip path/search/hash — CSP allows origins only.
    return `${u.protocol}//${u.host}`;
  } catch {
    throw new Error(
      `build-csp: ${envName}="${rawUrl}" is not a valid URL. Fix your env before running build.`
    );
  }
}

const ALLOW_FALLBACKS = process.env.CSP_ALLOW_FALLBACKS === "1";

function requiredOrigin(rawUrl, envName, devFallback) {
  const origin = originOf(rawUrl, envName);
  if (origin) return origin;
  if (ALLOW_FALLBACKS) return devFallback;
  throw new Error(
    `build-csp: ${envName} is not set. A production build cannot ship a CSP ` +
      `guessed from a dev default — the deployed app would block its own ` +
      `traffic. Set ${envName}, or pass CSP_ALLOW_FALLBACKS=1 for a local build.`
  );
}

const rpcOrigin = requiredOrigin(process.env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL", "http://127.0.0.1:8545");
const indexerOrigin = requiredOrigin(
  process.env.NEXT_PUBLIC_PONDER_URL,
  "NEXT_PUBLIC_PONDER_URL",
  "http://localhost:42069"
);

// R31/L-8: the CoinGecko origin is gone. Nothing in web/ fetches a price —
// PositionSummary records "no USD" as a deliberate decision — so the origin
// was allowing traffic the app never makes.
const connectSrc = [
  "'self'",
  rpcOrigin,
  indexerOrigin,
  ...WALLET_ORIGINS_HTTP,
  ...WALLET_ORIGINS_WSS,
];

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // No 'unsafe-inline' and no remote origins: nothing in web/ loads a remote
  // script, and the wildcard wallet domains only widened the post-XSS blast
  // radius. Inline-script hashes are appended post-build. Wallet connectivity
  // rides on connect-src and frame-src, which keep theirs.
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(" ")}`,
  `frame-src ${WALLET_ORIGINS_HTTP.join(" ")}`,
].join("; ");

const COMMON_HEADERS = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const vercelJson = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  headers: [
    {
      source: "/(.*)",
      headers: COMMON_HEADERS,
    },
  ],
};

const headersFileLines = [
  "/*",
  ...COMMON_HEADERS.map(({ key, value }) => `  ${key}: ${value}`),
  "",
];

const vercelPath = resolve(WEB_ROOT, "vercel.json");
const headersPath = resolve(WEB_ROOT, "public", "_headers");

writeFileSync(vercelPath, JSON.stringify(vercelJson, null, 2) + "\n");
mkdirSync(dirname(headersPath), { recursive: true });
writeFileSync(headersPath, headersFileLines.join("\n"));

process.stdout.write(
  `build-csp: wrote vercel.json and public/_headers (rpc=${rpcOrigin}, indexer=${indexerOrigin})\n`
);
