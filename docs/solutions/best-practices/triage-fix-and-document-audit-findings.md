---
title: Triage audit findings by trust boundary, then fix test-first and sync pattern docs
category: best-practices
module: src/
date: 2026-07-05
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - "Triaging findings from a code review or audit and deciding which to fix vs reject"
  - "Implementing fixes for accepted audit findings across core contracts"
  - "Ensuring each accepted finding gets test coverage for the fixed branch arm before closing it"
  - "Updating pattern documentation (ovrflo-critical-patterns.md) to encode newly enforced invariants"
  - "Running an audit fix campaign end-to-end: triage, decide fix vs reject, implement, test, document"
resolution_type: code_fix
tags: [audit, audit-fix-campaign, triage, test-coverage, pattern-documentation, solidity, foundry, ovrflo]
---

# Triage audit findings by trust boundary, then fix test-first and sync pattern docs

## Context

Between July 1 and July 5, 2026, the OVRFLO project ran a systematic campaign
against five audit findings (M-01, M-02, M-03, L-01, L-02) spanning the
secondary market (`OVRFLOBook`) and the vault (`OVRFLO`). The findings ranged
from Medium (stranded minority contributors in shared-pool claims, gross-vs-net
slippage, stale oracle reads at runtime) to Low (missing input validation in a
view quote, non-grid-aligned APR bounds). Each one was evaluated against the
project's existing trust boundary stance, then either accepted with a fix or
rejected with rationale.

The friction this campaign resolved was not "we have bugs to fix" — it was "we
have a repeatable method for deciding what is a bug, what is a feature, and how
to land a fix without regressing the patterns doc." A DeFi protocol with a
timelocked multisig admin surface gets audited repeatedly, and each auditor
re-raises findings that either (a) duplicate a check the multisig already
performs, or (b) describe a real value-loss path. Without a triage rule and a
fix discipline, the first class gets merged as defensive code that bloats the
contract, and the second class gets fixed in a way that drifts the patterns
doc out of sync with the code.

## Guidance

**Triage by trust boundary first.** The project's stance is "prefer off-chain
multisig verification over redundant on-chain checks." Before writing any fix,
classify each finding: does it protect against real value loss at runtime
(accept), or does it propose an on-chain guard for something the multisig
already validates (reject with rationale)? All five findings in this campaign
fell on the accept side because each protected a runtime value path — a
contributor stranded in a shrinking pot, a borrower slippage-checked on the
gross amount, a stale oracle feeding deposit and flash-loan math, a view
function with no input bounds, and admin-set bounds that could break the APR
grid. Findings that would have duplicated multisig intent (e.g., R-02's
rejected `to = address(0)` guard on `sweepExcessPt`) were rejected and recorded
in the companion practice
[record-rejected-findings-with-rationale](./record-rejected-findings-with-rationale.md).

**Fix test-first.** For each accepted finding, write the test that proves the
bug and locks the post-fix behavior before the fix is committed. The test is
the spec: it states the invariant the fix must establish. Five fixes produced
tests like `test_ClaimPoolShare_NoProRataCap`, `test_Deposit_RevertsWhenOracleStale`,
and `test_Quote_RevertsForZeroPrice` — each named for the property it locks,
not the function it calls.

**Document intentional asymmetry in the test.** When a fix deliberately does
NOT do something a reviewer expects, lock that decision with a test and a
comment. The oracle freshness fix checks `oldestObservationSatisfied` but
deliberately omits `increaseCardinalityRequired`, because cardinality is an
onboarding concern handled once by `addMarket`, not a runtime concern. A test
named `test_Deposit_SucceedsWithCardinalityRequiredButOldestSatisfied` encodes
that asymmetry so a future auditor cannot "fix" it without breaking a test.

**Sync the patterns doc when behavior changes.** When a fix changes an
enforceable rule, update `ovrflo-critical-patterns.md` in the same campaign.
Pattern #12 was rewritten from "pro-rata cap on shared-pool claims" to "cap at
`min(remaining, poolProceeds)`" with the WRONG/RIGHT code blocks swapped to
match the new contract behavior. A patterns doc that describes the old
behavior is worse than no doc — it teaches reviewers to flag correct code.

## Why This Matters

The cost of getting triage wrong is asymmetric. Accepting a finding that
duplicates the multisig adds gas, adds code surface, and sets a precedent that
every future auditor's "defensive check" suggestion should land — the contract
bloats and the trust boundary blurs. Rejecting a finding that protects a real
value path ships a fund-loss bug. The trust-boundary rule makes the call
mechanical: runtime value path → accept; multisig-validated intent → reject.

The test-first discipline matters because audit fixes are high-stakes edits to
value-routing code. A fix that "looks right" but does not have a test asserting
the new invariant can be silently reverted by the next refactor. The test is
the only artifact that survives refactors and reviewer turnover. Naming the
test for the property (not the function) makes the invariant legible to someone
reading the test list without opening the body.

Pattern-doc sync matters because the patterns doc is the canonical source a
reviewer consults before re-raising a finding. If pattern #12 still described
the pro-rata cap after the fix, a reviewer reading the contract would see
`min(remaining, poolProceeds)`, consult the doc, find a mismatch, and re-raise
the (now-correct) code as a bug. Keeping the doc in the same campaign as the
fix closes that loop.

## When to Apply

- After any audit or code review that produces findings, before any fix lands:
  classify each by trust boundary first.
- When a fix changes a behavior documented in `ovrflo-critical-patterns.md`:
  update the pattern in the same campaign.
- When a fix deliberately omits a check a reviewer expects (e.g., cardinality
  at runtime): lock the omission with a named test and a comment.
