import { describe, expect, it } from "vitest";
import {
  classifyUsd,
  STETH_USD_HEARTBEAT_SECONDS,
  tokenUsd8,
  USD_ABSOLUTE_CUTOFF_SECONDS,
  USD_HEARTBEAT_GRACE_SECONDS,
  wstethUsd8,
} from "@/lib/usd";
import { WAD } from "@/lib/units";

const NOW = 1_700_000_000n;
const STETH_USD_8 = 3_500_000_000n; // $35.00
const STETH_PER_TOKEN = WAD + WAD / 10n; // 1.1 stETH per wstETH

describe("USD product", () => {
  it("computes wstETH/USD from fixture feed answers", () => {
    expect(wstethUsd8(STETH_USD_8, STETH_PER_TOKEN)).toBe(3_850_000_000n);
    expect(tokenUsd8(WAD, wstethUsd8(STETH_USD_8, STETH_PER_TOKEN))).toBe(3_850_000_000n);
  });

  it("classifies unavailable on non-positive, heartbeat+grace, and 24h cutoff", () => {
    expect(classifyUsd({ answer: 0n, updatedAt: NOW }, STETH_PER_TOKEN, NOW)).toEqual({
      status: "unavailable",
      reason: "non-positive",
    });
    expect(classifyUsd({ answer: -1n, updatedAt: NOW }, STETH_PER_TOKEN, NOW)).toEqual({
      status: "unavailable",
      reason: "non-positive",
    });
    expect(
      classifyUsd({ answer: STETH_USD_8, updatedAt: NOW }, 0n, NOW),
    ).toEqual({ status: "unavailable", reason: "non-positive" });

    const heartbeatStale =
      NOW - (STETH_USD_HEARTBEAT_SECONDS + USD_HEARTBEAT_GRACE_SECONDS + 1n);
    expect(
      classifyUsd({ answer: STETH_USD_8, updatedAt: heartbeatStale }, STETH_PER_TOKEN, NOW),
    ).toEqual({ status: "unavailable", reason: "heartbeat" });

    const cutoff = NOW - (USD_ABSOLUTE_CUTOFF_SECONDS + 1n);
    expect(
      classifyUsd({ answer: STETH_USD_8, updatedAt: cutoff }, STETH_PER_TOKEN, NOW),
    ).toEqual({ status: "unavailable", reason: "cutoff" });
  });

  it("returns an available quote inside the heartbeat window", () => {
    const quote = classifyUsd(
      { answer: STETH_USD_8, updatedAt: NOW - 60n },
      STETH_PER_TOKEN,
      NOW,
    );
    expect(quote.status).toBe("available");
    if (quote.status === "available") expect(quote.usd8).toBe(3_850_000_000n);
  });
});
