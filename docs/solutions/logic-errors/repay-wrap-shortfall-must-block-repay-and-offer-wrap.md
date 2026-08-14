---
title: Repay wrap shortfall must block REPAY and offer wrap
date: 2026-08-14
category: logic-errors
module: web/components/watch/WatchWrite.tsx
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Repay stayed clickable when wallet ovrfloToken was short but underlying could wrap the gap"
  - "UI-REVIEW-REPAY-PREPARE did not exist as a named shortfall band"
  - "Wrap of the gap had no return handoff back to the same repay amount"
  - "Inventory 24 needed a short ovrfloToken wallet to pin WRAP SHORTFALL"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags: [repay, wrap-shortfall, watch-write, wrap, handoff]
related_components: [web/lib/storage.ts, web/tests/inventory/writes.test.tsx]
---

# Repay wrap shortfall must block REPAY and offer wrap

## Problem

A repay consumes ovrfloToken. A wallet can hold enough underlying to wrap the
gap and still present a live REPAY. That click fails or underpays. The prepare
path must name the gap, disable REPAY, and send the user to wrap with the
amount remembered.

The fix lives in the working tree on branch
`feat/watch-surface-markets-experience`. The change is uncommitted and
unmerged to `main` as of this writing.

## Symptoms

- `kind === "repay"` with `walletOvrflo < repayAmount` still armed REPAY.
- No `UI-REVIEW-REPAY-PREPARE` shortfall band.
- Assets wrap had no repay return query and no stored amount.
- Inventory 24 had to construct a short ovrfloToken wallet to pin the link.

## What Didn't Work

Treating every ovrfloToken shortfall as a wrap shortfall. If underlying is
also short, wrap cannot cover the gap. That case is not this path.

Leaving REPAY enabled behind a banner. Ethskills QA requires the reason in the
primary slot, not a silent no-op.

## Solution

`repayWrapShortfall` returns `{ have, need }` only when all of these hold
(`web/components/watch/WatchWrite.tsx:373-384`):

- `kind` is repay and `repayAmount > 0`
- wallet ovrfloToken and wallet underlying reads are ready
- wallet ovrfloToken is below `repayAmount`
- wallet underlying is at least the gap

Otherwise the helper returns `null`. Missing reads are not a shortfall.

When the helper returns a value and the flow is not confirmed, the surface
renders `UI-REVIEW-REPAY-PREPARE` with `data-state="shortfall"`, copy for have
and need, and a WRAP SHORTFALL link to
`/assets/?return=repay&loan=…` (`web/components/watch/WatchWrite.tsx:224-239`).
The click writes the amount through `writeRepayHandoff`
(`web/lib/storage.ts:99-101`).

REPAY renders disabled with
`WRAP THE ADDITIONAL AMOUNT TO REPAY THIS`
(`web/components/watch/WatchWrite.tsx:283-286`). `submit` returns on
`wrapShortfall` (`web/components/watch/WatchWrite.tsx:138`).

Inventory 24 pins the prepare band, the wrap href, and disabled REPAY
(`web/tests/inventory/writes.test.tsx:406-456`).

## Why This Works

Wrap is the next write only when underlying can mint the missing ovrfloToken.
The disabled reason occupies the REPAY slot. The handoff keeps the typed
amount across the Assets trip.

## Prevention

- Do not enable REPAY while `repayWrapShortfall` is non-null.
- Do not treat a not-ready wallet read as a shortfall. Wait for ready.
- Do not treat an underlying-also-short wallet as wrap shortfall. That wallet
  cannot wrap the gap.
- Inventory 24 must keep `walletOvrflo` below the repay amount and
  `walletUnderlying` above the gap.

## Related Issues

- [Borrow approve slot must honor signing block](borrow-approve-slot-must-honor-signing-block.md)
  — disabled reason in the primary slot, not a live button with an early return.
- [Freeze what you show, recompute what you submit](../design-patterns/freeze-what-you-show-recompute-what-you-submit.md)
  — the typed repay amount is the snapshot the wrap handoff must keep.
- [Enforce write invariants at the write layer](../architecture-patterns/enforce-write-invariants-at-the-write-layer-not-the-call-site.md)
  — `submit` also returns on wrap shortfall; the button is not the only gate.
