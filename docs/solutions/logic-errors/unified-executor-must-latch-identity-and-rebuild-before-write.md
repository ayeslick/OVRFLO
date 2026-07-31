---
title: Unified executor must latch identity and rebuild before every write
date: 2026-07-31
category: logic-errors
module: web/lib/action-runtime.ts, web/hooks/useWriteFlow.ts, web/hooks/useTransactionExecutor.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Live writes could submit a previously reviewed action without rebuilding"
  - "Approval prompts could fire after the wallet identity changed"
  - "Reset dropped pending dedupe; refresh retry lost recoverable receipt state"
  - "Critical refresh could succeed without refreshing declared resources"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [action-runtime, identity-latch, rebuild, approval, refresh, race]
related_components: [OVRFLO web]
---

# Unified executor must latch identity and rebuild before every write

## Problem

U6 review of the unified single-action executor found race defects around
identity, rebuild, approval, and refresh: reviewed actions could be submitted
stale, approvals could prompt after an account switch, and refresh recovery
could drop receipt evidence or skip resource refresh.

## Symptoms

- Live write path bypassed rebuild / approval ownership
- Identity unchecked between rebuild and approval prompt
- Reset cleared pending dedupe while a prompt was still in flight
- Changing input during simulation could produce two prompts
- Borrow route drift did not force renewed review

## What Didn't Work

Caching the reviewed calldata as authoritative for the life of the modal.
Chain and wallet state move; the reviewed bytes are a proposal, not a
capability.

## Solution

U6 review fixes (merged in PR #3) require:

- Rebuild accepted actions before live simulate/submit
- Recheck latched identity before every approval prompt and after approval
- Preserve pending dedupe across reset; coalesce refresh retries without losing
  recoverable receipt evidence
- Critical refresh must refresh declared resources (stale successful RPC reads
  do not count)
- Carry the rebuilt exact call into every form, including changed-review
- Borrow route drift returns `needs_review` instead of silent resubmit

Covered heavily in `web/tests/lib/action-runtime.test.ts` (identity_changed,
rebuild-after-approval, refresh-failed evidence retention).

## Why This Works

The executor treats "reviewed" as a latch that must be revalidated against the
live identity and a freshly rebuilt draft. Races become explicit terminal
statuses instead of double prompts or wrong-account submits.

## Prevention

- Never submit cached calldata without a rebuild + identity check in the same
  turn
- Add race tests for account switch at every await boundary (rebuild, approve,
  refresh)

## Related Issues

- [Refs beat state for cross-effect race guards](../design-patterns/refs-beat-state-for-cross-effect-race-guards.md)
- [Invalid pre-submit rebuild must surface errors for stale recovery](./invalid-presubmit-rebuild-must-surface-errors-for-stale-recovery.md) — rebuild must expose `invalid` `errors[]` as a consumer `error` or stale recovery never runs
- [Deposit reviewed slippage bound must survive mid-flow block advances](./deposit-reviewed-slippage-bound-must-survive-mid-flow-blocks.md) — rebuild must honor reviewed numeric bounds within a protective window
- Captured from Codex U6 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
