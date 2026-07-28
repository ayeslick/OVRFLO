import { formatUnits, parseUnits } from "viem";
import { Given, When } from "../fixtures/bdd";
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
  const deployment = readDeployment();
  const amount = BigInt(Math.round(Number(underlyingAmount) * 1e18));
  await wrapUnderlying({ account: DEV_WALLET_ADDRESS, ovrflo: deployment.ovrflo, amount });
});

Given("the deposit cap for the active market is reached", async () => {
  const deployment = readDeployment();
  // A tiny prior deposit from the lender persona (not DEV_WALLET) bumps
  // marketTotalDeposited above zero without touching the balances this
  // scenario's own assertions read from, then the cap gets pinned to match.
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
  await page.locator("input.input").first().fill(formatUnits(balance + 1n, 18));
});
