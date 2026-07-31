---
title: Claim All must never replay confirmed IDs and must re-review changed sets
date: 2026-07-31
category: logic-errors
module: web/hooks/useTxQueue.ts, web/hooks/useClaimAllExecution.ts, web/lib/live-action-plan.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Resumed Claim All plans could replay already-confirmed claim IDs when a pool group expanded"
  - "Changed or new constituents could continue without an explicit re-review"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [claim-all, resume, confirmed-ids, needs-review, queue]
related_components: [OVRFLOLending]
---

# Claim All must never replay confirmed IDs and must re-review changed sets

## Problem

U7 self-review of Claim All orchestration found two edge cases: a resumed plan
could re-include confirmed claim IDs when a shared pool group expanded, and
changed/new constituents could proceed without stopping for explicit re-review.

## Symptoms

- Resume rebuilt from live props without subtracting confirmed work
- Queue advanced past materially changed claim sets
- Wallet/chain identity was not treated as part of the latched plan identity

## What Didn't Work

Treating "resume" as "rebuild the full displayed set and continue." Confirmed
rows are spent work; new/changed rows are a new review.

## Solution

Applied in the U7 review-fix pass (merged in PR #3):

- Resumed plans subtract confirmed (and skipped) claim IDs so expanded pool
  groups cannot replay finished work
- Changed or new constituents stop with `needs_review` for explicit
  re-confirmation
- Live wallet identity, including chain, is latched into execution options via
  `useClaimAllExecution`

`useTxQueue` already treats `confirmed` / `skipped` as terminal for resume and
surfaces `needs_review` from the executor.

## Why This Works

Claim All is sequential U6 execution over a reviewed set. Completeness is a
property of that set. Expanding it mid-flight is a new plan, not a
continuation.

## Prevention

- On every resume, subtract terminal row IDs before planning remaining work
- Any plan diff that adds or materially changes claims must require re-review
- Never replay a confirmed claim ID even if the display set still lists it

## Related Issues

- [useTxQueue treated a mined-but-reverted claim as confirmed](./usetxqueue-on-chain-revert-treated-as-confirmed.md)
- Captured from Codex U7 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
