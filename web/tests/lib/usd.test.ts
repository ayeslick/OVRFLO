import { describe, expect, it } from "vitest";
import {
  classifyUsd,
  STETH_USD_HEARTBEAT_SECONDS,
  tokenUsd8,
  USD_ABSOLUTE_CUTOFF_SECONDS,
  USD_HEARTBEAT_GRACE_SECONDS,
  wstethUsd8,
} from "@/lib/usd";
import { usd8, WAD } from "@/lib/units";

const NOW = 1_700_000_000n;
const STETH_USD_8 = 3_500_000_000n; // $35.00
const STETH_PER_TOKEN = WAD + WAD / 10n; // 1.1 stETH per wstETH
const FRESH_ROUND = {
  roundId: 9n,
  answer: STETH_USD_8,
  updatedAt: NOW - 60n,
  answeredInRound: 9n,
};

describe("USD product", () => {
  it("computes wstETH/USD from fixture feed answers", () => {
    expect(wstethUsd8(STETH_USD_8, STETH_PER_TOKEN)).toBe(3_850_000_000n);
    expect(tokenUsd8(WAD, usd8(wstethUsd8(STETH_USD_8, STETH_PER_TOKEN)))).toBe(3_850_000_000n);
  });

  it("classifies unavailable on incomplete, non-positive, heartbeat+grace, and 24h cutoff", () => {
    expect(
      classifyUsd({
        round: { ...FRESH_ROUND, answeredInRound: 8n },
        now: NOW,
        heartbeat: STETH_USD_HEARTBEAT_SECONDS,
        grace: USD_HEARTBEAT_GRACE_SECONDS,
        kind: "chainlink-usd-times-share-rate",
        feedDecimals: 8,
        shareRate: STETH_PER_TOKEN,
      }),
    ).toEqual({ status: "unavailable", reason: "incomplete" });

    expect(
      classifyUsd({
        round: { ...FRESH_ROUND, answer: 0n },
        now: NOW,
        heartbeat: STETH_USD_HEARTBEAT_SECONDS,
        grace: USD_HEARTBEAT_GRACE_SECONDS,
        kind: "chainlink-usd-times-share-rate",
        feedDecimals: 8,
        shareRate: STETH_PER_TOKEN,
      }),
    ).toEqual({ status: "unavailable", reason: "incomplete" });

    expect(
      classifyUsd({
        round: FRESH_ROUND,
        now: NOW,
        heartbeat: STETH_USD_HEARTBEAT_SECONDS,
        grace: USD_HEARTBEAT_GRACE_SECONDS,
        kind: "chainlink-usd-times-share-rate",
        feedDecimals: 8,
        shareRate: 0n,
      }),
    ).toEqual({ status: "unavailable", reason: "non-positive" });

    const heartbeatStale = NOW - (STETH_USD_HEARTBEAT_SECONDS + USD_HEARTBEAT_GRACE_SECONDS + 1n);
    expect(
      classifyUsd({
        round: { ...FRESH_ROUND, updatedAt: heartbeatStale },
        now: NOW,
        heartbeat: STETH_USD_HEARTBEAT_SECONDS,
        grace: USD_HEARTBEAT_GRACE_SECONDS,
        kind: "chainlink-usd-times-share-rate",
        feedDecimals: 8,
        shareRate: STETH_PER_TOKEN,
      }),
    ).toEqual({ status: "unavailable", reason: "heartbeat" });

    const cutoff = NOW - (USD_ABSOLUTE_CUTOFF_SECONDS + 1n);
    expect(
      classifyUsd({
        round: { ...FRESH_ROUND, updatedAt: cutoff },
        now: NOW,
        heartbeat: STETH_USD_HEARTBEAT_SECONDS,
        grace: USD_HEARTBEAT_GRACE_SECONDS,
        kind: "chainlink-usd-times-share-rate",
        feedDecimals: 8,
        shareRate: STETH_PER_TOKEN,
      }),
    ).toEqual({ status: "unavailable", reason: "cutoff" });
  });

  it("returns an available quote inside the heartbeat window", () => {
    const quote = classifyUsd({
      round: FRESH_ROUND,
      now: NOW,
      heartbeat: STETH_USD_HEARTBEAT_SECONDS,
      grace: USD_HEARTBEAT_GRACE_SECONDS,
      kind: "chainlink-usd-times-share-rate",
      feedDecimals: 8,
      shareRate: STETH_PER_TOKEN,
    });
    expect(quote.status).toBe("available");
    if (quote.status === "available") expect(quote.usd8).toBe(3_850_000_000n);
  });

  it("uses zero grace for execution-style classification", () => {
    const justPastHeartbeat = NOW - (STETH_USD_HEARTBEAT_SECONDS + 1n);
    expect(
      classifyUsd({
        round: { ...FRESH_ROUND, updatedAt: justPastHeartbeat },
        now: NOW,
        heartbeat: STETH_USD_HEARTBEAT_SECONDS,
        grace: 0n,
        kind: "chainlink-usd-times-share-rate",
        feedDecimals: 8,
        shareRate: STETH_PER_TOKEN,
      }),
    ).toEqual({ status: "unavailable", reason: "heartbeat" });
  });
});
