import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  inferredLens,
  parseWatchUrl,
  selectionMatchesRow,
  serializeWatchSearch,
  selectionFromSearch,
} from "@/lib/watch-url";
import { parseWatchSearch } from "@/lib/parse";

const LENDING = "0x4444444444444444444444444444444444444444" as Address;
const OTHER = "0x5555555555555555555555555555555555555555" as Address;

describe("watch URL", () => {
  it("round-trips lens, lending, and a single entity kind", () => {
    const search = serializeWatchSearch({
      lens: "borrowed",
      selection: { kind: "loan", lending: LENDING, id: 12n },
    });
    expect(search).toBe(`?lens=borrowed&lending=${LENDING}&loan=12`);
    expect(parseWatchUrl(search)).toEqual({
      lens: "borrowed",
      selection: { kind: "loan", lending: LENDING, id: 12n },
    });
  });

  it("ignores a position without lending", () => {
    expect(parseWatchUrl("?lens=dashboard&position=3")).toEqual({
      lens: null,
      selection: { kind: "none" },
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
