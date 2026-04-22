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
 *   NEXT_PUBLIC_SABLIER_INDEXER_URL     → connect-src origin for Envio
 *   NEXT_PUBLIC_PRICE_API_URL           → connect-src origin for CoinGecko
 *
 * Static origins for WalletConnect / Reown and their WSS relays are baked
 * into the template since they're not environment-configurable.
 *
 * Emits:
 *   web/vercel.json          (Vercel's authoritative header format)
 *   web/public/_headers      (Cloudflare Pages / Netlify)
 *
 * Fails non-zero if an origin variable is present but syntactically
 * invalid (e.g. "not-a-url"), so deploys can't ship a busted CSP.
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

const rpcOrigin =
  originOf(process.env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL") ??
  "https://rpc.ankr.com";
const indexerOrigin =
  originOf(
    process.env.NEXT_PUBLIC_SABLIER_INDEXER_URL,
    "NEXT_PUBLIC_SABLIER_INDEXER_URL"
  ) ?? "https://indexer.hyperindex.xyz";
const priceApiOrigin =
  originOf(process.env.NEXT_PUBLIC_PRICE_API_URL, "NEXT_PUBLIC_PRICE_API_URL") ??
  "https://api.coingecko.com";

const connectSrc = [
  "'self'",
  rpcOrigin,
  indexerOrigin,
  priceApiOrigin,
  ...WALLET_ORIGINS_HTTP,
  ...WALLET_ORIGINS_WSS,
];

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline' ${WALLET_ORIGINS_HTTP.join(" ")}`,
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
  `build-csp: wrote vercel.json and public/_headers (rpc=${rpcOrigin}, indexer=${indexerOrigin}, priceApi=${priceApiOrigin})\n`
);
