import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  PENDLE_APP_HOST,
  pendleMarketUrlTemplate,
  resolvePendleLink,
  verifyPendleMarketUrl,
} from "@/components/first-run/pendleLink";

const MARKET = getAddress("0xcFD848b9f6fEf552204014ac67901223AD6bf679");
const OTHER = getAddress("0x34280882267ffa6383B363E278B027Be083bBe3b");

describe("Pendle deep link verification", () => {
  it("links when the URL names the on-chain market on the Pendle host", () => {
    const href = pendleMarketUrlTemplate(MARKET);
    expect(new URL(href).hostname).toBe(PENDLE_APP_HOST);
    expect(verifyPendleMarketUrl(href, MARKET)).toEqual({ kind: "linked", href });
  });

  it("degrades when the URL names a different market", () => {
    expect(verifyPendleMarketUrl(pendleMarketUrlTemplate(OTHER), MARKET)).toEqual({
      kind: "degraded",
      reason: "unusable",
    });
  });

  it("degrades a missing market instead of inventing a host", () => {
    expect(resolvePendleLink(null)).toEqual({ kind: "degraded", reason: "missing" });
  });

  it("degrades a rotten configured URL rather than substituting another market", () => {
    expect(resolvePendleLink(MARKET, "https://example.com/not-pendle")).toEqual({
      kind: "degraded",
      reason: "unusable",
    });
    expect(resolvePendleLink(MARKET, "http://app.pendle.finance/trade/markets/" + MARKET)).toEqual({
      kind: "degraded",
      reason: "unusable",
    });
  });
});
