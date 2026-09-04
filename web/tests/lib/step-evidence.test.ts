import { afterEach, describe, expect, it } from "vitest";
import type { Hash } from "viem";
import {
  anyUnresolvedHash,
  attemptKey,
  listStepEvidence,
  persistPendingHash,
  readCurrentAttempt,
  readPendingHash,
  readStepEvidence,
  stepEvidenceKey,
  writeCurrentAttempt,
  writeStepEvidence,
} from "@/lib/step-evidence";

const factory = "0x00000000000000000000000000000000000000f1";
const account = "0x00000000000000000000000000000000000000a1";
const hash = `0x${"cd".repeat(32)}` as Hash;

const key = {
  factory,
  chainId: 1,
  account,
  graphId: "g-1",
  stepId: "deposit" as const,
};

afterEach(() => {
  window.localStorage.clear();
});

describe("step evidence storage", () => {
  it("keys evidence by factory, chain, account, graph ID, and step ID", () => {
    expect(stepEvidenceKey(key)).toBe(
      `ovrflo:step:${factory}:${1}:${account}:g-1:deposit`,
    );
    const wrote = persistPendingHash(key, hash, {
      kind: "deposit",
      chainId: 1,
      token: "0xpt",
      amount: "10",
    });
    expect(wrote).toBe(true);
    const stored = readStepEvidence(key);
    expect(stored?.hash).toBe(hash);
    expect(stored?.status).toBe("unknown");
    expect(stored?.graphId).toBe("g-1");
    expect(stored?.stepId).toBe("deposit");
    expect(readPendingHash(key)).toBe(hash);
    expect(anyUnresolvedHash()).toBe(true);
  });

  it("keeps runtime progress when storage throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
      clear: () => {
        throw new Error("quota");
      },
      key: () => {
        throw new Error("quota");
      },
      length: 0,
    } as Storage;
    const previous = window.localStorage;
    Object.defineProperty(window, "localStorage", { configurable: true, value: throwing });
    expect(
      writeStepEvidence({
        factory,
        chainId: 1,
        account,
        graphId: "g-1",
        stepId: "deposit",
        status: "confirmed",
        hash,
        receiptStatus: "success",
        confirmations: 2,
        decoded: { streamId: "7" },
        economicIdentity: { kind: "deposit", chainId: 1, token: "0xpt", amount: "10" },
        graphComplete: false,
      }),
    ).toBe(false);
    expect(readStepEvidence(key)).toBeNull();
    expect(listStepEvidence(factory, 1, account)).toEqual([]);
    Object.defineProperty(window, "localStorage", { configurable: true, value: previous });
  });

  it("stores the current attempt so modal close can keep the graph ID", () => {
    writeCurrentAttempt(factory, 1, account, {
      graphId: "g-keep",
      kind: "deposit-plus-borrow",
      accepted: true,
    });
    expect(readCurrentAttempt(factory, 1, account, "deposit-plus-borrow")).toEqual({
      graphId: "g-keep",
      kind: "deposit-plus-borrow",
      accepted: true,
    });
    expect(readCurrentAttempt(factory, 1, account, "supply")).toBeNull();
    expect(attemptKey(factory, 1, account, "deposit-plus-borrow")).toBe(
      `ovrflo:attempt:${factory}:1:${account}:deposit-plus-borrow`,
    );
  });
});
