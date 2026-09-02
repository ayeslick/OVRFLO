import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { MarketInfo } from "@/lib/types";
import { isRetiredLending, marketForLending, uniqueLendings } from "@/lib/watch-lendings";

const A = "0x0000000000000000000000000000000000000a11" as Address;
const B = "0x0000000000000000000000000000000000000b22" as Address;
const C = "0x0000000000000000000000000000000000000c33" as Address;

describe("uniqueLendings", () => {
  it("keeps first-seen order and drops duplicates and nulls", () => {
    expect(
      uniqueLendings([
        { lending: A },
        { lending: null },
        { lending: B },
        { lending: A.toUpperCase() as Address },
        { lending: undefined },
      ]),
    ).toEqual([A, B]);
  });

  it("appends retired markets after the active market", () => {
    expect(
      uniqueLendings([
        { lending: A, retiredLendings: [C, A] },
        { lending: B, retiredLendings: [C] },
      ]),
    ).toEqual([A, B, C]);
    expect(isRetiredLending([{ lending: A, retiredLendings: [C] }], C)).toBe(true);
    expect(isRetiredLending([{ lending: A, retiredLendings: [C] }], A)).toBe(false);
  });
});

function series(lending: Address, market: Address, expiryCached: bigint): MarketInfo {
  return {
    vault: A,
    treasury: A,
    underlying: A,
    ovrfloToken: A,
    reserve: A,
    lending,
    retiredLendings: [],
    market,
    twapDurationFixed: 900,
    feeBps: 50,
    expiryCached,
    ptToken: A,
    oracle: A,
  };
}

describe("marketForLending", () => {
  it("selects the Pendle series that matches the row when one lending hosts two series", () => {
    const first = series(A, B, 1n);
    const second = series(A, C, 2n);
    expect(marketForLending([first, second], A, C)).toEqual(second);
    expect(marketForLending([first, second], A, B)).toEqual(first);
    expect(marketForLending([first, second], A)).toEqual(first);
  });
});
