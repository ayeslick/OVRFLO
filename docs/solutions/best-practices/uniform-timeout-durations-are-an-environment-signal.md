---
title: Uniform timeout durations across unrelated scenarios are an environment signal
date: 2026-07-29
category: best-practices
module: web/tests/e2e
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - A large fraction of an E2E suite fails at once
  - Deciding whether a red suite is a regression or a broken shared dependency
  - Writing E2E helpers that poll an external service
tags: [e2e, playwright, diagnosis, timeouts, anvil, indexer, failure-shape]
---

# Uniform timeout durations across unrelated scenarios are an environment signal

> **Step 1 of 2 when a suite goes red all at once.** Read the failure *shape*
> first (this doc) — it tells you whether the failure is about code at all. Only
> once you have ruled out a broken shared dependency does the question "was it my
> change?" become worth asking, and that is
> [Vary one thing before blaming your own change for a flake](./vary-one-thing-before-blaming-your-own-change-for-a-flake.md).

## Context

Three separate mass-failure events during the audit-remediation run were each
initially read as a regression, and none of them was one:

1. **Anvil wedged** — the process was alive but no longer answering on 8545.
   Every scenario timed out at exactly 30s.
2. **A removed route** — unit 16 replaced the indexer's `/sql` mount. The E2E
   helper `waitForHeldStream` still posted raw SQL to `/sql/db`, got a 404, and
   **silently returned `false`**. Eight scenarios timed out.
3. **A renamed formatter** — `formatMaturity` was removed in favour of
   `formatMaturityDate`, but the fixture's row locator still built its text from
   the old caption form. Nine expand-dependent scenarios timed out at 30s each.

All three produced the same picture: a large block of red spanning features with
no application code in common.

## Guidance

**Read the *shape* of the failure before its content.**

The discriminating signal is **duration uniformity**:

| Signal | Regression | Broken shared dependency |
|---|---|---|
| Failure duration | varies; usually fast | identical, equal to the timeout constant |
| Failure message | a specific assertion | "exceeded timeout", "locator not found" |
| Spread | clusters in the changed feature | spans unrelated features |
| Traffic during the stall | normal | near-zero, or 4xx to one host |

A real regression fails **at an assertion** — quickly, with a message about the
thing that is wrong. A broken shared dependency fails by **waiting**, so the
duration is a property of the *timeout constant*, not of the code. When a dozen
scenarios all fail at exactly 30.0s, that number is coming from
`playwright.config.ts`, not from the application.

The diagnostic ladder, cheapest first:

1. Is the duration uniform and equal to the configured timeout?
2. Do the failing scenarios span features that share no application code?
3. Is there network traffic during the stall, or 4xx responses to one host?
4. Ask the shared dependency directly — `curl` the RPC, `curl` the indexer route
   — before reading any application diff.

## Why This Matters

The cost of misreading this is not the wasted debugging time; it is that the
"obvious" fix is to revert whatever landed most recently. That reverts working
code, leaves the environment still broken, and burns the evidence.

The shape signal is reliable because it is **causally upstream of the test
content**. A timeout is the absence of an answer, and absence has no
feature-specific fingerprint — which is exactly why a wedged fork, a 404, and a
stale locator all look identical from the summary line. Reading the summary line
is what makes them look like a regression; reading the durations is what
separates them.

Two corollaries fall out of cases 2 and 3, and both are worth their own habit:

**A boolean helper hides transport failures.** `waitForHeldStream` returning
`false` for "the route no longer exists" is indistinguishable from `false` for
"not indexed yet." Polling helpers must distinguish *not yet* from *cannot ask*,
and throw on the second — the same rule that applies to indexer reads in the app
itself.

**E2E fixtures couple to formatter output, so a formatter is a test-facing
API.** `readSecondaryMaturityLabel` builds a Playwright locator from the same
function the table renders with. Renaming or reshaping that function is a
breaking change to nine scenarios that no unit test can catch, because both
sides of the unit suite were updated consistently. The fixture now carries a
comment naming which function it must track and why.

## When to Apply

- Any time more than a couple of E2E scenarios fail together
- After changing an API route, an env var, or a shared formatter — expect fixture
  desync and check it deliberately rather than waiting for the suite to tell you
- Before concluding "mass regression" from a summary line

## Examples

**The shape that says "environment", not "regression":**

```
9 failed
  claim-all.feature:12  › … ── Test timeout of 30000ms exceeded.
  borrow.feature:31     › … ── Test timeout of 30000ms exceeded.
  repay.feature:8       › … ── Test timeout of 30000ms exceeded.
```

Three unrelated features, one duration, and that duration is the config value.

**Check the dependency before the diff:**

```bash
cast block-number --rpc-url http://127.0.0.1:8545
```

A hang here — rather than an error — is the wedged-process case: the port
accepts the connection and never answers, which is why the process looks alive.

## Related

- [Vary one thing before blaming your own change for a flake](./vary-one-thing-before-blaming-your-own-change-for-a-flake.md) — the same discipline where the suspect is a code change rather than the environment
- [E2E shared fork requires serial workers until snapshot isolation](../architecture-patterns/e2e-shared-fork-requires-serial-workers-until-snapshot-isolation.md) — why one shared environment backs the whole suite
- [Stream discovery is a candidate set, not an authority](../security-issues/indexer-is-a-discovery-hint-not-an-authority.md) — the "empty is not cannot-ask" rule, applied in the app rather than the fixtures
