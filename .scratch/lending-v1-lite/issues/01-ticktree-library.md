# 01 — TickTree library

**What to build:** `src/TickTree.sol`, the self-contained packed prefix-sum tree: 64-bit node sums packed 4 per slot (hand-rolled pack/unpack helpers), `append`/`setLeaf`/`prefix`/`leaf`/`root`/`atCapacity` over a storage struct, dynamic height 4→7 where growth is one height increment plus one root-copy write. Custom errors, checked casts, zero knowledge of ticks/epochs/loans/tokens. Highest-risk pure component; lands first, alone, test-first against a reference model.

**Blocked by:** None — can start immediately.

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md

Scope: U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/lending-v1-lite/issues/01-ticktree-library.md
Spec/harness: .scratch/lending-v1-lite/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule,
Planning Contract (KTD2, KTD10, Risks #1–#2, Pinned Conventions and Schemas), and ### U1.
Execution note is binding: build the O(n) reference model and the differential test
harness FIRST; the library must agree with the model under randomized operation
sequences before contract work exists.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md` (rules 14, 15, 20)
- `docs/research/2026-08-03-lending-market-design-space.md` (segment-tree sections, for rationale only)
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Differential fuzz: library agrees with a naive in-test O(n) reference model under randomized append/shrink sequences (1000 runs per `foundry.toml`)
- [x] Boundary coverage: appends at `capacity−1`, `capacity`, `capacity+1` at each growth (4→5, 5→6, 6→7) and at the height-7 cap; prefixes of all pre-growth leaves unchanged after every growth
- [x] Growth root-copy: ordering assertion proves the old root is read before any new-height write; the copied value routes through the same checked-cast helper as leaf writes
- [x] `atCapacity` view is exact at the boundary (false at `capacity−1` leaves, true at `capacity`)
- [x] Errors per the plan's catalog: `LeafMissing`, `AtCapacity` (defense-in-depth), `NodeOverflow` (including on the root-copy path); leaf value 0 vs never-appended distinguished
- [x] Library imports OZ `Math`/`SafeCast` only; no tick/epoch/loan/token concepts anywhere in it
- [x] `forge build` clean; `forge test --match-path test/TickTree.t.sol` green; `forge fmt --check` clean

## Plan unit

U1 in `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`
