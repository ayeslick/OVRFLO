---
title: "E2E repay-close: hardcoded borrow amount exceeds the live stream's discount face value"
date: 2026-07-28
category: test-failures
module: web/tests/e2e
problem_type: test_failure
component: testing_framework
symptoms:
  - "Playwright timeout: waiting for locator('body').getByRole('button', { name: 'CLOSE', exact: true }).first()"
  - "repay-close.feature scenario 'Happy path — close a loan once the stream can cover it' fails on the arrange step, not the assertion"
  - "Loan card renders but only shows the ADVANCED toggle, never the CLOSE action"
  - "canCloseLoan({loan, withdrawable}) in web/lib/modal-logic.ts never becomes true because withdrawable stays pinned near ~50% of loanOutstanding(loan)"
root_cause: logic_error
resolution_type: test_fix
severity: medium
tags: [e2e-tests, playwright, stream-pricing, loan-obligation, pendle-discount, vesting, test-fixtures, sablier]
---

# E2E repay-close: hardcoded borrow amount exceeds the live stream's discount face value

## Problem

The E2E scenario "Happy path — close a loan once the stream can cover it" (`web/tests/e2e/repay-close.feature`) failed reproducibly: the CLOSE button never rendered on the loan card, even after the arrange steps advanced chain time and reloaded the page. The test's own loan-vesting arithmetic was wrong for the amount it actually borrowed on-chain, so the stream never vested enough to satisfy the close gate within the test's timeout.

## Symptoms

- Playwright timeout: `waiting for locator('body').getByRole('button', { name: 'CLOSE', exact: true }).first()` — `Test timeout of 30000ms exceeded.`
- Page snapshot at failure showed the loan card rendered correctly ("LOAN #1 @ 10.00%", "OUTSTANDING 1.95 ovrfloWSTETH") with an "ADVANCED ▸" toggle, but no CLOSE button — the component reached the loan-detail render path and simply evaluated the close condition as false.
- Failure was consistent (2/2 runs), not a flake tied to timing or network variance.

## What Didn't Work

- **Suspecting `withdrawable` staleness.** `withdrawable` in `useLoanBook` (`web/hooks/useLoanBook.ts:105-106`) comes from a direct on-chain `withdrawableAmountOf(streamId)` read via `useReadContracts`, not from the Ponder indexer, and the arrange flow already does `page.reload()` + `waitForWalletConnected` before asserting. Ruled out — the value read was always fresh.
- **Suspecting a loan/stream ID mismatch.** `useLoanBook` correctly maps each `loan.streamId` into the batched `withdrawableAmountOf` multicall (`withdrawableByLoanId`, `web/hooks/useLoanBook.ts:105-138`) and filters loans per borrower correctly. No mismatch found on inspection.
- **Suspecting `loanOutstanding` itself was buggy** (e.g. double-counting fees or interest). `loanOutstanding` (`web/lib/lending-math.ts:42-45`) is simple and correct — `obligation - (drawn + repaid)`, floored at zero. This function was not the bug; the problem was upstream, in what `obligation` got set to at loan-creation time.

## Solution

1. Added a helper to `web/tests/e2e/fixtures/chain.ts` that reads the contract's own full-borrow quote for a stream, using `OVRFLOLending.quote(market, streamId, aprBps, 0)` (per its NatSpec at `src/OVRFLOLending.sol:654`: "`borrowAmount` Principal to quote (0 = full borrow)"):

```ts
export async function readStreamGrossPrice(params: {
  lending: Address;
  market: Address;
  streamId: bigint;
  aprBps: number;
}) {
  const [grossPrice] = await publicClient.readContract({
    address: params.lending,
    abi: ovrfloLendingAbi,
    functionName: "quote",
    args: [params.market, params.streamId, params.aprBps, 0n],
  });
  return grossPrice;
}
```

2. Changed the "Given my wallet has an open loan against a stream" arrange step in `web/tests/e2e/steps/repay-close.ts` to quote the stream's actual discounted price first, then borrow a small fraction of *that* instead of a hardcoded absolute token amount:

```ts
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
```

3. Updated the stale comments in `repay-close.ts` that referenced the old "2-token obligation on a 10 PT stream" framing, which no longer matched the actual borrow sizing.

Verified by running `NEXT_PUBLIC_E2E=1 npx bddgen && NEXT_PUBLIC_E2E=1 npx playwright test tests/e2e/repay-close.feature.spec.js` against two independently fresh `bootstrap:e2e` environments (`tools/scripts/bootstrap-e2e.sh`), each live-discovering a different real Pendle market. All 5 scenarios in the spec passed consistently on both.

