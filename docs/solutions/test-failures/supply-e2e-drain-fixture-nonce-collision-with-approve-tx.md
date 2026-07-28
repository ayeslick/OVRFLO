---
title: "supply.feature's drain-balance fixture races the APPROVE tx's own nonce, sticking SUPPLY disabled"
date: 2026-07-28
category: test-failures
module: web/tests/e2e/fixtures/chain.ts
problem_type: test_failure
component: testing_framework
symptoms:
  - "web/tests/e2e/supply.feature's \"Error state — transaction reverts\" scenario intermittently times out instead of reaching the expected mapped-error assertion"
  - "The SUPPLY button in ActionModal.tsx's SupplyForm stays permanently disabled for the rest of the 30-second test timeout, so the doomed supply tx never submits and never visibly reverts"
  - "During a live reproduction, browser network-request inspection showed essentially zero on-chain RPC calls for a long stretch of the test, indicating the APPROVE transaction itself never completed rather than a completed transaction's balance read merely being stale"
  - "eth_getTransactionCount(account, \"latest\") vs eth_getTransactionCount(account, \"pending\") for the dev wallet mismatched exactly when the failure occurred, showing a pending tx orphaned by a nonce collision"
  - "A plain unrelated cast send on the same account confirmed in well under half a second, ruling out general Anvil slowness as the cause"
root_cause: async_timing
resolution_type: test_fix
severity: medium
tags: [e2e, playwright, nonce-collision, race-condition, anvil, viem, wagmi, fixture-vs-ui-write]
related_components: [web/tests/e2e/steps/supply.ts, web/components/ActionModal.tsx, "web/tests/e2e/fixtures/chain.ts (drainTokenBalance, used by both supply.feature and repay-close.feature)"]
---

# supply.feature's drain-balance fixture races the APPROVE tx's own nonce, sticking SUPPLY disabled

## Problem

`web/tests/e2e/supply.feature`'s "Error state — transaction reverts" scenario intermittently left the SUPPLY button permanently disabled for the entire 30-second Playwright test timeout, instead of staying enabled long enough to submit a doomed transaction that would then genuinely revert on-chain. The root cause was a nonce collision between two independent viem clients writing from the same account (the connected mock wallet's dev address) nearly simultaneously — one from the browser's UI-driven APPROVE click, one from the Playwright test process's own out-of-band balance-drain fixture call.

## Symptoms

- The scenario's final steps — click "APPROVE", drain the wstETH balance out from under the pending form, then click the SUPPLY-matching button — intermittently hung with the SUPPLY button stuck disabled for the full 30-second Playwright timeout instead of re-enabling once the doomed transaction reverted.
- Failure was non-deterministic: the same scenario passed cleanly on some runs and hung on others, with no application-level error ever surfacing in the UI.
- Live reproduction showed essentially zero on-chain RPC traffic during the stretch the button stayed disabled — not the pattern you'd expect from a stale read (a stale read still implies some earlier request succeeded and just isn't being refetched).

## What Didn't Work

