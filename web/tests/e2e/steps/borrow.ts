import { parseUnits } from "viem";
import { Given, When } from "../fixtures/bdd";
import {
  depositPtForStream,
  lenderSupplyLiquidity,
  readAprBounds,
  readDeployment,
  readSecondaryMarket,
  readSecondaryPt,
  withdrawLiquidity,
} from "../fixtures/chain";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";

// Module-scoped, not React state: these thread an arranged fixture's id from
// a Given step to a later When/Then step within the *same* scenario. Safe
// under workers: 1 (serial) — each scenario overwrites it before reading.
let liquidityId: bigint | null = null;

Given("a lender has posted liquidity for the active market", async () => {
  const deployment = readDeployment();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  liquidityId = await lenderSupplyLiquidity({
    lending: deployment.lending,
    market: readSecondaryMarket(),
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
});

Given("my wallet holds an eligible stream", async () => {
  const deployment = readDeployment();
  await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: readSecondaryMarket(),
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("10", 18),
  });
});

When("the posted liquidity is withdrawn by the lender", async () => {
  const deployment = readDeployment();
  if (liquidityId === null) throw new Error("no liquidity arranged yet — call the supply Given step first");
  await withdrawLiquidity({ lending: deployment.lending, liquidityId });
});

When("I select the first available stream", async ({ page }) => {
  await page.locator("select.input").selectOption({ index: 1 });
});
