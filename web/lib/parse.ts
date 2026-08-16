import { isAddress, type Address } from "viem";
import { tickBps, wei, type TickBps, type Wei } from "./units";

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; reason: "malformed" | "empty" | "negative" | "overflow" };
export type ParseResult<T> = ParseOk<T> | ParseErr;

export type WatchLens = "supplied" | "borrowed" | "streams";
export type UsdMode = "token" | "usd";

export type WatchSearch = {
  lens: WatchLens | null;
  lending: Address | null;
  position: bigint | null;
  loan: bigint | null;
  stream: bigint | null;
};

export type FlowDraft = {
  amountRaw: string;
  selectedAprBps: number | null;
  selectedStreamId: string | null;
  selectedMarket: Address | null;
};

const BIGINT_TAG = "$ovrflo/bigint";
const LENSES = new Set<WatchLens>(["supplied", "borrowed", "streams"]);
const USD_MODES = new Set<UsdMode>(["token", "usd"]);

function ok<T>(value: T): ParseOk<T> {
  return { ok: true, value };
}

function err(reason: ParseErr["reason"] = "malformed"): ParseErr {
  return { ok: false, reason };
}

function asRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWatchLens(raw: string | null | undefined): WatchLens | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return LENSES.has(raw as WatchLens) ? (raw as WatchLens) : null;
}

export function parseUsdMode(raw: string | null | undefined): UsdMode | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return USD_MODES.has(raw as UsdMode) ? (raw as UsdMode) : null;
}

export function parseEntityId(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export function parseWatchSearch(source: URLSearchParams | string): WatchSearch {
  try {
    const params = typeof source === "string" ? new URLSearchParams(source.replace(/^\?/, "")) : source;
    return {
      lens: parseWatchLens(params.get("lens")),
      lending: parseAddressParam(params.get("lending")),
      position: parseEntityId(params.get("position")),
      loan: parseEntityId(params.get("loan")),
      stream: parseEntityId(params.get("stream")),
    };
  } catch {
    return { lens: null, lending: null, position: null, loan: null, stream: null };
  }
}

export function parseAddressParam(raw: string | null | undefined): Address | null {
  if (!raw) return null;
  return isAddress(raw) ? raw : null;
}

export function parseTickParam(raw: string | null | undefined): TickBps | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  try {
    return tickBps(value);
  } catch {
    return null;
  }
}

export function localeSeparators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
    group: parts.find((part) => part.type === "group")?.value ?? ",",
  };
}

/**
 * Locale-aware decimal → wei. Never throws past the boundary (B11).
 * A German keyboard types `1,5`; grouping separators are stripped; paste is allowed.
 */
export function parseDecimalInput(
  raw: string,
  options: { locale?: string; decimals?: number } = {},
): ParseResult<Wei> {
  const locale = options.locale ?? "en-US";
  const decimals = options.decimals ?? 18;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return err("malformed");
  const trimmed = raw.trim();
  if (trimmed === "") return err("empty");
  if (trimmed.startsWith("-")) return err("negative");

  const { decimal, group } = localeSeparators(locale);
  let normalized = trimmed;
  if (group) normalized = normalized.split(group).join("");
  if (decimal !== ".") normalized = normalized.replace(decimal, ".");
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized) && normalized !== "0") {
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return err("malformed");
  }
  const [wholeRaw, fracRaw = ""] = normalized.split(".");
  if (fracRaw.length > decimals) return err("overflow");
  try {
    const whole = BigInt(wholeRaw || "0");
    const frac = BigInt(fracRaw.padEnd(decimals, "0") || "0");
    return ok(wei(whole * 10n ** BigInt(decimals) + frac));
  } catch {
    return err("malformed");
  }
}

export function stringifyWithBigint(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === "bigint") {
      return { [BIGINT_TAG]: current.toString() };
    }
    return current as unknown;
  });
}

export function parseWithBigint(raw: string): ParseResult<unknown> {
  if (raw === "") return err("empty");
  try {
    const value = JSON.parse(raw, (_key, current) => {
      if (asRecord(current) && typeof current[BIGINT_TAG] === "string") {
        const tagged = current[BIGINT_TAG];
        if (!/^-?(0|[1-9][0-9]*)$/.test(tagged)) {
          throw new Error("malformed bigint tag");
        }
        return BigInt(tagged);
      }
      return current as unknown;
    }) as unknown;
    return ok(value);
  } catch {
    return err("malformed");
  }
}

function parseDraftShape(value: unknown): FlowDraft | null {
  if (!asRecord(value)) return null;
  if (typeof value.amountRaw !== "string") return null;
  const selectedAprBps =
    value.selectedAprBps === null || value.selectedAprBps === undefined
      ? null
      : typeof value.selectedAprBps === "number" && Number.isInteger(value.selectedAprBps)
        ? value.selectedAprBps
        : undefined;
  if (selectedAprBps === undefined) return null;
  const selectedStreamId =
    value.selectedStreamId === null || value.selectedStreamId === undefined
      ? null
      : typeof value.selectedStreamId === "string"
        ? value.selectedStreamId
        : undefined;
  if (selectedStreamId === undefined) return null;
  const selectedMarket =
    value.selectedMarket === null || value.selectedMarket === undefined
      ? null
      : typeof value.selectedMarket === "string" && isAddress(value.selectedMarket)
        ? value.selectedMarket
        : undefined;
  if (selectedMarket === undefined) return null;
  return {
    amountRaw: value.amountRaw,
    selectedAprBps,
    selectedStreamId,
    selectedMarket,
  };
}

export function parseFlowDraft(raw: string | null | undefined): FlowDraft | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = parseWithBigint(raw);
  if (!parsed.ok) return null;
  return parseDraftShape(parsed.value);
}

export function serializeFlowDraft(draft: FlowDraft): string {
  return stringifyWithBigint(draft);
}

export function parseJsonStorage<T>(
  raw: string | null | undefined,
  guard: (value: unknown) => value is T,
): T | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = parseWithBigint(raw);
  if (!parsed.ok) return null;
  return guard(parsed.value) ? parsed.value : null;
}
