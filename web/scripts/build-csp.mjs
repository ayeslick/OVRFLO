#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, "..");
export const BASE_HEADERS_PATH = resolve(WEB_ROOT, "build", "security-headers.base.json");

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

/** @param {Record<string, string | undefined>} environment */
export function buildSecurityHeaders(environment = process.env) {
  const profile = environment.NEXT_PUBLIC_RUNTIME_PROFILE ?? "production";
  if (profile !== "local" && profile !== "production") {
    throw new Error("build-csp: NEXT_PUBLIC_RUNTIME_PROFILE must be local or production");
  }
  if (
    profile === "local" &&
    (environment.VERCEL_ENV === "production" || environment.OVRFLO_DEPLOYABLE_BUILD === "1")
  ) {
    throw new Error("build-csp: the local profile cannot activate in a deployable production build");
  }

  const rpcOrigins = configuredRpcOrigins(environment, profile);
  const historicalOrigin = requiredOrigin(
    environment.NEXT_PUBLIC_HISTORICAL_RPC_URL ??
      (profile === "local" ? environment.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545" : undefined),
    "NEXT_PUBLIC_HISTORICAL_RPC_URL",
    profile,
  );
  const connectSrc = [
    "'self'",
    ...new Set([...rpcOrigins, historicalOrigin]),
    "https://api-v2.pendle.finance",
    ...WALLET_ORIGINS_HTTP,
    ...WALLET_ORIGINS_WSS,
  ];

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${WALLET_ORIGINS_HTTP.join(" ")}`,
  ].join("; ");
  if (profile === "production" && /localhost|127\.0\.0\.1|\[::1\]/i.test(csp)) {
    throw new Error("build-csp: production CSP contains a localhost origin");
  }

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
  ];
}

function configuredRpcOrigins(environment, profile) {
  const primary =
    environment.NEXT_PUBLIC_RPC_URL ??
    (profile === "local" ? "http://127.0.0.1:8545" : undefined);
  const fallbacks = (environment.NEXT_PUBLIC_RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [
    requiredOrigin(primary, "NEXT_PUBLIC_RPC_URL", profile),
    ...fallbacks.map((value, index) =>
      requiredOrigin(value, `NEXT_PUBLIC_RPC_FALLBACK_URLS[${index}]`, profile),
    ),
  ];
}

function requiredOrigin(rawUrl, envName, profile) {
  if (!rawUrl) throw new Error(`build-csp: ${envName} is required`);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`build-csp: ${envName} is not a valid URL`);
  }
  if (url.hostname === "alchemyapi.io" || url.hostname.endsWith(".alchemyapi.io")) {
    throw new Error(`build-csp: ${envName} uses deprecated alchemyapi.io`);
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname.endsWith(".localhost");
  if (profile === "production" && (url.protocol !== "https:" || local)) {
    throw new Error(`build-csp: ${envName} cannot use a local or non-HTTPS origin in production`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`build-csp: ${envName} must use http or https`);
  }
  return url.origin;
}

/**
 * @param {Record<string, string | undefined>} environment
 * @param {string} outputPath
 */
export function writeBaseSecurityHeaders(environment = process.env, outputPath = BASE_HEADERS_PATH) {
  const headers = buildSecurityHeaders(environment);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(headers, null, 2)}\n`);
  return headers;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const headers = writeBaseSecurityHeaders();
  process.stdout.write(
    `build-csp: staged ${headers.length} headers under build/ without modifying tracked inputs\n`,
  );
}
