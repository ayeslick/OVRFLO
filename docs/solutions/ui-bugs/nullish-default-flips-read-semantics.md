---
title: Defaulting an unresolved contract read with ?? 0n silently selected "unlimited"
date: 2026-07-27
category: ui-bugs
module: web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Deposit-cap line absent and DEPOSIT enabled while the cap reads were still in flight"
  - "A capped-out deposit submitted during the loading window would revert on-chain"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [wagmi, useReadContract, loading-state, nullish-default, deposit-cap, zero-sentinel]
---

# Defaulting an unresolved contract read with `?? 0n` silently selected "unlimited"

## Problem

The deposit-cap edge state read `marketDepositLimits` and `marketTotalDeposited`
and derived headroom with `depositLimit.data ?? 0n`. In this protocol **0 means
unlimited** — so while the read was loading (or failing), the form didn't show a
cap and left DEPOSIT enabled. The nullish default didn't pick a neutral value;
it picked a *semantic*.

## Root cause

`?? 0n` conflates three states — loading, error, and a genuine on-chain zero —
and in any domain where zero is a sentinel ("unlimited", "disabled", "no
limit"), the conflation silently selects the most permissive meaning. Caught in
the ticket-10 review, not by tests, because test mocks always resolve data.

## Solution

Gate on resolution before deriving semantics; keep the raw default only for
display math that is guarded by the gate:

```ts
// While the cap reads are loading, deposit stays gated — an unresolved
// read must never render as "unlimited".
const capLoaded = depositLimit.data !== undefined && totalDeposited.data !== undefined;
const capReached = mode === "deposit" && capLoaded && capRemaining === 0n;
// modeDisabled: … || (mode === "deposit" && (!capLoaded || capReached))
```

## Prevention

- Before writing `read.data ?? <fallback>`, ask what the fallback **means** in
  the domain. If zero (or empty array, or false) is a sentinel with its own
  semantics, gate on `data !== undefined` instead of defaulting.
- The same trap appeared twice this cycle in opposite directions:
  `fetchHeldStreamIds` returning `[]` on an unreachable indexer (empty ≠
  unavailable, ticket 09) and this cap default (loading ≠ unlimited). The
  general rule: **unresolved is its own state; never collapse it into a valid
  domain value.**
- Component-test mocks that always resolve data structurally cannot catch this;
  add an explicit loading-state assertion when the loaded value carries sentinel
  semantics.
