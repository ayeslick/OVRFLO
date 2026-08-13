import { describe, expect, it } from "vitest";
import {
  adjustedNow,
  bucketsAt,
  coverDate,
  estimateSkew,
  interpolateOutstanding,
  interpolateStreamed,
  repayPreview,
  streamedAmountOf,
  type StreamSchedule,
} from "@/lib/payoff";

const DAY = 86_400n;
const ETHER = 10n ** 18n;

const seeded180: StreamSchedule = {
  start: 1_700_000_000n,
  end: 1_700_000_000n + 180n * DAY,
  deposited: 100n * ETHER,
  withdrawn: 0n,
  refunded: 0n,
};

describe("seeded 180-day payoff", () => {
  it("matches the hand-computed cover date at half remaining", () => {
    const outstanding = 50n * ETHER;
    const now = seeded180.start;
    const cover = coverDate(seeded180, outstanding, now);
    expect(cover).toEqual({ status: "projected", at: seeded180.start + 90n * DAY });
  });

  it("shifts the cover date for partial and full repayment (AE6)", () => {
    const outstanding = 50n * ETHER;
    const now = seeded180.start;
    const partial = repayPreview(seeded180, outstanding, 25n * ETHER, now);
    expect(partial.current).toEqual({ status: "projected", at: seeded180.start + 90n * DAY });
    expect(partial.next).toEqual({ status: "projected", at: seeded180.start + 45n * DAY });

    const full = repayPreview(seeded180, outstanding, outstanding, now);
    expect(full.next).toEqual({ status: "covered", at: now });
  });

  it("treats outstanding = 0 as already covered", () => {
    expect(coverDate(seeded180, 0n, seeded180.start)).toEqual({
      status: "covered",
      at: seeded180.start,
    });
  });
});

describe("Sablier interpolation + clock skew", () => {
  it("never exceeds streamedAmountOf / stream end when the local clock is ahead", () => {
    const pastEnd = seeded180.end + 90n;
    const streamed = interpolateStreamed(seeded180, pastEnd);
    expect(streamed).toBe(seeded180.deposited);
    expect(streamed).toBe(streamedAmountOf(seeded180, seeded180.end));
    expect(streamed <= seeded180.deposited).toBe(true);
  });

  it("clamps interpolation to the chain formula when the local clock leads the block", () => {
    const blockTs = seeded180.start + 10n * DAY;
    const localAhead = blockTs + 90n;
    const skew = estimateSkew(localAhead, blockTs);
    const now = adjustedNow(localAhead, skew);
    const interpolated = interpolateStreamed(seeded180, now);
    expect(skew).toBe(90n);
    expect(now).toBe(blockTs);
    expect(interpolated).toBe(streamedAmountOf(seeded180, blockTs));
    expect(interpolated < streamedAmountOf(seeded180, localAhead)).toBe(true);
    expect(interpolated <= streamedAmountOf(seeded180, seeded180.end)).toBe(true);
  });

  it("renders the last read value when the local clock is behind", () => {
    const lastAt = seeded180.start + 10n * DAY;
    const lastStreamed = streamedAmountOf(seeded180, lastAt);
    const behind = lastAt - 30n;
    expect(interpolateStreamed(seeded180, behind, { at: lastAt, streamed: lastStreamed })).toBe(
      lastStreamed,
    );
  });

  it("recovers a mocked ±90s clock offset", () => {
    const block = 1_700_000_090n;
    expect(estimateSkew(block + 90n, block)).toBe(90n);
    expect(estimateSkew(block - 90n, block)).toBe(-90n);
    expect(adjustedNow(block + 90n, 90n)).toBe(block);
    expect(adjustedNow(block - 90n, -90n)).toBe(block);
  });

  it("holds the previous offset when the block looks frozen", () => {
    const localNow = 1_700_100_000n;
    const frozenBlock = 1_700_000_000n;
    expect(estimateSkew(localNow, frozenBlock, 12n)).toBe(12n);
    expect(estimateSkew(localNow, frozenBlock, null)).toBe(0n);
  });

  it("counts outstanding down from last-read by newly streamed value", () => {
    const lastAt = seeded180.start;
    const later = seeded180.start + 90n * DAY;
    expect(interpolateOutstanding(seeded180, 50n * ETHER, lastAt, later)).toBe(0n);
    expect(interpolateOutstanding(seeded180, 50n * ETHER, lastAt, lastAt)).toBe(50n * ETHER);
  });

  it("exposes Sablier three-bucket vocab at a point in the schedule", () => {
    const mid = seeded180.start + 90n * DAY;
    const buckets = bucketsAt(seeded180, mid);
    expect(buckets.remaining).toBe(100n * ETHER);
    expect(buckets.claimable).toBe(50n * ETHER);
    expect(buckets.locked).toBe(50n * ETHER);
  });
});
