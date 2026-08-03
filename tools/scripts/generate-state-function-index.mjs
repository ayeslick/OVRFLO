#!/usr/bin/env node
/**
 * Generates the client-state function/module index from the state-key catalog.
 *
 * Keys are the source of truth (`docs/maps/SCHEMAS.md` §3). This script reads
 * every entry under `docs/maps/state/keys/` and emits the inverted view —
 * module -> keys it writes and reads — into `docs/maps/state/functions/INDEX.md`.
 * That output is generated and must never be hand-edited: a hand-copied index
 * drifts and then lies about blast radius, which is the one question the
 * catalog exists to answer.
 *
 *   node tools/scripts/generate-state-function-index.mjs           # write
 *   node tools/scripts/generate-state-function-index.mjs --check   # verify only
 *
 * `--check` exits non-zero when the committed index does not match the keys.
 * It is the form a presence gate or CI step should call.
 *
 * This covers the browser only. `x-ray/` remains the authority for Solidity
 * entry points and on-chain contract state; nothing here replaces it.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KEYS_DIR = join(REPO_ROOT, "docs/maps/state/keys");
const OUTPUT_PATH = join(REPO_ROOT, "docs/maps/state/functions/INDEX.md");
const TRUST_DOMAINS = new Set(["on-chain", "projection", "pure-client"]);
const GENERATED_MARKER = "<!-- GENERATED FILE — DO NOT EDIT -->";

const ENTRY_RE = /^### `([^`]+)`\s*$/;
const TRUST_RE = /^- \*\*trust_domain:\*\* `([^`]+)`\s*$/;
const SECTION_RE = /^- \*\*(writers|readers|notes):\*\*\s*(.*)$/;
const MEMBER_RE = /^ {2}- `([^`]+)`(?:\s+—\s+(.*))?$/;

/** Parses one key-catalog file into entries. Throws on any malformed entry. */
export function parseKeyFile(text, sourceLabel) {
  const lines = text.split("\n");
  const entries = [];
  let current = null;
  let section = null;

  const finish = () => {
    if (!current) return;
    const where = `${sourceLabel} · ${current.key}`;
    if (!current.trust_domain) throw new Error(`${where}: missing trust_domain`);
    if (!TRUST_DOMAINS.has(current.trust_domain)) {
      throw new Error(
        `${where}: trust_domain "${current.trust_domain}" is not one of ${[...TRUST_DOMAINS].join(" / ")}`,
      );
    }
    if (current.writers.length === 0) throw new Error(`${where}: writers is empty`);
    if (current.readers.length === 0) throw new Error(`${where}: readers is empty`);
    entries.push(current);
    current = null;
  };

  for (const [index, line] of lines.entries()) {
    const at = `${sourceLabel}:${index + 1}`;
    const entryMatch = ENTRY_RE.exec(line);
    if (entryMatch) {
      finish();
      current = {
        key: entryMatch[1],
        source: sourceLabel,
        trust_domain: null,
        writers: [],
        readers: [],
      };
      section = null;
      continue;
    }
    if (!current) continue;

    const trustMatch = TRUST_RE.exec(line);
    if (trustMatch) {
      current.trust_domain = trustMatch[1];
      section = null;
      continue;
    }

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const memberMatch = MEMBER_RE.exec(line);
    if (memberMatch) {
      if (section === "writers" || section === "readers") {
        current[section].push({ module: memberMatch[1], note: memberMatch[2] ?? "" });
      }
      continue;
    }

    // A bullet that is neither a recognised field nor a member of the section
    // we are in ends the section; prose and notes are allowed between fields.
    if (/^- /.test(line)) {
      const stray = /^- \*\*([a-z_]+):\*\*/.exec(line);
      if (stray && !["trust_domain", "writers", "readers", "notes"].includes(stray[1])) {
        throw new Error(`${at}: unknown field "${stray[1]}" in ${current.key}`);
      }
      section = null;
    }
  }
  finish();
  return entries;
}

