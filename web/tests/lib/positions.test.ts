import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { ovrfloLendingAbi } from "@/lib/generated";
import {
  adjustReceiptSummary,
  borrowTeaserBps,
  classifyAdjustError,
  loanCardState,
  obligationPct,
  selectForMarket,
  selectLiquidityForLender,
  streamedPct,
} from "@/lib/positions";
import type { TickDepth } from "@/lib/router";
import type { LiquidityPosition, LoanPool } from "@/lib/types";

function testAddress(id: number): Address {
  return `0x${id.toString(16).padStart(40, "0")}` as Address;
}

// --- loanCardState ---

describe("loanCardState", () => {
  it("classifies an open loan with outstanding debt as repaying", () => {
    expect(loanCardState({ obligation: 100n, drawn: 20n, repaid: 10n, closed: false })).toBe("repaying");
  });

  it("classifies obligation-met-but-open as residual (stream still returning)", () => {
    expect(loanCardState({ obligation: 100n, drawn: 60n, repaid: 40n, closed: false })).toBe("residual");
  });

  it("classifies a closed loan as settled regardless of ledger state", () => {
    expect(loanCardState({ obligation: 100n, drawn: 100n, repaid: 0n, closed: true })).toBe("settled");
    expect(loanCardState({ obligation: 100n, drawn: 10n, repaid: 0n, closed: true })).toBe("settled");
  });
});

// --- streamedPct ---

describe("streamedPct", () => {
  it("reports withdrawn plus currently claimable as streamed", () => {
    expect(streamedPct({ deposited: 200n, withdrawn: 40n, withdrawable: 10n })).toBe(25);
  });

  it("clamps to 100 and floors fractional percentages", () => {
    expect(streamedPct({ deposited: 3n, withdrawn: 2n, withdrawable: 0n })).toBe(66);
    expect(streamedPct({ deposited: 100n, withdrawn: 150n, withdrawable: 0n })).toBe(100);
  });

  it("returns 0 for an empty deposit instead of dividing by zero", () => {
    expect(streamedPct({ deposited: 0n, withdrawn: 0n, withdrawable: 0n })).toBe(0);
  });
});

// --- borrowTeaserBps ---

function tick(aprBps: number, total: bigint): TickDepth {
  return { aprBps, total, own: 0n, positions: [] };
}

describe("borrowTeaserBps", () => {
  const YEAR = 31_536_000n;

  it("prices the teaser at the lowest tick with real liquidity", () => {
    // 10% APR over a full year, zero fee: upfront = 10000/1.1 ≈ 90.9%
    const bps = borrowTeaserBps([tick(1200, 50n), tick(1000, 10n)], YEAR, 0);
    expect(bps).toBe(9090n);
  });

  it("returns null when no tick has liquidity", () => {
    expect(borrowTeaserBps([tick(1000, 0n)], YEAR, 0)).toBeNull();
    expect(borrowTeaserBps([], YEAR, 0)).toBeNull();
  });
});

// --- adjustReceiptSummary ---

const LENDING = testAddress(0x999);

function suppliedLog(liquidityId: bigint, moved: bigint, emitter = LENDING): Log {
  const topics = encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "LiquiditySupplied",
    args: { liquidityId, lender: testAddress(0x111), market: testAddress(0x333) },
  });
  return {
    address: emitter,
    topics,
    data: encodeAbiParameters([{ type: "uint16" }, { type: "uint128" }], [1100, moved]),
  } as unknown as Log;
}

function withdrawnLog(liquidityId: bigint, refunded: bigint): Log {
  const topics = encodeEventTopics({
    abi: ovrfloLendingAbi,
    eventName: "LiquidityWithdrawn",
    args: { liquidityId, lender: testAddress(0x111) },
  });
  return {
    address: LENDING,
    topics,
    data: encodeAbiParameters([{ type: "uint128" }], [refunded]),
  } as unknown as Log;
}