- When implementing a slippage, validation, or freshness guard: write the test
  that proves the guard fires and the test that proves the happy path still
  passes, before the fix.
- When the finding's rejection depends on a multisig trust boundary: record
  the rejection with rationale rather than merging defensive code.

## Examples

### M-01: Remove the pro-rata cap in `claimPoolShare`

The pro-rata cap stranded minority contributors when the pool's stream was
partially drawn. As the pot shrank, a minority contributor's pro-rata share
floored to zero even when proceeds remained for their full entitlement.

```solidity
// BEFORE (pro-rata cap): caps claim at pro-rata share of a shrinking pot.
// After a majority contributor drains the pot, minority pro-rata floors to 0.
uint256 available = remaining;
uint256 proRata = uint256(poolProceeds[poolId]) * remaining / pools[poolId].totalObligation;
if (proRata < available) available = proRata;
```

```solidity
// AFTER (no pro-rata cap): contributors claim up to their full entitlement
// from available proceeds. poolReceived already prevents over-claiming.
uint256 remaining = _remainingEntitlement(poolId, msg.sender);
uint256 available = remaining;
if (uint256(poolProceeds[poolId]) < available) available = uint256(poolProceeds[poolId]);
require(uint256(amount) <= available, "OVRFLOBook: exceeds available");
```

Pattern #12 was rewritten in the same campaign to read "cap shared-pool claims
at `min(remaining, poolProceeds)` — no pro-rata distribution," with the
pro-rata block moved to the WRONG example. Tests
`test_ClaimPoolShare_NoProRataCap` and
`test_ClaimPoolShare_MinorityContributorNotStranded` lock the behavior.

### M-02: Net slippage check in `createBorrowPool`

Slippage must be checked on the net amount the borrower receives (after fees),
not the gross borrow amount. A borrower setting `minAcceptable = borrowAmount`
expects to receive that much; checking gross lets fees silently reduce their
proceeds.

```solidity
// BEFORE (gross slippage): check runs before fee computation.
require(borrowAmount >= minAcceptable, "OVRFLOBook: slippage");
// ... fee computed later, netToBorrower = borrowAmount - fee
```

```solidity
// AFTER (net slippage): check runs after fee computation on net proceeds.
feeAmount = StreamPricing.fee(actualBorrow, feeBps);
netToBorrower = actualBorrow - feeAmount;
require(netToBorrower >= minAcceptable, "OVRFLOBook: slippage");
```

Tests `test_CreateBorrowPool_NetSlippageWithFees`,
`test_CreateBorrowPool_SlippageRevertsOnNetNotGross`, and
`test_CreateBorrowPool_FeeAtMaxSlippageReverts` cover the happy path, the
revert, and the boundary.

### M-03: Oracle freshness at runtime, with intentional asymmetry

The vault checked `oldestObservationSatisfied` only at market onboarding
(`addMarket`), not when reading `getPtToSyRate` in `deposit` and `flashLoan`.
A stale oracle could return incorrect rates at runtime.

```solidity
// AFTER: internal helper called before every getPtToSyRate read.
function _requireOracleFresh(address market, uint32 twapDuration) internal view {
    (,, bool oldestObservationSatisfied) = IPendleOracle(oracle).getOracleState(market, twapDuration);
    require(oldestObservationSatisfied, "OVRFLO: oracle not ready");
}
```

The helper checks ONLY `oldestObservationSatisfied`, not
`increaseCardinalityRequired`. Cardinality is an onboarding concern handled
once by `addMarket`; re-checking it at runtime would revert on markets that
are perfectly usable. This asymmetry is locked by
`test_Deposit_SucceedsWithCardinalityRequiredButOldestSatisfied` and the
flash-loan equivalent, both named for the property they protect.

### L-01: Input validation in `quote()`

`quote()` is a view function but still needs bounds checks — an out-of-bounds
APR or a zero price is a caller error worth reverting on, not a silent zero.

```solidity
// AFTER: validate APR and guard zero price in the view.
_validateApr(aprBps);
grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
require(grossPrice > 0, "OVRFLOBook: price zero");
```

Tests `test_Quote_RevertsForAprOutOfBounds`,
`test_Quote_RevertsForNonWholeApr`, and `test_Quote_RevertsForZeroPrice` lock
the three revert paths.

### L-02: Step-aligned APR bounds

`setAprBounds` now requires both bounds to be multiples of `APR_STEP_BPS`
(100 bps) so the runtime APR grid stays consistent with the admin-set range.

```solidity
// AFTER: bounds must land on the APR grid.
require(aprMinBps_ % APR_STEP_BPS == 0, "OVRFLOBook: aprMin not step-aligned");
require(aprMaxBps_ % APR_STEP_BPS == 0, "OVRFLOBook: aprMax not step-aligned");
```

`test_Admin_SetAprBounds_StepAlignment` locks the requirement. The full
campaign took the suite from 213 to 299 passing tests (unit, fuzz, invariant,
attack, and fork), with all five fixes test-first and pattern #12 resynced.

## Related

- [Record rejected audit findings with rationale](./record-rejected-findings-with-rationale.md) — companion practice covering the rejection side of triage
- [OVRFLO critical patterns](../patterns/ovrflo-critical-patterns.md) — enforceable rules doc updated during this campaign (pattern #12 resynced)
- [Verify token balance movement, not just ownership](./verify-token-balance-movement-not-just-ownership.md) — test-coverage methodology applied throughout the campaign
- [Solidity batch function safety patterns](../design-patterns/solidity-batch-function-safety-patterns.md) — pro-rata claim pool design context for M-01
