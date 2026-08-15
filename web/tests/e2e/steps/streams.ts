import { expect } from "@playwright/test";
import { parseUnits } from "viem";
import { Given, Then, When } from "../fixtures/bdd";
import {
  advancePastExpiry,
  advanceSeconds,
  advanceToUnitAlignedGrossPrice,
  borrowAgainstStream,
  claimStreamMax,
  closeLoan,
  depositPtForStream,
  lenderSupplyLiquidity,
  publicClient,
  readAprBounds,
  readDeployment,
  readSecondaryExpiry,
  readSecondaryMarket,
  readSecondaryPt,
  readStreamGrossPrice,
  readStreamLockup,
  streamIsDepleted,
  streamOwnerOf,
  waitForHeldStream,
} from "../fixtures/chain";
import { floorToUnit, MIN_LIQUIDITY_AMOUNT } from "@/lib/lending-math";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";
import { ui } from "./locators";

let trackedStreamId: bigint | null = null;
let trackedLoanId: bigint | null = null;
let depositedStreamIds: bigint[] = [];
let disposedFullValueStreamId: bigint | null = null;
let returnedResidualStreamId: bigint | null = null;
let ae6BurnAligned = false;
let ae6PostSettleDeplete = false;

function streamRow(page: import("@playwright/test").Page, streamId: bigint) {
  return ui(page, "UI-WATCH-WALL").getByRole("button", {
    name: new RegExp(`STREAM #${streamId.toString()}\\b`),
  });
}

async function depositTrackedStream(ptAmount = parseUnits("10", 18)) {
  const deployment = readDeployment();
  const streamId = await depositPtForStream({
    account: DEV_WALLET_ADDRESS,
    ovrflo: deployment.ovrflo,
    market: readSecondaryMarket(),
    ptToken: readSecondaryPt(),
    ptAmount,
  });
  await waitForHeldStream(DEV_WALLET_ADDRESS, streamId);
  return streamId;
}

Given("my wallet holds two deposited streams", async () => {
  const first = await depositTrackedStream(parseUnits("10", 18));
  const second = await depositTrackedStream(parseUnits("11", 18));
  depositedStreamIds = [first, second];
  trackedStreamId = second;
});

Given("my wallet holds a tracked eligible stream", async () => {
  trackedStreamId = await depositTrackedStream();
});

When("I select the first stream row", async ({ page }) => {
  await ui(page, "UI-WATCH-WALL").getByRole("button", { name: /STREAM #/ }).first().click();
});

When("I pledge the tracked stream via borrow", async () => {
  if (trackedStreamId === null) throw new Error("no tracked stream — arrange the tracked Given first");
  const deployment = readDeployment();
  const market = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  const cap = await readStreamGrossPrice({
    lending: deployment.lending,
    market,
    streamId: trackedStreamId,
    aprBps: aprMinBps,
  });
  const fifth = floorToUnit(cap / 5n);
  const targetBorrow = fifth < MIN_LIQUIDITY_AMOUNT ? MIN_LIQUIDITY_AMOUNT : fifth;
  trackedLoanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market,
    streamId: trackedStreamId,
    aprBps: aprMinBps,
    targetBorrow,
  });
});

Given("a full-value loan has settled and disposed its stream", async () => {
  const deployment = readDeployment();
  const market = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await lenderSupplyLiquidity({
    lending: deployment.lending,
    market,
    aprBps: aprMinBps,
    amount: parseUnits("40", 18),
  });
  const streamId = await depositTrackedStream(parseUnits("12", 18));
  disposedFullValueStreamId = streamId;

  let targetBorrow = await advanceToUnitAlignedGrossPrice({
    streamId,
    aprBps: aprMinBps,
  });
  ae6BurnAligned = targetBorrow !== null;
  if (targetBorrow === null) {
    targetBorrow = await readStreamGrossPrice({
      lending: deployment.lending,
      market,
      streamId,
      aprBps: aprMinBps,
    });
  }
  if (targetBorrow < MIN_LIQUIDITY_AMOUNT) {
    throw new Error(`AE6 full-value arrange: borrow target ${targetBorrow} below MIN_LIQUIDITY_AMOUNT`);
  }

  const loanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market,
    streamId,
    aprBps: aprMinBps,
    targetBorrow,
  });

  await advancePastExpiry(readSecondaryExpiry());
  await closeLoan({ account: DEV_WALLET_ADDRESS, lending: deployment.lending, loanId });

  const owner = await streamOwnerOf(streamId);
  if (owner === null) {
    ae6PostSettleDeplete = false;
    return;
  }
  const depleted = await streamIsDepleted(streamId);
  if (depleted) {
    ae6PostSettleDeplete = false;
    return;
  }
  // Residual after a non-UNIT-aligned max fill: empty the returned NFT so the
  // lens filter (remaining <= 0 / isDepleted) drops the row. Log on the ticket.
  await claimStreamMax(streamId);
  ae6PostSettleDeplete = true;
});

Given("a partial loan has settled and returned its stream", async () => {
  const deployment = readDeployment();
  const market = readSecondaryMarket();
  const { aprMinBps } = await readAprBounds(deployment.lending);
  await lenderSupplyLiquidity({
    lending: deployment.lending,
    market,
    aprBps: aprMinBps,
    amount: parseUnits("50", 18),
  });
  const streamId = await depositTrackedStream(parseUnits("10", 18));
  returnedResidualStreamId = streamId;

  const cap = await readStreamGrossPrice({
    lending: deployment.lending,
    market,
    streamId,
    aprBps: aprMinBps,
  });
  const fifth = floorToUnit(cap / 5n);
  const targetBorrow = fifth < MIN_LIQUIDITY_AMOUNT ? MIN_LIQUIDITY_AMOUNT : fifth;
  const loanId = await borrowAgainstStream({
    account: DEV_WALLET_ADDRESS,
    lending: deployment.lending,
    market,
    streamId,
    aprBps: aprMinBps,
    targetBorrow,
  });

  const latest = await publicClient.getBlock();
  const secondsRemaining = readSecondaryExpiry() - latest.timestamp;
  await advanceSeconds(Number(secondsRemaining / 2n) + 1);
  await closeLoan({ account: DEV_WALLET_ADDRESS, lending: deployment.lending, loanId });
  await waitForHeldStream(DEV_WALLET_ADDRESS, streamId);
});

