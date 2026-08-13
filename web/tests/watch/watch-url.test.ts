import { describe, expect, it } from "vitest";
import {
  inferredLens,
  parseWatchUrl,
  serializeWatchSearch,
  selectionFromSearch,
} from "@/lib/watch-url";
import { parseWatchSearch } from "@/lib/parse";

describe("watch URL", () => {
  it("round-trips lens and a single entity kind", () => {
    const search = serializeWatchSearch({
      lens: "borrowed",
      selection: { kind: "loan", id: 12n },
    });
    expect(search).toBe("?lens=borrowed&loan=12");
    expect(parseWatchUrl(search)).toEqual({
      lens: "borrowed",
      selection: { kind: "loan", id: 12n },
    });
  });

  it("ignores invalid lens values", () => {
    expect(parseWatchUrl("?lens=dashboard&position=3")).toEqual({
      lens: null,
      selection: { kind: "position", id: 3n },
    });
  });

  it("infers lens from the selected entity kind", () => {
    expect(inferredLens({ kind: "position", id: 1n })).toBe("supplied");
    expect(inferredLens({ kind: "loan", id: 1n })).toBe("borrowed");
    expect(inferredLens({ kind: "stream", id: 1n })).toBe("streams");
    expect(inferredLens({ kind: "none" })).toBeNull();
  });

  it("prefers position when multiple entity params are present", () => {
    expect(selectionFromSearch(parseWatchSearch("?position=1&loan=2&stream=3"))).toEqual({
      kind: "position",
      id: 1n,
    });
  });
});
