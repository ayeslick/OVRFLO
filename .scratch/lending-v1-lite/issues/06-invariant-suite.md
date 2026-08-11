# 06 — Invariant suite rewrite

**What to build:** X-ray first (user directive, 2026-08-08): execute the x-ray skill at `/Users/jay/.agents/skills/x-ray/SKILL.md` — follow its SKILL.md inline against the repo root — to regenerate `x-ray/` (x-ray.md, entry-points.md, invariants.md, architecture) over the rebuilt contracts, and update the docs that track it (`AUDIT.md` pointer notes referencing x-ray sections). Its `invariants.md` catalog (G/I/X/E blocks) then serves as the discovery checklist for the suite below — the plan stays the decision authority; the catalog is an input, and any catalog invariant not encoded must be recorded with a reason. Then replace `test/OVRFLOLendingInvariant.t.sol` with a handler + ghost suite for the new design, following the existing single-handler/bounded-actors/try-catch-skip pattern. Ghosts include per-tick posted/cancelled/filled mirrors, per-loan interval records, GL-70 close-time stream-withdrawn snapshots, and received-per-pair sums. Handlers must structurally exercise: multi-position fills crossing tree-node boundaries, forced growth and forced epoch rollover (via the harness capacity override), self-fills, time advancement, withdrawals interleaved with fills, and stream re-pledging — with a coverage assertion that every handler path executed.

