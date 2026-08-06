# 07 — Claim All through the executor

**What to build:** Claim All is a sequential orchestration layer over the single-action executor. It builds only after every enabled lending and held-stream scope is complete and hydrated, and only when primary and independent verifier projections agree on sorted candidate identity sets at the same captured block/hash. Confirmed rows stay immutable across pause/resume; loss of completeness, agreement, account, or chain pauses before the next wallet prompt. Incomplete discovery never enables a batch Claim All (individual verified actions may remain).

**Blocked by:** 04 — Explicit read outcomes and shadow discovery adapters; 06 — Single-action transaction executor.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U7 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/07-claim-all-through-executor.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U7.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Goal Capsule stop conditions in the plan
- plan KTD14 / Claim All requirements R12, R24-R25, R47
- this ticket's acceptance criteria


- [x] Preflight shows source-level progress with Close/Cancel, failed-scope Retry, and safe session-cache reuse (AE33)
- [x] Primary/verifier candidate-set disagreement or missing verifier disables Claim All without false completeness (AE26, AE35)
- [x] Each row goes through the executor; after success + critical refresh, the next unsent row rebuilds
- [x] Completeness lost mid-queue keeps confirmed rows and pauses before another wallet prompt (AE9)
- [x] Changed or disappeared grouped constituents produce needs-review or skipped; confirmed rows remain immutable
- [x] Loss of provider agreement, hydration freshness, account, or chain pauses before the next prompt
- [x] Known-ID single recovery remains available without enabling the batch
- [x] Claim All has no independent signing or discovery implementation of its own

## Plan unit

U7 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
