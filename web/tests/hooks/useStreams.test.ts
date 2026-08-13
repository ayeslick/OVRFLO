import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { borrowRouteEligibleStream, renderEligibleStream } from "@/hooks/useStreams";
import { MIN_STREAM_AMOUNT } from "@/lib/lending-math";

const VAULT = "0x00000000000000000000000000000000000000a1" as Address;
const TOKEN = "0x00000000000000000000000000000000000000b2" as Address;
const OTHER = "0x00000000000000000000000000000000000000c3" as Address;
const MARKET = "0x00000000000000000000000000000000000000d4" as Address;

const vaults = [{ vault: VAULT, ovrfloToken: TOKEN }];
const schedule = {
  start: 1_000n,
  end: 2_000n,
  deposited: MIN_STREAM_AMOUNT * 2n,
  withdrawn: 0n,
  refunded: 0n,
  cliffTime: 1_000n,
  isCancelable: false,
};

describe("stream eligibility predicates", () => {
  it("render predicate keeps vault+asset streams including matured markets", () => {
    expect(
      renderEligibleStream({ sender: VAULT, asset: TOKEN, vaults }).eligible,
    ).toBe(true);
    expect(
      renderEligibleStream({ sender: OTHER, asset: TOKEN, vaults }).eligible,
    ).toBe(false);
    expect(
      renderEligibleStream({ sender: VAULT, asset: OTHER, vaults }).eligible,
    ).toBe(false);
  });

  it("borrow-route predicate drops SeriesMatured and dust remaining", () => {
    const markets = [{ vault: VAULT, market: MARKET, ovrfloToken: TOKEN, expiryCached: 2_000n }];
    expect(
      borrowRouteEligibleStream({
        sender: VAULT,
        asset: TOKEN,
        schedule,
        remaining: MIN_STREAM_AMOUNT * 2n,
        now: 1_500n,
        vaults,
        markets,
      }).eligible,
    ).toBe(true);
    expect(
      borrowRouteEligibleStream({
        sender: VAULT,
        asset: TOKEN,
        schedule,
        remaining: MIN_STREAM_AMOUNT * 2n,
        now: 2_000n,
        vaults,
        markets,
      }).eligible,
    ).toBe(false);
    expect(
      borrowRouteEligibleStream({
        sender: VAULT,
        asset: TOKEN,
        schedule,
        remaining: MIN_STREAM_AMOUNT - 1n,
        now: 1_500n,
        vaults,
        markets,
      }).eligible,
    ).toBe(false);
  });
});
