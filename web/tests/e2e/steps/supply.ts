import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import {
  depositPtForStream,
  drainUnderlyingBalance,
  readAprBounds,
  readDeployment,
  readLatestLiquidityId,
  readSecondaryMarket,
  readSecondaryPt,
  sellStreamIntoLiquidity,
  supplyLiquidityAs,
  waitForHeldStream,
} from "../fixtures/chain";
import { Given, When } from "../fixtures/bdd";
import { DEV_WALLET_ADDRESS, LENDER_WALLET_ADDRESS } from "../fixtures/mock-wallet";

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
  // Waiting only for `.status-warning` absence is trivially satisfied in the
  // caption-free window between clicking APPROVE and the SIGNING caption
  // rendering, letting the drain land before the app's awaited post-approve
  // refresh — which then honestly reads the drained balance and fail-closes
  // the form before submit. Wait for the positive signal instead: SUPPLY
  // becoming enabled proves approval covered, the refresh completed, and the
  // balance was read pre-drain, so the UI holds a stale balance and the
  // submit genuinely reverts on-chain (the scenario's premise).
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /^SUPPLY @/ }).first(),
  ).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator(".status-warning")).toHaveCount(0, { timeout: 15_000 });
  await drainUnderlyingBalance(DEV_WALLET_ADDRESS);
});

// R46/F2 — the sale side of a supplied position. The lender here is the app's
// own wallet, so the acquired stream has to surface in the view under test.
//
// This is deliberately an E2E rather than a component test: the chain that can
// actually regress runs `sellStreamToLiquidity` transferring the NFT, then the
// verified-log projection intersects that Transfer with its vault origin and
// hydrates the surviving ID. A component test mocks `useHeldStreams` wholesale
// and would only prove PositionList renders a stream it was handed.
Given("my supplied liquidity is filled by an outright stream sale", async () => {
  const deployment = readDeployment();
  const market = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);

  // The app's wallet is the buyer: it supplies, and the sale consumes that.
  await supplyLiquidityAs({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market,
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
  const liquidityId = await readLatestLiquidityId(deployment.lending);

  // A different persona holds the stream and sells it in.
  const streamId = await depositPtForStream({
    account: LENDER_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market,
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("5", 18),
  });

  await sellStreamIntoLiquidity({
    seller: LENDER_WALLET_ADDRESS,
    lending: deployment.lending,
    market,
    streamId,
    liquidityId,
  });

  // The NFT is the buyer's now — wait for the direct projection to agree
  // before the app is asked to render it.
  await waitForHeldStream(DEV_WALLET_ADDRESS, streamId);
});
