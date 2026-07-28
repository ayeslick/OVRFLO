---
title: "E2E race fixes should synchronize the test, not weaken the app's own validation"
date: 2026-07-28
category: workflow-issues
module: web/tests/e2e
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "An E2E scenario injects an out-of-band chain mutation (a fixture-direct viem call bypassing the UI) between two app-observable actions, and the target UI element ends up permanently disabled or hung instead of reaching the state the scenario is meant to exercise"
  - "The tempting fix is to remove or loosen a client-side validation/disable check in the app so the test's target action becomes reachable"
  - "A very similar out-of-band-mutation race has already been diagnosed and fixed elsewhere in the same codebase or session"
tags: [e2e, playwright, race-condition, test-vs-app-fix, wagmi, refetch, precedent]
related_components: ["web/components/ActionModal.tsx", "web/hooks/useBorrowerLoans.ts", "web/tests/e2e/steps/repay-close.ts", "web/tests/e2e/steps/borrow.ts"]
---

# E2E race fixes should synchronize the test, not weaken the app's own validation

## Context

While fixing `repay-close.feature`'s "Error state — repay reverts if the balance is drained
mid-flow" scenario, the REPAY button was found to be permanently disabled after the fixture drained
the wallet's ovrfloToken balance mid-flow — the app's `validationError` check
(`web/components/ActionModal.tsx:1468`, `INSUFFICIENT BALANCE`) was accurately reflecting the now-
true insufficient balance, and correctly refusing to let the user submit a doomed transaction.

The first fix removed `validationError` from `RepayForm`'s `disabled` gate entirely
(`web/components/ActionModal.tsx:1470`, at the time), letting the REPAY button submit regardless of
known-insufficient balance and deferring to the contract's on-chain revert instead. This made the
target scenario pass and did not regress any other scenario in the file — it looked, superficially,
like a correct and complete fix.

It wasn't the right fix. `docs/solutions/test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md`,
written earlier in the *same session*, diagnosed the structurally identical bug for
`borrow.feature`'s stale-liquidity scenario — an out-of-band fixture mutation (there, a lender
withdrawing liquidity) racing an approve-tx's own `invalidateAllOnChainReads` refetch, landing on
the disable gate before the scenario's target action could fire. That doc's own conclusion:
*"The disabled gate in `ActionModal.tsx` was behaving exactly as designed given the data it had;
the defect was that the test let an incidental background read discover the staleness first"* — and
its fix was made entirely in the test (`web/tests/e2e/steps/borrow.ts`: wait for the target button
to be observably enabled before injecting the mutation), explicitly preserving `BorrowForm`'s
disable gate as correct, production-worthy behavior.

The repay-close fix took the opposite path on an identical bug shape, discovered only because the
user, prompted to compound the session's learnings, asked for the reasoning to be checked against
what the session had already established — surfacing the inconsistency before it was written up as
if it were the obvious answer.

## Guidance

When an E2E scenario's target UI element is unreachable (disabled, hidden, timed out) because of an
out-of-band fixture mutation racing the app's own async read/refetch cycle:

1. **First ask whether the disable/validation is behaving correctly given the data it has.** If a
   real balance, liquidity check, or similar guard is accurately blocking a doomed submission, that
   is very likely intentional, production-worthy behavior — not a bug to "fix" by loosening it.
2. **Search for precedent before picking a fix.** The same race shape (fixture mutation racing an
   `invalidateAllOnChainReads`-triggered refetch) is generic to this codebase's whole write-flow
   architecture, not scenario-specific — `grep`/search `docs/solutions/` for prior E2E-race fixes in
   the same test suite before deciding where the fix belongs.
3. **Prefer synchronizing the test** over changing app behavior: wait for an app-observable signal
   (a button becoming enabled, specific text appearing) that represents "the app's prior async
   effects have already settled," *then* inject the out-of-band mutation. This is what
   `web/tests/e2e/steps/borrow.ts`'s `"the posted liquidity is withdrawn by the lender"` step does.
