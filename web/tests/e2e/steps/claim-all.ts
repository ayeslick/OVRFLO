import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import { Given, Then } from "../fixtures/bdd";
import { advanceSeconds, claimStreamMax, depositPtForStream, readDeployment, SECONDARY_MARKET, SECONDARY_PT } from "../fixtures/chain";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";

let currentStreamId: bigint | null = null;

Given("my wallet holds a stream with a withdrawable balance", async () => {
  const deployment = readDeployment();
  currentStreamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: SECONDARY_MARKET,
    ptToken: SECONDARY_PT,
    ptAmount: parseUnits("10", 18),
  });
  // A few minutes of linear vesting is enough for withdrawableAmountOf to be
  // meaningfully nonzero without meaningfully affecting the stream's total.
  await advanceSeconds(600);
});

Given("the stream has already been claimed elsewhere", async () => {
  if (currentStreamId === null) throw new Error("no stream arranged yet — hold a stream first");
  await claimStreamMax(currentStreamId);
});

Then("there is no {string} position group", async ({ page }, label: string) => {
  await expect(page.locator(".position-group", { hasText: label })).toHaveCount(0);
});
