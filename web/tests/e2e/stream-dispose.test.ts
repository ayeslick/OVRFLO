import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { requireStreamBurnedAfterClose } from "../e2e/steps/stream-dispose";

const RETURNED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

describe("AE6 full-value dispose arrange", () => {
  it("accepts a burned NFT", () => {
    expect(() => requireStreamBurnedAfterClose(null, 12n)).not.toThrow();
  });

  it("fails the arrange when the NFT returns", () => {
    expect(() => requireStreamBurnedAfterClose(RETURNED, 12n)).toThrow(
      /stream 12 returned to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; expected burn/,
    );
  });
});
