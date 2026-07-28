import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import { Given, When } from "../fixtures/bdd";
import {
  advanceSeconds,
  borrowAgainstStream,
  depositPtForStream,
  drainTokenBalance,
  lenderSupplyLiquidity,
  publicClient,
  readAprBounds,
  readDeployment,
  readSecondaryExpiry,
  readSecondaryMarket,
  readSecondaryPt,
  readStreamGrossPrice,
  repayLoanFully,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS, waitForWalletConnected } from "../fixtures/mock-wallet";

let currentLoanId: bigint | null = null;

Given("my wallet has an open loan against a stream", async () => {
  const deployment = readDeployment();
  const secondaryMarket = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await lenderSupplyLiquidity({
    lending: deployment.lending,
    market: secondaryMarket,
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
  const streamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: secondaryMarket,
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("10", 18),
  });
  // A fixed absolute (e.g. "2 tokens") isn't safely "small" here: the stream's
  // face value is the PT *discount* (OVRFLO._computeSplit's `toStream`), a
  // function of the live-discovered market's rate/time-to-maturity, not the
  // 10 PT deposited — it can easily be smaller than any hardcoded absolute.
  // Sizing the borrow off the stream's own quoted price instead keeps this a
  // genuine partial borrow (below `createBorrowerLoanPool`'s full-borrow
  // branch, which would otherwise set obligation = the *entire* remaining
  // stream), so the modest half-time vest below reliably covers it — see
  // "the loan's stream has vested enough to close it".
  const grossPrice = await readStreamGrossPrice({
    lending: deployment.lending,
    market: secondaryMarket,
    streamId,
    aprBps: aprMinBps,
  });
  currentLoanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: secondaryMarket,
    streamId,
    aprBps: aprMinBps,
    targetBorrow: grossPrice / 5n,
  });
});

Given("the loan's stream has vested enough to close it", async ({ page }) => {
  // OVRFLO.deposit sets the Sablier stream's total duration to exactly
  // `marketExpiry - block.timestamp` at deposit time (see src/OVRFLO.sol),
  // so a fixed day count would be safe against one hardcoded expiry but not
  // against whatever market seed-local.sh's live discovery actually picks
  // this run (only guaranteed >14 days out — see PENDLE_EXPIRY_BUFFER_DAYS).
  // Advancing half the *remaining* time to that same expiry vests half the
  // stream's face value — comfortably more than the ~1/5-of-price obligation
  // arranged above — while staying strictly before both the stream's end and
  // the market's own maturity, regardless of which real market got seeded.
  const latest = await publicClient.getBlock();
  const secondsRemaining = readSecondaryExpiry() - latest.timestamp;
  await advanceSeconds(Number(secondsRemaining / 2n));
  await page.reload();
  await waitForWalletConnected(page);
});

When("I open the loan's advanced panel", async ({ page }) => {
  await page.locator(".position-card", { hasText: "LOAN" }).locator(".advanced-toggle").click();
});

Given("the loan is fully repaid from another channel", async () => {
  const deployment = readDeployment();
  if (currentLoanId === null) throw new Error("no loan arranged yet — call the open-loan Given step first");
  await repayLoanFully({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    loanId: currentLoanId,
    ovrfloToken: deployment.token,
  });
});

// Shared by two scenarios with different preconditions.
//
// "Insufficient balance" drains before any amount is filled: RepayForm's
// `balanceRead` (web/components/ActionModal.tsx) has no write of its own to
// key an invalidation off of here, so it's polled (`refetchInterval: 2_000`)
// rather than invalidation-driven — the drain lands correctly within a poll
// or two, well inside the 15s caption timeout, regardless of whether it
// beats balanceRead's very first mount-time fetch.
//
// "Drained mid-flow" drains right after clicking APPROVE REPAY, while that
// tx's own invalidateAllOnChainReads refetch (web/hooks/useWriteFlow.ts) may
// still be resolving the pre-drain balance read. Firing the drain
// immediately risks racing that refetch — the same class of bug fixed for
// borrow.feature's stale-liquidity scenario (see
// docs/solutions/test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md).
// Waiting for REPAY to be enabled pins the drain to strictly after the
// refetch settles with a fresh, pre-drain balance; the subsequent drain and
// click both land well within balanceRead's 2s poll interval, so the
// already-fresh balance is what the click submits against.
When("my ovrfloToken balance is drained", async ({ page }) => {
  const deployment = readDeployment();
  const amountFilled = (await page.locator("input.input").first().inputValue()) !== "";
  if (amountFilled) {
    await expect(page.getByRole("dialog").getByRole("button", { name: /^REPAY /}).first()).toBeEnabled();
  }
  await drainTokenBalance(deployment.token, DEV_WALLET_ADDRESS);
});