**Blocked by:** 05 (parallel with 07)

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/06-invariant-suite.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. 07 runs in parallel — do not touch
test/OVRFLOFuzz.t.sol, test/OVRFLOAttackScenarios.t.sol, or test/fork/.
Before any code, read Required reading below and the plan sections: Goal Capsule,
Success Criteria (invariants), Planning Contract (Risks table; Pinned Conventions),
and ### U6. Invariants assert state identities against ghosts — never the
implementation's own arithmetic mirrored back at itself.
Step zero: execute the x-ray skill (/Users/jay/.agents/skills/x-ray/SKILL.md,
followed inline) to regenerate x-ray/ over the rebuilt contracts; update AUDIT.md's
x-ray pointer notes; use x-ray/invariants.md as the suite's discovery checklist.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `/Users/jay/.agents/skills/x-ray/SKILL.md` (execute, not just read — see step zero)
- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rule 6)
- `docs/solutions/logic-errors/stream-reuse-after-loan-close-property-fix.md` (GL-70)
- `docs/solutions/best-practices/closing-stateful-fuzz-coverage-gaps.md`
- `docs/solutions/best-practices/solidity-foundry-test-quality-antipatterns.md`
- `docs/solutions/best-practices/avoid-unnecessary-type-widening-with-invariant-guarantees.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Interval partition: per tick-epoch, loan intervals are disjoint, contiguous, and exactly tile `[0, filled)` (verified via stored `seq`: `loanAt[k].fillEnd == loanAt[k+1].fillStart`)
- [x] Frozen history: no coordinate below `filled` ever changes across any operation (ghost snapshots)
- [x] Escrow solvency: Σ per-tick `(root − filled) × UNIT` equals underlying held for unfilled positions (pattern #6 all-party balances extended to the tape)
- [x] Tree integrity: stored node = sum of children, across growth and rollover
- [x] Claim caps: Σ received per (loan, position) ≤ pro-rata entitlement (per-pair `received ≤ contribution × obligation / intervalLength`); Σ received per loan ≤ recovered; obligation ≤ remaining (carried from today's suite); handlers MUST reach over-vested open loans (`withdrawable > outstanding` — the U4-review mutation-proven theft boundary)
- [x] Non-UNIT-aligned `grossPrice` concrete case (U3 review, 2026-08-08): a max borrow whose `grossPrice` is not a UNIT multiple yields `obligation < remaining` strictly (safe direction) — pinning the floor/ceil boundary the 73-day/1.02 fixture never exercises
- [x] View-truth invariant (U5 review, 2026-08-08): for every (loan, position) pair the handler touches, `loansOf`'s reported `claimable` equals exactly what a subsequent max `claim` pays — the view mirror and the money path may never diverge
- [x] Epoch isolation: no claim pays across mismatched `(market, aprBps, epoch)` — adversarial handler pairs numerically identical intervals across epochs
- [x] Dust bound: closed-loan total claimant shortfall ≤ contributor count in wei; cursor soundness: cursor ≤ `currentEpoch`, every epoch below it has available < `MIN_LIQUIDITY_AMOUNT`
- [x] GL-70: close-time stream-withdrawn ghost snapshots keep re-pledged-stream properties exact
- [x] Handler coverage assertion proves multi-node fills, growth, rollover, self-fills, and re-pledge all executed in a run
- [x] x-ray regenerated over the rebuilt contracts; `AUDIT.md` x-ray pointer notes updated; every G/I/X invariant in the fresh `x-ray/invariants.md` is either encoded in the suite, covered by an existing test (cite it), or recorded as out-of-scope with reason
- [x] `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` green at runs=500 / depth=40

## Review batch (2026-08-10, applied)

Two reviews (plan-conformance; adversarial, with a 13-mutant kill-test campaign at the real gate profile)
examined `3ed77cf`. The campaign killed 6 and let 7 through: the suite was strong on conserved quantities and
blind on **who receives money** and on **liveness** — entire 500×40 campaigns completed with zero claims, and
the coverage gate was satisfied by the deterministic baseline alone. The consolidated batch landed here:

- [x] Recipients pinned (M3, M10): borrower net == `actualBorrow − fee`, treasury deltas == Σ fees, withdraw
      refund lands in the lender's own balance — `invariant_MoneyRecipients`.
- [x] Obligation recomputed handler-side per tick from `(actualBorrow, remaining, aprBps, ttm)` (M4), plus a
      second hand-derived literal at APR 1025 (`test_Borrow_ObligationTracksTheTickRate`).
- [x] Independent entitlement ceiling recomputed before every claim (M2) — `invariant_ClaimEntitlementCeiling`.
- [x] Liveness gates: claim, repay, close and post-fill withdraw are now mandatory per run (M9, M12), driven by
      the `_drainAllClaims` / `_withdrawFromFilledPosition` / `_partialRepay` scenarios.
- [x] Dust bound replaced (it followed from `Σ contribution == length` asserted the line above and read no
      contract state): a drained closed loan's residual `proceeds` ≤ contributing positions, in wei.
- [x] `*FromFuzz` counters gate the post-baseline path (M8); a cadence hook guarantees a structural pass every
      five calls so the gate is reachable at both profiles.
- [x] Maturity reachability: `_maturityExcursion` warps past expiry every run, exercises post-maturity
      repay/close/claim, then restores the clock.
- [x] Reported-but-reverted counter (M11) and the cross-epoch revert **selector** decoded (`EpochMismatch` only).
- [x] Selector rebalance: `structural` 5 weights → 1 (35.8% → 7.0% of calls), the four money paths ~7% → ~14%
      each; fuzzed seed threaded through the baseline; frozen-history snapshot moved above the baseline block.
- [x] Ghost hygiene: `ghostReceived`/`ghostReceivedLoan`/`ghostFilled` wired into assertions, open-loan stream
      custody invariant added, tautological `positionState` pair deleted, per-level Σchildren == parent walk
      added, `loansOf` paginated, `warpAndVest` vesting made monotone.
- [x] Disposition corrections: I-11/I-12/X-4 were FALSE (the cited tests did not exist) — the three guard tests
      are written and cited; I-22/I-23/X-1 citations corrected; I-16/I-18 monotonicity halves encoded with
      prior-value ghosts rather than downgraded; E-5 → PARTIAL with the U7 pointer.
- [x] `AUDIT.md` resynced: staleness banner across all seven old-numbering docs, one-line banner atop each of
      the five `docs/audit/` package docs, and the complete old→new ID map for all 34 I/X/E blocks.

## Plan unit

U6 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
