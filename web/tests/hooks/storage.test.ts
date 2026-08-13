import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCheckpoint,
  storageGet,
  storageSet,
  writeCandidateIdsUnion,
  writeCheckpointMax,
} from "@/lib/storage";

const KEY = "ovrflo:test-checkpoint";
const IDS_KEY = "ovrflo:test-candidates";

describe("throw-tolerant storage", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(IDS_KEY);
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it("survives a throwing localStorage (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(storageGet(KEY)).toBeNull();
    expect(storageSet(KEY, "1")).toBe(false);
    expect(readCheckpoint(KEY)).toBeNull();
  });

  it("concurrent checkpoint writes resolve to the maximum block", () => {
    const hashA = `0x${"aa".repeat(32)}` as const;
    const hashB = `0x${"bb".repeat(32)}` as const;
    writeCheckpointMax(KEY, { number: 10n, hash: hashA });
    const stored = writeCheckpointMax(KEY, { number: 7n, hash: hashB });
    expect(stored.number).toBe(10n);
    expect(readCheckpoint(KEY)?.number).toBe(10n);
    const later = writeCheckpointMax(KEY, { number: 12n, hash: hashB });
    expect(later.number).toBe(12n);
  });

  it("unions candidate ids across incremental scans", () => {
    expect(writeCandidateIdsUnion(IDS_KEY, [2n, 1n])).toEqual([1n, 2n]);
    expect(writeCandidateIdsUnion(IDS_KEY, [2n, 9n])).toEqual([1n, 2n, 9n]);
  });
});
