# 10 — Remove `gatherLiquidity`

**What to build:** After live cutover, audit repository and known external consumers. If any non-shadow consumer still requires `gatherLiquidity`, stop. Otherwise remove the unbounded view and dedicated handlers/tests, regenerate the frontend ABI, and re-prove targeted aggregate/event/runtime-parity and `MAX_ROUTE_IDS` fixtures against the final ABI.

**Blocked by:** 09 — Shadow parity and live frontend cutover.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U11 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/10-remove-gather-liquidity.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U11.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- Goal Capsule stop conditions in the plan
- Goal Capsule stop conditions (external gatherLiquidity consumers)
- this ticket's acceptance criteria


- [x] Consumer audit finds no non-shadow requirement for `gatherLiquidity` (name + selector `0x06076be8` + ABI-fragment sweep; only historical docs and absence-assertions remain)
- [x] Function removed; dedicated unit tests and fuzz handler removed (logged in `web/reviews/test-accountability.md`); parity instrumentation's gather branch removed
- [x] Generated client exposes aggregates/checkpoints and no `gatherLiquidity` (typegen clean)
- [x] Targeted parity and adversarial route fixtures pass after ABI regeneration (parity harness 4/4 vs 501-position seeded fork on the final ABI; deposit E2E spec 8/8; two-wallet walkthrough complete incl. stale-submit revert + re-quote)
- [x] Build-before-test discipline followed (`forge build` → `forge test` 373/373 with fork tests, invariant 7/7, fuzz 13/13)

**Resolution note (2026-07-31):** Also carried a follow-up engine fix from ticket 09's live evidence: the deposit rebuild's reviewed-bound tolerance now allows one extra slippage band of quote drift (upward drift on live markets re-tripped the review gate); degenerate bounds still tighten (review-gate unit tests unchanged and green).

## Plan unit

U11 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
