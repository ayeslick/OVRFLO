import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import {
  drainUnderlyingBalance,
  readAprBounds,
  readDeployment,
  readSecondaryMarket,
  supplyLiquidityAs,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";
import { ui } from "./locators";

Given("my wallet has supplied liquidity to the active market", async () => {
  const deployment = readDeployment();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await supplyLiquidityAs({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: readSecondaryMarket(),
    aprBps: aprMinBps,
    amount: parseUnits("5", 18),
  });
});

When("I select the first supply market", async ({ page }) => {
  await ui(page, "UI-SUPPLY-SELECT-MARKET").locator(".kit-entity-row").first().click();
});

Then("the supply amount step is open", async ({ page }) => {
  await expect(ui(page, "UI-SUPPLY-AMOUNT")).toBeVisible();
});

Then("the supply review is open", async ({ page }) => {
  await expect(ui(page, "UI-REVIEW-SPLIT")).toBeVisible();
});

Then("the supply market picker is showing a non-loading state", async ({ page }) => {
  await expect(ui(page, "UI-SUPPLY-SELECT-MARKET")).not.toHaveAttribute("data-state", "loading");
});

When("I approve the supply token if needed", async ({ page }) => {
  const approve = page.getByRole("button", { name: /^APPROVE / });
  if (await approve.count()) {
    await expect(approve.first()).toBeEnabled({ timeout: 15_000 });
    await approve.first().click();
  }
  const supply = page.getByRole("button", { name: "SUPPLY", exact: true });
  await expect(supply.first()).toBeEnabled({ timeout: 15_000 });
});

When("my wstETH balance is drained", async ({ page }) => {
  await expect(page.getByRole("button", { name: "SUPPLY", exact: true }).first()).toBeEnabled({
    timeout: 15_000,
  });
  await drainUnderlyingBalance(DEV_WALLET_ADDRESS);
});
