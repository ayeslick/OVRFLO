import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  classifyAdjustError,
  loanCardState,
  obligationPct,
  selectLiquidityForLender,
  streamedPct,
} from "@/lib/positions";
import type { LiquidityPosition } from "@/lib/types";

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

describe("classifyAdjustError", () => {
  it("treats an ERC20 shortfall as a liquidity race, not a dead end", () => {
    expect(classifyAdjustError(new Error("ERC20: transfer amount exceeds balance"))).toBe("stale");
    expect(classifyAdjustError(new Error("ERC20InsufficientBalance(0x.., 1, 2)"))).toBe("stale");
  });

  it("defers to the borrow classification otherwise", () => {
    expect(classifyAdjustError(new Error("reverted: OVRFLOLending: liquidity inactive"))).toBe("stale");
    expect(classifyAdjustError(new Error("reverted: OVRFLOLending: borrow above price"))).toBe("terminal");
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
