---
title: Checkpoint zero-address guards must use isAddressEqual and ZERO_ADDRESS
date: 2026-07-31
category: logic-errors
module: web/lib/discovery/lending-projection.ts
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "validateCheckpoint compared lender/market to zero-address string literals"
  - "Discovery layer mixed address-guard conventions across modules"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [checkpoint, isAddressEqual, ZERO_ADDRESS, discovery, review-feedback]
related_components: [OVRFLOLending]
---

# Checkpoint zero-address guards must use isAddressEqual and ZERO_ADDRESS

## Problem

PR review of the U11 deletion cutover found `validateCheckpoint` in the
ticket-03 pure reducer (`lending-projection.ts`) used zero-address string
literals instead of the discovery-layer convention `isAddressEqual(...,
ZERO_ADDRESS)`.

## Symptoms

- Inconsistent checksum/case handling vs every other discovery guard
- Reviewer could point at the exact module by name; easy to confuse with
  `live-projection.ts`

## What Didn't Work

`=== "0x000…000"` style checks. They work for normalized lowercase hex but
diverge from the shared helper and invite case bugs.

## Solution

```329:336:web/lib/discovery/lending-projection.ts
function validateCheckpoint(checkpoint: LiquidityCheckpoint): void {
  if (checkpoint.liquidityId === 0n) throw new Error("Liquidity checkpoint id is zero");
  if (isAddressEqual(checkpoint.lender, ZERO_ADDRESS)) {
    throw new Error("Liquidity checkpoint lender is zero");
  }
  if (isAddressEqual(checkpoint.market, ZERO_ADDRESS)) {
    throw new Error("Liquidity checkpoint market is zero");
  }
```

## Why This Works

One guard convention across discovery means reviews and refactors can spot
outliers immediately, and address equality follows viem's rules.

## Prevention

- Prefer `isAddressEqual` + shared `ZERO_ADDRESS` for every address emptiness
  check in `web/lib/discovery/**`
- Ban raw zero-address string literals in discovery via lint/banned-patterns
  if they recur

## Related Issues

- [Stream discovery is a candidate set, not an authority](../security-issues/indexer-is-a-discovery-hint-not-an-authority.md) — same discovery-layer address-guard convention
- Captured from Claude U11 review feedback fix (merged in PR #3)
