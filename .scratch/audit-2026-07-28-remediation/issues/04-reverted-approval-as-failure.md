# 04 — Reverted approval treated as failure

**Category:** bug (release blocker)

**Covers:** R8 (Tranche 2 — Release blockers). Findings: M-2.

**What to build:** An approval transaction that mines but reverts on-chain is treated as a failed approval everywhere approval state is checked — never as a successful one.

**Details:**
- Find every place approval status is read/inferred (e.g. `convertApprovalNeeds` and equivalents for PT approve, stream approve, and any other allowance-gated flow) and ensure a mined-but-reverted approval tx does not get treated as having succeeded (e.g. via an optimistic "approved amount" flag that was set on submission rather than confirmed reversion-checked receipt).
- This is distinct from ticket 02 (wrong-chain refusal) and distinct from the deposit fee-approve buffer work in the separate dogfood plan (001) — this ticket is specifically: on-chain revert of an approval must read as failure, full stop.

**Acceptance criteria:**
- [x] AE3: given an approval that was mined but reverted on-chain, when the flow evaluates approval state, it reports failure rather than advancing to the action step
- [x] Covers every approval-gated flow in `web/`, not just the deposit fee-approve path
- [x] A regression test simulates a reverted approval receipt and asserts the UI does not advance
- [x] `npm --prefix web run test` green

**Out of scope:**
- The 2% fee-approve buffer strategy (separate, already-planned work in `docs/plans/2026-07-28-001-fix-dogfood-c1024d9-borrow-gate-and-fee-approve-plan.md`) — don't re-litigate that decision here, just fix revert detection

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 2).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Note for whoever picks this up: check whether ticket 01 from the dogfood-followups plan (`.scratch/dogfood-c1024d9-followups/issues/04-decide-deposit-fee-approve-strategy.md`) already touches this same approval-state code — coordinate to avoid double-editing `convertApprovalNeeds`.

**2026-07-29 (implemented):** Landed as U4 on branch `fix/audit-2026-07-28-tranche-1`.

The audit's diagnosis was exact. `useWriteFlow` already distinguished a reverted transaction from a failed fetch (`isReverted` vs `isConfirmed`, read off `receipt.data.status`) — that part was fixed in `c1024d9`. What it did not do was give consumers a single way to ask "did this fail", so all five forms independently reset their optimistic approval state on `approveTx.error` alone. On an on-chain-reverted approval `error` is `null` and `isReverted` is `true`, so the optimistic amount survived and the UI advanced past an approval that never happened.

Fixed at the source rather than five times over: `useWriteFlow` now returns `hasFailed` (`Boolean(error) || isReverted`), and all five reset effects consume it. A sixth form added later reaches for the same signal. The six StepIndicator sites that already spelled the condition out longhand now use it too, so `hasFailed` is the one idiom for write failure.

Audited but unchanged: `useTxQueue` already treats a mined-but-reverted receipt as a failed row (`receipt.data?.status !== "success"`), also from `c1024d9`. No approval path outside `ActionModal` was found.

Coverage: 5 new cases on `hasFailed`, the first of which pins the exact shape that made this invisible — `error` null, `isReverted` true, `hasFailed` true. Full suite 362 passed; lint and `tsc --noEmit` clean.
