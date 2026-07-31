---
title: Deposit reviewed slippage bound must survive mid-flow block advances
date: 2026-07-31
category: logic-errors
module: web/lib/live-action-plan.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Deposit confirm re-tripped ACTION INPUTS CHANGED on every mid-flow Anvil block"
  - "Recomputing minToWallet from a fresh preview made review loops deterministic locally and intermittent on mainnet"
  - "Live markets also drift the fresh quote upward between review and confirm"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [deposit, slippage, reviewed-bound, live-action-plan, cutover]
related_components: [OVRFLO vault]
---

# Deposit reviewed slippage bound must survive mid-flow block advances

## Problem

U9 live verification found the deposit rebuild recomputed its slippage bound
from a fresh `previewDeposit` each time. Stream pricing decays with
`block.timestamp`, so any mid-flow block (every APPROVE on Anvil) changed the
rebuilt args and forced endless re-review. U10 then widened the tolerance one
extra slippage band because live markets also drift the fresh quote *upward*.

## Symptoms

- "ACTION INPUTS CHANGED — REVIEW AGAIN" on every confirm after an approval
- Deterministic on local forks; intermittent on mainnet under load
- Honoring a reviewed `0n` bound unconditionally would drop slippage
  protection

## What Didn't Work

1. Always recompute `minToWallet` from the fresh preview.
2. Always keep the reviewed bound with no floor check (unit suite caught the
   degenerate-zero case).

## Solution

Honor the reviewed bound while it remains satisfiable and within one extra
slippage band of the fresh floor; otherwise recompute and route to
`needs_review`:

```452:465:web/lib/live-action-plan.ts
              // Honor the bound the user reviewed while it is satisfiable and
              // within one extra slippage band of the fresh floor ...
              minToWallet:
                reviewedMin >= applySlippageDown(applySlippageDown(preview[0])) &&
                reviewedMin <= preview[0]
                  ? reviewedMin
                  : applySlippageDown(preview[0]),
```

## Why This Works

The reviewed bound is what the user consented to. Small time/price drift must
not invalidate that consent; large or unsafe drift must still force re-review
and never wave through a degenerate bound.

## Prevention

- Never recompute reviewed numeric call args unconditionally on rebuild
- Keep a unit case for degenerate `0n` reviewed bounds still tightening
- Prefer live-fork deposit E2E after approvals before declaring cutover green

## Related Issues

- [Invalid pre-submit rebuild must surface errors for stale recovery](./invalid-presubmit-rebuild-must-surface-errors-for-stale-recovery.md)
- [Unified executor must latch identity and rebuild before every write](./unified-executor-must-latch-identity-and-rebuild-before-write.md)
- [Freeze what you show, recompute what you submit](../design-patterns/freeze-what-you-show-recompute-what-you-submit.md) — complementary rule: freeze the reviewed display, recompute effects; for deposit, honor the reviewed numeric bound while it remains protective
- Captured from Claude U9/U10 live-gate fixes (merged in PR #3)
