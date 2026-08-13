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
import { floorToUnit, MIN_LIQUIDITY_AMOUNT } from "@/lib/lending-math";
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
  const cap = await readStreamGrossPrice({
    lending: deployment.lending,
    market: secondaryMarket,
    streamId,
    aprBps: aprMinBps,
  });
  const fifth = floorToUnit(cap / 5n);
  const targetBorrow = fifth < MIN_LIQUIDITY_AMOUNT ? MIN_LIQUIDITY_AMOUNT : fifth;
  currentLoanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: secondaryMarket,
    streamId,
    aprBps: aprMinBps,
    targetBorrow,
  });
});

Given("the loan's stream has vested enough to close it", async ({ page }) => {
  const latest = await publicClient.getBlock();
  const secondsRemaining = readSecondaryExpiry() - latest.timestamp;
  await advanceSeconds(Number(secondsRemaining / 2n));
  await page.reload();
  await waitForWalletConnected(page);
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

When("my ovrfloToken balance is drained", async ({ page }) => {
  const deployment = readDeployment();
  const input = page.locator("#kit-amount, input[inputMode='decimal']").first();
  const amountFilled = (await input.count()) > 0 && (await input.inputValue()) !== "";
  if (amountFilled) {
    await expect(page.getByRole("button", { name: "REPAY", exact: true }).first()).toBeEnabled();
  }
  await drainTokenBalance(deployment.token, DEV_WALLET_ADDRESS);
});
