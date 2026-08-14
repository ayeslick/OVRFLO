---
title: Borrow approve slot must honor signing block
date: 2026-08-14
category: logic-errors
module: web/components/borrow/ReviewHandoff.tsx, web/components/borrow/BorrowFlow.tsx
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Borrow ReviewHandoff rendered APPROVE STREAM as a live primary while signingBlockedReason was set"
  - "Wrong-chain and stale-event states still left Sablier NFT approve clickable"
  - "Supply ReviewHandoff already disabled its approve slot under the same signingBlockedReason"
  - "Inventory test 6 BORROW.APPROVE_STREAM covered the live receipt only; 6b was added for the blocked slot"
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags: [borrow, review-handoff, signing-block, approve-stream, wrong-chain, stale-events, permission-receipt, ethskills-qa]
related_components: [web/components/supply/ReviewHandoff.tsx, web/tests/inventory/borrow.test.tsx]
---

# Borrow approve slot must honor signing block

## Problem

Borrow `ReviewHandoff` kept APPROVE STREAM as a clickable primary when
`signingBlockedReason` was set. Supply `ReviewHandoff` already disabled the
matching approve slot. Ticket 17 ethskills QA found the gap. The user could
start a Sablier `approve` on the wrong chain or while event truth was stale.

The fix lives in the working tree on branch
`feat/watch-surface-markets-experience`. The change is uncommitted and
unmerged to `main` as of this writing.

## Symptoms

- At checkpoint `approve`, APPROVE STREAM stayed enabled while
  `signingBlockedReason` held a block string such as `SWITCH NETWORK`.
- `onApprove` in `BorrowFlow` did not return on `chainGuard.wrongChain` or
  `!signingAllowed`, so a click could still call `writeContract`.
- `onBorrow` had the same missing return. The BORROW slot in `ReviewHandoff`
  already rendered disabled when `signingBlockedReason` was set; the approve
  slot did not.
- Inventory test 6 asserted APPROVE STREAM was present. Test 6 did not assert
  the disabled-when-blocked case.

## What Didn't Work

Gating only the BORROW / `sign` checkpoint left APPROVE STREAM as a live
broadcast. Sablier `approve` is a wallet write. A block that covers BORROW
must cover APPROVE STREAM too.

Passing `signingBlockedReason` into borrow `ReviewHandoff` was not enough.
Borrow `ReviewHandoff` already accepted the prop and used the prop for BORROW
(`web/components/borrow/ReviewHandoff.tsx:213`). The approve branch ignored
the prop (`checkpoint === "approve"` with no `signingBlockedReason` test).

An early return in `onApprove` alone would still show a clickable primary.
Ethskills QA requires the wrong-network / stale reason in the primary CTA
slot, not a silent no-op behind an armed button.

Inventory test 6 (`web/tests/inventory/borrow.test.tsx:157`) covers the
unblocked approve receipt. Test 6 cannot catch this defect.

## Solution

The working tree on `feat/watch-surface-markets-experience` copies the supply
approve split into borrow `ReviewHandoff`. When `checkpoint === "approve"` and
`signingBlockedReason` is set, APPROVE STREAM renders as a disabled
`ActionButton` with `disabledReason={signingBlockedReason}`. When the reason
is absent, the busy / primary pair stays as before.

```tsx
{checkpoint === "approve" && signingBlockedReason ? (
  <ActionButton disabled disabledReason={signingBlockedReason}>
    APPROVE STREAM
  </ActionButton>
) : null}
```

Supply `ReviewHandoff` is the pattern borrow now matches:

```tsx
{checkpoint === "approve" && signingBlockedReason ? (
  <ActionButton disabled disabledReason={signingBlockedReason}>
    {`APPROVE ${underlyingSymbol}`}
  </ActionButton>
) : null}
```

`BorrowFlow` still builds `signingBlocked` and still passes the string as
`signingBlockedReason`. Wrong chain overwrites stale copy. Stale-quote
recovery overwrites both.

```ts
let signingBlocked: string | undefined;
if (!signingAllowed) signingBlocked = "EVENTS STALE — SIGNING DISABLED";
if (chainGuard.wrongChain) signingBlocked = "SWITCH NETWORK";
if (stale.staleRecovery) signingBlocked = "QUOTE UPDATED — REVIEW AGAIN";
```

`onApprove` and `onBorrow` now return before `writeContract` when the chain is
wrong or signing is not allowed:

