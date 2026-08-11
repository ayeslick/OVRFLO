---
title: Uncheatable-test discipline — discriminating boundaries, no tautologies, liveness gates, mutation as the verifier
date: 2026-08-10
category: best-practices
module: test/ (all suites), especially invariant and boundary tests
problem_type: best_practice
component: test-integrity
severity: critical
applies_when:
  - Writing any test meant to guard a money path or a rounding boundary
  - Writing or reviewing an invariant suite
  - Deciding whether a test suite is "done"
  - Citing a test as evidence that a guard is covered
tags: [test-integrity, mutation-testing, invariants, boundaries, tautology, liveness]
---

# Uncheatable-test discipline — discriminating boundaries, no tautologies, liveness gates, mutation as the verifier

## Context

The v1-lite buildout's central test-quality lesson, assembled from the U3
review, the U6 mutation campaign, and the fizz property work: **a test that
would pass against a subtly wrong implementation is a defect.** Each rule below
was paid for by a concrete instance.

## The rules

**1. Boundary tests must sit at the discriminating distance.** A test at the
wrong distance from a boundary proves nothing. U3's review moved the flooring
test to the true `UNIT-1` boundary and made the `minAcceptable` test compare
net-of-fee (the quantity the contract actually compares) — the original forms
passed both the correct and several wrong implementations. Rounding-direction
claims additionally need a concrete non-aligned fixture: the U6-era case where
a max borrow's non-UNIT-aligned `grossPrice` must yield strictly
`obligation < remaining` (the safe direction) — the general `≤` property
cannot distinguish a flipped rounding mode; the concrete case can.

**2. No assertion may mirror the implementation or itself.** The U6 campaign
found the suite's dust bound was tautological — it followed from an identity
asserted one line above and read no contract state. Assert against
independently tracked ghosts or hand-derived literals (the review added a
handler-side obligation recompute with a hand-derived expected value). The
same discipline holds in fizz properties: monotone quantities are asserted as
monotone (never equality), and every ghost must be read by at least one
assertion or it is decoration.

**3. Coverage without liveness is vacuous.** U6's original suite passed every
named invariant while full 500×40 campaigns completed **zero claims** — the
coverage gate was satisfied by the deterministic baseline alone, so the
claim-path invariants were true vacuously. The fix: mandatory liveness gates
(each campaign must execute claim/repay/close/withdraw at least once),
`*FromFuzz` gating counters, a reverted-but-reported counter with decoded
revert selectors, and selector-weight rebalancing. An invariant suite's
first-class output is *what actually ran*, not just what held.

**4. A citation to a test is a claim that must be verified.** The x-ray
disposition table said `setAprBounds`/`setFee`/`setTreasury` guards were
"covered by" tests that did not exist — three false citations that nearly
defeated the review. Citation-forcing (open the cited test, watch it fail
under the mutation) is the only reliable check.

**5. Mutation campaigns are how you review a test suite.** The U6 suite —
reviewed, green, coverage-clean — killed only 6 of 13 designed mutants; it was
strong on conserved quantities and blind on *who receives money* and on
liveness. A test-only commit's product IS the safety net, so the adversarial
lens (mutants designed by a judge, executed by a runner) is the appropriate
review depth — a security pass over unchanged production code would have found
nothing. The mutation-proven crown example: replacing claim's
`min(withdrawable, outstanding)` clamp with bare `withdrawable` paid the first
claimer 12.24 instead of 6.12 — caught only by the post-campaign
money-recipient invariant.

## Remediation tier (per the 2026-08-10 hierarchy)

These are tier-3 rules by nature (they define what "detected" must mean), with
a tier-4 enforcement surface (review checklist + the coding standard). The
meta-rule — suites are verified by mutation, not by reading — is what keeps
tier-3 honest. Where a stronger tier exists for the underlying property (e.g.
frozen-history by design), the tests remain as evidence, per the hierarchy's
guardrail.

## See also

- `.scratch/lending-v1-lite/issues/06-invariant-suite.md` — the full applied review batch.
- `docs/solutions/patterns/ovrflo-critical-patterns.md` #6 (all-party balance assertions).
