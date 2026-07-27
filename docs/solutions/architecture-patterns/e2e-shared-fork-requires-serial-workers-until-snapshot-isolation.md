---
title: E2E against a shared local fork needs serial workers until snapshot/revert isolation is proven
date: 2026-07-27
category: architecture-patterns
module: web/tests/e2e
problem_type: architecture_pattern
component: testing_framework
severity: medium
applies_when:
  - "Writing E2E tests that exercise real on-chain state against one shared local blockchain fork (Anvil, Hardhat node, etc.), rather than a fresh instance per test"
  - "Adopting Playwright (or any E2E runner) for a codebase whose only prior test tiers were unit tests against mocked I/O"
tags: [playwright, playwright-bdd, e2e, anvil, test-isolation, ci-deferral]
---

# E2E against a shared local fork needs serial workers until snapshot/revert isolation is proven

## Context

Ticket 01 of the frontend test suite plan (`docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md`)
added Playwright + `playwright-bdd` tooling for Gherkin E2E tests that will run against one seeded local Anvil
fork (`bootstrap:local`), not a mocked RPC layer. The plan's own KTD7 anticipated per-scenario isolation via
`evm_snapshot`/`evm_revert` (a `fork-snapshot.ts` fixture, built in a later ticket) but explicitly allowed a
`workers: 1` fallback if that fixture proved awkward to wire correctly.

The config-only ticket (no scenarios, no fixtures yet) still had to pick a real default for
`playwright.config.ts` — and a naive `fullyParallel: true` (Playwright's own default posture, and what a
generic scaffold or `npm init playwright` would produce) directly contradicts the isolation story the ticket's
own README was already documenting.

## Guidance

When the E2E target is one shared, stateful backend (a blockchain fork, a shared database, a shared queue) and
per-test isolation is *planned but not yet built*, default the runner to serial execution now and revisit later
— don't ship the parallel default speculatively ahead of the isolation mechanism that would make it safe.

Concretely, for this repo: `web/playwright.config.ts` sets `workers: 1` and omits `fullyParallel`, with a
comment pointing at the `fork-snapshot.ts` fixture that is expected to unlock parallelism once built and proven.
The same principle should hold when writing that fixture later: keep `workers: 1` until snapshot/revert has
actually run under real parallel workers and been shown not to race.

This generalizes past this one config file:
- Don't configure a capability (parallelism, retries, caching) around an isolation/consistency mechanism that
  is still a TODO. Configure for the mechanism that exists today; upgrade the config in the same change that
  ships the mechanism.
- A one-line code comment citing the fixture/ticket that will unlock the stricter default (`workers: 1` here)
  keeps the "why" attached to the config, so a future reader doesn't need to reverse-engineer it from a
  standalone rationale doc.

A related, smaller instance of the same "don't get ahead of what exists" principle showed up in the same
ticket: the initial config also branched `forbidOnly`/`retries` on `process.env.CI`, even though the repo's own
README (and KTD8 in the plan) states plainly that no CI workflow exists yet for this suite. Speculative
CI-conditional branches for a CI that isn't wired are the same category of premature configuration as
speculative parallelism — remove both until the thing they condition on is real.

## Why This Matters

A parallel-by-default E2E config against shared mutable chain state doesn't fail loudly in a way that points at
the real cause — it produces flaky, hard-to-reproduce cross-scenario contamination (one scenario's borrow
changes the liquidity another scenario expected) that looks like a business-logic bug in the app under test,
not a test-runner configuration mistake. Diagnosing that after the fact costs far more than picking the
conservative default up front, especially since the failure mode only appears once enough scenarios exist to
actually overlap in time — exactly the point at which a team is least likely to suspect the runner config.

## When to Apply

- Any new E2E/integration test tier being added against a backend that is a single shared stateful instance,
  where per-test isolation (a snapshot/revert fixture, a per-test schema, a per-test namespace) is planned but
  not yet implemented.
- Revisit the serial default only after the isolation fixture is built *and* has been run under real parallel
  workers without observed cross-scenario races — not on the assumption that it will work.

## Examples

```ts
// web/playwright.config.ts — the config shipped in Ticket 01
export default defineConfig({
  testDir,
  // KTD7: every journey mutates the one shared seeded fork. Serial workers
  // is the documented fallback until fork-snapshot.ts proves per-scenario
  // isolation reliable under real parallelism (see tests/e2e/README.md).
  workers: 1,
  reporter: "list",
  use: {
    // KTD8/R2: no CI exists yet, so this has no CI-conditional branches
    // (forbidOnly, retries) — add them if/when CI wiring actually lands.
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

## Related

- `docs/plans/2026-07-23-002-test-web-frontend-test-suite-plan.md` — KTD7 (fork-snapshot isolation), KTD8 (CI
  wiring deferral)
- `.scratch/web-frontend-test-suite/issues/01-test-infrastructure.md` — the ticket this pattern was extracted
  from
- `.scratch/web-frontend-test-suite/issues/05-playwright-e2e-gherkin.md` — where `fork-snapshot.ts` gets built;
  the fallback-to-`workers: 1` decision this doc describes is that ticket's explicit contingency plan