```ts
function onApprove() {
  if (!lending || !selectedStream || chainGuard.wrongChain || !signingAllowed) return;
  approveTx.writeContract({ /* Sablier approve */ });
}

function onBorrow() {
  if (!lending || !market || !selectedStream || !quote || !frozen || drifted || chainGuard.wrongChain || !signingAllowed) return;
  actionTx.writeContract({ /* lending borrow */ });
}
```

`ActionButton` uses a TypeScript union: `disabled: true` requires
`disabledReason: string` (`web/components/kit/ActionButton.tsx:12-15`). The
native button is disabled when `disabled` or `busy` is set
(`web/components/kit/ActionButton.tsx:32-40`). The reason paints in a sibling
span when both `disabled` and `disabledReason` are set (`:45-49`).

Inventory test 6b drives the approve checkpoint with
`signingBlockedReason="SWITCH NETWORK"`. The test asserts APPROVE STREAM is
disabled, the reason text is visible, and BORROW is absent
(`web/tests/inventory/borrow.test.tsx:187-214`).

## Why This Works

APPROVE STREAM and BORROW are both wallet broadcasts. The approve slot now
reads `signingBlockedReason` the same way the non-drifted sign slot already
did (`web/components/borrow/ReviewHandoff.tsx:213-217`). The drifted sign
slot is a separate disable path with hardcoded quote-updated copy.

The handler return is a second gate for two of the three `signingBlocked`
writers. `onApprove` / `onBorrow` refuse `writeContract` when
`chainGuard.wrongChain` or `!signingAllowed`
(`web/components/borrow/BorrowFlow.tsx:363`, `:373`). They do not return on
`stale.staleRecovery`. `onBorrow` also returns on `drifted`.

Signing-block copy for APPROVE STREAM is owned by `BorrowFlow`. The drifted
BORROW slot still hardcodes `QUOTE UPDATED — REVIEW AGAIN`
(`web/components/borrow/ReviewHandoff.tsx:208-211`) before it reads
`signingBlockedReason`. APPROVE STREAM has no drifted branch; it honors only
the prop.

## Prevention

- Keep inventory test 6b. The test must fail if APPROVE STREAM is enabled at
  checkpoint `approve` while `signingBlockedReason` is set.
- Rule: every checkpoint that can broadcast must honor `signingBlockedReason`.
  For borrow that is `approve` (Sablier `approve`) and `sign` (`borrow`). For
  supply that is `approve` (ERC-20 `approve`) and `sign` (`supply`). A new
  flow with an approve checkpoint must copy the supply / borrow split, not
  only the action-button split.
- Do not treat a `signingBlockedReason` prop as coverage. The render branch
  for each broadcast slot must test the prop.
- Pair the disabled slot with a handler return on `chainGuard.wrongChain` and
  `!signingAllowed`.

Still open (do not treat as solved by this fix): there is no Playwright
scenario for stale signing. Test 6b is Vitest-only. Banner copy
`STALE — SIGNING DISABLED` (`SURFACE_STATE_LABEL.STALE` in
`web/lib/surface-state.ts:34`) is not the APPROVE STREAM `disabledReason`.
The button reason for stale signing is `EVENTS STALE — SIGNING DISABLED`
(`web/components/borrow/BorrowFlow.tsx:408`).

## Related Issues

- [Enforce write invariants at the write layer, not the call site](../architecture-patterns/enforce-write-invariants-at-the-write-layer-not-the-call-site.md)
  — wrong-network split: UX gate plus `chainId` on the write. Borrow APPROVE
  STREAM sat outside the UX gate.
- [Unified executor must latch identity and rebuild before every write](unified-executor-must-latch-identity-and-rebuild-before-write.md)
  — sibling identity latch before an approval prompt.
- [Invalid pre-submit rebuild must surface errors for stale recovery](invalid-presubmit-rebuild-must-surface-errors-for-stale-recovery.md)
  — stale recovery still needs the approve slot hidden while signing is blocked.
- [Freeze what you show, recompute what you submit](../design-patterns/freeze-what-you-show-recompute-what-you-submit.md)
  — a blocked signing state must freeze the approve control, not only calldata.
- [OVRFLO web standard](../patterns/ovrflo-web-standard.md) — executor latches
  and per-button pending; this learning adds: every approve slot honors
  `signingBlockedReason`.