When("stream lockup RPC reads are interrupted", async ({ page }) => {
  const lockupBody = readStreamLockup().toLowerCase().replace(/^0x/, "");
  await page.route(/127\.0\.0\.1:8545|localhost:8545/, async (route) => {
    const raw = route.request().postData();
    if (!raw) {
      await route.continue();
      return;
    }
    const lower = raw.toLowerCase();
    if (!lower.includes(lockupBody)) {
      await route.continue();
      return;
    }
    let id: string | number = 1;
    try {
      const parsed = JSON.parse(raw) as { id?: string | number };
      if (parsed.id !== undefined) id = parsed.id;
    } catch {
      // keep default id
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "stream lockup RPC interrupted" },
      }),
    });
  });
  // useStreams polls on READ_INTERVAL_MS (15s). Wait for the degraded panel.
  try {
    await expect(ui(page, "UI-WATCH-STREAMS-DEGRADED")).toBeVisible({ timeout: 25_000 });
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

Then("I see the two deposited streams under Streams", async ({ page }) => {
  if (depositedStreamIds.length < 2) throw new Error("two deposited streams were not arranged");
  for (const streamId of depositedStreamIds) {
    await expect(streamRow(page, streamId)).toBeVisible({ timeout: 15_000 });
  }
});

Then("I see a stream row for the tracked stream", async ({ page }) => {
  if (trackedStreamId === null) throw new Error("no tracked stream");
  await expect(streamRow(page, trackedStreamId)).toBeVisible({ timeout: 15_000 });
});

Then("the tracked stream row is pledged", async ({ page }) => {
  if (trackedStreamId === null) throw new Error("no tracked stream");
  const row = streamRow(page, trackedStreamId);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveAttribute("data-state", "pledged");
  await expect(row.getByText(/PLEDGED TO LOAN #/)).toBeVisible();
});

Then("I see a loan row for the tracked stream", async ({ page }) => {
  if (trackedLoanId === null) throw new Error("no tracked loan — pledge the stream first");
  await expect(
    ui(page, "UI-WATCH-WALL").getByRole("button", {
      name: new RegExp(`LOAN #${trackedLoanId.toString()}\\b`),
    }),
  ).toBeVisible({ timeout: 15_000 });
});

Then("the tracked stream is not double-listed", async ({ page }) => {
  if (trackedStreamId === null) throw new Error("no tracked stream");
  // Borrowed lens shows LOAN # only. A second STREAM # row here would double-list.
  await expect(streamRow(page, trackedStreamId)).toHaveCount(0);
});

Then("the stream detail is open", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-STREAM-DETAIL")).toBeVisible({ timeout: 15_000 });
});

Then("I see the HTML ledger card", async ({ page }) => {
  const card = ui(page, "UI-WATCH-LEDGER-CARD");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator(".watch-ledger-cell")).toHaveCount(24);
  await expect(card.getByText(/STREAMING|SETTLED|DEPLETED/i).first()).toBeVisible();
  await expect(card.getByText("Streamed", { exact: true })).toBeVisible();
  await expect(card.getByText("Remaining", { exact: true })).toBeVisible();
  await expect(card.getByText("Rate", { exact: true })).toBeVisible();
  await expect(card.getByText("End", { exact: true })).toBeVisible();
});

Then("the disposed full-value stream is absent from Streams", async ({ page }) => {
  if (disposedFullValueStreamId === null) throw new Error("no disposed full-value stream");
  // Lens may hide when count is zero; either no STREAMS tab or no matching row.
  const tab = ui(page, "UI-WATCH-LENS").getByRole("tab", { name: "STREAMS", exact: true });
  if ((await tab.count()) === 0) return;
  await expect(streamRow(page, disposedFullValueStreamId)).toHaveCount(0);
});

Then("the returned residual stream is present under Streams", async ({ page }) => {
  if (returnedResidualStreamId === null) throw new Error("no returned residual stream");
  await expect(streamRow(page, returnedResidualStreamId)).toBeVisible({ timeout: 15_000 });
});

Then("I see the degraded streams state", async ({ page }) => {
  await expect(ui(page, "UI-WATCH-STREAMS-DEGRADED")).toBeVisible({ timeout: 15_000 });
  await expect(ui(page, "UI-WATCH-STREAMS-DEGRADED")).toHaveAttribute("data-state", /pending|could-not-ask/);
  await expect(page.getByText(/STREAM DISCOVERY IS UNAVAILABLE|CHECKING STREAMS/i).first()).toBeVisible();
});

Then("I do not see empty-lens streams copy", async ({ page }) => {
  await expect(page.getByText(/you hold no streams/i)).toHaveCount(0);
  await expect(page.getByText(/no streams yet/i)).toHaveCount(0);
  await expect(ui(page, "UI-FIRST-RUN-SURFACE")).toHaveCount(0);
});

/** Test-only export for ticket deviation logging after the run. */
export function ae6ArrangeNotes() {
  return { ae6BurnAligned, ae6PostSettleDeplete };
}