1. **Assumed it was a stale-read/staleness bug**, the same general class as other confirmed issues in this e2e suite this session (Ponder-indexed data or a cached `balanceOf` read never refetching after an out-of-band fixture write). Read `web/components/ActionModal.tsx`'s `SupplyForm` to check the actual disabled condition, and inspected the browser's own network requests during a live reproduction of the failure. Found essentially zero on-chain RPC traffic for the entire multi-second stretch the button stayed disabled — which contradicts the stale-read theory (a stale read still means some earlier request succeeded and just isn't being re-fetched; here almost nothing was happening at all) and instead points at a transaction that never actually completed.

2. **Suspected the shared Anvil fork itself was simply slow** — a long-lived local fork process, having accumulated a large transaction history over a long testing session, might have degraded. Ran a plain, unrelated `cast send` transaction against the same dev-wallet account outside the test and timed it: confirmed in well under half a second. This ruled out general node/RPC slowness as the explanation for a transaction stuck pending for the test's entire 30-second timeout.

3. **Confirmed the actual mechanism directly**: compared `eth_getTransactionCount(account, "latest")` against `eth_getTransactionCount(account, "pending")` for the dev wallet mid-failure and found them mismatched — a real pending transaction sitting unconfirmed in the mempool, orphaned by a nonce collision with the fixture's own out-of-band write, exactly matching the race-condition hypothesis.

## Solution

Two layers, both applied.

**Layer 1 — a generic safety net in the shared fixture helper.** `web/tests/e2e/fixtures/chain.ts` adds a `waitForNoncesToSettle` function (lines 203-213):

```ts
async function waitForNoncesToSettle(account: Address) {
  for (let i = 0; i < 50; i++) {
    const [latest, pending] = await Promise.all([
      rpcCall<string>("eth_getTransactionCount", [account, "latest"]),
      rpcCall<string>("eth_getTransactionCount", [account, "pending"]),
    ]);
    if (latest === pending) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitForNoncesToSettle(${account}): pending nonce never caught up to latest`);
}
```

It's called at the top of `drainTokenBalance` (lines 227-228):

```ts
export async function drainTokenBalance(token: Address, account: Address) {
  await waitForNoncesToSettle(account);
  const balance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  ...
```

This protects every caller of the shared helper — both `supply.feature`'s wstETH drain and `repay-close.feature`'s ovrfloToken drain (`drainUnderlyingBalance` at line 246-248 is a thin wrapper around it) — not just this one scenario.

**Layer 2 — a more targeted, higher-confidence fix in `web/tests/e2e/steps/supply.ts`** for the "my wstETH balance is drained" step specifically. The full current file (19 lines):

```ts
import { expect } from "@playwright/test";
import { drainUnderlyingBalance } from "../fixtures/chain";
import { When } from "../fixtures/bdd";
import { DEV_WALLET_ADDRESS } from "../fixtures/mock-wallet";

// Must wait for the just-clicked APPROVE to actually be mined before draining:
// this drains the same account (DEV_WALLET) that the still-in-flight APPROVE
// tx was signed from, via a *separate* client outside the browser. Racing the
// two risks a nonce collision — Playwright resolves the APPROVE click as soon
// as the DOM interaction completes, well before the tx reaches the mempool,
// so a fixed delay or a nonce-parity check alone can still land before the
// browser's tx is submitted. Waiting for the app's own "CONFIRMING" caption
// (`.status-warning`, ActionModal.tsx's ApproveTxState) to clear ties this to
// the real on-chain event instead of a guessed timing window.
When("my wstETH balance is drained", async ({ page }) => {
  await expect(page.locator(".status-warning")).toHaveCount(0, { timeout: 15_000 });
  await drainUnderlyingBalance(DEV_WALLET_ADDRESS);
});
```

Rather than relying purely on the nonce-parity poll, the step waits for the app's own UI signal that APPROVE actually confirmed: polling for the `.status-warning` CSS class (used by `ActionModal.tsx`'s `ApproveTxState` component to render "SIGNING"/"CONFIRMING …") to disappear from the page, with a 15-second timeout, before calling the drain fixture at all. This ties the wait to a real, observable on-chain event — the app itself only stops rendering that class once its own `useWaitForTransactionReceipt` hook confirms the receipt.

## Why This Works

The e2e suite's `Given`/`When` steps arrange on-chain state directly via a separate viem `WalletClient` (never through the UI) — a deliberate architectural choice documented in `web/tests/e2e/README.md` and in `chain.ts`'s own header comment (lines 1-7):

> "Given" steps arrange on-chain state directly via viem (never through the UI) so preconditions are fast and deterministic; "When"/"Then" steps drive the real app. This is the standard BDD arrange/act split, not a shortcut — it also sidesteps a real limitation: the E2E mock connector only ever signs as one address (KTD6's dev wallet), so lender-side state (someone else's supplied liquidity) can never be arranged by clicking through the UI as the connected persona in the first place.

That split is exactly what creates the hazard here: clicking "APPROVE" in the UI submits a real transaction via the browser's own wagmi/mock-connector write path, signed by the same dev-wallet address the fixture's own drain call also signs from. Playwright resolves a `.click()` call as soon as the DOM interaction completes — not once the resulting transaction is mined, or even once it's been broadcast to the mempool. So the very next step, "my wstETH balance is drained" (`drainTokenBalance`), can attempt to compute and submit its own transaction before the browser's APPROVE transaction has actually reached the mempool, racing both transactions for the same nonce. Whichever wins the race gets mined; the loser sits in the mempool forever (Anvil doesn't reject or replace it), and since the app's UI logic is driving off that loser transaction's never-arriving receipt, the SUPPLY button (or, in the losing case, whatever state depends on APPROVE completing) never re-enables — hence the 30-second hang.

The precise, most valuable distinction in this fix is *why nonce-parity polling alone is insufficient*, even though it looks like it should close the race. `waitForNoncesToSettle` observes `eth_getTransactionCount(account, "latest")` vs `"pending"` and returns as soon as they match. But "no pending tx yet" is not the same guarantee as "the browser's APPROVE tx has been submitted and mined" — it's a check-then-act gap: the poll can observe nonce parity in the instant *before* the browser's transaction has been constructed, signed, and broadcast (all of which happens asynchronously inside the browser's own wagmi/viem stack, off of Playwright's control flow entirely), then the drain fixture proceeds to submit its own transaction using that "clear" nonce, and only afterward does the browser's transaction arrive and collide with it. Nonce-parity polling can only tell you the mempool is clear *at the instant you looked* — it cannot tell you nothing is about to land. Waiting for the app's own `.status-warning` class to disappear closes this gap because it's not polling a proxy signal; it's the direct output of the app's own `useWaitForTransactionReceipt` hook, which by construction cannot report "confirmed" before the transaction actually has a receipt. There is no window in which that signal clears before the real on-chain event has already happened, so it eliminates the check-then-act race in a way a polled precondition never fully can.

## Prevention

Any e2e fixture step that mutates on-chain state for an account whose own in-flight UI transaction might not have confirmed yet should wait on an observable app-level confirmation signal (a UI state that is provably downstream of a mined receipt, e.g. a `useWaitForTransactionReceipt`-driven CSS class or text change), not just a nonce-parity poll — nonce-parity polling has an unavoidable check-then-act gap between "no pending tx observed" and "no pending tx incoming." Nonce-parity polling remains valuable as a generic, cheap safety net at the shared-helper level (as `waitForNoncesToSettle` inside `drainTokenBalance` now is) precisely because it's a broad backstop, not because it's sufficient on its own for every caller.

As a review heuristic: grep e2e step files (`web/tests/e2e/steps/*.ts`) for fixture-direct writes (any `chain.ts` helper that submits a transaction, e.g. `drainTokenBalance`, `drainUnderlyingBalance`, `withdrawLiquidity`, `claimStreamMax`, `repayLoanFully`) that immediately follow a UI click step for the *same account* the fixture write targets, without an intervening explicit wait on an app-rendered confirmation signal. Any such sequence is a candidate for the same class of intermittent hang this fix resolved.

## Related Issues

- `docs/solutions/test-failures/createborrowerloanpool-gas-estimation-race-flakes-e2e-suite.md` — a different bug in the same file (`chain.ts`) and the same broad family of "e2e fixture arrange helper needs to account for real wall-clock drift vs. a live local chain" races. Its own Prevention section already name-checks `waitForNoncesToSettle`/`drainTokenBalance` as a "related but distinct race... from an earlier same-day session" — this doc is the concrete writeup that reference was pointing at. Distinct root cause (gas-estimation/quote drift causing an out-of-gas revert, not a nonce collision); cross-reference, don't merge.
- `docs/solutions/test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md` — same general shape (a fixture-direct, out-of-band viem call racing an in-flight UI-driven wagmi write on the same dev-wallet account, leaving a UI element stuck), but a different mechanism: that race is against the app's own `invalidateAllOnChainReads` refetch (query staleness), not a nonce collision. The fix pattern is structurally identical to this doc's Layer 2: wait for an app-observable UI signal (there: the BORROW button becomes enabled; here: `.status-warning` clears) before injecting the out-of-band mutation.
- `docs/solutions/workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md` — states the general prevention principle this fix's Layer 2 follows: synchronize the test on an app-observable signal rather than racing blind or weakening app validation. This doc's `.status-warning` wait in `supply.ts` is a third instance of that same pattern, alongside `repay-close.ts` and `borrow.ts`.
