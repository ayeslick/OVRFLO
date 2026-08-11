---
title: Frozen history + monotone counters as a safety-argument style — and how to test a design guarantee
date: 2026-08-10
category: architecture-patterns
module: src/OVRFLOLending.sol, src/TickTree.sol (fill attribution)
problem_type: architecture_pattern
component: lending-market
severity: high
applies_when:
  - Arguing the safety of an append-only / cumulative-counter design
  - Writing properties or gas tests for a structure with its own growth transitions
  - Choosing between per-entity mutation and lazy interval attribution
tags: [frozen-history, monotone, blind-fill, tick-tree, safety-argument, gas-flatness]
---

# Frozen history + monotone counters as a safety-argument style — and how to test a design guarantee

## Context

v1-lite's load-bearing design move: `borrow` advances one cumulative `filled`
counter and freezes the interval `[fillStart, fillEnd)` into the loan record —
no position is read or written at fill time. Attribution is computed lazily at
claim time by interval overlap against history that can never change.

## The safety-argument style

The design's safety case is a chain of three small, checkable claims rather
than one large behavioral one:

1. **Monotonicity** — `filled`, `drawn`, `repaid`, `received` only grow;
   epoch/leaf/height counters only grow. Violations are locally visible.
2. **Frozen history** — once written, a loan's interval and a position's
   consumed prefix never move. Later operations can only append.
3. **Tiling** — loan intervals partition `[0, filled)`; therefore attribution
   sums are exact by construction, not by bookkeeping.

Together these imply the big claims (no double-attribution, claim-order
independence, per-pair caps) without any code enforcing them directly. This is
the style to reach for whenever "who owns what" can be derived from immutable
coordinates instead of maintained in mutable per-entity state — the failure
mode it eliminates (a missed update to one of N mirrored records) simply has
no write site to miss.

## How to test a design guarantee (the U3 lesson)

The blind-fill gas-flatness claim ("fill cost is flat in positions crossed
*because* no position is written") is a design guarantee, and its test is
EVIDENCE, not a patch guard. The U3 review's key catch: same-height gas pairs
don't pin flatness through a tree-height growth — the guarantee spans the
structure's own transitions, so the measurement must too. `OVRFLOLendingGas`
therefore pins both the 1-vs-50-position pair AND a pair measured across a
height growth. General rule: **a claim about a data structure must be tested
across that structure's own structural transitions, not just in steady state.**
(Same shape as the rounding lesson: the boundary fixture, not the general
property, is what discriminates.)

## Remediation tier (per the 2026-08-10 hierarchy)

Tier 1 (unrepresentable): stale-attribution and missed-update classes have no
write site to fail at. The invariant suite, fizz properties (GL-20/21/25,
SP-19/20), and the gas pairs are the tier-3 evidence that the tier-1 premises
(monotone, frozen, tiling) actually hold in the implementation. This is the
canonical example of the hierarchy's "tests as evidence of a design guarantee."

## See also

- `x-ray/invariants.md` (frozen-history lemma, formal statement per ticket 08).
- `docs/solutions/best-practices/uncheatable-test-discipline-20260810.md`.
