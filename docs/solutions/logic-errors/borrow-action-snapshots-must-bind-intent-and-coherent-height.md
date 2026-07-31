---
title: Borrow action snapshots must bind to submitted intent and coherent height
date: 2026-07-31
category: logic-errors
module: web/lib/actions/borrow.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Borrow snapshots were not bound to the submitted stream/amount intent"
  - "Coherence accepted unrelated reads that only shared a block height"
  - "Fee buffer produced unnecessary deposit approvals; failure guards lacked tests"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [borrow, action-definitions, snapshot, intent, block-hash, fail-closed]
related_components: [OVRFLOLending]
---

# Borrow action snapshots must bind to submitted intent and coherent height

## Problem

U5 review of pure liquidity action definitions found borrow snapshots could
drift from the submitted intent, and "same height" coherence was too weak —
unrelated reads at one block number could be treated as one coherent snapshot.

## Symptoms

- Stream/resource state not matching `intent.streamId` still built an action
- Coherence checks compared heights without requiring matching block hashes /
  resource identity
- Convert fee buffer inflated approvals; failure-guard paths lacked definition
  coverage

## What Didn't Work

Assuming same `blockNumber` implies same world. Two independent multicalls can
share a height while binding different resources.

## Solution

Bind borrow builds to submitted intent and require coherent metadata
(including block hash agreement across outcomes). Reject
snapshot-resource mismatches. Tighten convert fee/approval buffering and add
action-definition failure-guard tests (Codex U5; merged in PR #3).

```58:60:web/lib/actions/borrow.ts
    if (stream.streamId !== intent.streamId) {
      return invalidAction(
        actionError("snapshot-resource-mismatch", "Stream state does not match the borrow intent"),
```

## Why This Works

An action draft is a claim about a specific intent at a specific chain view.
Intent binding + hash-level coherence make that claim checkable before any
wallet prompt.

## Prevention

- For every action definition, assert intent fields against snapshot resources
- Prefer block-hash agreement over height-only coherence across multi-read
  snapshots

## Related Issues

- Captured from Codex U5 review fixes on the on-chain liquidity discovery cutover (merged in PR #3)
