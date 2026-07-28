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
  // Deliberately small relative to the 10 PT stream — see "the loan's stream
  // has vested enough to close it" below, which relies on a modest time
  // advance vesting far more than this loan's own obligation.
  currentLoanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: secondaryMarket,
    streamId,
    aprBps: aprMinBps,
    targetBorrow: parseUnits("2", 18),
  });
});

Given("the loan's stream has vested enough to close it", async ({ page }) => {
  // OVRFLO.deposit sets the Sablier stream's total duration to exactly
  // `marketExpiry - block.timestamp` at deposit time (see src/OVRFLO.sol),
  // so a fixed day count would be safe against one hardcoded expiry but not
  // against whatever market seed-local.sh's live discovery actually picks
  // this run (only guaranteed >14 days out — see PENDLE_EXPIRY_BUFFER_DAYS).
  // Advancing half the *remaining* time to that same expiry vests comfortably
  // more than a 2-token obligation on a 10 PT stream while staying strictly
  // before both the stream's end and the market's own maturity, regardless
  // of which real market got seeded.
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
  await repayLoanFully({ account: DEV_WALLET_ADDRESS, lending: deployment.lending, loanId: currentLoanId });
});

When("my ovrfloToken balance is drained", async () => {
  const deployment = readDeployment();
  await drainTokenBalance(deployment.token, DEV_WALLET_ADDRESS);
});
