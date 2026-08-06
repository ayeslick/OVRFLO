# 05 — Pure action definitions (Borrow on projected routes)

**What to build:** Every supported OVRFLO action has a pure definition that turns identity-scoped snapshot + user intent into preconditions, amount validation, authorization plan, final-call construction, touched-resource tags, and review summary. Borrow consumes a complete routing outcome plus fresh selected-position hydration — not `gatherLiquidity` or global enumeration. Invalid amounts fail before approval planning or ABI encoding. Material route/call/approval/economic changes replace the frozen review.

**Blocked by:** 04 — Explicit read outcomes and shadow discovery adapters.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U5 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/05-pure-action-definitions.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U5.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- Goal Capsule stop conditions in the plan
- `CONCEPTS.md (OVRFLO rules)`
- this ticket's acceptance criteria


- [x] Exhaustive action registry covers all existing action types with current business rules preserved
- [x] Zero, negative, malformed, or over-capacity amounts fail before approval or encoding (AE5)
- [x] Matured claim capacity uses the fresh minimum of wallet balance, claimable PT, and market total deposited for MAX and manual validation
- [x] Borrow freezes sorted unique strictly increasing self-excluded liquidity IDs and rebuilds when rehydration changes route or economics (AE6)
- [x] Stale candidates are replaced or reported incomplete — never silently treated as available (AE4)
- [x] Allowance becoming satisfied without changing the final action does not force a new review
- [x] Pure definitions have no React, wallet, TanStack, Ponder, or `gatherLiquidity` dependency

## Plan unit

U5 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