## Why This Works

The arrange step deposited 10 PT and then borrowed a hardcoded `targetBorrow: parseUnits("2", 18)`, on the assumption that the Sablier stream's face value tracks the 10 PT deposit amount. It doesn't. `OVRFLO._computeSplit` (`src/OVRFLO.sol:351-356`) splits a deposit into an immediate `toUser` portion and a streamed `toStream` portion using the market's live discount rate:

```solidity
function _computeSplit(uint256 ptAmount, uint256 rateE18) internal pure returns (uint256 toUser, uint256 toStream) {
    toUser = Math.mulDiv(ptAmount, rateE18, WAD);
    if (toUser > ptAmount) toUser = ptAmount;
    toStream = ptAmount - toUser;
    require(toStream > 0, "OVRFLO: nothing to stream");
}
```

`toStream` — the stream's actual face value — is only the PT *discount*, not the full deposit. Because `script/lib/discover-pendle-market.sh` live-discovers an arbitrary real market each run (see `docs/solutions/architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md`), that discount is unpredictable: in the debugged run it came out to `grossPrice ≈ 1.952` tokens — smaller than the hardcoded `targetBorrow = 2`.

`borrowAgainstStream` in `web/tests/e2e/fixtures/chain.ts:517` caps the fill at the stream's price: `const fill = grossPrice < params.targetBorrow ? grossPrice : params.targetBorrow;`. With `grossPrice (1.952) < targetBorrow (2)`, `fill` silently clamped down to `grossPrice` — turning what the test intended as a small partial borrow into an unintentional **full borrow** (`fill == grossPrice`). On-chain, `createBorrowerLoanPool` enforces the same clamp and never reverts on an oversized request (`src/OVRFLOLending.sol:555-556`: `actualBorrow = min(targetBorrow, totalAvailable); require(actualBorrow <= grossPrice, ...)`), so this trap is silent by design, not a contract bug.

That distinction matters because `StreamPricing.obligationForFill` (`src/StreamPricing.sol:140-151`) branches on exactly this condition:

```solidity
function obligationForFill(
    uint256 borrowAmount,
    uint256 grossPrice_,
    uint128 remaining,
    uint16 aprBps,
    uint256 timeToMaturity
) internal pure returns (uint128) {
    if (borrowAmount == grossPrice_) {
        return remaining;
    }
    return obligation(borrowAmount, aprBps, timeToMaturity);
}
```

On a full borrow (`borrowAmount == grossPrice_`), `obligation` is set to `remaining` — the entire remaining stream face value — not a small amount scaled off `targetBorrow`. This is correct, intentional contract behavior (a full-borrow lender is owed the whole stream — see the companion Solidity-side audit note in Related Issues below), but it broke the test's implicit assumption that its ~2-token borrow would produce a correspondingly small `loan.obligation`.

The next arrange step only advances chain time by 50% of the stream's remaining time-to-expiry, on the (previously true only under the intended partial-borrow sizing) assumption that 50%-elapsed linear vesting would comfortably exceed a small ~2-token obligation on a much larger stream. Instead, because the loan was actually a full borrow, `obligation ≈ remaining` (the whole stream), and Sablier's `withdrawableAmountOf` at 50% elapsed time is ≈50% of that same face value — nowhere near the 100% needed to satisfy `canCloseLoan`'s gate (`web/lib/modal-logic.ts:12-20`):

```ts
export function canCloseLoan({ loan, withdrawable }: {...}) {
  if (loan.closed) return false;
  return withdrawable >= loanOutstanding(loan);
}
```

This was confirmed empirically with a temporary debug read of `loans(loanId)` and `withdrawableAmountOf(streamId)` against the live fork:

```
loan.obligation  = 1952269688506934000  (~1.952269688506934 ovrfloWSTETH)
withdrawable     =  976134457542734504  (~0.976134457542734 ovrfloWSTETH)
ratio withdrawable/obligation = 0.4999998019173607
```

The obligation figure matches the "OUTSTANDING 1.95 ovrfloWSTETH" seen in the original bug report, and the ratio landing at exactly ~50% is the signature of "obligation = full stream face value, withdrawable = 50%-elapsed linear vesting of that same face value" — i.e. the full-borrow branch, not the intended partial-borrow branch.

The fix removes the false assumption entirely: by quoting `grossPrice` via the contract's own `quote(...,0n)` (the canonical full-borrow price) and borrowing a fixed *fraction* of it (`grossPrice / 5n`), `fill` is always strictly less than `grossPrice`, so `obligationForFill` can never take the full-borrow branch, regardless of which live market gets discovered or what its discount/time-to-maturity happen to be on a given run.

