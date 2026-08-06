# 18 — Claim-plan freshness & signer-switch race guard

**Category:** bug (race condition)

**Covers:** R41, R42 (Tranche 5 — Indexer trust and races). Findings: M-6, M-7.

**What to build:** A multi-step claim plan (e.g. claim-all across several streams) is computed fresh at submit time rather than frozen at the moment the modal opened, and a signer switch mid-flow cannot be beaten by a transaction that was already queued against the previous signer.

**Details:**
- R41/M-6: if a claim-all (or any multi-step) plan is built when the modal opens and the underlying state changes before submit (a stream gets claimed elsewhere, a position changes), the frozen plan can be stale by the time it's submitted. Recompute the plan at submit time.
- R42/M-7: if the user switches wallets/signers mid-flow, an already-queued transaction targeting the old signer must not be able to land after the switch as if it came from the new signer's context — guard against that race explicitly.

**Acceptance criteria:**
- [x] Claim-all (and any other multi-step plan) is recomputed immediately before submission, not reused from modal-open time
- [x] A test simulates state changing between modal-open and submit, and asserts the submitted plan reflects the fresh state
- [x] A test simulates a signer switch with an in-flight queued transaction and asserts it cannot be attributed to / land under the new signer incorrectly
- [x] `npm --prefix web run test` green

**Out of scope:**
- General transaction simulation/pre-flight (covered by the separate SE2-adoption plan, R1–R3) — this ticket is specifically about plan freshness and signer-switch races, not simulation

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 5).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Last ticket in the set — closes out tranche 5 alongside 14–17.

**2026-07-29 (implemented):** Landed as U18 on branch `fix/audit-2026-07-28-tranche-1` — the last unit in the plan.

*Plan freshness (R41/M-6).* The claim-all plan was frozen at modal open by a `useState` initialiser, and CONFIRM QUEUE submitted that snapshot. RESUME always re-planned from live props; the first confirm did not, which is the asymmetry the finding names. Between opening and confirming, a stream can be claimed elsewhere or a pool share drawn down, and the frozen plan would queue transactions that are already spent. The plan is now recomputed at submit. The review list stays a snapshot — that is the right thing to *show* — but it is not what gets submitted. If the recomputed plan is empty the modal says everything was claimed elsewhere, rather than queueing nothing and reporting success.

*Signer-switch race (R42/M-7).* The audit's diagnosis was exact: the pause effect and the receipt-advance effect run in the same commit when a receipt lands on the render where `user` changed, and the advance effect's closure still holds the pre-update `paused === false`. It therefore dispatched the next transaction against the **new** signer. It fails closed on-chain — Sablier rejects a non-recipient, `claimLoanPoolShare` reverts — but the user gets a wallet prompt they never initiated, which is the actual harm.

Fixed with a `queueOwner` ref rather than more state: a ref is read at execution time instead of captured in a closure, so the window closes regardless of effect ordering. An explicit RESUME re-owns the queue for the new signer, which is the user's deliberate act and distinct from auto-advance.

Coverage includes an over-correction guard in both places — the queue must still advance normally when the signer has *not* changed, and a recomputed plan must not drop work that is still valid.

Verification: 448 unit tests (up from 444), 32 E2E scenarios, lint, `tsc --noEmit`, and the a11y sweep clean.
