---
title: Vary one thing before blaming your own change for a flake
date: 2026-07-29
category: best-practices
module: web/tests/e2e, debugging methodology
problem_type: best_practice
component: testing_framework
severity: high
applies_when:
  - A test suite starts failing after a change and the change looks like the obvious cause
  - Deciding whether to revert working code to make a suite go green
  - Investigating an order-dependent or intermittent E2E failure
tags: [debugging, flaky-tests, e2e, causation, controls, order-dependence]
---

# Vary one thing before blaming your own change for a flake

> **Step 2 of 2 when a suite goes red all at once.** If many unrelated scenarios
> failed together, check the failure *shape* first —
> [Uniform timeout durations are an environment signal](./uniform-timeout-durations-are-an-environment-signal.md)
> — because a broken shared dependency makes every hypothesis below moot. This
> doc applies once the failure is genuinely about code, and its reasoning is not
> limited to test suites: it governs any claim that your change caused something.

## Context

While landing unit 11 of the audit-remediation plan, the full E2E suite passed
twice **without** the new hook and failed twice **with** it. Four data points,
perfectly correlated, pointing at code written ten minutes earlier.

The next step was going to be reverting the hook. It was working code, the
finding it fixed was real, and reverting it would have made the suite green
while leaving the actual defect in place — and the actual defect had nothing to
do with the hook.

The control that was never run: **the same subset, without the change.** That
configuration also fails.

## Guidance

**Before concluding your change caused a failure, run a comparison that differs
from the failing run in exactly one variable — the change itself.**

The trap is that "passed before, fails now" *feels* like a controlled
comparison. It usually is not, because the two runs also differed in scope,
ordering, worker count, or environment state. In this case:

| Run | Scope | Change present | Result |
|-----|-------|----------------|--------|
| A | full suite | no | pass |
| B | full suite | no | pass |
| C | subset | yes | fail |
| D | subset | yes | fail |

Comparing A/B against C/D varies **two** things — the change *and* the scope.
The valid comparison is a fifth run: subset, change absent. That run fails,
which exonerates the change immediately.

**Second rule: a change can correlate with a flake without causing it.** Adding
a hook, a render, or an await perturbs timing and ordering. If a latent
order-dependency exists, that perturbation is enough to *reveal* it every time
while causing none of it. Perfect correlation across four runs is exactly what
a revealed latent bug looks like — it is not evidence of authorship.

## Why This Matters

The cost of getting this wrong is not a wasted hour; it is **reverting a
correct fix and shipping the original defect**, with a green suite as
justification. That failure is self-concealing: the revert makes the evidence
that would have contradicted it disappear.

The underlying root cause here was worth finding on its own. The
`claim-all` scenario "empty position categories render nothing" has **no
`Given`** — it asserts an *absence* and therefore depends on whatever residue
earlier scenarios left behind:

```gherkin
Scenario: Cross-cutting — empty position categories render nothing, not placeholder text
  When I expand a market I hold no positions in
  Then there is no "LENDING" position group
```

Before the fix, the step targeted the *secondary* market, so the scenario
passed only when the run order happened to leave the dev wallet clean. Any run
that put the borrow scenarios first failed it — which reads exactly like a
regression in whatever changed most recently. The fix targets the primary
market, which the dev wallet never transacts in, so the precondition holds by
construction (`web/tests/e2e/steps/common.ts:85`).

## When to Apply

- Any time the conclusion is "my change broke the suite" and the remedy is a revert
- Intermittent failures, order-dependent failures, and anything described as flaky
- When the failing configuration differs from the passing one in scope, worker
  count, or seed state — not only in code

## Examples

**The insufficient comparison:**

```bash
# passed on main
npm --prefix web run test:e2e
# fails on the branch, running only the touched feature
npx playwright test claim-all.feature
```

**The control that settles it** — same scope, change absent:

```bash
git stash && npx playwright test claim-all.feature; git stash pop
```

If that fails too, the change is exonerated and the investigation moves to the
configuration: what does this subset do that the full suite does not, and which
scenario depends on state it never established?

## Related

- [Scenarios that assert an absence need an explicit Given](../test-failures/absence-assertions-need-an-explicit-given.md) — the root cause this investigation uncovered
- [E2E shared fork requires serial workers until snapshot isolation](../architecture-patterns/e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md) — why this suite's scenarios share mutable state at all
- [E2E race fixes should sync tests, not weaken app validation](../workflow-issues/e2e-race-fixes-should-sync-tests-not-weaken-app-validation.md) — the related temptation to change the app to satisfy a test
