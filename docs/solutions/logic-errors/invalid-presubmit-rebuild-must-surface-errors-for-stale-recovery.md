---
title: Invalid pre-submit rebuild must surface errors for stale recovery
date: 2026-07-31
category: logic-errors
module: web/hooks/useTransactionExecutor.ts, web/lib/errors.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "A lost-liquidity race during pre-submit rebuild dead-ended with no user caption"
  - "invalid ActionExecutionResult carried errors that no consumer read"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [executor, invalid, stale-recovery, rebuild, cutover]
related_components: [OVRFLO web]
---

# Invalid pre-submit rebuild must surface errors for stale recovery

## Problem

U9 live gates found that an `invalid` pre-submit rebuild result carried
`errors`, not `error`. No consumer (`userFacingError`, stale-recovery
classifier) saw it, so a lost-liquidity race failed silently instead of
triggering stale recovery.

## Symptoms

- Mid-flow liquidity loss produced a stuck/empty failure with no
  "inputs changed — review again" path
- Unit suites that only asserted `status === "invalid"` missed the UI wiring

## What Didn't Work

Exposing only `result.error`. The rebuild path reports structured
`errors: { code, message }[]` on `invalid`.

## Solution

`useTransactionExecutor` synthesizes a stable `Error` from `result.errors` so
stale recovery and captions can classify it. `REBUILD_STALE_REASONS` covers
rebuild-only needles that are not on-chain revert strings:

```137:148:web/hooks/useTransactionExecutor.ts
  // An `invalid` result carries `errors`, not `error`; without surfacing it
  // here no consumer (userFacingError, useStaleRecovery's classifier) ever
  // sees it and a failed pre-submit rebuild dead-ends silently.
  const error = useMemo(() => {
    if (!result) return null;
    if ("error" in result) return result.error;
    if ("errors" in result && result.errors.length > 0) {
      return new Error(
        result.errors.map((entry) => `${entry.code}: ${entry.message}`).join("; "),
      );
    }
```

## Why This Works

Stale recovery is a presentation concern over a classified failure signal. If
the executor hides `invalid` payloads, the recovery machinery never runs.

## Prevention

- Every terminal `ActionExecutionResult` shape must expose a single consumer
  `error` (or equivalent) for captions and classifiers
- Add a UI/hook test that an `invalid` rebuild with `errors` enters stale
  recovery, not a silent dead-end

## Related Issues

- [Unified executor must latch identity and rebuild before every write](./unified-executor-must-latch-identity-and-rebuild-before-write.md)
- [Deposit reviewed slippage bound must survive mid-flow block advances](./deposit-reviewed-slippage-bound-must-survive-mid-flow-blocks.md)
- Captured from Claude U9 live-gate fixes (merged in PR #3)
