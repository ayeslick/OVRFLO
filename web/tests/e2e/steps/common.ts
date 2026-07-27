import { expect, type Locator, type Page } from "@playwright/test";
import { formatUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import { advancePastExpiry, publicClient, SECONDARY_EXPIRY, SECONDARY_MATURITY_LABEL, WSTETH } from "../fixtures/chain";
import { DEV_WALLET_ADDRESS, waitForWalletConnected } from "../fixtures/mock-wallet";
import { erc20Abi } from "@/lib/abis";

// Scenarios act on whichever container is "in front": an open action modal
// takes priority over the expanded market row's own action buttons, which in
// turn takes priority over the bare page (nothing expanded yet). This mirrors
// how a real user's attention narrows as they drill into a journey.
async function actionScope(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) return dialog;
  const region = page.getByRole("region");
  if (await region.count()) return region.first();
  return page.locator("body");
}

Given("I am on the markets page", async ({ page }) => {
  await page.goto("/");
});

Given("my wallet is connected", async ({ page }) => {
  await waitForWalletConnected(page);
});

// Every scenario targets the same long-dated (2027) market — the only one
// currently onboardable at all (see e2e/README.md "known fixture blocker").
// "Matured" scenarios don't need a second, separately-pinned near-term
// market: advancing this market's own clock (below) covers every maturity
// state deterministically, on a fixture that never itself goes stale.
When("I expand the active market", async ({ page }) => {
  const row = page.locator("tr", { hasText: SECONDARY_MATURITY_LABEL }).first();
  await row.locator(".row-toggle").click();
});

When("I collapse the expanded market row", async ({ page }) => {
  await page.locator(".row-toggle[aria-expanded='true']").click();
});

When("I open the advanced panel", async ({ page }) => {
  await page.locator(".advanced-toggle").click();
});

// Advances BOTH clocks the app's maturity checks can observe: the fork's own
// block.timestamp (so contract-side `require(block.timestamp >= expiry)`
// gates open for real, e.g. OVRFLO.claim) and the browser's Date.now() (so
// the frontend's wall-clock-anchored useNowSeconds() agrees from the very
// first render after the reload). Neither alone is sufficient — see
// docs/solutions/integration-issues/indexer-window-wall-clock-vs-chain-time.md
// for the general chain-time-vs-wall-time pitfall this sidesteps.
Given("the market has matured", async ({ page }) => {
  await advancePastExpiry(SECONDARY_EXPIRY);
  // setFixedTime (not install/tick) — it only freezes Date.now()/`new Date()`,
  // leaving real setTimeout/setInterval alone, so wagmi's own read-polling
  // and query refetch intervals keep working normally after the reload.
  await page.clock.setFixedTime(new Date(Number(SECONDARY_EXPIRY) * 1000 + 5_000));
  await page.reload();
  await waitForWalletConnected(page);
});

When("I click the {string} button", async ({ page }, label: string) => {
  const scope = await actionScope(page);
  await scope.getByRole("button", { name: label, exact: true }).first().click();
});

When("I click the button matching {string}", async ({ page }, pattern: string) => {
  const scope = await actionScope(page);
  await scope.getByRole("button", { name: new RegExp(pattern) }).first().click();
});

When("I fill the amount field with {string}", async ({ page }, amount: string) => {
  const scope = await actionScope(page);
  await scope.locator("input.input").first().fill(amount);
});

When("I fill the amount field with a value exceeding my wstETH balance", async ({ page }) => {
  const balance = await publicClient.readContract({
    address: WSTETH,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [DEV_WALLET_ADDRESS],
  });
  const scope = await actionScope(page);
  await scope.locator("input.input").first().fill(formatUnits(balance + 1n, 18));
});

When("I select the first available rate", async ({ page }) => {
  const scope = await actionScope(page);
  await scope.getByRole("radio").first().click();
});

When("I select the second available rate", async ({ page }) => {
  const scope = await actionScope(page);
  await scope.getByRole("radio").nth(1).click();
});

Then("I see a {string} position card", async ({ page }, label: string) => {
  await expect(page.locator(".position-card", { hasText: label }).first()).toBeVisible();
});

When("I press Escape", async ({ page }) => {
  await page.keyboard.press("Escape");
});

Then("the {string} modal is open", async ({ page }, title: string) => {
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
});

Then("no modal is open", async ({ page }) => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then("I see the caption {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then("I do not see the caption {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).not.toBeVisible();
});

Then("I see text matching {string}", async ({ page }, pattern: string) => {
  await expect(page.getByText(new RegExp(pattern)).first()).toBeVisible();
});

When("I fill the slippage field with {string}", async ({ page }, value: string) => {
  await page.locator("#borrow-slippage").fill(value);
});

Then("I see a mapped error message", async ({ page }) => {
  await expect(page.locator(".status-negative").first()).toBeVisible();
});

Then("the {string} button is disabled", async ({ page }, label: string) => {
  const scope = await actionScope(page);
  await expect(scope.getByRole("button", { name: label, exact: true }).first()).toBeDisabled();
});

Then("the {string} button is enabled", async ({ page }, label: string) => {
  const scope = await actionScope(page);
  await expect(scope.getByRole("button", { name: label, exact: true }).first()).toBeEnabled();
});

Then("the button matching {string} is disabled", async ({ page }, pattern: string) => {
  const scope = await actionScope(page);
  await expect(scope.getByRole("button", { name: new RegExp(pattern) }).first()).toBeDisabled();
});

Then("the button matching {string} is enabled", async ({ page }, pattern: string) => {
  const scope = await actionScope(page);
  await expect(scope.getByRole("button", { name: new RegExp(pattern) }).first()).toBeEnabled();
});

Then("focus is trapped within the {string} modal", async ({ page }, title: string) => {
  const dialog = page.getByRole("dialog", { name: title });
  // More Tabs than any modal has focusable elements — if the trap ever leaks,
  // document.activeElement eventually lands outside the dialog.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const stillInside = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(stillInside).toBe(true);
  }
});

Then("focus returns to the {string} button", async ({ page }, label: string) => {
  await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeFocused();
});

Given("the viewport is {int} by {int}", async ({ page }, width: number, height: number) => {
  await page.setViewportSize({ width, height });
});
