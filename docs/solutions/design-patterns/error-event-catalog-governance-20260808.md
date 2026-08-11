---
title: Closed error/event catalog governance — semantics per selector, symmetric enforcement, log-complete events
date: 2026-08-08
category: design-patterns
module: src/OVRFLOLending.sol (error catalog, events)
problem_type: design_pattern
component: lending-market
severity: high
applies_when:
  - Adding, reusing, or sharing a custom-error selector
  - Designing an event for a payout-affecting path
  - Reviewing whether an error/event addition honors the plan's closed catalog
tags: [custom-errors, events, catalog-governance, log-completeness, selectors]
---

# Closed error/event catalog governance — semantics per selector, symmetric enforcement, log-complete events

## Context

The v1-lite plan pinned a closed error catalog: errors are amended only by
dated user decision, never invented locally. Four governance lessons emerged
from living under that regime during tickets 03–05.

## The rules

**1. One selector, one semantic class.** Sharing `BelowMinimum` between the
borrow-fill floor and the `MIN_STREAM_AMOUNT` floor was accepted (both are
size floors). Sharing it with `close`-before-coverage was rejected and
`NotCovered` was minted (2026-08-08): a temporal condition ("not yet") is not
a size floor ("too small"), and a caller distinguishing the two by selector
must be able to. The line is semantic class, not surface similarity.

**2. The catalog constrains implementations productively — the forcing chain.**
U3's grossPrice-cap decision shows the closed catalog working as designed: with
no error available for "target exceeds stream value" and R11's documented
call-site precondition, the only implementable behavior was capping the fill at
`grossPrice` — reviewed and promoted from "reasonable judgment call" to
"provably forced." A closed catalog plus documented preconditions can pin an
implementation choice as tightly as a spec paragraph.

**3. Catalog governance must bind its own governors.** The U5 reviewer caught
the coordinator minting `PositionMissing` freely for its own unit while
holding builders to reuse (`loansOf(maxN==0)` initially shared `ZeroAmount`;
reversed to the exact-fit `ZeroSteps` already in the catalog). Asymmetric
application is how a closed catalog quietly dies.

**4. Events must be log-complete for owner-mutable parameters.** `Borrowed`
gained `feeAmount` because `feeBps` is owner-mutable with no per-loan
snapshot — without the field, net proceeds could not be reconstructed from
logs alone after a fee change. Rule: any payout-affecting quantity derived
from an owner-mutable parameter is emitted explicitly. Corollary from U4:
terminal signals are uniform — full repay emits both `Repaid(...,0)` and
`Closed(loanId, drawn)`, so every closure path produces the same terminal
event regardless of exit route.

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 2 (unmissable) for the catalog itself: an unlisted error fails plan
review by construction, and reusing the wrong selector is caught by
exact-selector `expectRevert` tests. Tier 4 for the semantic-class and
symmetry rules (review judgment). Log-completeness is tier 3 (full-field emit
tests assert every field).

## See also

- `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md` — error catalog + dated notes (2026-08-08).