function loadCatalog() {
  const files = readdirSync(KEYS_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
  if (files.length === 0) throw new Error(`no key files found in ${KEYS_DIR}`);

  const entries = [];
  const seen = new Map();
  for (const file of files) {
    const label = relative(REPO_ROOT, join(KEYS_DIR, file));
    for (const entry of parseKeyFile(readFileSync(join(KEYS_DIR, file), "utf8"), label)) {
      const previous = seen.get(entry.key);
      if (previous) {
        throw new Error(`duplicate key "${entry.key}" in ${label} and ${previous}`);
      }
      seen.set(entry.key, label);
      entries.push(entry);
    }
  }
  return { files, entries };
}

function buildModuleIndex(entries) {
  const modules = new Map();
  const touch = (module) => {
    let record = modules.get(module);
    if (!record) {
      record = { module, writes: [], reads: [] };
      modules.set(module, record);
    }
    return record;
  };
  for (const entry of entries) {
    for (const writer of entry.writers) {
      touch(writer.module).writes.push({ key: entry.key, trust: entry.trust_domain, note: writer.note });
    }
    for (const reader of entry.readers) {
      touch(reader.module).reads.push({ key: entry.key, trust: entry.trust_domain, note: reader.note });
    }
  }
  const sortByKey = (a, b) => a.key.localeCompare(b.key);
  return [...modules.values()]
    .map((record) => ({
      ...record,
      writes: record.writes.sort(sortByKey),
      reads: record.reads.sort(sortByKey),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

function render({ files, entries }) {
  const modules = buildModuleIndex(entries);
  const byDomain = (domain) => entries.filter((entry) => entry.trust_domain === domain).length;

  const out = [];
  out.push(GENERATED_MARKER);
  out.push("");
  out.push("# Client state — function/module index (generated)");
  out.push("");
  out.push("**This file is generated. Do not hand-edit it, and never cite it as source of");
  out.push("truth.** The source of truth is the key catalog in `../keys/`");
  out.push("(`docs/maps/SCHEMAS.md` §3). If a line here is wrong, the key entry is wrong —");
  out.push("fix the key and regenerate. An index maintained by hand drifts and then lies");
  out.push("about blast radius, which is the one question this catalog exists to answer.");
  out.push("");
  out.push("Regenerate:");
  out.push("");
  out.push("```sh");
  out.push("node tools/scripts/generate-state-function-index.mjs");
  out.push("node tools/scripts/generate-state-function-index.mjs --check   # verify only");
  out.push("```");
  out.push("");
  out.push("**Browser only.** `x-ray/` remains the authority for Solidity entry points and");
  out.push("on-chain contract state. This index does not cover, replace, or summarise it.");
  out.push("");
  out.push("## Coverage");
  out.push("");
  out.push("| | Count |");
  out.push("|---|---|");
  out.push(`| Key files | ${files.length} |`);
  out.push(`| Keys | ${entries.length} |`);
  out.push(`| Modules | ${modules.length} |`);
  out.push(`| \`on-chain\` keys | ${byDomain("on-chain")} |`);
  out.push(`| \`projection\` keys | ${byDomain("projection")} |`);
  out.push(`| \`pure-client\` keys | ${byDomain("pure-client")} |`);
  out.push("");
  out.push("## Trust-domain exposure by module");
  out.push("");
  out.push("Counts of distinct keys each module touches, in either direction. A module with");
  out.push("a `projection` count is a module where a fail-closed mistake can happen.");
  out.push("");
  out.push("| Module | on-chain | projection | pure-client |");
  out.push("|---|---|---|---|");
  for (const record of modules) {
    const touched = new Map();
    for (const item of [...record.writes, ...record.reads]) touched.set(item.key, item.trust);
    const count = (domain) => [...touched.values()].filter((trust) => trust === domain).length;
    out.push(
      `| \`${record.module}\` | ${count("on-chain")} | ${count("projection")} | ${count("pure-client")} |`,
    );
  }
  out.push("");
  out.push("## Modules");
  out.push("");
  for (const record of modules) {
    out.push(`### \`${record.module}\``);
    out.push("");
    out.push("| Direction | Key | Trust domain | Role |");
    out.push("|---|---|---|---|");
    for (const item of record.writes) {
      out.push(`| writes | \`${item.key}\` | \`${item.trust}\` | ${item.note || "—"} |`);
    }
    for (const item of record.reads) {
      out.push(`| reads | \`${item.key}\` | \`${item.trust}\` | ${item.note || "—"} |`);
    }
    out.push("");
  }
  out.push("## Keys");
  out.push("");
  out.push("Reverse lookup — the *who reads X?* direction. Follow the source file for the");
  out.push("full entry, including fail-closed guidance on `projection` keys.");
  out.push("");
  out.push("| Key | Trust domain | Writers | Readers | Source |");
  out.push("|---|---|---|---|---|");
  for (const entry of [...entries].sort((a, b) => a.key.localeCompare(b.key))) {
    const list = (members) => members.map((member) => `\`${member.module}\``).join("<br>");
    out.push(
      `| \`${entry.key}\` | \`${entry.trust_domain}\` | ${list(entry.writers)} | ${list(entry.readers)} | \`${entry.source}\` |`,
    );
  }
  out.push("");
  return out.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const catalog = loadCatalog();
  const rendered = render(catalog);

  if (check) {
    let existing = null;
    try {
      existing = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      console.error(
        `state function index is missing at ${relative(REPO_ROOT, OUTPUT_PATH)} — run: node tools/scripts/generate-state-function-index.mjs`,
      );
      process.exit(1);
    }
    if (existing !== rendered) {
      console.error(
        `state function index is stale — run: node tools/scripts/generate-state-function-index.mjs`,
      );
      process.exit(1);
    }
    console.log(
      `state function index is current (${catalog.entries.length} keys, ${catalog.files.length} key files)`,
    );
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, rendered);
  console.log(
    `wrote ${relative(REPO_ROOT, OUTPUT_PATH)} — ${catalog.entries.length} keys from ${catalog.files.length} key files`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
