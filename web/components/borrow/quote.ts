import { poolAvailableWei, type LadderModel, type ShapedRung } from "@/lib/ladder";
import {
  MIN_LIQUIDITY_AMOUNT,
  UNIT,
  fee,
  floorToUnit,
  grossPrice,
  obligationForFill,
} from "@/lib/lending-math";
import { applySlippageDown } from "@/lib/modal-logic";
import { coverDate, repayPreview, type CoverDate, type StreamSchedule } from "@/lib/payoff";
import { formatAprBps } from "@/lib/format";

export type BorrowQuote = {
  target: bigint;
  cap: bigint;
  depth: bigint;
  fill: bigint;
  partial: boolean;
  emptyTick: boolean;
  belowFillFloor: boolean;
  gross: bigint;
  obligation: bigint;
  residual: bigint;
  feeAmount: bigint;
  net: bigint;
  minAcceptable: bigint;
  saleEquivalent: boolean;
};

export type BorrowQuoteInput = {
  remaining: bigint;
  aprBps: number;
  ttmSeconds: bigint;
  feeBps: number;
  target: bigint;
  depth: bigint;
  unit?: bigint;
  minLiquidity?: bigint;
};

export type QuoteSnapshot = {
  gross: bigint;
  feeAmount: bigint;
  net: bigint;
  depth: bigint;
  fill: bigint;
  obligation: bigint;
  residual: bigint;
  aprBps: number;
  target: bigint;
  minAcceptable: bigint;
};

/** Stream-derived MAX: UNIT-floored present value. Not a wallet balance. */
export function streamDerivedCap(
  remaining: bigint,
  aprBps: number,
  ttmSeconds: bigint,
  unit: bigint = UNIT,
): bigint {
  return floorToUnit(grossPrice(remaining, aprBps, ttmSeconds), unit);
}

/**
 * Client quote for the spacious borrow form.
 * Sale-equivalence is `obligation === remaining` only — the UNIT floor means a
 * price-clamped max almost always leaves dust residual (U9 copy rule).
 */
export function quoteBorrow(input: BorrowQuoteInput): BorrowQuote {
  const unit = input.unit ?? UNIT;
  const minLiquidity = input.minLiquidity ?? MIN_LIQUIDITY_AMOUNT;
  const gross = grossPrice(input.remaining, input.aprBps, input.ttmSeconds);
  const cap = floorToUnit(gross, unit);
  const depth = input.depth < 0n ? 0n : input.depth;
  const emptyTick = depth < minLiquidity;
  const target = floorToUnit(input.target < 0n ? 0n : input.target, unit);
  let fill = target;
  if (fill > cap) fill = cap;
  if (fill > depth) fill = floorToUnit(depth, unit);
  const partial = !emptyTick && target > 0n && fill < target;
  const belowFillFloor = fill > 0n && fill < minLiquidity;
  const obligation =
    fill <= 0n
      ? 0n
      : obligationForFill(fill, gross, input.remaining, input.aprBps, input.ttmSeconds);
  const residual = input.remaining > obligation ? input.remaining - obligation : 0n;
  const feeAmount = fee(fill, input.feeBps);
  const net = fill - feeAmount;
  return {
    target,
    cap,
    depth,
    fill,
    partial,
    emptyTick,
    belowFillFloor,
    gross,
    obligation,
    residual,
    feeAmount,
    net,
    minAcceptable: net > 0n ? applySlippageDown(net) : 0n,
    saleEquivalent: fill > 0n && obligation === input.remaining,
  };
}

export function snapshotQuote(quote: BorrowQuote, aprBps: number): QuoteSnapshot {
  return {
    gross: quote.gross,
    feeAmount: quote.feeAmount,
    net: quote.net,
    depth: quote.depth,
    fill: quote.fill,
    obligation: quote.obligation,
    residual: quote.residual,
    aprBps,
    target: quote.target,
    minAcceptable: quote.minAcceptable,
  };
}

export function quoteDrift(frozen: QuoteSnapshot, live: BorrowQuote): boolean {
  return (
    frozen.gross !== live.gross ||
    frozen.feeAmount !== live.feeAmount ||
    frozen.net !== live.net ||
    frozen.depth !== live.depth ||
    frozen.fill !== live.fill
  );
}

export function tickDepthWei(model: LadderModel | null, aprBps: number | null, minLiquidity?: bigint): bigint {
  if (!model || aprBps === null) return 0n;
  const rung = model.rungs.find((row) => row.aprBps === aprBps) ?? null;
  return poolAvailableWei(rung, minLiquidity);
}

export function liveRungs(model: LadderModel): readonly ShapedRung[] {
  return model.pickable;
}

export function liveTickCopy(model: LadderModel): string {
  const live = liveRungs(model);
  if (live.length === 0) return "NO LIVE TICKS HAVE RESTING LIQUIDITY";
  return `LIVE TICKS: ${live.map((rung) => formatAprBps(rung.aprBps)).join(", ")}`;
}

export function ttmSeconds(end: bigint, now: bigint): bigint {
  return now >= end ? 0n : end - now;
}

export function loanCover(schedule: StreamSchedule, obligation: bigint, now: bigint): CoverDate {
  return coverDate(schedule, obligation, now);
}

export function fullRepayCoverPreview(
  schedule: StreamSchedule,
  obligation: bigint,
  now: bigint,
): { current: CoverDate; next: CoverDate } {
  return repayPreview(schedule, obligation, obligation, now);
}

/** Exact wei → decimal input so MAX round-trips through parseDecimalInput. */
export function weiToAmountInput(value: bigint, decimals = 18): string {
  if (value <= 0n) return "";
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = value % scale;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function poolFractions(draw: bigint, depth: bigint): { self: number; overrun: boolean } {
  if (depth <= 0n) return { self: 0, overrun: draw > 0n };
  if (draw <= 0n) return { self: 0, overrun: false };
  const ratioBps = (draw * 10_000n) / depth;
  const capped = ratioBps > 1_000_000n ? 1_000_000n : ratioBps;
  return { self: Number(capped) / 10_000, overrun: draw > depth };
}
