#!/usr/bin/env node
/**
 * Live pin-capability probe for ticket 11 / 14.
 *
 * Per configured provider: deployless code+calldata pinned to a known past
 * block, returning block.number, asserted equal to the pinned height.
 * Does not print RPC URLs or keys. Skip with reason is data, not a hard fail.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http } from "viem";
import { mainnet } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const PIN_PROBE_TS = join(WEB_ROOT, "lib/protocol/pin-probe.ts");
const DEFAULT_OUTPUT =
  "/Users/jay/OVRFLO/.scratch/mainnet-execution-router/memory/pin-capability.md";

const pinProbeAbi = [
  {
    type: "function",
    name: "blockNumber",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const PIN_PROBE_LAG_BLOCKS = 64n;

function loadProbeBytecode() {
  const text = readFileSync(PIN_PROBE_TS, "utf8");
  const match = /PIN_PROBE_CREATION_BYTECODE =\s*"(0x[0-9a-fA-F]+)"/.exec(text);
  if (!match) throw new Error("PIN_PROBE_CREATION_BYTECODE missing from pin-probe.ts");
  return match[1];
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function hostnameOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

function resolveEnvPath() {
  const local = join(WEB_ROOT, ".env.local");
  if (existsSync(local)) return local;
  const operator = "/Users/jay/OVRFLO/web/.env.local";
  if (existsSync(operator)) return operator;
  return undefined;
}

function providersFromEnv(env) {
  const rows = [];
  const primary = env.NEXT_PUBLIC_RPC_URL;
  if (primary) rows.push({ role: "primary", url: primary });
  const fallbacks = (env.NEXT_PUBLIC_RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  fallbacks.forEach((url, index) => {
    rows.push({ role: `fallback-${index}`, url });
  });
  const historical = env.NEXT_PUBLIC_HISTORICAL_RPC_URL;
  if (historical) rows.push({ role: "historical", url: historical });
  return rows;
}

async function selectPastPin(client) {
  const latest = await client.getBlockNumber();
  if (latest < 2n) {
    return { skip: `head ${latest.toString()} has no past block to pin` };
  }
  const lag = latest > PIN_PROBE_LAG_BLOCKS ? PIN_PROBE_LAG_BLOCKS : latest - 1n;
  const blockNumber = latest - lag;
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) {
    return { skip: `block ${blockNumber.toString()} has no hash` };
  }
  if (blockNumber >= latest) {
    return { skip: `pin ${blockNumber.toString()} is not a past block (latest ${latest.toString()})` };
  }
  return { pin: { blockNumber, blockHash: block.hash } };
}

async function probeHashPin(client, pin, bytecode) {
  const { data } = await client.call({
    code: bytecode,
    data: encodeFunctionData({ abi: pinProbeAbi, functionName: "blockNumber" }),
    blockHash: pin.blockHash,
    requireCanonical: true,
  });
  if (!data || data === "0x") {
    return { supported: false, error: "probe returned empty data" };
  }
  const returnedBlockNumber = decodeFunctionResult({
    abi: pinProbeAbi,
    functionName: "blockNumber",
    data,
  });
  return {
    supported: returnedBlockNumber === pin.blockNumber,
    returnedBlockNumber,
  };
}

async function probeProvider(role, url, bytecode) {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(url, { timeout: 20_000 }),
  });
  try {
    const selected = await selectPastPin(client);
    if ("skip" in selected) {
      return { role, host: hostnameOf(url), supported: "skip", notes: selected.skip };
    }
    const result = await probeHashPin(client, selected.pin, bytecode);
    const notes = result.supported
      ? `past block ${selected.pin.blockNumber.toString()} returned ${result.returnedBlockNumber.toString()}`
      : result.error
        ? result.error
        : `returned ${result.returnedBlockNumber?.toString() ?? "empty"} at pin ${selected.pin.blockNumber.toString()}`;
    return {
      role,
      host: hostnameOf(url),
      supported: result.supported ? "yes" : "no",
      notes,
    };
  } catch (error) {
    return {
      role,
      host: hostnameOf(url),
      supported: "skip",
      notes: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderMarkdown(rows, envPath) {
  const lines = [
    "# Pin capability probe",
    "",
    "Ticket 11. Deployless `eth_call` with creation `code` + calldata, pinned to a **known past** block via EIP-1898 `{blockHash, requireCanonical: true}`. The probe contract returns `block.number`. Supported means the returned height equals the pinned height. A block-independent probe is not this probe.",
    "",
    `Recorded: ${new Date().toISOString()}`,
    `Env file: ${envPath ? "present (path omitted)" : "missing"}`,
    "CREATE2 flip: not in this ticket. This record says whether the production primitive works.",
    "",
    "| Provider role | EIP-1898 hash pin supported | Notes |",
    "|---|---|---|",
  ];
  for (const row of rows) {
    const notes = String(row.notes).replace(/\|/g, "/");
    lines.push(`| ${row.role} (${row.host}) | ${row.supported} | ${notes} |`);
  }
  if (rows.length === 0) {
    lines.push("| — | skip | no NEXT_PUBLIC_RPC_URL / fallbacks / NEXT_PUBLIC_HISTORICAL_RPC_URL |");
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const bytecode = loadProbeBytecode();
  const envPath = resolveEnvPath();
  const env = envPath ? loadEnvFile(envPath) : {};
  const providers = providersFromEnv(env);
  const rows = [];
  for (const provider of providers) {
    rows.push(await probeProvider(provider.role, provider.url, bytecode));
  }
  const output = process.env.PIN_CAPABILITY_OUT ?? DEFAULT_OUTPUT;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderMarkdown(rows, envPath));
  console.log(`probe-pin-capability: wrote ${output} (${rows.length} provider row(s))`);
}

const isDirect =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
