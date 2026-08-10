# 06 — Invariant suite rewrite

**What to build:** X-ray first (user directive, 2026-08-08): execute the x-ray skill at `/Users/jay/.agents/skills/x-ray/SKILL.md` — follow its SKILL.md inline against the repo root — to regenerate `x-ray/` (x-ray.md, entry-points.md, invariants.md, architecture) over the rebuilt contracts, and update the docs that track it (`AUDIT.md` pointer notes referencing x-ray sections). Its `invariants.md` catalog (G/I/X/E blocks) then serves as the discovery checklist for the suite below — the plan stays the decision authority; the catalog is an input, and any catalog invariant not encoded must be recorded with a reason. Then replace `test/OVRFLOLendingInvariant.t.sol` with a handler + ghost suite for the new design, following the existing single-handler/bounded-actors/try-catch-skip pattern. Ghosts include per-tick posted/cancelled/filled mirrors, per-loan interval records, GL-70 close-time stream-withdrawn snapshots, and received-per-pair sums. Handlers must structurally exercise: multi-position fills crossing tree-node boundaries, forced growth and forced epoch rollover (via the harness capacity override), self-fills, time advancement, withdrawals interleaved with fills, and stream re-pledging — with a coverage assertion that every handler path executed.

**Blocked by:** 05 (parallel with 07)

**Status:** claimed
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

- [ ] Interval partition: per tick-epoch, loan intervals are disjoint, contiguous, and exactly tile `[0, filled)` (verified via stored `seq`: `loanAt[k].fillEnd == loanAt[k+1].fillStart`)
- [ ] Frozen history: no coordinate below `filled` ever changes across any operation (ghost snapshots)
- [ ] Escrow solvency: Σ per-tick `(root − filled) × UNIT` equals underlying held for unfilled positions (pattern #6 all-party balances extended to the tape)
- [ ] Tree integrity: stored node = sum of children, across growth and rollover
- [ ] Claim caps: Σ received per (loan, position) ≤ pro-rata entitlement (per-pair `received ≤ contribution × obligation / intervalLength`); Σ received per loan ≤ recovered; obligation ≤ remaining (carried from today's suite); handlers MUST reach over-vested open loans (`withdrawable > outstanding` — the U4-review mutation-proven theft boundary)
- [ ] Non-UNIT-aligned `grossPrice` concrete case (U3 review, 2026-08-08): a max borrow whose `grossPrice` is not a UNIT multiple yields `obligation < remaining` strictly (safe direction) — pinning the floor/ceil boundary the 73-day/1.02 fixture never exercises
- [ ] View-truth invariant (U5 review, 2026-08-08): for every (loan, position) pair the handler touches, `loansOf`'s reported `claimable` equals exactly what a subsequent max `claim` pays — the view mirror and the money path may never diverge
- [ ] Epoch isolation: no claim pays across mismatched `(market, aprBps, epoch)` — adversarial handler pairs numerically identical intervals across epochs
- [ ] Dust bound: closed-loan total claimant shortfall ≤ contributor count in wei; cursor soundness: cursor ≤ `currentEpoch`, every epoch below it has available < `MIN_LIQUIDITY_AMOUNT`
- [ ] GL-70: close-time stream-withdrawn ghost snapshots keep re-pledged-stream properties exact
- [ ] Handler coverage assertion proves multi-node fills, growth, rollover, self-fills, and re-pledge all executed in a run
- [ ] x-ray regenerated over the rebuilt contracts; `AUDIT.md` x-ray pointer notes updated; every G/I/X invariant in the fresh `x-ray/invariants.md` is either encoded in the suite, covered by an existing test (cite it), or recorded as out-of-scope with reason
- [ ] `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` green at runs=500 / depth=40

## Plan unit

U6 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
