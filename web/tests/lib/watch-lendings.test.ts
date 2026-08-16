import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { uniqueLendings } from "@/lib/watch-lendings";

const A = "0x0000000000000000000000000000000000000a11" as Address;
const B = "0x0000000000000000000000000000000000000b22" as Address;

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
});
