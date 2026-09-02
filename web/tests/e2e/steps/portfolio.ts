import { parseUnits } from "viem";
import { Given } from "../fixtures/bdd";
import {
  borrowAgainstStream,
  depositPtForStream,
  lenderSupplyLiquidity,
  readAprBounds,
  readDeployment,
  readSecondaryMarket,
  readSecondaryPt,
  readStreamGrossPrice,
  waitForHeldStream,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";
import { floorToUnit, MIN_LIQUIDITY_AMOUNT } from "@/lib/lending-math";

Given("my wallet has a second Self-Repaying Loan", async () => {
  const deployment = readDeployment();
  const market = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await lenderSupplyLiquidity({
    lending: deployment.lending,
    market,
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
  const streamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market,
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("10", 18),
  });
  await waitForHeldStream(DEV_WALLET_ADDRESS, streamId);
  const cap = await readStreamGrossPrice({
    lending: deployment.lending,
    market,
    streamId,
    aprBps: aprMinBps,
  });
  const fifth = floorToUnit(cap / 5n);
  const targetBorrow = fifth < MIN_LIQUIDITY_AMOUNT ? MIN_LIQUIDITY_AMOUNT : fifth;
  await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market,
    streamId,
    aprBps: aprMinBps,
    targetBorrow,
  });
});
