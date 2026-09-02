import { expect } from "@playwright/test";
import { formatUnits, parseUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import { ui } from "./locators";
import {
  depositPtForStream,
  exhaustDepositCap,
  publicClient,
  readDeployment,
  readSecondaryMarket,
  readSecondaryPt,
  wrapUnderlying,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS, LENDER_WALLET_ADDRESS } from "../fixtures/mock-wallet";
import { erc20Abi } from "@/lib/abis";

// eslint-disable-next-line no-empty-pattern -- playwright-bdd requires the object-destructuring form for its first argument, even with no fixtures used.
Given("my wallet holds ovrfloToken from a deposit of {string}", async ({}, ptAmount: string) => {
  const deployment = readDeployment();
  const amount = BigInt(Math.round(Number(ptAmount) * 1e18));
  await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: readSecondaryMarket(),
    ptToken: readSecondaryPt(),
    ptAmount: amount,
  });
});

// eslint-disable-next-line no-empty-pattern -- playwright-bdd requires the object-destructuring form for its first argument, even with no fixtures used.
Given("the wrap reserve holds {string}", async ({}, underlyingAmount: string) => {
  const amount = BigInt(Math.round(Number(underlyingAmount) * 1e18));
  await wrapUnderlying({ account: DEV_WALLET_ADDRESS, amount });
});

Given("the deposit cap for the active market is reached", async () => {
  const deployment = readDeployment();
  const secondaryMarket = readSecondaryMarket();
  await depositPtForStream({
    account: LENDER_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: secondaryMarket,
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("1", 18),
  });
  await exhaustDepositCap({ factory: deployment.factory, ovrflo: deployment.ovrflo, market: secondaryMarket });
});

When("I fill the amount field with a value exceeding my PT balance", async ({ page }) => {
  const balance = await publicClient.readContract({
    address: readSecondaryPt(),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [DEV_WALLET_ADDRESS],
  });
  await page.locator("#assets-pt-amount, input[inputMode='decimal']").first().fill(formatUnits(balance + 1n, 18));
});

When("I choose the wrap direction", async ({ page }) => {
  await page.getByRole("button", { name: "WRAP", exact: true }).click();
});

When("I choose the unwrap direction", async ({ page }) => {
  const unwrap = page.getByRole("button", { name: "UNWRAP", exact: true });
  if (await unwrap.count()) await unwrap.click();
});

When("I open stream creation", async ({ page }) => {
  await page.getByRole("tab", { name: "CREATE STREAM", exact: true }).click();
});

When("I select the first stream market", async ({ page }) => {
  await ui(page, "UI-ASSETS-STREAM-SELECT-MARKET").locator(".assets-market").first().click();
});

Then("the assets converter is open", async ({ page }) => {
  await expect(ui(page, "UI-ASSETS-CONVERTER")).toBeVisible();
});

Then("I see a borrow handoff for the new stream", async ({ page }) => {
  await expect(ui(page, "UI-ASSETS-STREAM-CONFIRMED")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: /BORROW AGAINST THIS STREAM/ })).toBeVisible();
});