describe("adjustReceiptSummary", () => {
  it("pairs the withdraw refund with the supplied amount", () => {
    expect(adjustReceiptSummary([withdrawnLog(3n, 500n), suppliedLog(9n, 500n)], LENDING)).toEqual({
      liquidityId: 9n,
      aprBps: 1100,
      moved: 500n,
      refunded: 500n,
    });
  });

  it("exposes a wallet top-up when the position shrank before execution", () => {
    const summary = adjustReceiptSummary([withdrawnLog(3n, 300n), suppliedLog(9n, 500n)], LENDING);
    expect(summary?.refunded).toBe(300n);
    expect(summary?.moved).toBe(500n);
  });

  it("ignores logs from other contracts and empty receipts", () => {
    expect(adjustReceiptSummary([suppliedLog(9n, 500n, testAddress(0xbad))], LENDING)).toBeNull();
    expect(adjustReceiptSummary([], LENDING)).toBeNull();
  });

  it("falls back to the supplied amount for refunded when there is no withdraw leg at all", () => {
    // A pure top-up (increasing available liquidity) never emits LiquidityWithdrawn.
    const summary = adjustReceiptSummary([suppliedLog(9n, 500n)], LENDING);
    expect(summary).toEqual({ liquidityId: 9n, aprBps: 1100, moved: 500n, refunded: 500n });
  });
});

describe("classifyAdjustError", () => {
  it("treats an ERC20 shortfall as a liquidity race, not a dead end", () => {
    expect(classifyAdjustError(new Error("ERC20: transfer amount exceeds balance"))).toBe("stale");
    expect(classifyAdjustError(new Error("ERC20InsufficientBalance(0x.., 1, 2)"))).toBe("stale");
  });

  it("defers to the borrow classification otherwise", () => {
    expect(classifyAdjustError(new Error("reverted: OVRFLOLending: liquidity inactive"))).toBe("stale");
    expect(classifyAdjustError(new Error("reverted: OVRFLOLending: self-match"))).toBe("terminal");
    expect(classifyAdjustError(new Error("User rejected the request."))).toBe("retryable");
  });
});

describe("obligationPct", () => {
  it("floors and clamps repayment progress", () => {
    expect(obligationPct({ obligation: 100n, drawn: 20n, repaid: 13n })).toBe(33);
    expect(obligationPct({ obligation: 100n, drawn: 150n, repaid: 0n })).toBe(100);
    expect(obligationPct({ obligation: 0n, drawn: 0n, repaid: 0n })).toBe(100);
  });
});

// --- selectLiquidityForLender / selectForMarket ---

const MARKET_A = testAddress(0x333);
const MARKET_B = testAddress(0x444);
const LENDER = testAddress(0x111);

function liquidityPosition(id: number, market: Address, lender: Address): LiquidityPosition {
  return { id: BigInt(id), lender, market, aprBps: 1000, availableLiquidity: 100n };
}

describe("selectLiquidityForLender", () => {
  const rows = [
    liquidityPosition(1, MARKET_A, LENDER),
    liquidityPosition(2, MARKET_B, LENDER),
    liquidityPosition(3, MARKET_A, testAddress(0x222)),
  ];

  it("keeps only rows matching both the market and the normalized lender", () => {
    expect(selectLiquidityForLender(rows, MARKET_A, LENDER.toLowerCase())).toEqual([rows[0]]);
  });

  it("matches the market case-insensitively", () => {
    const upperMarket = MARKET_A.toUpperCase().replace("0X", "0x") as Address;
    expect(selectLiquidityForLender(rows, upperMarket, LENDER.toLowerCase())).toEqual([rows[0]]);
  });

  it("matches the lender case-insensitively", () => {
    // LENDER (0x111...) is all-digit, so LENDER.toLowerCase() above is a
    // no-op and never actually exercises normalization on the lender side.
    // Use an address with real hex letters so an upper/lower mismatch is
    // observable, and would fail if the position side's .toLowerCase() were
    // ever dropped.
    const mixedCaseLender = testAddress(0xabc);
    const upperLender = mixedCaseLender.toUpperCase().replace("0X", "0x") as Address;
    const row = liquidityPosition(9, MARKET_A, upperLender);
    expect(selectLiquidityForLender([row], MARKET_A, mixedCaseLender.toLowerCase())).toEqual([row]);
  });

  it("returns nothing when no wallet is connected (normalizedUser undefined)", () => {
    expect(selectLiquidityForLender(rows, MARKET_A, undefined)).toEqual([]);
  });
});

function poolRow(market: Address): { pool: Pick<LoanPool, "market"> } {
  return { pool: { market } };
}

describe("selectForMarket", () => {
  it("keeps only rows whose pool.market matches, case-insensitively", () => {
    const rows = [poolRow(MARKET_A), poolRow(MARKET_B)];
    const upperMarket = MARKET_A.toUpperCase().replace("0X", "0x") as Address;
    expect(selectForMarket(rows, upperMarket)).toEqual([rows[0]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(selectForMarket([poolRow(MARKET_B)], MARKET_A)).toEqual([]);
  });
});
