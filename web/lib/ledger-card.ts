import { streamedAmountOf, type StreamSchedule } from "./payoff";
import { wei } from "./units";

/** Lockup.Status (Sablier v2 / OVRFLOStream). */
export const LOCKUP_STATUS = {
  PENDING: 0,
  STREAMING: 1,
  SETTLED: 2,
  CANCELED: 3,
  DEPLETED: 4,
} as const;

export type LockupStatusCode = (typeof LOCKUP_STATUS)[keyof typeof LOCKUP_STATUS];

export type LedgerCardStatus =
  | "pending"
  | "streaming"
  | "settled"
  | "canceled"
  | "depleted"
  | "unknown";

/** SC15: pin the U3 ledger-card descriptor so a hot-swap remounts the HTML card. */
export const OVRFLO_STREAM_DESCRIPTOR_PIN = "u3-ledger";

export const LEDGER_BAR_SEGMENTS = 24;

export type LedgerCardSnapshot = {
  status: LedgerCardStatus;
  statusLabel: string;
  streamed: bigint;
  remainingUnstreamed: bigint;
  withdrawn: bigint;
  deposited: bigint;
  percent: number;
  percentLabel: string;
  filledSegments: number;
  ratePerDay: bigint;
  daysLeft: number;
  bandLive: boolean;
  cacheKey: string;
};

export function lockupStatusLabel(code: number): { status: LedgerCardStatus; label: string } {
  switch (code) {
    case LOCKUP_STATUS.PENDING:
      return { status: "pending", label: "Pending" };
    case LOCKUP_STATUS.STREAMING:
      return { status: "streaming", label: "Streaming" };
    case LOCKUP_STATUS.SETTLED:
      return { status: "settled", label: "Settled" };
    case LOCKUP_STATUS.CANCELED:
      return { status: "canceled", label: "Canceled" };
    case LOCKUP_STATUS.DEPLETED:
      return { status: "depleted", label: "Depleted" };
    default:
      return { status: "unknown", label: "Unknown" };
  }
}

/**
 * Ceiling segment count from streamed / deposited (matches U3 golden 37% → 9/24).
 * Settled and depleted fill all 24 when streamed reaches the cap.
 */
export function ledgerFilledSegments(streamed: bigint, deposited: bigint): number {
  if (deposited <= 0n || streamed <= 0n) return 0;
  if (streamed >= deposited) return LEDGER_BAR_SEGMENTS;
  const ceil = (streamed * BigInt(LEDGER_BAR_SEGMENTS) + deposited - 1n) / deposited;
  const n = Number(ceil);
  if (n < 1) return 1;
  if (n > LEDGER_BAR_SEGMENTS) return LEDGER_BAR_SEGMENTS;
  return n;
}

/** Truncated percent with one decimal when needed (R14 snapshot, not local clock). */
export function ledgerPercent(streamed: bigint, deposited: bigint): { value: number; label: string } {
  if (deposited <= 0n || streamed <= 0n) return { value: 0, label: "0%" };
  if (streamed >= deposited) return { value: 100, label: "100%" };
  const tenths = Number((streamed * 1000n) / deposited);
  const value = tenths / 10;
  if (tenths % 10 === 0) return { value: tenths / 10, label: `${tenths / 10}%` };
  return { value, label: `${value.toFixed(1)}%` };
}

export function ledgerRatePerDay(schedule: StreamSchedule): bigint {
  const cap = schedule.deposited - schedule.refunded;
  if (cap <= 0n) return 0n;
  const duration = schedule.end - schedule.start;
  if (duration <= 0n) return 0n;
  return (cap * 86_400n) / duration;
}

export function ledgerDaysLeft(end: bigint, asOf: bigint): number {
  if (asOf >= end) return 0;
  const rem = end - asOf;
  return Number((rem + 86_399n) / 86_400n);
}

/**
 * Card figures from hydrated schedule at `asOf` (last successful read), never Date.now().
 */
export function buildLedgerCardSnapshot(input: {
  streamId: bigint;
  statusCode: number;
  schedule: StreamSchedule;
  asOf: bigint;
  descriptorPin?: string;
}): LedgerCardSnapshot {
  const { status, label } = lockupStatusLabel(input.statusCode);
  const cap = input.schedule.deposited - input.schedule.refunded;
  let streamed = streamedAmountOf(input.schedule, input.asOf);
  if (status === "settled" || status === "depleted") {
    streamed = wei(cap > 0n ? cap : 0n);
  }
  if (status === "canceled") {
    // Canceled freezes at refunded-adjusted streamed already in streamedAmountOf when asOf is past cancel;
    // without cancel time, hold formula at asOf (hydration).
  }
  const deposited = input.schedule.deposited;
  const remainingUnstreamed = cap > streamed ? cap - streamed : 0n;
  const pct = ledgerPercent(streamed, deposited > 0n ? deposited : cap > 0n ? cap : 1n);
  const filled =
    status === "settled" || status === "depleted"
      ? LEDGER_BAR_SEGMENTS
      : ledgerFilledSegments(streamed, deposited > 0n ? deposited : 1n);
  const pin = input.descriptorPin ?? OVRFLO_STREAM_DESCRIPTOR_PIN;
  const cacheKey = [
    pin,
    input.streamId.toString(),
    String(input.statusCode),
    input.schedule.withdrawn.toString(),
    input.schedule.refunded.toString(),
    streamed.toString(),
    input.asOf.toString(),
  ].join(":");

  return {
    status,
    statusLabel: label,
    streamed,
    remainingUnstreamed,
    withdrawn: input.schedule.withdrawn,
    deposited,
    percent: pct.value,
    percentLabel: pct.label,
    filledSegments: filled,
    ratePerDay: status === "streaming" || status === "pending" ? ledgerRatePerDay(input.schedule) : 0n,
    daysLeft: ledgerDaysLeft(input.schedule.end, input.asOf),
    bandLive: status === "streaming" && filled > 0 && filled < LEDGER_BAR_SEGMENTS,
    cacheKey,
  };
}
