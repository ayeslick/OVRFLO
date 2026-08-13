import { describe, expect, it } from "vitest";
import { classifySurfaceState, confirmedEmpty, SURFACE_STATES, SURFACE_STATE_LABEL } from "@/lib/surface-state";

describe("eight-state grammar", () => {
  it("names eight distinct labeled states", () => {
    expect(SURFACE_STATES).toEqual([
      "LOADING",
      "EMPTY",
      "READY",
      "STALE",
      "WALLET_PENDING",
      "CHAIN_PENDING",
      "CONFIRMED",
      "ERROR",
    ]);
    expect(new Set(Object.values(SURFACE_STATE_LABEL)).size).toBe(8);
    expect(SURFACE_STATE_LABEL.STALE).not.toBe(SURFACE_STATE_LABEL.LOADING);
    expect(SURFACE_STATE_LABEL.STALE).toMatch(/SIGNING DISABLED/);
  });

  it("never classifies loading as empty even when the count is zero", () => {
    expect(confirmedEmpty("loading", 0)).toBe(false);
    expect(confirmedEmpty("unavailable", 0)).toBe(false);
    expect(confirmedEmpty("ready", 0)).toBe(true);
    expect(
      classifySurfaceState({ dataStatus: "loading" }),
    ).toBe("LOADING");
    expect(
      classifySurfaceState({ dataStatus: "empty" }),
    ).toBe("EMPTY");
  });

  it("keeps STALE distinct from LOADING when last-known data exists", () => {
    expect(
      classifySurfaceState({
        dataStatus: "ready",
        stale: true,
        signingAllowed: false,
        hasLastKnown: true,
      }),
    ).toBe("STALE");
    expect(
      classifySurfaceState({
        dataStatus: "loading",
        stale: true,
        signingAllowed: false,
        hasLastKnown: false,
      }),
    ).toBe("LOADING");
  });

  it("orders write-lifecycle states above data states", () => {
    expect(classifySurfaceState({ dataStatus: "ready", isConfirmed: true })).toBe("CONFIRMED");
    expect(classifySurfaceState({ dataStatus: "ready", error: true })).toBe("ERROR");
    expect(classifySurfaceState({ dataStatus: "ready", isSigning: true })).toBe("WALLET_PENDING");
    expect(classifySurfaceState({ dataStatus: "ready", isConfirming: true })).toBe("CHAIN_PENDING");
    expect(classifySurfaceState({ dataStatus: "ready" })).toBe("READY");
  });
});
