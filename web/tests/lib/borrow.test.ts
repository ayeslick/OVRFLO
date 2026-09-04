import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { ovrfloLendingAbi } from "@/lib/generated";
import {
  borrowReceiptSummary,
  classifyBorrowError,
  parseSlippageBps,
  SLIPPAGE_MAX_BPS,
  SLIPPAGE_MIN_BPS,
} from "@/lib/borrow";
function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

const MARKET = testAddress(0x333);
const SELF = testAddress(0x222);

// --- parseSlippageBps ---

describe("parseSlippageBps", () => {
  it("parses whole and fractional percent", () => {
    expect(parseSlippageBps("1")).toBe(100n);
    expect(parseSlippageBps("0.5")).toBe(50n);
    expect(parseSlippageBps("0.25")).toBe(25n);
  });

  it("accepts the range bounds", () => {
    expect(parseSlippageBps("0.1")).toBe(SLIPPAGE_MIN_BPS);
    expect(parseSlippageBps("5")).toBe(SLIPPAGE_MAX_BPS);
  });

  it("rejects out-of-range, malformed, and over-precise input", () => {
    expect(parseSlippageBps("0.05")).toBeNull();
    expect(parseSlippageBps("5.01")).toBeNull();
    expect(parseSlippageBps("-1")).toBeNull();
    expect(parseSlippageBps("abc")).toBeNull();
    expect(parseSlippageBps("")).toBeNull();
    expect(parseSlippageBps("0.125")).toBeNull();
    // Literal zero is below the minimum, not a valid slippage tolerance —
    // distinct from "0.05" above (which is below the minimum but non-zero).
    expect(parseSlippageBps("0")).toBeNull();
    expect(parseSlippageBps("0.0")).toBeNull();
  });
});

// --- classifyBorrowError ---

describe("classifyBorrowError", () => {
  it("classifies liquidity races as stale", () => {
    for (const reason of [
      "OVRFLOLending: liquidity inactive",
      "OVRFLOLending: insufficient availableLiquidity",
      "OVRFLOLending: duplicate or unsorted ids",
      "OVRFLOLending: slippage",
    ]) {
      expect(classifyBorrowError(new Error(`reverted: ${reason}`))).toBe("stale");
    }
  });

  it("classifies other contract reverts as terminal", () => {
    expect(classifyBorrowError(new Error("reverted: OVRFLOLending: borrow above price"))).toBe("terminal");
    expect(classifyBorrowError(new Error("WrongSender()"))).toBe("terminal");
    expect(classifyBorrowError(new Error("SeriesMatured()"))).toBe("terminal");
  });

  it("classifies everything else as retryable", () => {
    expect(classifyBorrowError(new Error("User rejected the request."))).toBe("retryable");
    expect(classifyBorrowError(new Error("HTTP request failed"))).toBe("retryable");
  });

  it("classifies non-Error thrown values as retryable rather than throwing", () => {
    expect(classifyBorrowError("")).toBe("retryable"); // empty-message failure
    expect(classifyBorrowError(undefined)).toBe("retryable"); // no failure object at all
  });
});

// --- borrowReceiptSummary ---

const LENDING = testAddress(0x999);

function borrowCreatedLog(loanId: bigint, contributed: bigint, emitter = LENDING): Log {
  const topics = encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "Borrowed",
    args: { loanId, borrower: SELF, market: MARKET },
  });
  return {
    address: emitter,
    topics,
    data: encodeAbiParameters(
      [
        { type: "uint16" },
        { type: "uint32" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint128" },
        { type: "uint256" },
      ],
      [1000, 0, 0n, 0n, 0n, contributed, 0n, 0n, 0n],
    ),
  } as unknown as Log;
}

describe("borrowReceiptSummary", () => {
  it("parses the created pool and nets out the fee", () => {
    const summary = borrowReceiptSummary([borrowCreatedLog(7n, 10_000n)], 40, LENDING);
    expect(summary).toEqual({ loanId: 7n, contributed: 10_000n, net: 9_960n });
  });

  it("returns null when the receipt has no pool-created log", () => {
    expect(borrowReceiptSummary([], 40, LENDING)).toBeNull();
  });

  it("ignores look-alike events emitted by other contracts", () => {
    const forged = borrowCreatedLog(7n, 10_000n, testAddress(0xbad));
    expect(borrowReceiptSummary([forged], 40, LENDING)).toBeNull();
  });

  it("keeps net equal to contributed when the market fee is zero", () => {
    const summary = borrowReceiptSummary([borrowCreatedLog(7n, 10_000n)], 0, LENDING);
    expect(summary).toEqual({ loanId: 7n, contributed: 10_000n, net: 10_000n });
  });

  it("floors the fee (never rounds up) — 15000 * 1bps / 10000 = 1.5, so fee is 1, not 2", () => {
    const summary = borrowReceiptSummary([borrowCreatedLog(7n, 15_000n)], 1, LENDING);
    expect(summary).toEqual({ loanId: 7n, contributed: 15_000n, net: 14_999n });
  });
});
