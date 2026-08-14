# 07 — Shell + watch surface

**What to build:** The home: shell chrome, role-lens wall, in-place details with roll-in heroes, all ribbon idiom, honesty end-to-end. A connected wallet with positions lands on the meter wall; empty confirmed wallets get first-run later (ticket 11) — this ticket owns the entry gate and the watch itself.

**Blocked by:** 04 — Component kit; 06 — Hooks + executor re-anchor

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U7 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/07-shell-and-watch-surface.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not implement Supply/Borrow/Assets/First-run flows beyond launching checkpoints already specified for watch actions. Do not invent an attention strip.
Before any writes, read Required reading below and the plan sections: Goal Capsule, Product Contract R1–R12, AE1–AE5, KTD6, KTD7, KTD12, KTD13, ### U7.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan R1–R12, F1–F2, AE1–AE5, KTD6–KTD7, KTD12–KTD13, ### U7
- Watch and shell briefs from ticket 02
- Approved walkthrough (hero → action → ribbons → facts → freshness)
- `docs/agents/testing.md` before any E2E
- this ticket's acceptance criteria

- [x] Disconnected visitors see the shell brief's disconnected entry; no protocol metrics
- [x] First-run renders only when positions, loans, AND stream discovery are all confirmed-empty; pending/could-not-ask with zero books renders degraded watch, never first-run
- [x] Role-lens wall: identity, state line, miniature ribbon, decisive number; zero-count lenses hidden; dual-role defaults to supplied
- [x] No aggregate attention strip; actions live on owning entities
- [x] Supplied detail leads with growing earnings and CLAIM; borrowed detail leads with outstanding countdown, done-date, and debt ribbon
- [x] Resting supply shows no motion (AE2); between-visits fill leads the state line (AE3); covered loan becomes close-ready (AE4)
- [x] Closed loans remain SETTLED on Borrowed; freed stream reappears under Streams on the same reconciling read
- [x] RPC blackout keeps heroes ticking, shows events as-of, disables signing (AE1)
- [x] Narrow viewports use list→detail with return; URL carries lens and selected entity at every width
- [x] Watch tests green at 1280px and 360px; E2E: seeded book renders; claim path completes on fork — remaining-gap (U14)

## Plan unit

U7 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
