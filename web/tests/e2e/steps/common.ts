import { expect, type Locator, type Page } from "@playwright/test";
import { formatUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import { advancePastExpiry, publicClient, readSecondaryExpiry, WSTETH } from "../fixtures/chain";
import {
  DEV_WALLET_ADDRESS,
  EMPTY_WALLET_ADDRESS,
  waitForWalletConnected,
} from "../fixtures/mock-wallet";
import { erc20Abi } from "@/lib/abis";
import { ui } from "./locators";

async function amountInput(page: Page): Promise<Locator> {
  const candidates = [
    page.locator("#supply-amount"),
    page.locator("#borrow-amount"),
    page.locator("#assets-convert-amount"),
    page.locator("#assets-pt-amount"),
    page.locator("#kit-amount"),
    page.locator("input[inputMode='decimal']"),
  ];
  for (const candidate of candidates) {
    if (await candidate.count()) return candidate.first();
  }
  throw new Error("no amount input found");
}

async function restoreSeededWallet(page: Page) {
  const identity = page.locator(".wallet-identity");
  const devChip = identity.getByRole("button", { name: formatAddressChip(DEV_WALLET_ADDRESS) });
  if (await devChip.count()) {
    await expect(devChip).toBeVisible();
    return;
  }
  const disconnect = identity.getByRole("button", { name: "DISCONNECT", exact: true });
  if (await disconnect.count()) await disconnect.click();
  await identity.getByRole("button", { name: "CONNECT WALLET", exact: true }).click();
  await waitForWalletConnected(page);
}

function formatAddressChip(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

Given("I am on the watch surface", async ({ page }) => {
  await page.goto("/");
});

Given("I am on the supply flow", async ({ page }) => {
  await page.goto("/supply");
});

Given("I am on the borrow flow", async ({ page }) => {
  await page.goto("/borrow");
});

Given("I am on the assets page", async ({ page }) => {
  await page.goto("/assets");
});

Given("my wallet is connected", async ({ page }) => {
  await restoreSeededWallet(page);
});

Given("the frontend re-syncs with chain state", async ({ page }) => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await restoreSeededWallet(page);
});

Given("the market has matured", async ({ page }) => {
  const secondaryExpiry = readSecondaryExpiry();
  await advancePastExpiry(secondaryExpiry);
  await page.clock.setFixedTime(new Date(Number(secondaryExpiry) * 1000 + 5_000));
  await page.reload({ waitUntil: "domcontentloaded" });
  await restoreSeededWallet(page);
});

When("I reload the page", async ({ page }) => {
  await page.reload({ waitUntil: "domcontentloaded" });
});

When("I disconnect my wallet", async ({ page }) => {
  await page.locator(".wallet-identity").getByRole("button", { name: "DISCONNECT", exact: true }).click();
});

When("I reconnect my wallet", async ({ page }) => {
  await page.locator(".wallet-identity").getByRole("button", { name: "CONNECT WALLET", exact: true }).click();
  await waitForWalletConnected(page);
});

When("I switch to a protocol-empty wallet", async ({ page }) => {
  await ui(page, "UI-E2E-USE-EMPTY-WALLET").click();
  await waitForWalletConnected(page, EMPTY_WALLET_ADDRESS);
});

When("I click the {string} button", async ({ page }, label: string) => {
  await page.getByRole("button", { name: label, exact: true }).first().click();
});

When("I click the button matching {string}", async ({ page }, pattern: string) => {
  await page.getByRole("button", { name: new RegExp(pattern) }).first().click();
});

When("I click the {string} button if it is shown", async ({ page }, label: string) => {
  const button = page.getByRole("button", { name: label, exact: true });
  if (await button.count()) await button.first().click();
});

When("I acknowledge risk if prompted", async ({ page }) => {
  const ack = page.getByRole("button", { name: "ACKNOWLEDGE RISK", exact: true });
  if (await ack.count()) await ack.click();
});

When("I fill the amount field with {string}", async ({ page }, amount: string) => {
  await (await amountInput(page)).fill(amount);
});

When("I fill the amount field with a value exceeding my wstETH balance", async ({ page }) => {
  const balance = await publicClient.readContract({
    address: WSTETH,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [DEV_WALLET_ADDRESS],
  });
  await (await amountInput(page)).fill(formatUnits(balance + 1n, 18));
});

When("I select the first available rate", async ({ page }) => {
  await page.locator(".kit-rate").first().click();
});

When("I select the {string} lens", async ({ page }, label: string) => {
  await ui(page, "UI-WATCH-LENS").getByRole("tab", { name: label, exact: true }).click();
});

When("I select the first loan row", async ({ page }) => {
  await ui(page, "UI-WATCH-WALL").getByRole("button", { name: /LOAN #/ }).first().click();
});

When("I select the first supply row", async ({ page }) => {
  await ui(page, "UI-WATCH-WALL").getByRole("button", { name: /SUPPLY #/ }).first().click();
});

When("I start the in-place {string} write", async ({ page }, label: string) => {
  await page.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}`) }).first().click();
});

When("I confirm the watch write", async ({ page }) => {
  const write = ui(page, "UI-WATCH-WRITE");
  await write.getByRole("button", { name: /^(CLAIM |WITHDRAW UNFILLED|REPAY|CLOSE FROM STREAM)/ }).click();
});

Then("the watch wall is showing the {string} lens", async ({ page }, lens: string) => {
  await expect(ui(page, "UI-WATCH-WALL")).toHaveAttribute("data-lens", lens);
});

Then("the watch wall is visible", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-WALL")).toBeVisible();
});

Then("I see a loan row", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-WALL").getByRole("button", { name: /LOAN #/ }).first()).toBeVisible({
    timeout: 15_000,
  });
});

Then("the borrowed detail is open", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-BORROWED-DETAIL")).toBeVisible({ timeout: 15_000 });
});

Then("the borrowed detail is close-ready", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-BORROWED-DETAIL")).toHaveAttribute("data-state", "close-ready", {
    timeout: 15_000,
  });
});

Then("the supplied detail is open", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-SUPPLIED-DETAIL")).toBeVisible({ timeout: 15_000 });
});

Then("I see a settled loan detail", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-CLOSED-DETAIL")).toBeVisible({ timeout: 15_000 });
});

Then("the watch write is closed", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-WRITE")).toHaveCount(0);
});

Then("I see the disconnected entry", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-ENTRY-DISCONNECTED")).toBeVisible();
});

Then("I see the first-run surface", async ({ page }) => {
  await expect(ui(page, "UI-FIRST-RUN-SURFACE")).toBeVisible({ timeout: 15_000 });
});

Then("I do not see the first-run surface", async ({ page }) => {
  await expect(ui(page, "UI-FIRST-RUN-SURFACE")).toHaveCount(0);
});

Then("I see the first-run chooser", async ({ page }) => {
  await expect(ui(page, "UI-FIRST-RUN-CHOOSER")).toBeVisible();
});

Then("I see the deposit intent", async ({ page }) => {
  await expect(ui(page, "UI-FIRST-RUN-INTENT-DEPOSIT")).toBeVisible();
});

When("I follow the first-run deposit intent", async ({ page }) => {
  await ui(page, "UI-FIRST-RUN-INTENT-DEPOSIT").click();
});

Then("the assets route is open", async ({ page }) => {
  await expect(page).toHaveURL(/\/assets\/?/);
});

Then("the {string} lens is hidden", async ({ page }, label: string) => {
  await expect(ui(page, "UI-WATCH-LENS").getByRole("tab", { name: label, exact: true })).toHaveCount(0);
});

Then("the {string} lens is visible", async ({ page }, label: string) => {
  await expect(ui(page, "UI-WATCH-LENS").getByRole("tab", { name: label, exact: true })).toBeVisible();
});

Then("the URL carries the borrowed lens and a loan id", async ({ page }) => {
  await expect(page).toHaveURL(/\?lens=borrowed&loan=\d+/);
});

Then("the URL carries the supplied lens and a position id", async ({ page }) => {
  await expect(page).toHaveURL(/\?lens=supplied&position=\d+/);
});

Then("I see a confirmed action receipt", async ({ page }) => {
  await expect(
    page.locator('[data-state="confirmed"], [data-surface-state="CONFIRMED"]').first(),
  ).toBeVisible({ timeout: 15_000 });
});

Then("I see a field error", async ({ page }) => {
  await expect(page.locator(".kit-field-error, [role='alert']").first()).toBeVisible({ timeout: 15_000 });
});

Then("I see a mapped error message", async ({ page }) => {
  await expect(page.locator("[data-ui='UI-REVIEW-TX-STATE'], .kit-field-error, [role='alert']").first()).toBeVisible({
    timeout: 15_000,
  });
});

Then("I see the caption {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

Then("I see text matching {string}", async ({ page }, pattern: string) => {
  await expect(page.getByText(new RegExp(pattern)).first()).toBeVisible({ timeout: 15_000 });
});

Then("the {string} button is disabled", async ({ page }, label: string) => {
  await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeDisabled();
});

Then("the {string} button is enabled", async ({ page }, label: string) => {
  await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeEnabled();
});

Given("the viewport is {int} by {int}", async ({ page }, width: number, height: number) => {
  await page.setViewportSize({ width, height });
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
