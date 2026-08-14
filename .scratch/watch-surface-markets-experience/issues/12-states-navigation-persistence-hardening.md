# 12 — States, navigation, persistence hardening

**What to build:** The flow spec's global rendering states and navigation/persistence rules hold on every surface. Failure containment is regional. Drafts persist selections only; quotes always rebuild.

**Blocked by:** 07 — Shell + watch surface; 08 — Supply flow; 09 — Borrow flow; 10 — Assets: converter + stream creation; 11 — First run + risk surface

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U12 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/12-states-navigation-persistence-hardening.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not add new product flows. Wire the eight-state grammar and persistence rules across existing surfaces.
Before any writes, read Required reading below and the plan sections: Goal Capsule, R8, R13, AE1, KTD13, ### U12, flow-spec Global Rendering States + Navigation and Persistence.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan R8, R13, AE1, KTD13, ### U12
- `docs/plans/2026-08-11-markets-frontend-flow-spec.md` Global Rendering States + Navigation and Persistence (read-only)
- Wallet-change reset and stale-recovery learnings
- `docs/agents/testing.md` before E2E
- this ticket's acceptance criteria

- [x] One representative topology per route renders all eight states with distinct, labeled UI; LOADING ≠ zero; STALE (signing disabled, refresh) is visually distinct from LOADING
- [x] DEGRADED — SHOWING LAST KNOWN is wired end-to-end from freshness
- [x] Back moves one decision preserving valid selections; checkpoints revalidate and fall back to review (never enterable from history)
- [x] Borrow/Supply drafts persist selections-only per wallet+chain; quotes always rebuild from live reads
- [x] Wallet/chain change clears approvals/quotes/checkpoints and invalidates every address/chain-keyed query
- [x] Receipts recoverable by tx hash until reads reflect the entity; a receipt-confirmed tx plus stale RPC never resurrects pre-transaction balances
- [x] One error boundary per independent display region; expected errors handled locally
- [x] Background refetch failure surfaces one global notice, not per-hook toasts
- [ ] Hardening tests green; E2E wallet-switch mid-supply and RPC-blackout (fork paused) pass — **unit half done** (`tests/hardening` 29 files / 149 tests green with watch/supply/borrow/assets/first-run). E2E wallet-switch / RPC-blackout remains U14.

## Plan unit

## Plan unit

U12 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
