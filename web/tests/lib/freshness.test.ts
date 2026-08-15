import { describe, expect, it } from "vitest";
import { classifyFreshness, signingAllowed } from "@/lib/freshness";

describe("classifyFreshness", () => {
  it("maps success / pending / error against a retained asOf", () => {
    expect(classifyFreshness({ lastSuccessAt: 100n, status: "success" })).toEqual({
      kind: "synced",
      asOf: 100n,
    });
    expect(classifyFreshness({ lastSuccessAt: 100n, status: "pending" })).toEqual({
      kind: "reconnecting",
      asOf: 100n,
    });
    expect(classifyFreshness({ lastSuccessAt: 100n, status: "error" })).toEqual({
      kind: "degraded",
      asOf: 100n,
    });
    expect(classifyFreshness({ lastSuccessAt: null, status: "error" })).toEqual({
      kind: "unavailable",
      asOf: null,
    });
    expect(classifyFreshness({ lastSuccessAt: null, status: "idle" })).toEqual({
      kind: "unavailable",
      asOf: null,
    });
    expect(classifyFreshness({ lastSuccessAt: null, status: "pending" })).toEqual({
      kind: "unavailable",
      asOf: null,
    });
  });

  it("discards an aged success past maxAgeMs", () => {
    // lastSuccessAt is unix seconds; now is wall-clock ms.
    expect(
      classifyFreshness({
        lastSuccessAt: 100n,
        status: "success",
        now: 160_000,
        maxAgeMs: 45_000,
      }),
    ).toEqual({ kind: "unavailable", asOf: null });
  });

  it("gates signing to synced only", () => {
    expect(signingAllowed({ kind: "synced", asOf: 1n })).toBe(true);
    expect(signingAllowed({ kind: "degraded", asOf: 1n })).toBe(false);
    expect(signingAllowed({ kind: "unavailable", asOf: null })).toBe(false);
  });
});
