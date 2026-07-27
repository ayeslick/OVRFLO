import { describe, expect, it } from "vitest";
import { demandKeys, streamKeys } from "@/lib/query-keys";

const USER_A = "0x1234567890abcdef1234567890abcdef12345678" as const;
const USER_B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;

describe("streamKeys", () => {
  it("roots every derived key under the same top-level namespace", () => {
    expect(streamKeys.all).toEqual(["streams"]);
    expect(streamKeys.held(USER_A)[0]).toBe(streamKeys.all[0]);
  });

  it("produces distinct keys for distinct users", () => {
    expect(streamKeys.held(USER_A)).toEqual(["streams", "held", USER_A]);
    expect(streamKeys.held(USER_A)).not.toEqual(streamKeys.held(USER_B));
  });

  it("keeps null/undefined users distinguishable from a real address (no collapsing to one shared cache entry)", () => {
    expect(streamKeys.held(null)).toEqual(["streams", "held", null]);
    expect(streamKeys.held(undefined)).toEqual(["streams", "held", undefined]);
    expect(streamKeys.held(null)).not.toEqual(streamKeys.held(USER_A));
  });
});

describe("demandKeys", () => {
  it("roots every derived key under the same top-level namespace, distinct from streamKeys", () => {
    expect(demandKeys.all).toEqual(["demand"]);
    expect(demandKeys.market(USER_A)[0]).toBe(demandKeys.all[0]);
    expect(demandKeys.all[0]).not.toBe(streamKeys.all[0]);
  });

  it("produces distinct keys per market", () => {
    expect(demandKeys.market(USER_A)).toEqual(["demand", "market", USER_A]);
    expect(demandKeys.market(USER_A)).not.toEqual(demandKeys.market(USER_B));
  });

  it("never collides with a streamKeys key even when called with the same address", () => {
    expect(demandKeys.market(USER_A)).not.toEqual(streamKeys.held(USER_A));
  });
});
