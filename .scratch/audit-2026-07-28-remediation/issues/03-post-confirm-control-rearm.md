# 03 — Post-confirm control re-arm

**Category:** bug (release blocker)

**Covers:** R7 (Tranche 2 — Release blockers). Findings: H-3.

**What to build:** Once an action transaction confirms, its control cannot be re-clicked into signing a duplicate transaction, and the user has clear confirmation that it succeeded.

**Details:**
- After a transaction confirms, the amount field clears (a cleared form must never be mistaken for an untouched one) and a transient success confirmation is shown.
- The primary action control does not stay armed in a way that lets a second click sign another transaction against stale state (e.g. clicking DEPOSIT again after a deposit just confirmed, before the form has reset).
- Applies across every action surface: ConvertForm (deposit/wrap/unwrap), BorrowForm, SupplyForm, AdjustRateForm, RepayForm, and claim actions.

**Acceptance criteria:**
- [x] AE2: given a transaction that has confirmed, clicking the primary action again signs nothing, the amount field is already empty, and a success confirmation is visible
- [x] Verified across all forms listed above, not just one
- [x] `npm --prefix web run test` green; manually exercised per the tranche 2 gate

**Out of scope:**
- Reverted-approval handling (that's ticket 04, R8) — this ticket is about the confirmed-success path only

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 2).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Independent of 02 and 04 — different code path (post-confirm state) than wrong-network gating or approval-failure detection.

**2026-07-29 (implemented):** Landed as U3 on branch `fix/audit-2026-07-28-tranche-1`.

The audit's diagnosis held exactly: no form's `disabled` predicate included `actionTx.isConfirmed`, so once a transaction confirmed, `busy` dropped back to false and the primary button re-armed with the original arguments still in the field. All six forms now carry `isConfirmed` in the predicate — five via their `disabled` const, `SimpleActionForm` inline since it has none.

Clearing the amount field is the other half, and it is only safe *because* the form simultaneously renders `CONFIRMED` and a `CLOSE` button — an empty field on its own is indistinguishable from a form the user never touched, which is the failure mode R7 names. New hook `web/hooks/useClearOnConfirm.ts`, mirroring the existing `useWalletChangeReset` shape. It fires once per confirmation rather than on every render while `isConfirmed` stays true, so a user typing their next amount in a still-open modal does not have it wiped from under them. Wired into the four forms that own a free-text amount (Supply, Convert, Borrow, Repay); AdjustRate and the SimpleAction family have no amount to strand.

Worth recording: the first placement put `useClearOnConfirm` *after* each form's `if (guard.walletChanged) return` early return, which is a rules-of-hooks violation — React threw "Rendered fewer hooks than expected" the moment the wallet-change guard fired, and `data-layer.test.tsx` caught it. The calls now sit above the guard in every form.

Coverage: 7 new cases — four amount-bearing forms disarmed on confirm, the field cleared, CONFIRMED shown alongside the cleared field, and an over-correction guard proving an unconfirmed form stays armed. Full suite 357 passed; lint and `tsc --noEmit` clean.
