---
title: Borrow presentation must not announce read failures as true zero
date: 2026-07-31
category: ui-bugs
module: web/components/action-flow/BorrowFlow.tsx
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Source or route read failures could render as true-zero liquidity"
  - "Quote/gather loading skipped the preparing state"
  - "Enumeration truncation was labeled route fragmentation"
  - "Quote reverts were shown as retryable unavailable"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [borrow-flow, presentation, fail-closed, preparing, fragmented, liquidity]
related_components: [OVRFLOLending]
---

# Borrow presentation must not announce read failures as true zero

## Problem

U8 review of the shared action-flow shell found a P1 in `BorrowFlow`: read
failures could fall through to the "true zero" presentation, and related P2s
misclassified loading, truncation, and terminal quote failures.

## Symptoms

- `streams.unavailable` / read errors not selected before zero/insufficient
  branches
- Quote and gather loading did not enter `preparing`
- Legacy enumeration truncation labeled as `fragmented`
- Terminal quote failures presented as retryable unavailable

## What Didn't Work

Ordering outcome resolution as "no ticks ⇒ zero." Absence of ticks is only
meaningful after sources successfully report empty.

## Solution

`resolveBorrowOutcome` selects unavailable and preparing before zero /
fragmented / insufficient (merged in PR #3):

```351:367:web/components/action-flow/BorrowFlow.tsx
  const borrowOutcome = resolveBorrowOutcome({
    staleRoute: staleRecovery || routeErrorKind === "stale",
    unavailable:
      streams.unavailable ||
      Boolean(sourceError) ||
      routeErrorKind === "retryable",
    preparing:
      streams.isLoading ||
      lending.isLoading ||
      liquidity.isLoading ||
      routePreparing,
    routeStatus: freshRoute?.status,
    // ...
  });
```

Also added flow-level Borrow transition tests and reused shared
`ActionFlowProps` across extracted flows.

## Why This Works

Presentation states are a trust UI. "Zero" is an affirmative claim about the
market; it must never be the fallback for "we could not read."

## Prevention

- Outcome classifiers must check unavailable/preparing/error before empty
- Add integration tests that drive Borrow classification through real flow
  inputs, not only unit-level label maps

## Related Issues

- [PositionList blanket error hides on-chain positions](./positionlist-blanket-error-hides-onchain-positions.md)
- Captured from Codex U8 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
