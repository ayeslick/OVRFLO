import { streamBuckets } from "./lending-math";
import { min, sub, wei, type Wei } from "./units";

export type StreamSchedule = {
  start: bigint;
  end: bigint;
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
};

export type CoverDate =
  | { status: "projected"; at: bigint }
  | { status: "covered"; at: bigint }
  | { status: "uncovered" };

export type LastStreamRead = {
  at: bigint;
  streamed: bigint;
};

/** Blocks older than this (localNow − block.timestamp) are treated as frozen; hold the last offset. */
export const SKEW_MAX_SAMPLE_AGE_SECONDS = 180n;

/**
 * Sablier Lockup Linear `streamedAmountOf` for cliff-zero, non-cancelable streams.
 * Truncates toward zero. Never exceeds `deposited − refunded`.
 */
export function streamedAmountOf(schedule: StreamSchedule, now: bigint): Wei {
  const cap = schedule.deposited - schedule.refunded;
  if (cap <= 0n) return wei(0n);
  if (now <= schedule.start) return wei(0n);
  if (now >= schedule.end) return wei(cap < 0n ? 0n : cap);
  const duration = schedule.end - schedule.start;
  if (duration <= 0n) return wei(cap);
  const elapsed = now - schedule.start;
  const streamed = (schedule.deposited * elapsed) / duration;
  const capped = streamed > cap ? cap : streamed;
  return wei(capped < 0n ? 0n : capped);
}

export function interpolateStreamed(
  schedule: StreamSchedule,
  now: bigint,
  lastRead?: LastStreamRead,
): Wei {
  const formula = streamedAmountOf(schedule, now);
  if (lastRead && now < lastRead.at) {
    const held = lastRead.streamed < 0n ? wei(0n) : wei(lastRead.streamed);
    return min(held, streamedAmountOf(schedule, schedule.end));
  }
  return formula;
}

export function coverDate(schedule: StreamSchedule, outstanding: bigint, now: bigint): CoverDate {
  if (outstanding <= 0n) return { status: "covered", at: now };
  const remaining = schedule.deposited - schedule.withdrawn - schedule.refunded;
  if (remaining <= 0n || outstanding > remaining) return { status: "uncovered" };

  const need = outstanding + schedule.withdrawn;
  if (need <= 0n) return { status: "covered", at: now };
  const duration = schedule.end - schedule.start;
  if (duration <= 0n) {
    return remaining >= outstanding ? { status: "covered", at: now } : { status: "uncovered" };
  }

  const elapsed = (need * duration + schedule.deposited - 1n) / schedule.deposited;
  const at = schedule.start + elapsed;
  if (at <= now) {
    const streamed = streamedAmountOf(schedule, now);
    const withdrawn = wei(schedule.withdrawn < 0n ? 0n : schedule.withdrawn);
    const claimable = streamed >= withdrawn ? sub(streamed, withdrawn) : wei(0n);
    return claimable >= outstanding ? { status: "covered", at: now } : { status: "projected", at };
  }
  if (at >= schedule.end) {
    return remaining >= outstanding ? { status: "projected", at: schedule.end } : { status: "uncovered" };
  }
  return { status: "projected", at };
}

export function repayPreview(
  schedule: StreamSchedule,
  outstanding: bigint,
  repayAmount: bigint,
  now: bigint,
): { current: CoverDate; next: CoverDate } {
  const repay = repayAmount < 0n ? 0n : repayAmount;
  const nextOutstanding = repay >= outstanding ? 0n : outstanding - repay;
  return {
    current: coverDate(schedule, outstanding, now),
    next: coverDate(schedule, nextOutstanding, now),
  };
}

export function interpolateOutstanding(
  schedule: StreamSchedule,
  lastOutstanding: bigint,
  lastReadAt: bigint,
  now: bigint,
): Wei {
  if (lastOutstanding <= 0n) return wei(0n);
  if (now <= lastReadAt) return wei(lastOutstanding);
  const thenStreamed = streamedAmountOf(schedule, lastReadAt);
  const nowStreamed = interpolateStreamed(schedule, now, { at: lastReadAt, streamed: thenStreamed });
  const additional = nowStreamed > thenStreamed ? sub(nowStreamed, thenStreamed) : wei(0n);
  const last = wei(lastOutstanding);
  return last > additional ? sub(last, additional) : wei(0n);
}

/**
 * Skew = localNow − block.timestamp.
 * Adjusted interpolation time is `localNow − skew` (KTD6).
 * Samples only blocks younger than `SKEW_MAX_SAMPLE_AGE_SECONDS`; otherwise holds `previous`.
 */
export function estimateSkew(
  localNow: bigint,
  blockTimestamp: bigint,
  previous: bigint | null = null,
  maxAge: bigint = SKEW_MAX_SAMPLE_AGE_SECONDS,
): bigint {
  const delta = localNow - blockTimestamp;
  const abs = delta < 0n ? -delta : delta;
  if (abs > maxAge) return previous ?? 0n;
  return delta;
}

export function adjustedNow(localNow: bigint, skew: bigint): bigint {
  const next = localNow - skew;
  return next < 0n ? 0n : next;
}

export function bucketsAt(schedule: StreamSchedule, now: bigint, lastRead?: LastStreamRead) {
  const streamed = interpolateStreamed(schedule, now, lastRead);
  return streamBuckets({
    deposited: schedule.deposited,
    withdrawn: schedule.withdrawn,
    refunded: schedule.refunded,
    streamed,
  });
}
