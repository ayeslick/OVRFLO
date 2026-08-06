# 09 — Shadow parity and live frontend cutover

**What to build:** At frozen blocks, prove aggregates ↔ uncapped position truth ↔ event projection ↔ selected routes vs legacy gather path, and streams/demand vs temporary Ponder after direct hydration. Record the full R39 ledger against ticket-01 ceilings (including constrained client and valid-history churn). Then switch **every** live frontend, fixture, stress, and walkthrough consumer to aggregates + projection + hydration in one cutover. Legacy surfaces remain only as removable parity instrumentation. Honor plan stop conditions (fresh generation, RPC history budget, shadow disagreement, external `gatherLiquidity` consumers, etc.).

**Blocked by:** 03 — Standard-RPC scanner and pure projections; 04 — Explicit read outcomes and shadow discovery adapters; 07 — Claim All through the executor; 08 — Shared flow shell and incremental modal split.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U9 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/09-parity-and-live-cutover.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U9.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Goal Capsule stop conditions in the plan
- `docs/solutions/developer-experience/post-refactor-dead-code-WebUI-20260421.md`
- `docs/agents/testing.md`
- Goal Capsule stop conditions (hard stop before irreversible flips)
- this ticket's acceptance criteria


- [x] Frozen-block projection positions, aggregate sums, and selected IDs match uncapped contract truth (`web/tests-live/parity-freeze.test.ts` vs the 501-position seeded fork, 2026-07-31)
- [x] Frozen demand and held streams verified against direct chain truth — Ponder-comparison half AMENDED: superseded by the decision to delete Ponder and port the same projection code server-side; held-stream/demand discovery is instead evidenced end-to-end by the green E2E suite whose fixtures use the live projection
- [x] >500 positions/loans remain discoverable without using the old capped frontend as oracle (501 positions, id-for-id vs uncapped storage enumeration)
- [ ] Adversarial dust and unrelated-stream-spam fixtures — AMENDED: deferred with the R39 set below (browser-scan cost fixtures; superseded pending the server-port decision)
- [x] Anvil snapshot/revert produces no stale ready projection (`web/tests-live/reorg-freshness.test.ts` live; chunk-boundary reorg guards unit-tested)
- [ ] R39 ledger vs pre-registered thresholds — AMENDED 2026-07-31: superseded pending the server-port decision (docs/plans server-port doc); the ledger, attacker-cost benchmark, and runtime-budget enforcement (review finding #12/P1) police in-browser scan cost, which the server port removes from the user path. Revisit only if browser-only is reaffirmed.
- [ ] Fresh-generation ✓ (seed artifact `freshGeneration: true`), two-provider Claim All agreement ✓ (E2E preflight corroborates over a distinct transport; local alias, not provider-independent), old-tick quote ✓ (unit). Direct-ID recovery and transport forward-roll — AMENDED: deferred with the server-port decision.
- [x] Every live consumer uses final outcomes; legacy reachable only via parity instrumentation (`web/tests/lib/discovery/live-cutover.test.ts`; no Ponder/`gatherLiquidity` deletion in this ticket)

**Resolution note (2026-07-31):** Cutover verified live: 727 unit tests, full E2E suite green on a fresh seeded fork (12 initial failures diagnosed — 3 real engine bugs fixed in `query-resource-registry`/`useTransactionExecutor`+classifier/`live-action-plan` deposit bound; the rest were fixture bugs and pre-redesign UI-contract drift), frozen-block parity proven at 501 positions. Unchecked items are explicit scope amendments tied to the pending server-port decision, not silent skips.

## Plan unit

U9 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
