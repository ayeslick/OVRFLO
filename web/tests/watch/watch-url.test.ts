import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  inferredLens,
  parseWatchUrl,
  selectionMatchesRow,
  serializeWatchSearch,
  selectionFromSearch,
  stripLensSearch,
} from "@/lib/watch-url";
import { parseWatchSearch } from "@/lib/parse";

const LENDING = "0x4444444444444444444444444444444444444444" as Address;
const OTHER = "0x5555555555555555555555555555555555555555" as Address;

describe("watch URL", () => {
  it("round-trips identity params and never writes lens", () => {
    const search = serializeWatchSearch({
      lens: "borrowed",
      selection: { kind: "loan", lending: LENDING, id: 12n },
    });
    expect(search).toBe(`?lending=${LENDING}&loan=12`);
    expect(parseWatchUrl(search)).toEqual({
      lens: null,
      type: null,
      selection: { kind: "loan", lending: LENDING, id: 12n },
    });
  });

  it("writes type only when selection is none", () => {
    expect(serializeWatchSearch({ type: "loan", selection: { kind: "none" } })).toBe("?type=loan");
    expect(serializeWatchSearch({ type: "fixed", selection: { kind: "none" } })).toBe("?type=fixed");
    expect(
      serializeWatchSearch({
        type: "loan",
        selection: { kind: "loan", lending: LENDING, id: 12n },
      }),
    ).toBe(`?lending=${LENDING}&loan=12`);
  });

  it("ignores a position without lending and unknown keys", () => {
    expect(parseWatchUrl("?lens=dashboard&position=3&foo=1")).toEqual({
      lens: null,
      type: null,
      selection: { kind: "none" },
    });
  });

  it("strips a historical lens query without inventing a redirect", () => {
    expect(stripLensSearch(`?lens=borrowed&lending=${LENDING}&loan=12`)).toEqual({
      search: `?lending=${LENDING}&loan=12`,
      stripped: true,
    });
    expect(stripLensSearch(`?lending=${LENDING}&loan=12`)).toEqual({
      search: `?lending=${LENDING}&loan=12`,
      stripped: false,
    });
  });

  it("infers lens from the selected entity kind", () => {
    expect(inferredLens({ kind: "position", lending: LENDING, id: 1n })).toBe("supplied");
    expect(inferredLens({ kind: "loan", lending: LENDING, id: 1n })).toBe("borrowed");
    expect(inferredLens({ kind: "stream", id: 1n })).toBe("streams");
    expect(inferredLens({ kind: "none" })).toBeNull();
  });

  it("prefers position when multiple entity params are present", () => {
    expect(
      selectionFromSearch(
        parseWatchSearch(`?lending=${LENDING}&position=1&loan=2&stream=3`),
      ),
    ).toEqual({
      kind: "position",
      lending: LENDING,
      id: 1n,
    });
  });

  it("matches a row only when lending and id both agree", () => {
    const selection = { kind: "position" as const, lending: LENDING, id: 1n };
    expect(selectionMatchesRow(selection, "position", { lending: LENDING, id: 1n })).toBe(true);
    expect(selectionMatchesRow(selection, "position", { lending: OTHER, id: 1n })).toBe(false);
    expect(selectionMatchesRow(selection, "loan", { lending: LENDING, id: 1n })).toBe(false);
  });
});
