import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { shapeLadder } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, UNIT } from "@/lib/lending-math";
import { applySlippageDown } from "@/lib/modal-logic";
import {
  PREVIEW_MAX_TARGET,
  liveTickCopy,
  poolFractions,
  presentQuote,
  quoteDrift,
  snapshotQuote,
  tickDepthWei,
  weiToAmountInput,
  type PreviewBorrowOutcome,
} from "@/components/borrow/quote";

const ETHER = 10n ** 18n;
const REMAINING = 110n * ETHER;
const APR = 1000;
const FEE = 40;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const BLOCK = { N: 10n, H: HASH };

function preview(overrides: Partial<PreviewBorrowOutcome> = {}): PreviewBorrowOutcome {
  return {
    emptyTick: false,
    actualBorrow: 10n * ETHER,
    feeAmount: (10n * ETHER * BigInt(FEE)) / 10_000n,
    obligation: 11n * ETHER,
    block: BLOCK,
    ...overrides,
  };
}

function quoteFromPreview(
  outcome: PreviewBorrowOutcome,
  extras: { target?: bigint; cap?: bigint; depth?: bigint; remaining?: bigint } = {},
) {
  return presentQuote({
    preview: outcome,
    target: extras.target ?? outcome.actualBorrow,
    cap: extras.cap ?? outcome.actualBorrow,
    depth: extras.depth ?? 50n * ETHER,
    aprBps: APR,
    streamRemaining: extras.remaining ?? REMAINING,
    minLiquidity: MIN_LIQUIDITY_AMOUNT,
  });
}

describe("borrow quote", () => {
  it("MAX cap is previewBorrow actualBorrow at uint128.max, not a wallet balance", () => {
    expect(PREVIEW_MAX_TARGET).toBe((1n << 128n) - 1n);
    const capPreview = preview({ actualBorrow: 100n * ETHER, feeAmount: 0n, obligation: REMAINING });
    const quote = quoteFromPreview(capPreview, {
      target: PREVIEW_MAX_TARGET,
      cap: capPreview.actualBorrow,
    });
    expect(quote.cap).toBe(100n * ETHER);
    expect(quote.cap % UNIT).toBe(0n);
    expect(quote.fill).toBe(capPreview.actualBorrow);
  });

  it("states sale equivalence only when obligation equals remaining", () => {
    const exact = quoteFromPreview(
      preview({ actualBorrow: 10n * ETHER, obligation: REMAINING, feeAmount: 0n }),
      { remaining: REMAINING },
    );
    expect(exact.saleEquivalent).toBe(true);
    expect(exact.obligation).toBe(REMAINING);
    expect(exact.residual).toBe(0n);

    const clamped = quoteFromPreview(
      preview({ actualBorrow: 99n * ETHER, obligation: REMAINING - 1n, feeAmount: 0n }),
      { remaining: REMAINING, cap: 99n * ETHER },
    );
    expect(clamped.saleEquivalent).toBe(false);
    expect(clamped.residual).toBeGreaterThan(0n);
  });

  it("derives minAcceptable from reviewed net", () => {
    const quote = quoteFromPreview(preview({ actualBorrow: 10n * ETHER }));
    expect(quote.minAcceptable).toBe(applySlippageDown(quote.net));
    expect(quote.minAcceptable <= quote.net).toBe(true);
    expect(quote.feeAmount).toBe((quote.fill * BigInt(FEE)) / 10_000n);
    expect(quote.net).toBe(quote.actualBorrow - quote.feeAmount);
  });

  it("flags a partial fill when the preview fill is below target", () => {
    const quote = quoteFromPreview(preview({ actualBorrow: 5n * ETHER, feeAmount: 0n }), {
      target: 20n * ETHER,
      depth: 5n * ETHER,
    });
    expect(quote.partial).toBe(true);
    expect(quote.fill).toBe(5n * ETHER);
    expect(quote.emptyTick).toBe(false);
  });

  it("maps EmptyTick zeros without marking a partial fill", () => {
    const quote = quoteFromPreview(
      preview({ emptyTick: true, actualBorrow: 0n, feeAmount: 0n, obligation: 0n }),
      { target: 5n * ETHER, depth: MIN_LIQUIDITY_AMOUNT - 1n },
    );
    expect(quote.emptyTick).toBe(true);
    expect(quote.partial).toBe(false);
    expect(quote.fill).toBe(0n);
    expect(quote.net).toBe(0n);
  });

  it("detects quote drift on actualBorrow, feeAmount, or obligation only", () => {
    const live = quoteFromPreview(preview({ actualBorrow: 10n * ETHER }));
    const frozen = snapshotQuote(live);
    expect(quoteDrift(frozen, live)).toBe(false);
    expect(quoteDrift(frozen, { ...live, net: live.net - 1n })).toBe(false);
    expect(quoteDrift(frozen, { ...live, depth: live.depth - UNIT })).toBe(false);
    expect(quoteDrift(frozen, { ...live, block: { N: 99n, H: HASH } })).toBe(false);
    expect(quoteDrift(frozen, { ...live, actualBorrow: live.actualBorrow - 1n })).toBe(true);
    expect(quoteDrift(frozen, { ...live, feeAmount: live.feeAmount + 1n })).toBe(true);
    expect(quoteDrift(frozen, { ...live, obligation: live.obligation + 1n })).toBe(true);
  });

  it("round-trips MAX through the amount input", () => {
    const cap = 100n * ETHER;
    const raw = weiToAmountInput(cap);
    expect(raw.includes(".") ? raw.split(".")[1]?.length ?? 0 : 0).toBeLessThanOrEqual(18);
    const [whole, frac = ""] = raw.split(".");
    const back = BigInt(whole ?? "0") * ETHER + BigInt(frac.padEnd(18, "0"));
    expect(back).toBe(cap);
  });

  it("names live ticks and reports pool overrun with bigint-safe fractions", () => {
    const model = shapeLadder([
      { aprBps: 1000, availableUnits: 0n },
      { aprBps: 1100, availableUnits: 5_000_000n },
    ]);
    expect(liveTickCopy(model)).toContain("11.00%");
    expect(tickDepthWei(model, 1000)).toBe(0n);
    expect(poolFractions(12n, 10n).overrun).toBe(true);
    expect(poolFractions(4n, 10n).self).toBe(0.4);
  });
});
