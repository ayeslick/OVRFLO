# 02 — Authoritative liquidity depth and checkpoint events

**What to build:** Public liquidity depth becomes a bounded contract read (total per market and per market/APR). Every supply, withdrawal, stream-sale consumption, and actually consumed loan position updates those aggregates and emits exactly one absolute checkpoint (indexed lender, market, APR; liquidity ID and resulting availability in data). Lending economics, self-match, sorted IDs, and `availableLiquidity > 0` activity semantics stay unchanged. `gatherLiquidity` remains for shadow comparison until later tickets remove it.

**Blocked by:** None — can start immediately.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/02-liquidity-depth-and-checkpoints.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U2.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- Goal Capsule stop conditions in the plan
- https://ethskills.com/SKILL.md
- `docs/solutions/patterns/ovrflo-critical-patterns.md (rules 4, 6, 10, 16, 17)`
- `docs/solutions/best-practices/solidity-hot-path-optimization-patterns.md`
- this ticket's acceptance criteria


- [x] Summation-safe aggregates equal the sum of position availability after every mutation path (AE11)
- [x] Checkpoints emit only for touched/consumed positions; trailing backup IDs never emit (AE12)
- [x] Partial consumption leaves checkpoint result, storage, aggregate, and contribution in agreement
- [x] Loan references remain discoverable after availability reaches zero for lender-funded claims
- [x] Narrowed APR posting bounds reject new supply at old ticks without hiding or invalidating existing depth/routes (AE13, AE27)
- [x] `MAX_ROUTE_IDS` is measured against worst-case calldata/gas; 500+ dust fixtures stay safe under that bound (AE21)
- [x] Unit, fuzz, invariant, attack, and fork coverage stay green; no per-user index, linked list, or second route finder is added
- [x] `gatherLiquidity` still exists for shadow/parity use

## Plan unit

U2 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
