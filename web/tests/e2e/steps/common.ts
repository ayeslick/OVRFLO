import { expect, type Locator, type Page } from "@playwright/test";
import { formatUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import { advancePastExpiry, publicClient, readSecondaryExpiry, readSecondaryMaturityLabel, WSTETH } from "../fixtures/chain";
import { DEV_WALLET_ADDRESS, waitForWalletConnected } from "../fixtures/mock-wallet";
import { erc20Abi } from "@/lib/abis";

// Scenarios act on whichever container is "in front". An open action modal
// takes priority (it overlays everything). Otherwise search the whole page —
// action buttons live in different places (market-row detail for SUPPLY /
// BORROW / DEPOSIT PT, position cards for ADJUST RATE / REPAY / CLOSE / CLAIM
// ALL), so scoping to the expanded market `region` alone misses half of them.
// Also: PositionSummary's own "Your positions" `<section aria-label=...>`
// carries an implicit ARIA `region` role too, so `getByRole("region")` isn't
// even unique to the expanded market once a user has open positions —
// `.first()` on it would silently grab the wrong one. body is correct here.
async function actionScope(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) return dialog;
  return page.locator("body");
}

Given("I am on the markets page", async ({ page }) => {
  await page.goto("/");
});

Given("my wallet is connected", async ({ page }) => {
  await waitForWalletConnected(page);
});

// Every fixture-direct arrange step (chain.ts helpers, called via a raw viem
// client) mutates chain state completely outside the app's own write flow —
// no wagmi hook ever confirms a matching transaction, so `useWriteFlow.ts`'s
// `invalidateAllOnChainReads` never fires and the page keeps showing
// whatever it fetched on its FIRST load (before the arrangement), forever:
// there's no polling and nothing else to trigger a refetch. supply.feature's
// scenarios never hit this because they create their own liquidity by
// clicking through the real SUPPLY form — a UI-driven write the app's own
// invalidation already covers. Anything arranged as a different persona
// (lender-side liquidity) or via a direct fixture call (streams, deposit
// caps) needs this explicit step appended as the LAST arrange step in its
// scenario's Given chain — do not add it when a later step already reloads
// (e.g. "the market has matured", "the loan's stream has vested enough to
// close it"), or the scenario reloads twice for no reason.
Given("the frontend re-syncs with chain state", async ({ page }) => {
  await page.reload();
  await waitForWalletConnected(page);
});

// Every scenario targets the market with the further-out expiry of the two
// seed-local.sh discovers live on every run (see script/lib/discover-pendle-market.sh)
// — arbitrary, just needs to be a stable pick between the two. "Matured"
// scenarios don't need the *other* market: advancing this one's own clock
// (below) covers every maturity state deterministically, regardless of which
// real markets got seeded this run.
//
// "Ensure expanded", not "toggle": `.row-toggle` is a plain click target that
// bubbles to the `<tr>`'s own onClick, which flips `expanded ? null : market`
// (see MarketsTable.tsx) — a second call in the same scenario (e.g. re-check
// a position card after closing an action modal, which only clears
// `activeMode` and never touches the row's own expanded state) would
// collapse the row instead of leaving it open, silently unmounting
// PositionList right before the next assertion looks for a `.position-card`.
When("I expand the active market", async ({ page }) => {
  const toggle = page.locator("tr", { hasText: readSecondaryMaturityLabel() }).first().locator(".row-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.click();
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
  const secondaryExpiry = readSecondaryExpiry();
  await advancePastExpiry(secondaryExpiry);
  // setFixedTime (not install/tick) — it only freezes Date.now()/`new Date()`,
  // leaving real setTimeout/setInterval alone, so wagmi's own read-polling
  // and query refetch intervals keep working normally after the reload.
  await page.clock.setFixedTime(new Date(Number(secondaryExpiry) * 1000 + 5_000));
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

// Longer than the default 5s: a just-confirmed write only bumps the enumeration
// count (e.g. `nextLiquidityId`) via one invalidated read, and the position
// list itself is a *second* read keyed off that count (see useLendingLiquidity)
// — it can't refetch with the right args until the first read's new value has
// round-tripped back and re-rendered, so this is inherently a two-hop refetch,
// not a single query invalidation.
Then("I see a {string} position card", async ({ page }, label: string) => {
  await expect(page.locator(".position-card", { hasText: label }).first()).toBeVisible({ timeout: 15_000 });
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
  // .first(), not a strict match: MarketRowDetail computes supplyCaption and
  // borrowCaption from the same baseActionCaption() call (see
  // MarketRowDetail.tsx), so a matured market renders "MARKET MATURED" twice
  // at once — once per action area, in the SAME market's own row-detail, not
  // across two markets. A strict getByText would throw on that duplicate.
  // Longer than the default 5s: this step is also used for "CONFIRMED" after
  // a real on-chain write, which only surfaces once wagmi's own
  // useWaitForTransactionReceipt polling notices the mined receipt (see the
  // longer explanation on "I see a mapped error message" below).
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

Then("I do not see the caption {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toHaveCount(0);
});

Then("I see text matching {string}", async ({ page }, pattern: string) => {
  await expect(page.getByText(new RegExp(pattern)).first()).toBeVisible();
});

When("I fill the slippage field with {string}", async ({ page }, value: string) => {
  await page.locator("#borrow-slippage").fill(value);
});

// Longer than the default 5s: this always follows a real on-chain revert
// (supply.feature/repay-close.feature's "transaction reverts" scenarios), and
// the mapped-error caption only appears once wagmi's `useWaitForTransactionReceipt`
// notices it — that hook polls (viem's default ~4s HTTP polling interval),
// it doesn't push, so a receipt that's already mined can still take a full
// poll tick-or-two to surface in the UI.
Then("I see a mapped error message", async ({ page }) => {
  await expect(page.locator(".status-negative").first()).toBeVisible({ timeout: 15_000 });
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
