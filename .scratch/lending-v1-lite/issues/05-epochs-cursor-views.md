# 05 — Epochs, cursor, and the discovery views

**What to build:** Activate the capacity backstop and finish on-chain discovery. `supply` pre-checks `TickTree.atCapacity` and opens epoch N+1 *before* appending (internal library reverts cannot be caught; `AtCapacity` stays defense-in-depth). `borrow` advances `oldestLiveEpoch` past epochs with available `< MIN_LIQUIDITY_AMOUNT` (one predicate for drained and dust epochs, which become withdraw-only), capped at `CURSOR_CAP = 32` → `EpochBacklog`. `advanceEpochCursor(market, aprBps, maxSteps)`: permissionless, progress-persisting, no-op success, `ZeroSteps` guard, `EpochCursorAdvanced` event. Views: `tickDepths(market)` (whole ladder, one multicall) and `loansOf(positionId, startSeq, maxN) → (entries[], nextSeq)` (binary search over the interval-sorted loan list; entries carry `(loanId, contribution, claimable)`).

**Blocked by:** 04

**Status:** open
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/05-epochs-cursor-views.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule,
Product Contract (R3, R5, R17, R18; AE6, AE8), Planning Contract (KTD4, KTD8;
Risks #3, #4; Pinned Conventions and Schemas — the advanceEpochCursor and loansOf
semantics are pinned there in full), and ### U5.
Extend the LendingInternalHarness with a capacity-override hook so growth and rollover
are testable without 2M supplies.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rules 6, 7, 17)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Covers AE6. At tree capacity, the next `supply` succeeds — height grows below the cap, epoch opens at the cap — and every prior position's coordinates, loan intervals, and claimables are byte-identical before/after
- [ ] Covers AE8, both branches: an above-minimum oldest-epoch residual partially fills then the cursor advances; a sub-minimum dust epoch is skipped in the same borrow transaction, its remainder withdraw-only
- [ ] Rollover uses the `atCapacity` pre-check — no try/catch on the internal library anywhere
- [ ] Recovery: a backlog deeper than `CURSOR_CAP` reverts `EpochBacklog`, then repeated `advanceEpochCursor(…, maxSteps)` calls durably restore borrowability (test with backlog > cap); `ZeroSteps` reverts; no-op call succeeds returning the unchanged cursor
- [ ] Cursor never passes an epoch with available ≥ `MIN_LIQUIDITY_AMOUNT` and never exceeds `currentEpoch`
- [ ] Old-epoch behavior after rollover: withdraw from a drained-epoch position, and claims against old-epoch loans, work unchanged
- [ ] `tickDepths(market)` returns every spacing-multiple tick within current bounds with depth summed across live epochs — exercised as one multicall in a view test
- [ ] `loansOf`: binary-search entry, exact pagination continuation across a `maxN` boundary (`nextSeq` contract per pinned semantics), entries match `contributionOf`/claimable ground truth
- [ ] `EpochOpened`/`EpochCursorAdvanced` events per schema; `forge build` then `forge test` green; `forge fmt --check` clean

## Plan unit

U5 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
