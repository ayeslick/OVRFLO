import { describe, expect, it } from "vitest";
import { classifyEntry, streamsDegradedKind } from "@/lib/watch-entry";

const empty = { status: "ready" as const, count: 0 };
const loading = { status: "loading" as const, count: 0 };
const unavailable = { status: "unavailable" as const, count: 0 };
const some = { status: "ready" as const, count: 1 };

describe("R12 entry gate", () => {
  it("renders disconnected when no wallet is connected", () => {
    expect(
      classifyEntry({
        connected: false,
        positions: empty,
        loans: empty,
        streams: empty,
      }),
    ).toBe("disconnected");
  });

  it("holds syncing while books are still loading", () => {
    expect(
      classifyEntry({
        connected: true,
        positions: loading,
        loans: empty,
        streams: empty,
      }),
    ).toBe("syncing");
  });

  it("renders first-run only when positions, loans, and streams are confirmed empty", () => {
    expect(
      classifyEntry({
        connected: true,
        positions: empty,
        loans: empty,
        streams: empty,
      }),
    ).toBe("first-run");
  });

  it("never sends pending discovery with zero books into first-run", () => {
    expect(
      classifyEntry({
        connected: true,
        positions: empty,
        loans: empty,
        streams: loading,
      }),
    ).toBe("watch-streams-degraded");
    expect(streamsDegradedKind(loading)).toBe("pending");
  });

  it("never sends could-not-ask discovery with zero books into first-run", () => {
    expect(
      classifyEntry({
        connected: true,
        positions: empty,
        loans: empty,
        streams: unavailable,
      }),
    ).toBe("watch-streams-degraded");
    expect(streamsDegradedKind(unavailable)).toBe("could-not-ask");
  });

  it("lands on watch when any book has items", () => {
    expect(
      classifyEntry({
        connected: true,
        positions: some,
        loans: empty,
        streams: empty,
      }),
    ).toBe("watch");
  });
});
