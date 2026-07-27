import { parseUnits } from "viem";
import { Given, When } from "../fixtures/bdd";
import {
  advanceSeconds,
  borrowAgainstStream,
  depositPtForStream,
  drainTokenBalance,
  lenderSupplyLiquidity,
  readAprBounds,
  readDeployment,
  repayLoanFully,
  SECONDARY_MARKET,
  SECONDARY_PT,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS, waitForWalletConnected } from "../fixtures/mock-wallet";

let currentLoanId: bigint | null = null;

Given("my wallet has an open loan against a stream", async () => {
  const deployment = readDeployment();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await lenderSupplyLiquidity({
    lending: deployment.lending,
    market: SECONDARY_MARKET,
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
  const streamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: SECONDARY_MARKET,
    ptToken: SECONDARY_PT,
    ptAmount: parseUnits("10", 18),
  });
  // Deliberately small relative to the 10 PT stream — see "the loan's stream
  // has vested enough to close it" below, which relies on a modest time
  // advance vesting far more than this loan's own obligation.
  currentLoanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: SECONDARY_MARKET,
    streamId,
    aprBps: aprMinBps,
    targetBorrow: parseUnits("2", 18),
  });
});

Given("the loan's stream has vested enough to close it", async ({ page }) => {
  // 180 days into the stream's ~16-month total vesting window (SECONDARY_EXPIRY
  // is 2027) comfortably exceeds a 2-token obligation on a 10 PT stream, without
  // approaching the market's own expiry — CLOSE and market maturity are
  // deliberately kept independent here.
  await advanceSeconds(180 * 24 * 60 * 60);
  await page.reload();
  await waitForWalletConnected(page);
});

When("I open the loan's advanced panel", async ({ page }) => {
  await page.locator(".position-card", { hasText: "LOAN" }).locator(".advanced-toggle").click();
});

Given("the loan is fully repaid from another channel", async () => {
  const deployment = readDeployment();
  if (currentLoanId === null) throw new Error("no loan arranged yet — call the open-loan Given step first");
  await repayLoanFully({ account: DEV_WALLET_ADDRESS, lending: deployment.lending, loanId: currentLoanId });
});

When("my ovrfloToken balance is drained", async () => {
  const deployment = readDeployment();
  await drainTokenBalance(deployment.token, DEV_WALLET_ADDRESS);
});