## Prevention

- When an E2E fixture arranges a loan/borrow against a Sablier stream backed by a live-discovered PT market (`script/lib/discover-pendle-market.sh`), never size `targetBorrow` as a hardcoded token amount. Always call `readStreamGrossPrice` (a thin wrapper over `OVRFLOLending.quote(market, streamId, aprBps, 0)`) first and derive the borrow as a fraction of that quoted price, e.g. `grossPrice / 5n`. A hardcoded absolute can silently collide with `borrowAgainstStream`'s `fill = min(grossPrice, targetBorrow)` clamp and flip a "small partial borrow" test fixture into an unintended full borrow.
- Treat `borrowAmount == grossPrice_` in `StreamPricing.obligationForFill` (`src/StreamPricing.sol:147-148`) as a hard branch boundary in any test or fixture reasoning about `loan.obligation` size — a fill that lands exactly at or is clamped to `grossPrice` sets `obligation = remaining` (the whole stream), not a value proportional to the requested amount. Any fixture-side "vest N% and expect it to cover the obligation" arithmetic must know which branch its borrow actually took, not just what `targetBorrow` was requested.
- Since `createBorrowerLoanPool` never reverts on an oversized `targetBorrow` (it clamps via `require(actualBorrow <= grossPrice, ...)` after already computing `min(targetBorrow, totalAvailable)`, `src/OVRFLOLending.sol:555-556`), fixtures cannot rely on a revert to catch this class of sizing mistake — the clamp is silent by design. Prefer asserting on the *returned* fill/obligation values in fixtures (or logging them during fixture development) rather than trusting the requested `targetBorrow` matches what was actually borrowed.
- When adding a new scenario that borrows against a live-discovered stream and later checks a time/vesting-dependent gate (like `canCloseLoan`), derive both the borrow size and the vesting wait as fractions/percentages tied to the same quoted `grossPrice`/`remaining` values, rather than mixing a fixed vest percentage with an assumption about obligation size — that mismatch is exactly what let this bug hide behind a plausible-looking comment ("vests comfortably more than a 2-token obligation on a 10 PT stream") for as long as it did.

## Related Issues

- [live-pendle-market-discovery-for-seed-and-fork-fixtures.md](../architecture-patterns/live-pendle-market-discovery-for-seed-and-fork-fixtures.md) — the systemic root driver this bug is a second downstream casualty of: `script/seed-local.sh` discovers a different live Pendle market (different discount, different time-to-maturity) on every run. That doc's "Example 5" already fixed one hardcoded assumption in this exact file (`repay-close.ts`'s time-advance step, keyed off market expiry); this doc fixes a second, independent hardcoded assumption in the same file and scenario family — the borrow amount, keyed off the stream's discount price — that discovery had not yet broken until this run turned up a market with a small enough discount. Same lesson, different downstream victim; worth reading together.
- [createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md](createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md) — a same-day sibling fix touching the identical `borrowAgainstStream()` call path in `web/tests/e2e/fixtures/chain.ts`, but a mechanistically distinct bug (a wall-clock gas-estimation race between quoting and mining, not a wrong assumption about how much to borrow). Not a duplicate; useful for distinguishing which mechanism is in play if a `repay-close` arrange step flakes or fails again.
- [repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md) — the Solidity-side audit note documenting `obligationForFill`'s full-borrow-vs-partial-borrow branches directly (§6, "Related equality: `borrowAmount == grossPrice_` in `obligationForFill`"): confirms the full-borrow branch this bug tripped is intentional, correct contract behavior, not a defect.
- [borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md](borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md) — a different same-day `async_timing` bug in the same borrow/lending E2E surface (a query-invalidation race, not a fixture-sizing mistake); grouped here mainly so a reader debugging this suite has the full family of same-day fixes in one place.
- (session history) The other two `repay-close.feature` scenarios flagged during triage as possibly sharing this bug's root cause — "the loan disappears while the modal is open" and "repay reverts if the balance is drained mid-flow" — turned out to have distinct, unrelated causes (a missing refetch interval in `useBorrowerLoans`, a missing `loan.closed` check in `RepayForm`, and a test-side synchronization gap in the balance-drain step), fixed in a separate, concurrent same-day session and already reflected in the current `repay-close.ts`. Confirmed independently here: both scenarios passed on two fresh environments once only this doc's fix was applied.
