import { type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { MAX_PENDLE_PRICE_IMPACT_BPS, PENDLE_SLIPPAGE_BPS } from "@/lib/default/policy";
import {
  HOSTED_IMPACT_COPY,
  PENDLE_ROUTER_V4,
  evaluateHostedPolicy,
  hostedConvertUrl,
  priceImpactToBps,
  requestHostedConvert,
  resolveHostedSlippageBps,
  validateHostedResponse,
  type HostedConvertIntentInput,
} from "@/lib/hosted-convert";
import { encodeHostedMintPy, hostedConvertResponse } from "./hosted-convert.fixture";

const ACCOUNT = "0x00000000000000000000000000000000000000a1" as Address;
const INPUT = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as Address;
const OUTPUT = "0x00000000000000000000000000000000000000b2" as Address;
const MARKET = "0x00000000000000000000000000000000000000c3" as Address;
const OTHER_ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const AMOUNT = 10n ** 18n;
const NOW = 1_700_000_000n;

const intent: HostedConvertIntentInput = {
  chainId: 1,
  account: ACCOUNT,
  inputToken: INPUT,
  outputToken: OUTPUT,
  pendleMarket: MARKET,
  amountIn: AMOUNT,
  slippageBps: 50n,
  enableAggregator: false,
  now: NOW,
  disclosure: "default",
};

function hostedResponse(overrides: Partial<Parameters<typeof hostedConvertResponse>[0]> = {}) {
  return hostedConvertResponse({
    account: ACCOUNT,
    inputToken: INPUT,
    outputToken: OUTPUT,
    pendleMarket: MARKET,
    amount: AMOUNT,
    ...overrides,
  });
}

describe("Hosted Convert policy", () => {
  it("owns Default slippage at 50 bps and rejects 101 bps impact", () => {
    expect(PENDLE_SLIPPAGE_BPS).toBe(50n);
    expect(MAX_PENDLE_PRICE_IMPACT_BPS).toBe(100n);
    expect(resolveHostedSlippageBps("default", 200n)).toBe(50n);
    expect(evaluateHostedPolicy("default", 100n).status).toBe("pass");
    expect(evaluateHostedPolicy("default", 101n)).toEqual({
      status: "reject-impact",
      copy: HOSTED_IMPACT_COPY,
      actions: ["smaller-amount", "open-advanced"],
    });
    expect(evaluateHostedPolicy("advanced", 101n).status).toBe("pass");
    expect(resolveHostedSlippageBps("advanced", 200n)).toBe(200n);
    expect(resolveHostedSlippageBps("advanced", 9n)).toBe(50n);
  });

  it("parses price impact without JavaScript Number on token amounts", () => {
    expect(priceImpactToBps(0.0101)).toBe(101n);
    expect(priceImpactToBps("0.0100")).toBe(100n);
    expect(priceImpactToBps("0.01009")).toBe(101n);
  });
});

describe("Hosted Convert hostility", () => {
  it("accepts a Router V4 swap that matches the intended tokens and bounds", () => {
    const result = validateHostedResponse(hostedResponse(), intent);
    expect("tx" in result).toBe(true);
    if (!("tx" in result)) throw new Error("expected valid");
    expect(result.tx.to).toBe(PENDLE_ROUTER_V4);
    expect(result.method).toBe("swapExactTokenForPt");
    expect(result.impactBps).toBe(100n);
  });

  it("rejects wrong chain, tokens, router, semantics, bounds, and deadline", () => {
    expect(validateHostedResponse(hostedResponse(), { ...intent, chainId: 10 })).toMatchObject({
      status: "reject",
      code: "hosted-chain-mismatch",
    });
    expect(
      validateHostedResponse(hostedResponse(), { ...intent, inputToken: OTHER_ROUTER }),
    ).toMatchObject({ status: "reject", code: "hosted-token-mismatch" });
    expect(validateHostedResponse(hostedResponse({ to: OTHER_ROUTER }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-router-mismatch",
    });
    expect(validateHostedResponse(hostedResponse({ action: "add-liquidity" }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-semantics",
    });
    expect(validateHostedResponse(hostedResponse({ inputAmount: AMOUNT + 1n }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-bounds",
    });
    expect(validateHostedResponse(hostedResponse({ deadline: NOW - 1n }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-deadline",
    });
    expect(
      validateHostedResponse(hostedResponse({ pendleMarket: OTHER_ROUTER }), intent),
    ).toMatchObject({ status: "reject", code: "hosted-token-mismatch" });
    expect(validateHostedResponse(hostedResponse({ value: "1" }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-bounds",
    });
    expect(validateHostedResponse(hostedResponse({ priceImpact: null }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-response",
    });
    expect(
      validateHostedResponse(
        hostedResponse({
          data: encodeHostedMintPy({
            account: ACCOUNT,
            inputToken: INPUT,
            yt: OTHER_ROUTER,
            amount: AMOUNT,
          }),
        }),
        intent,
      ),
    ).toMatchObject({
      status: "reject",
      code: "hosted-semantics",
    });
    expect(validateHostedResponse(hostedResponse({ action: "mint-py" }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-semantics",
    });
  });

  it("rejects Default impact above 100 bps and posts only to the v3 convert path", () => {
    expect(validateHostedResponse(hostedResponse({ priceImpact: 0.0101 }), intent)).toMatchObject({
      status: "reject",
      code: "hosted-impact",
    });
    expect(hostedConvertUrl(1)).toBe("https://api-v2.pendle.finance/core/v3/sdk/1/convert");
  });

  it("does not fetch the hosted origin on a local fork", async () => {
    const fetchImpl = vi.fn();
    const result = await requestHostedConvert(intent, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "reject", code: "hosted-unavailable" });
  });
});
