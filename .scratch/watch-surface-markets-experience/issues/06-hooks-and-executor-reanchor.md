# 06 — Hooks + executor re-anchor

**What to build:** Every mechanism-map row is answerable by a named hook. The executor safety contract (rebuild, identity latch, stale recovery, zero-first approve) carries over intact against the new action builders. TanStack Query is the only chain-state store.

**Blocked by:** 05 — Pure lib layer

**Status:** resolved

## Session prompt (paste into a new chat)
```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/06-hooks-and-executor-reanchor.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not rewrite the executor. Do not weaken rebuild/latch/zero-first. Stop and surface if those cannot carry over.
Before any writes, read Required reading below and the plan sections: Goal Capsule, mechanism map, KTD5, KTD6, KTD9, KTD14, KTD16, ### U6, Sources learnings list.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan mechanism map, KTD5–KTD6, KTD9, KTD14, KTD16, ### U6, Sources learnings list
- The sixteen named learnings in the plan Sources (read the matching `docs/solutions/` files for executor, query, honesty, and batching)
- Lib modules from ticket 05
- this ticket's acceptance criteria

- [x] Named hooks cover clock (eager + hydration-safe), ladder, lender book, borrower book, streams, USD price, freshness, and acknowledgment
- [x] Books hydrate via enumeration → batched state reads with matching `enabled` predicates only
- [x] Stream discovery stays two-step (candidates vs truth); candidates never gate; eligibility mirror drops non-vault / wrong-asset streams
- [x] Query keys live in factories; no inline key literals outside the factory module
- [x] Invalidation after each write's receipt touches exactly its declared resources
- [x] Action builders produce reviewed actions; PERMISSION RECEIPT values assert byte-equal to built calldata
- [x] Per-position claim batches that position's loan pairs through Multicall with a measured pair cap and `ponytail:` ceiling comment
- [x] Replaced transactions (same nonce, new hash) resolve; invalid rebuild enters stale recovery; identity change mid-flow returns to review
- [x] Zero-first approve fires only on the classified revert shape and never re-triggers after confirm
- [x] Read failure classifies unavailable, never zero (AE1 data half); confirmed-empty is distinct from unavailable
- [x] Hook tests and migrated executor suite green; Chainlink addresses enter config only after explorer verification

## Plan unit

U6 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
