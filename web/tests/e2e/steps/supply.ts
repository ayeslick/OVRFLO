import { expect } from "@playwright/test";
import { drainUnderlyingBalance } from "../fixtures/chain";
import { When } from "../fixtures/bdd";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";

// Must wait for the just-clicked APPROVE to actually be mined before draining:
// this drains the same account (DEV_WALLET) that the still-in-flight APPROVE
// tx was signed from, via a *separate* client outside the browser. Racing the
// two risks a nonce collision — Playwright resolves the APPROVE click as soon
// as the DOM interaction completes, well before the tx reaches the mempool,
// so a fixed delay or a nonce-parity check alone can still land before the
// browser's tx is submitted. Waiting for the app's own "CONFIRMING" caption
// (`.status-warning`, ActionModal.tsx's ApproveTxState) to clear ties this to
// the real on-chain event instead of a guessed timing window.
When("my wstETH balance is drained", async ({ page }) => {
  await expect(page.locator(".status-warning")).toHaveCount(0, { timeout: 15_000 });
  await drainUnderlyingBalance(DEV_WALLET_ADDRESS);
});
