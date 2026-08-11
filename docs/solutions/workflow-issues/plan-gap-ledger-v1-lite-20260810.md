---
title: Plan-gap ledger for the v1-lite buildout — five gap classes and the plan-authoring rules that retire them
date: 2026-08-10
category: workflow-issues
module: docs/plans/ (plan authoring), .scratch/lending-v1-lite (execution harness)
problem_type: workflow_issue
component: planning
severity: high
applies_when:
  - Authoring or reviewing an implementation plan another agent will execute
  - Auditing why an executing agent had to stop, interpret, or deviate
  - Updating the plan-authoring standard
tags: [plan-authoring, plan-gaps, ambiguity, spec-quality, harness]
---

# Plan-gap ledger for the v1-lite buildout — five gap classes and the plan-authoring rules that retire them

## Context

Ticket 09's plan-gap harvest (directive 2026-08-10): every instance across
tickets 01–08 where an executing agent could not simply follow the plan
*because of the plan*, classified, with per-ticket attestations. The buildout
trail is evidence about the plan's quality, not just the code's.

## The ledger

| # | Where | Class | Instance |
|---|-------|-------|----------|
| 1 | Pre-ticket (doc review, 2026-08-05) | **Wrong assumption** (unimplementable as written) | U5's original text had `supply` try/catching TickTree's at-capacity revert — impossible: `try/catch` only works on external calls and KTD2 makes TickTree an internal library. Caught before U5 was assigned; fixed via `atCapacity` pre-check. |
| 2 | Ticket 01 | — | **None found** (no review batch, no correction commits). |
| 3 | Ticket 02 | — | **None found.** |
| 4 | Ticket 03 | **Ambiguity** (resolved as forced) | Borrow-fill mechanics didn't spell out the grossPrice-cap term; builder derived it by judgment; review later proved it forced by R11 + the closed catalog. |
| 5 | Ticket 04 | **Unpinned decision** | Neither the `NotCovered`-vs-shared-`BelowMinimum` selector question nor `Closed`-on-both-closure-paths was pinned; both were coordinator-accepted mid-flight and recorded after the fact. |
| 6 | Ticket 05 | **Contradiction** | The unit's bare-`atCapacity` rollover predicate contradicted R4/AE6 (would freeze trees at height 4); amended to `height == MAX_HEIGHT && atCapacity()` — the height term is forced, not stylistic. |
| 7 | Ticket 06 | **Missing contingency** (flagship) | The plan specified the invariant suite's coverage but no adversarial-strength requirement — the spec'd suite passed every named invariant while campaigns completed zero claims and killed only 6/13 mutants. The suite was sound in its spec'd form and still nearly worthless against the bug classes that matter. |
| 8 | Ticket 06 | **Wrong assumption** | The x-ray disposition table claimed three admin-guard tests existed that did not — false citations feeding the invariant checklist. |
| 9 | Ticket 07 | **Wrong assumption** (unsound as spec'd) | SP-26's single-actor no-free-profit property is not soundly expressible against a shared-liquidity book with interacting actors; stubbed `[-]` with rationale. |
| 10 | Ticket 07 | **Missing contingency** | Original U7 text didn't anticipate that gas-flatness must be measured across a tree-height growth (patched into the AC from the U3 review). |
| 11 | Ticket 08 | **Missing contingency** | The ticket asserted an SPDX "workspace standard" the plan body never pins; the builder stopped on it. (Resolved by user confirmation; actual repo state was drift, not convention.) |
| 12 | Ticket 08 | **Wrong assumption** (silent, plan-wide) | Deployability under EIP-3860/EIP-170 was never checked for the factory; the buildout tipped it over both caps, discovered only at the seed smoke. |

## Plan-authoring rules distilled (feed the plan-authoring standard)

1. **Compile-feasibility pass for language-mechanics claims** (#1): any plan
   step invoking a language feature (try/catch, delegatecall, catch-data)
   states the mechanic's precondition next to the step. Unrepresentable-tier
   fix: the plan template's per-unit "Approach" section gains a "mechanics
   check" line.
2. **Pin or delegate, never imply** (#4, #5): every error selector, event
   field, and boundary predicate is either pinned in Pinned Conventions or
   explicitly marked "builder's choice, record on landing." Silence is the
   gap class.
3. **Cross-check derived predicates against the requirements they serve**
   (#6): a boundary predicate cited in a unit must name the requirement IDs it
   encodes; a reviewer can then check the conjunction, not the vibe.
4. **Test-suite units carry an adversarial-strength criterion** (#7): "suite
   passes" is not an acceptance criterion for a suite; "suite kills the
   designed mutant set / satisfies liveness gates" is.
5. **Citations to tests are claims** (#8): any "covered by" table feeding a
   plan must be produced by opening the cited tests, never by name-matching.
6. **Property specs state their soundness domain** (#9): a property borrowed
   from another lane (vault conservation → lending no-free-profit) states the
   assumptions under which it is sound; the implementer checks the domain
   before the form.
7. **Environmental-rules sweep in the Verification Contract** (#12): every
   plan whose artifacts deploy on-chain includes a gate that runs under real
   network rules (size caps, at minimum `forge build --sizes` review).
8. **Structural-transition coverage** (#10): claims about a data structure
   must be exercised across its growth/rollover transitions in the same unit
   that claims them.

## Remediation tier (per the 2026-08-10 hierarchy)

Applied to plans: rules 1, 2, and 7 are template changes (make the gap class
unwritable — tier 1 for plans); rules 3–6 and 8 are review-checklist items
(tier 4) pending template slots. The per-ticket attestation requirement
("none found" is an explicit statement, not silence) is itself a tier-4→3
upgrade for the harvest process.

## See also

- `.scratch/lending-v1-lite/issues/09-compound-and-codify.md` (directive).
- The plan-authoring standard (user memory) — updated 2026-08-10 from this ledger.
