# 04 — Explicit read outcomes and shadow discovery adapters

**What to build:** Financial read surfaces return explicit `loading` / `ready` / `partial` / `unavailable` outcomes with fresh/stale freshness — failed reads never become zero or ready-empty. Markets show aggregate depth first; APR buckets, personal positions, loans, demand, streams, and Claim All start only when their owning surface needs them. Hydration of projected candidates is block-pinned and bounded. Known-ID / tx-hash recovery verifies directly without claiming portfolio completeness. Replacement adapters run in **shadow** so live UI remains on legacy discovery until cutover.

**Blocked by:** 03 — Standard-RPC scanner and pure projections.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U4 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/04-read-outcomes-and-shadow-adapters.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U4.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- Goal Capsule stop conditions in the plan
- `docs/solutions/architecture-patterns/wagmi-read-batching-requires-matching-enabled-predicates.md`
- `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`
- this ticket's acceptance criteria


- [x] Shared outcome vocabulary and structured failure metadata are used across depth, routing, and hydration surfaces (AE1–AE2)
- [x] Successful siblings remain visible under partial; true empty only after complete success with no entities
- [x] Fresh public depth stays visible while routing is loading/partial/stale/unavailable; Borrow stays disabled until depth, routing, and selected hydration are ready
- [x] Executable depth is primary once routing is ready; public/fragmented depth is labeled secondary (AE31)
- [x] Connected portfolio shows unknown metrics and a load action before personal discovery starts — never zero or hidden (AE32)
- [x] Manual/deep-link/tx-hash recovery verifies identity, ownership/contribution, and eligibility without marking Claim All or portfolio complete (AE25, AE30, AE34)
- [x] Scope cancel on account/chain/market/APR/modal change; late results cannot populate the new identity
- [x] Vault registry enumeration is chunked complete/partial; failed subcalls never silently exclude origins (AE20, AE36)
- [x] Live consumers still use legacy discovery; shadow/test adapters prove replacement outcomes without authoritative flip

## Plan unit

U4 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
