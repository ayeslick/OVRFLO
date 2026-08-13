import { describe, expect, it } from "vitest";
import {
  parseDecimalInput,
  parseEntityId,
  parseFlowDraft,
  parseUsdMode,
  parseWatchLens,
  parseAddressParam,
  parseTickParam,
  parseWatchSearch,
  parseWithBigint,
  serializeFlowDraft,
  stringifyWithBigint,
} from "@/lib/parse";

describe("URL / localStorage parsers", () => {
  it("accepts well-formed watch search params", () => {
    expect(parseWatchSearch("?lens=borrowed&loan=14")).toEqual({
      lens: "borrowed",
      position: null,
      loan: 14n,
      stream: null,
    });
    expect(parseWatchLens("supplied")).toBe("supplied");
    expect(parseUsdMode("usd")).toBe("usd");
    expect(parseEntityId("0")).toBe(0n);
  });

  it("rejects malformed URL and localStorage input without throwing past the boundary", () => {
    expect(parseWatchLens("dashboard")).toBeNull();
    expect(parseUsdMode("dollars")).toBeNull();
    expect(parseEntityId("1e18")).toBeNull();
    expect(parseEntityId("-1")).toBeNull();
    expect(parseEntityId("0x01")).toBeNull();
    expect(parseWatchSearch("%%%not-a-query")).toEqual({
      lens: null,
      position: null,
      loan: null,
      stream: null,
    });
    expect(parseWatchSearch("lens=supplied&position=abc")).toEqual({
      lens: "supplied",
      position: null,
      loan: null,
      stream: null,
    });
    expect(parseTickParam("1000")).toBe(1000);
    expect(parseTickParam("99.5")).toBeNull();
    expect(parseTickParam("99999")).toBeNull();
    expect(parseAddressParam("not-an-address")).toBeNull();
    expect(parseFlowDraft("{not json")).toBeNull();
    expect(parseFlowDraft("[]")).toBeNull();
    expect(parseFlowDraft(null)).toBeNull();
    expect(parseWithBigint("")).toEqual({ ok: false, reason: "empty" });
    expect(parseWithBigint("{")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("locale-aware decimal input", () => {
  it("parses a German keyboard 1,5 as 1.5 tokens", () => {
    const parsed = parseDecimalInput("1,5", { locale: "de-DE", decimals: 18 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe(1_500_000_000_000_000_000n);
  });

  it("strips grouping separators and rejects negatives", () => {
    const grouped = parseDecimalInput("1,234.5", { locale: "en-US", decimals: 18 });
    expect(grouped.ok).toBe(true);
    if (grouped.ok) expect(grouped.value).toBe(1_234_500_000_000_000_000_000n);
    expect(parseDecimalInput("-1", { locale: "en-US" })).toEqual({ ok: false, reason: "negative" });
    expect(parseDecimalInput("not-a-number")).toEqual({ ok: false, reason: "malformed" });
    expect(parseDecimalInput("   ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("bigint-safe serializer", () => {
  it("round-trips drafts that contain bigint fields", () => {
    const draft = {
      amountRaw: "1.5",
      selectedAprBps: 1000,
      selectedStreamId: "7",
      selectedMarket: "0x00000000000000000000000000000000000000a1" as const,
      obligation: 123_456_789_012_345_678_901n,
    };
    expect(() => JSON.stringify(draft)).toThrow();
    const raw = stringifyWithBigint(draft);
    const parsed = parseWithBigint(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(draft);
    }
  });

  it("round-trips a flow draft through serializeFlowDraft", () => {
    const draft = {
      amountRaw: "2",
      selectedAprBps: 1100,
      selectedStreamId: null,
      selectedMarket: null,
    };
    expect(parseFlowDraft(serializeFlowDraft(draft))).toEqual(draft);
  });
});
