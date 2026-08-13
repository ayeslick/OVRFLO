import type { TraceStep, TraceStepState } from "@/components/kit/SettlementTrace";
import { tickInBounds } from "@/lib/ladder";
import { MIN_LIQUIDITY_AMOUNT, UNIT } from "@/lib/lending-math";
import { formatTokenAmount } from "@/lib/format";
import { classifyBorrowError, type BorrowErrorKind } from "@/lib/borrow";
import { ABI_STALE_ERRORS } from "@/lib/errors";

export type SupplyCheckpoint =
  | "review"
  | "acknowledge"
  | "approve"
  | "sign"
  | "pending"
  | "confirmed";

export type SupplySnapshot = {
  amount: bigint;
  aprBps: number;
  ahead: bigint;
  aprMinBps: number;
  aprMaxBps: number;
  spacing: number;
};

export type AmountErrorKind = "malformed" | "below-minimum" | "unaligned" | "insufficient";

/** Exact wei → decimal input so MAX round-trips through parseDecimalInput. */
export function weiToAmountInput(value: bigint, decimals = 18): string {
  if (value <= 0n) return "";
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = value % scale;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function amountErrorCopy(
  kind: AmountErrorKind,
  minLiquidity = MIN_LIQUIDITY_AMOUNT,
  unitSymbol = "underlying",
): string {
  if (kind === "malformed") return "Enter a valid amount.";
  if (kind === "below-minimum") return `Minimum supply is ${formatTokenAmount(minLiquidity, unitSymbol)}.`;
  if (kind === "unaligned") return "Amount must be an exact UNIT multiple.";
  return "INSUFFICIENT BALANCE";
}

export function amountFieldError(
  raw: string,
  parsed: { ok: true; value: bigint } | { ok: false; reason?: string },
  balance: bigint | null,
  minLiquidity = MIN_LIQUIDITY_AMOUNT,
  unit = UNIT,
  unitSymbol = "underlying",
): string | undefined {
  if (raw.trim() === "") return undefined;
  if (!parsed.ok) return amountErrorCopy("malformed", minLiquidity, unitSymbol);
  if (parsed.value % unit !== 0n) return amountErrorCopy("unaligned", minLiquidity, unitSymbol);
  if (parsed.value < minLiquidity) return amountErrorCopy("below-minimum", minLiquidity, unitSymbol);
  if (balance !== null && parsed.value > balance) {
    return amountErrorCopy("insufficient", minLiquidity, unitSymbol);
  }
  return undefined;
}

export function queueFractions(ahead: bigint, amount: bigint): { ahead: number; self: number } {
  const total = ahead + amount;
  if (total <= 0n) return { ahead: 0, self: 0 };
  const aheadBps = (ahead * 10_000n) / total;
  const aheadN = Number(aheadBps > 10_000n ? 10_000n : aheadBps) / 10_000;
  return { ahead: aheadN, self: 1 - aheadN };
}

export function snapshotSupply(input: SupplySnapshot): SupplySnapshot {
  return { ...input };
}

export function supplyDrift(frozen: SupplySnapshot, live: SupplySnapshot): boolean {
  return (
    frozen.amount !== live.amount ||
    frozen.aprBps !== live.aprBps ||
    frozen.ahead !== live.ahead ||
    frozen.aprMinBps !== live.aprMinBps ||
    frozen.aprMaxBps !== live.aprMaxBps ||
    frozen.spacing !== live.spacing
  );
}

export function tickNoLongerValid(
  aprBps: number,
  bounds: { aprMinBps: number; aprMaxBps: number; spacing: number },
): boolean {
  return !tickInBounds(aprBps, {
    aprMin: bounds.aprMinBps,
    aprMax: bounds.aprMaxBps,
    spacing: bounds.spacing,
  });
}

export function classifySupplyError(error: unknown): BorrowErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (ABI_STALE_ERRORS.some((name) => message.includes(name))) return "stale";
  if (message.includes("InvalidTick") || message.includes("SpacingUnset")) return "stale";
  return classifyBorrowError(error);
}

function mark(id: string, activeId: string, done: ReadonlySet<string>): TraceStepState {
  if (activeId !== "" && id === activeId) return "active";
  if (done.has(id)) return "done";
  return "pending";
}

export function supplyTrace({
  underlyingSymbol,
  needsApprove,
  ackRequired,
  checkpoint,
}: {
  underlyingSymbol: string;
  needsApprove: boolean;
  ackRequired: boolean;
  checkpoint: SupplyCheckpoint;
}): TraceStep[] {
  const active =
    checkpoint === "confirmed"
      ? ""
      : checkpoint === "pending"
        ? "settled"
        : checkpoint === "sign"
          ? "supply"
          : checkpoint === "approve"
            ? "approve"
            : checkpoint === "acknowledge"
              ? "ack"
              : "apr";
  const order = [
    "amount",
    "apr",
    ...(ackRequired ? (["ack"] as const) : []),
    ...(needsApprove ? (["approve"] as const) : []),
    "supply",
    "settled",
  ];
  const resolved = checkpoint === "confirmed" ? "" : order.includes(active) ? active : "supply";
  const activeIndex = checkpoint === "confirmed" ? order.length : order.indexOf(resolved);
  const done = new Set(order.filter((_, index) => index < activeIndex || checkpoint === "confirmed"));
  return [
    { id: "amount", label: "AMOUNT", state: mark("amount", resolved, done) },
    { id: "apr", label: "APR", state: mark("apr", resolved, done) },
    ...(ackRequired
      ? [{ id: "ack", label: "ACKNOWLEDGE RISK", state: mark("ack", resolved, done) } satisfies TraceStep]
      : []),
    ...(needsApprove
      ? [
          {
            id: "approve",
            label: `APPROVE ${underlyingSymbol}`,
            state: mark("approve", resolved, done),
          } satisfies TraceStep,
        ]
      : [{ id: "approve", label: `APPROVE ${underlyingSymbol}`, state: "skipped" } satisfies TraceStep]),
    { id: "supply", label: "SUPPLY", state: mark("supply", resolved, done) },
    { id: "settled", label: "SETTLED", state: mark("settled", resolved, done) },
  ];
}

export function shownTraceLabels(steps: readonly TraceStep[]): string[] {
  return steps.filter((step) => step.state !== "skipped").map((step) => step.label);
}
