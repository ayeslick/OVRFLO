import { describe, expect, it } from "vitest";
import { applyWithdrawal, assetKey, normalizeAddress, shouldSkipMintTransfer, streamKey, ZERO_ADDRESS } from "../src/logic";

describe("Sablier indexer logic", () => {
  it("skips ERC-721 mint transfers so CreateLockupLinearStream remains authoritative", () => {
    expect(shouldSkipMintTransfer(ZERO_ADDRESS)).toBe(true);
    expect(shouldSkipMintTransfer("0x0000000000000000000000000000000000000abc")).toBe(false);
  });

  it("normalizes keys and addresses consistently", () => {
    expect(normalizeAddress("0xABCDEF")).toBe("0xabcdef");
    expect(streamKey(1, "0xABCDEF", 42n)).toBe("0xabcdef-1-42");
    expect(assetKey(1, "0xABCDEF")).toBe("asset-1-0xabcdef");
  });

  it("accumulates withdrawals and marks streams depleted at zero intact amount", () => {
    expect(applyWithdrawal({ intactAmount: 100n, withdrawnAmount: 5n, amount: 40n })).toEqual({
      withdrawnAmount: 45n,
      intactAmount: 60n,
      depleted: false,
    });
    expect(applyWithdrawal({ intactAmount: 10n, withdrawnAmount: 5n, amount: 40n })).toEqual({
      withdrawnAmount: 45n,
      intactAmount: 0n,
      depleted: true,
    });
  });
});
