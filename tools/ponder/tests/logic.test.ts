import { describe, expect, it } from "vitest";
import { shouldSkipMintTransfer, ZERO_ADDRESS } from "../src/logic";

describe("Sablier transfer logic", () => {
  it("skips ERC-721 mint transfers so CreateLockupLinearStream remains authoritative", () => {
    expect(shouldSkipMintTransfer(ZERO_ADDRESS)).toBe(true);
    expect(shouldSkipMintTransfer("0x0000000000000000000000000000000000000abc")).toBe(false);
  });
});
