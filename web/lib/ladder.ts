import {
  MIN_LIQUIDITY_AMOUNT,
  UNIT,
  floorToUnit,
  unitsToWei,
} from "./lending-math";
import { tickBps, type TickBps } from "./units";

export type TickDepthInput = {
  aprBps: number;
  availableUnits: bigint;
};

export type RungKind = "pickable" | "below-minimum" | "empty";

export type ShapedRung = {
  aprBps: TickBps;
  availableUnits: bigint;
  availableWei: bigint;
  kind: RungKind;
};

export type StepperBound = "enabled" | "disabled-min" | "disabled-max";

export type TickWindow = {
  rungs: ShapedRung[];
  selected: TickBps | null;
  prev: StepperBound;
  next: StepperBound;
  neighborBelow: ShapedRung | null;
  neighborAbove: ShapedRung | null;
  emptyLadder: boolean;
};

export type LadderModel = {
  rungs: ShapedRung[];
  pickable: ShapedRung[];
  emptyLadder: boolean;
  bestDepth: ShapedRung | null;
};

function rungKind(availableWei: bigint, minLiquidity: bigint): RungKind {
  if (availableWei <= 0n) return "empty";
  if (availableWei < minLiquidity) return "below-minimum";
  return "pickable";
}

export function shapeLadder(
  depths: readonly TickDepthInput[],
  options: { unit?: bigint; minLiquidity?: bigint } = {},
): LadderModel {
  const unit = options.unit ?? UNIT;
  const minLiquidity = options.minLiquidity ?? MIN_LIQUIDITY_AMOUNT;
  const rungs: ShapedRung[] = depths.map((depth) => {
    const availableWei = unitsToWei(depth.availableUnits, unit);
    return {
      aprBps: tickBps(depth.aprBps),
      availableUnits: depth.availableUnits,
      availableWei,
      kind: rungKind(availableWei, minLiquidity),
    };
  });
  const pickable = rungs.filter((rung) => rung.kind === "pickable");
  let bestDepth: ShapedRung | null = null;
  for (const rung of pickable) {
    if (!bestDepth || rung.availableWei > bestDepth.availableWei) bestDepth = rung;
  }
  return {
    rungs,
    pickable,
    emptyLadder: rungs.length === 0,
    bestDepth,
  };
}

export function bestDepthTick(model: LadderModel): TickBps | null {
  return model.bestDepth?.aprBps ?? null;
}

function indexOfTick(rungs: readonly ShapedRung[], aprBps: number): number {
  return rungs.findIndex((rung) => rung.aprBps === aprBps);
}

/**
 * Three-tick window centered on `selected` when possible.
 * Paddles disable at the configured `aprMin` / `aprMax` ends — they never wrap.
 */
export function tickWindow(
  model: LadderModel,
  selectedAprBps: number | null,
  bounds: { aprMin: number; aprMax: number },
): TickWindow {
  if (model.emptyLadder || model.rungs.length === 0) {
    return {
      rungs: [],
      selected: null,
      prev: "disabled-min",
      next: "disabled-max",
      neighborBelow: null,
      neighborAbove: null,
      emptyLadder: true,
    };
  }

  const selected =
    selectedAprBps !== null && indexOfTick(model.rungs, selectedAprBps) >= 0
      ? tickBps(selectedAprBps)
      : (bestDepthTick(model) ?? model.rungs[0]?.aprBps ?? null);

  const selectedIndex = selected === null ? 0 : Math.max(0, indexOfTick(model.rungs, selected));
  const last = model.rungs.length - 1;
  let start = selectedIndex - 1;
  if (start < 0) start = 0;
  if (start + 2 > last) start = Math.max(0, last - 2);
  const end = Math.min(last, start + 2);
  const windowRungs = model.rungs.slice(start, end + 1);

  const atConfiguredMin = selected !== null && selected <= bounds.aprMin;
  const atConfiguredMax = selected !== null && selected >= bounds.aprMax;
  const atFirst = selectedIndex <= 0;
  const atLast = selectedIndex >= last;

  return {
    rungs: windowRungs,
    selected,
    prev: atConfiguredMin || atFirst ? "disabled-min" : "enabled",
    next: atConfiguredMax || atLast ? "disabled-max" : "enabled",
    neighborBelow: start > 0 ? (model.rungs[start - 1] ?? null) : null,
    neighborAbove: end < last ? (model.rungs[end + 1] ?? null) : null,
    emptyLadder: false,
  };
}

export function stepWindow(
  model: LadderModel,
  selectedAprBps: number,
  direction: -1 | 1,
  bounds: { aprMin: number; aprMax: number },
): TickWindow {
  const current = indexOfTick(model.rungs, selectedAprBps);
  const nextIndex = current < 0 ? 0 : current + direction;
  const next = model.rungs[nextIndex];
  const apr = next ? next.aprBps : selectedAprBps;
  return tickWindow(model, apr, bounds);
}

export function poolAvailableWei(rung: ShapedRung | null, minLiquidity: bigint = MIN_LIQUIDITY_AMOUNT): bigint {
  if (!rung || rung.kind !== "pickable") return 0n;
  return rung.availableWei < minLiquidity ? 0n : rung.availableWei;
}

export function alignSupplyAmount(amount: bigint, unit: bigint = UNIT): bigint {
  return floorToUnit(amount, unit);
}

export function tickInBounds(aprBps: number, bounds: { aprMin: number; aprMax: number; spacing: number }): boolean {
  if (bounds.spacing <= 0) return false;
  return aprBps >= bounds.aprMin && aprBps <= bounds.aprMax && aprBps % bounds.spacing === 0;
}
