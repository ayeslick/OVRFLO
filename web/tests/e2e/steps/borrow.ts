import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import { Given, When } from "../fixtures/bdd";
import {
  depositPtForStream,
  lenderSupplyLiquidity,
  readAprBounds,
  readDeployment,
  readSecondaryMarket,
  readSecondaryPt,
  waitForHeldStream,
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
  const streamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: readSecondaryMarket(),
    ptToken: readSecondaryPt(),
    ptAmount: parseUnits("10", 18),
  });
  await waitForHeldStream(DEV_WALLET_ADDRESS, streamId);
});

// A successful APPROVE STREAM confirmation triggers the app's own coarse
// post-write invalidation (useWriteFlow.ts's `invalidateAllOnChainReads`),
// which refetches the ladder/gather/quote reads this form's BORROW button
// gates on. That refetch is async and otherwise racy against this fixture's
// direct, un-synchronized withdrawal: if the withdrawal lands on-chain before
// the refetch resolves, the refetch itself discovers the now-empty liquidity
// and disables BORROW before it's ever clicked — the button never reaches a
// submission attempt, so the scenario's actual target (a stale-liquidity
// revert on submit, recovered by useStaleRecovery) is never exercised.
// Waiting for BORROW to be enabled first pins the withdrawal to strictly
// after that refetch has settled with a fresh, pre-withdrawal quote — the
// same role a page reload plays in other fixture-direct arrangements (see
// "the frontend re-syncs with chain state"), but without reloading, since
// this scenario needs the modal to stay open.
When("the posted liquidity is withdrawn by the lender", async ({ page }) => {
  const deployment = readDeployment();
  if (liquidityId === null) throw new Error("no liquidity arranged yet — call the supply Given step first");
  await expect(page.getByRole("dialog").getByRole("button", { name: "BORROW", exact: true }).first()).toBeEnabled();
  await withdrawLiquidity({ lending: deployment.lending, liquidityId });
});

When("I select the first available stream", async ({ page }) => {
  await page.locator("select.input").selectOption({ index: 1 });
});
