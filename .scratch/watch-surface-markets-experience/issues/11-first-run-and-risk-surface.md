# 11 — First run + risk surface

**What to build:** The guided path for a protocol-empty wallet and the factual risk note with one-time per-wallet acknowledgment. First-run is the app's only teaching surface.

**Blocked by:** 04 — Component kit; 06 — Hooks + executor re-anchor

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U11 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/11-first-run-and-risk-surface.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not add engagement mechanics, synthetic loans, or load-bearing Pendle URLs. Follow the first-run brief.
Before any writes, read Required reading below and the plan sections: Goal Capsule, R12, AE5, F4, ### U11.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan R12, AE5, F4, ### U11, Risk 8
- First-run and shell briefs from ticket 02
- Approved walkthrough section 7
- `docs/agents/testing.md` before E2E
- this ticket's acceptance criteria

- [x] Protocol-empty wallet renders the guided path (AE5) — no demonstration loan, no synthetic instrument, no empty meter wall
- [x] Cycle strip uses market-driven token copy; symbol renders live `symbol()` when a market is chosen
- [x] Resource-aware intent rows: borrow path via address-verified external Pendle link (degrades to naming the market if the URL rots) or deposit; supply ready when underlying balance exists
- [x] Dismiss persists per wallet and yields a plain chooser
- [x] Risk page is factual (contract risk, audit status from the repo record, dependencies, fixed-schedule projection basis, not financial advice) and readable disconnected
- [x] First write per wallet inserts one ACKNOWLEDGE RISK step into that flow's SETTLEMENT trace; never re-prompts; never gates reads — helper + tests shipped (`useAcknowledgeRiskTrace`, `AcknowledgeRiskStep`). U12 wired the step into supply, borrow, wrap, stream-create, and watch writes. The executor is unchanged (ack is a trace overlay, not a write).
- [x] Deposit handoff carries into stream-creation — first-run routes to `/assets` (`UI-ASSETS-STREAM-SELECT-MARKET`); U10 owns the flow body
- [x] Component tests green (`cd web && node ./node_modules/vitest/dist/cli.js run tests/first-run` — 23 passed). E2E not in this worker (U14)

## Plan unit

U11 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`

## Comments

Closed 2026-08-14. The leftover ack checkbox waited on U12. Supply, borrow, converter, stream-create, and `WatchWrite` all call `useAcknowledgeRiskTrace`. Reads stay ungated. E2E of first-run remains the orchestrator Verification Contract (seeded-fork suite), not a U11 reopen.