4. **Verify a fix doesn't just relocate the failure.** Fixing one scenario's race can leave a
   sibling scenario — especially one sharing the same Gherkin step definition — still racy in the
   opposite direction. `repay-close.feature`'s `"my ovrfloToken balance is drained"` step is used by
   both the target scenario and `"Error state — repay blocked by insufficient ovrfloToken balance"`;
   after switching the fix to test-synchronization, that *other* scenario started failing
   deterministically — it had its own, previously-latent race (the balance read's very first mount
   fetch beating the drain transaction to land on-chain) that had simply never been exercised
   under this exact timing before. Re-running the *whole* affected feature file, not just the
   scenario being worked on, is what surfaced this.
5. **Weakening app validation to make a test pass is a last resort**, appropriate only when the
   validation itself was actually wrong (stale-favorable *and* stale-unfavorable in ways that make
   it worse than no client-side check at all) — not merely inconvenient for one test's timing.

## Why This Matters

An app's client-side validation exists to protect real users from submitting transactions that are
already known to fail — wasted gas, confusing errors, worse UX than a clear pre-submit caption.
Removing that protection to satisfy a test's synchronization gap trades real production safety for
test-suite convenience, and does so silently: the test suite goes green, but the deployed app is
measurably worse for it. The fix is cheap to get right (a few lines in a test step) and expensive to
get wrong quietly, since nothing in CI distinguishes "the validation was genuinely wrong" from "the
validation was fine and the test just couldn't reach past it."

This also compounds: once one E2E-race scenario in a suite is fixed by weakening app validation,
it sets an inconsistent precedent that makes the *next* similar-looking bug harder to diagnose
correctly — a future session might reasonably assume "we handle this class of race by relaxing
app-side gates," when the established, deliberate answer in this codebase is the opposite.

## When to Apply

- Diagnosing any E2E scenario where a fixture-direct chain mutation (bypassing the UI) is staged
  between two UI-observable steps, and the target action becomes unreachable.
- Before finalizing a fix that changes an app component's `disabled`/validation logic in response to
  an E2E test failure — check whether the underlying guard was actually behaving correctly.
- After landing any race fix touching a Gherkin step shared across multiple scenarios — re-run the
  whole feature file (not just the target scenario) to catch a sibling scenario that depended on the
  old, unfixed timing.

## Examples

Before (repay-close, first attempt — wrong):

```ts
// web/components/ActionModal.tsx — RepayForm
const disabled = !market.lending || !loan || repayAmount === 0n || busy;
// validationError computed but no longer blocks submission
```

After (repay-close, corrected — matches borrow.feature precedent):

```ts
// web/components/ActionModal.tsx — RepayForm: validation restored, unchanged from before the bug
const disabled =
  !market.lending || !loan || repayAmount === 0n || busy || Boolean(validationError);
```

```ts
// web/tests/e2e/steps/repay-close.ts — the fix moved here instead
When("my ovrfloToken balance is drained", async ({ page }) => {
  const deployment = readDeployment();
  const amountFilled = (await page.locator("input.input").first().inputValue()) !== "";
  if (amountFilled) {
    // Mirrors borrow.ts's "the posted liquidity is withdrawn by the lender": wait for the
    // approve-tx's own invalidateAllOnChainReads refetch to settle before injecting the
    // out-of-band mutation, instead of racing it.
    await expect(page.getByRole("dialog").getByRole("button", { name: /^REPAY /}).first()).toBeEnabled();
  }
  await drainTokenBalance(deployment.token, DEV_WALLET_ADDRESS);
});
```

The sibling scenario's own latent race (surfaced by re-running the full suite after the above
change) needed a distinct fix — not test synchronization, since nothing was in flight to
synchronize against, but polling the read itself so it eventually notices the drain regardless of
mount-timing luck. See
[RepayForm's loan and balance reads never refetch without polling](../ui-bugs/repayform-loan-and-balance-reads-never-refetch-without-polling.md)
for that half of the fix.

## Related

- [Borrow-form stale-liquidity E2E scenario races the approve-tx's own invalidateAllOnChainReads refetch](../test-failures/borrow-stale-liquidity-e2e-fixture-races-approve-invalidation-refetch.md) —
  the precedent this doc is built on; read it first for the full mechanics of the race shape.
- [RepayForm's loan and balance reads never refetch without polling](../ui-bugs/repayform-loan-and-balance-reads-never-refetch-without-polling.md) —
  the concrete bug fixes from the same investigation, including the sibling scenario's latent race.
