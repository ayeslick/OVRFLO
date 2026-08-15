import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readRepayHandoff,
  storageGet,
  storageSet,
  writeRepayHandoff,
} from "@/lib/storage";

const KEY = "ovrflo:test-storage";

describe("throw-tolerant storage", () => {
  afterEach(() => {
    try {
      window.localStorage.removeItem(KEY);
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
  });

  it("restores a matching repay handoff once", () => {
    writeRepayHandoff(12n, "1.25000");
    expect(readRepayHandoff(99n)).toBeNull();
    expect(readRepayHandoff(12n)).toBe("1.25000");
    expect(readRepayHandoff(12n)).toBeNull();
  });
});
