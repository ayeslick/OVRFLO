import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import {
  depositPtForStream,
  lenderSupplyLiquidity,
  readAprBounds,
  readDeployment,
  readSecondaryMarket,
  readSecondaryPt,
  waitForHeldStream,
  withdrawLiquidity,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";
import { ui } from "./locators";

let positionId: bigint | null = null;

Given("a lender has posted liquidity for the active market", async () => {
  const deployment = readDeployment();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  positionId = await lenderSupplyLiquidity({
    lending: deployment.lending,
    market: readSecondaryMarket(),
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
});

Given("my wallet holds an eligible stream", async () => {
  const deployment = readDeployment();
  const streamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: readSecondaryMarket(),
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("10", 18),
  });
  await waitForHeldStream(DEV_WALLET_ADDRESS, streamId);
});

When("I select the first available stream", async ({ page }) => {
  await ui(page, "UI-BORROW-SELECT-STREAM").locator(".kit-entity-row").first().click();
});

Then("the borrow amount step is open", async ({ page }) => {
  await expect(ui(page, "UI-BORROW-AMOUNT")).toBeVisible();
});

Then("the borrow review is open", async ({ page }) => {
  await expect(ui(page, "UI-REVIEW-SPLIT")).toBeVisible();
});

Then("I see the no-eligible-stream handoff", async ({ page }) => {
  await expect(ui(page, "UI-BORROW-NO-STREAM")).toBeVisible({ timeout: 15_000 });
});

When("the posted liquidity is withdrawn by the lender", async ({ page }) => {
  const deployment = readDeployment();
  if (positionId === null) throw new Error("no liquidity arranged yet — call the supply Given step first");
  await expect(page.getByRole("button", { name: "BORROW", exact: true }).first()).toBeEnabled();
  await withdrawLiquidity({ lending: deployment.lending, positionId });
});
