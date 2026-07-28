import { parseUnits } from "viem";
import { Given } from "../fixtures/bdd";
import {
  borrowAgainstStream,
  depositPtForStream,
  readAprBounds,
  readDeployment,
  readSecondaryMarket,
  readSecondaryPt,
  supplyLiquidityAs,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS, LENDER_WALLET_ADDRESS } from "../fixtures/mock-wallet";

const SUPPLY_AMOUNT = parseUnits("5", 18);

Given("my wallet has supplied liquidity to the active market", async () => {
  const deployment = readDeployment();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await supplyLiquidityAs({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market: readSecondaryMarket(),
    aprBps: aprMinBps,
    amount: SUPPLY_AMOUNT,
  });
});

// Races the review modal's idle-amount snapshot: another borrower (the
// lender persona, playing a third party here) draws down the same liquidity
// tick after the modal has already captured its numbers, forcing the
// stale-recovery path that AdjustRateForm's pre-submit refetch guards on.
Given("another borrower draws down that liquidity before I confirm", async () => {
  const deployment = readDeployment();
  const secondaryMarket = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  const streamId = await depositPtForStream({
    account: LENDER_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: secondaryMarket,
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("10", 18),
  });
  await borrowAgainstStream({
    account: LENDER_WALLET_ADDRESS,
    lending: deployment.lending,
    market: secondaryMarket,
    streamId,
    aprBps: aprMinBps,
    targetBorrow: SUPPLY_AMOUNT,
  });
});
