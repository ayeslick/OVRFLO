---
title: Live discovery cutover must keep partial and stale reads fail-closed
date: 2026-07-31
category: integration-issues
module: web/lib/discovery/live-projection.ts, web/components/PositionSummary.tsx, web/hooks
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "Partial discovery reads could render as empty portfolio or missing liquidity"
  - "Stale async work remained actionable after newer reads"
  - "Unstable adapter results and aggressive full-history polling churned the UI"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [live-cutover, discovery, fail-closed, polling, hydration, portfolio]
related_components: [OVRFLOLending]
---

# Live discovery cutover must keep partial and stale reads fail-closed

## Problem

U9 live cutover review (after on-chain discovery replaced indexer-backed
reads) found substantive fail-open risks: old-tick liquidity visibility gaps,
fresh-wallet portfolio loading ambiguity, partial reads appearing empty, and
stale async work remaining actionable. A simplify pass also found unstable
adapter results and 2-second full-history polling.

## Symptoms

- Portfolio summary eagerly scanned markets without a clear
  loading/unavailable discriminant for fresh wallets
- Partial provider agreement or incomplete hydration looked like "no
  positions"
- Stale in-flight work could still drive actionable Borrow / Claim All state
- Adapter identity churn forced recurring PositionSummary updates

## What Didn't Work

Cutting live consumers over to on-chain discovery while treating incomplete
projections like legacy empty indexer responses.

## Solution

Post-review / simplify fixes on the U9 cutover path (merged in PR #3):

- Stable adapter results (avoid recurring PositionSummary updates)
- Remove 2-second full-history polling
- Global fail-closed market-registry budgeting
- Bounded / concurrent APR and Claim All work
- Shared U4 hydration outcome semantics for live consumers
- Explicit Borrow outcome guards and canonical route selection in stress
  fixtures

Validated review fixes: focused suites green with clean typecheck/lint; hard
external performance evidence remained an intentional blocker rather than an
invented limit.

## Why This Works

Live discovery is authoritative only when complete. Partial and stale views
must stay unavailable/preparing, not empty/actionable — the same fail-closed
contract shadow adapters already taught.

## Prevention

- Never map incomplete hydration to ready-empty in live consumers
- Budget registry and candidate hydration; fail closed on overflow
- Stabilize adapter return identities so React consumers do not thrash

## Related Issues

- [Shadow discovery outcomes must be fail-closed discriminated unions](../logic-errors/shadow-discovery-outcomes-must-be-fail-closed-discriminated-unions.md)
- [Stream discovery is a candidate set, not an authority](../security-issues/indexer-is-a-discovery-hint-not-an-authority.md)
- Captured from Codex U9 live-cutover review fixes (merged in PR #3)

- [Tick-scoped market-depth refresh must also match whole-market projection keys](../logic-errors/tick-scoped-market-depth-refresh-must-match-whole-market-keys.md)
- [Invalid pre-submit rebuild must surface errors for stale recovery](../logic-errors/invalid-presubmit-rebuild-must-surface-errors-for-stale-recovery.md)
- [Deposit reviewed slippage bound must survive mid-flow block advances](../logic-errors/deposit-reviewed-slippage-bound-must-survive-mid-flow-blocks.md)
