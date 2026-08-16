import { describe, expect, it } from "vitest";
import {
  aprChoices,
  BPS,
  enumerateIds,
  floorToUnit,
  formatBpsPct,
  isLoanOpen,
  lenderReturnBps,
  liquidityExists,
  loanExists,
  loanOutstanding,
  MAX_ENUMERATION_IDS,
  MAX_UINT128,
  mulDiv,
  ratioBps,
  recoveredForClaimable,
  streamBuckets,
  UNIT,
  upfrontBps,
  WAD,
  YEAR_SECONDS,
} from "@/lib/lending-math";
import { ZERO_ADDRESS } from "@/lib/config";

const lender = "0x0000000000000000000000000000000000000a11" as const;
const borrower = "0x0000000000000000000000000000000000000b0b" as const;

describe("lending math", () => {
  it("computes outstanding from obligation, drawn, and repaid in exactly one helper", () => {
    expect(loanOutstanding({ obligation: 100n, drawn: 30n, repaid: 25n })).toBe(45n);
    expect(loanOutstanding({ obligation: 100n, drawn: 100n, repaid: 25n })).toBe(0n);
  });

  it("treats a zero-obligation loan (e.g. a loan pool with no contributions) as fully satisfied and not open", () => {
    // obligation/drawn/repaid all zero is vacuous for loanOutstanding alone —
    // every plausible mutation (>= vs >, subtraction order) still yields 0n.
    // isLoanOpen is the property this scenario actually exercises.
    expect(loanOutstanding({ obligation: 0n, drawn: 0n, repaid: 0n })).toBe(0n);
    expect(isLoanOpen({ obligation: 0n, drawn: 0n, repaid: 0n, closed: false })).toBe(false);
  });

  it("treats closed loans and fully satisfied loans as not open", () => {
    expect(isLoanOpen({ obligation: 100n, drawn: 50n, repaid: 0n, closed: false })).toBe(true);
    expect(isLoanOpen({ obligation: 100n, drawn: 100n, repaid: 0n, closed: false })).toBe(false);
    expect(isLoanOpen({ obligation: 100n, drawn: 50n, repaid: 0n, closed: true })).toBe(false);
  });

  it("caps open-stream recovery at outstanding debt", () => {
    expect(
      recoveredForClaimable({
        loan: { obligation: 100n, drawn: 20n, repaid: 10n, closed: false },
        withdrawable: 90n,
      }),
    ).toBe(100n);
  });

  it("enumerates 1-based ids, caps at the enumeration limit, and never underflows", () => {
    expect(enumerateIds(4n)).toEqual([1n, 2n, 3n]);
    expect(enumerateIds(1n)).toEqual([]);
    expect(enumerateIds(0n)).toEqual([]);
    const capped = enumerateIds(MAX_ENUMERATION_IDS + 50n);
    expect(capped.length).toBe(Number(MAX_ENUMERATION_IDS));
    expect(capped[0]).toBe(1n);
    expect(capped[capped.length - 1]).toBe(MAX_ENUMERATION_IDS);
    expect(enumerateIds(6n, 2n)).toEqual([1n, 2n]);
  });

  it("builds inclusive APR ladders on the step and handles empty ranges", () => {
    expect(aprChoices(1000, 1300)).toEqual([1000, 1100, 1200, 1300]);
    expect(aprChoices(1000, 1000)).toEqual([1000]);
    expect(aprChoices(1300, 1000)).toEqual([]);
  });

  it("includes a zero-bps floor when the market's minimum APR is zero", () => {
    expect(aprChoices(0, 200)).toEqual([0, 100, 200]);
  });

  it("detects presence by non-zero owner address", () => {
    expect(liquidityExists({ lender })).toBe(true);
    expect(liquidityExists({ lender: ZERO_ADDRESS })).toBe(false);
    expect(loanExists({ borrower })).toBe(true);
    expect(loanExists({ borrower: ZERO_ADDRESS })).toBe(false);
  });

  it("computes upfront bps on the golden vector, net of fee", () => {
    // gross = WAD * BPS / 1.05e18 = 9523.80… -> floor 9523
    expect(upfrontBps(1000, YEAR_SECONDS / 2n, 0)).toBe(9523n);
    // net = 9523 * (10000 - 40) / 10000 = 9484.9… -> floor 9484
    expect(upfrontBps(1000, YEAR_SECONDS / 2n, 40)).toBe(9484n);
  });

  it("returns full value at zero time to maturity", () => {
    expect(upfrontBps(1000, 0n, 0)).toBe(10_000n);
    expect(upfrontBps(1000, 0n, 40)).toBe(9960n);
  });

  it("computes simple-interest lender return over the remaining period", () => {
    expect(lenderReturnBps(1000, YEAR_SECONDS)).toBe(1000n);
    expect(lenderReturnBps(1000, YEAR_SECONDS / 2n)).toBe(500n);
    expect(lenderReturnBps(1000, 0n)).toBe(0n);
  });

  it("formats bps as a one-decimal percent, truncated never rounded", () => {
    expect(formatBpsPct(9523n)).toBe("95.2%");
    expect(formatBpsPct(9529n)).toBe("95.2%");
    expect(formatBpsPct(500n)).toBe("5.0%");
    expect(formatBpsPct(10_000n)).toBe("100.0%");
    expect(formatBpsPct(0n)).toBe("0.0%");
  });

  it("pins MAX_UINT128 to the real uint128 max (the claim max-amount sentinel)", () => {
    expect(MAX_UINT128).toBe(340_282_366_920_938_463_463_374_607_431_768_211_455n);
  });

  it("uses Sablier remaining / claimable / locked buckets", () => {
    const buckets = streamBuckets({
      deposited: 100n,
      withdrawn: 10n,
      refunded: 0n,
      streamed: 40n,
    });
    expect(buckets.remaining).toBe(90n);
    expect(buckets.claimable).toBe(30n);
    expect(buckets.locked).toBe(60n);
  });

  it("keeps ratio math exact above 2^53", () => {
    const num = 2n ** 53n;
    const den = 2n ** 54n + 3n;
    expect(Number(num) === Number(num + 1n)).toBe(true);
    expect(ratioBps(num, den)).toBe(mulDiv(num, BPS, den));
  });

  it("floors odd-wei inputs to UNIT", () => {
    expect(floorToUnit(UNIT + 1n)).toBe(UNIT);
    expect(floorToUnit(UNIT - 1n)).toBe(0n);
  });

  it("drops pending stream recovery once a loan is closed", () => {
    expect(
      recoveredForClaimable({
        loan: { obligation: 100n, drawn: 20n, repaid: 10n, closed: true },
        withdrawable: 90n,
      }),
    ).toBe(30n);
    expect(
      recoveredForClaimable({
        loan: { obligation: 100n, drawn: 20n, repaid: 10n, closed: false },
        withdrawable: 5n,
      }),
    ).toBe(35n);
  });
});
