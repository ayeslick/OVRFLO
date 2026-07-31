---
title: Shadow discovery outcomes must be fail-closed discriminated unions
date: 2026-07-31
category: logic-errors
module: web/lib/discovery/shadow-adapters.ts, web/lib/discovery/live-projection.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Portfolio and recovery inputs were loose shapes that could look ready while incomplete"
  - "Excluded hydration could present as ready-empty"
  - "Refresh failures and registry reads lacked budgets / dedupe"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [shadow-adapters, discovery, fail-closed, discriminated-union, hydration, budget]
related_components: [OVRFLO web]
---

# Shadow discovery outcomes must be fail-closed discriminated unions

## Problem

U4 review of the shadow discovery adapters found loose input typing and
fail-open presentation: excluded or incomplete hydration could look ready,
refresh failures were unbounded, and registry work lacked an explicit budget.

## Symptoms

- Portfolio / recovery payloads accepted overlapping shapes without a ready vs
  unavailable discriminant
- Discovery scope was a bare string, easy to forge or mix across markets
- Registry counts beyond budget did not fail closed

## What Didn't Work

Returning empty arrays or "ready" for partial shadow reads. Empty is a success
state in the UI; incomplete must be a distinct failure/unavailable outcome.

## Solution

Applied U4-local hardening (Codex U4; merged in PR #3):

- Discriminated unions for portfolio and recovery inputs
- Immutable branded `DiscoveryScope` key
- Deduplicated / bounded refresh failures
- Explicit registry read budgets (`MAX_*` limits fail closed)
- Closed the false-ready path for excluded hydration
- Covered receipt-decoding failure branches in tests

```684:685:web/lib/discovery/shadow-adapters.ts
declare const discoveryScopeBrand: unique symbol;
export type DiscoveryScope = string & { readonly [discoveryScopeBrand]: true };
```

## Why This Works

Shadow adapters must never upgrade uncertainty into confidence. Discriminated
outcomes force consumers to handle unavailable / incomplete explicitly.

## Prevention

- Never map "no rows yet" and "cannot ask" to the same UI state
- Budget every registry / candidate hydration path and fail closed on overflow

## Related Issues

- [Nullish default flips read semantics](../ui-bugs/nullish-default-flips-read-semantics.md)
- Captured from Codex U4 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
