# 03 — Standard-RPC scanner and pure projections

**What to build:** A pure, reorg-aware browser discovery module over standard JSON-RPC: capture finalized/latest heads and hashes, scan bounded address/topic ranges from the verified deployment anchor, reduce absolute checkpoints into active market/APR candidates and durable lender→loan relationships, discover borrower loans/demand and OVRFLO-origin held streams, and compare complete projection sums to block-pinned aggregates before routing can be ready. Includes an independent second-transport verifier projection used only by Claim All. No live UI cutover in this ticket.

**Blocked by:** 01 — Fail-closed runtime and verified deployment anchors; 02 — Authoritative liquidity depth and checkpoint events.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/03-standard-rpc-scanner-and-projections.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U3.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- Goal Capsule stop conditions in the plan
- `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`
- ticket 01 R39/R50 baselines (must already exist)
- this ticket's acceptance criteria


- [x] Scanner retries capacity errors on the same range, bisects only range/size (or boundedly retried timeout) failures, validates log identity, orders/dedupes deterministically, and cancels cleanly
- [x] Multi-range sync re-reads boundary hashes; mismatch discards the whole attempt without advancing the prior checkpoint (AE3, AE15, AE22)
- [x] Zero availability does not erase durable loan-reference candidates; active routing and claim history stay separate
- [x] Pure route selection minimizes cardinality, applies self-exclusion only after conservation, sorts IDs ascending, and exposes fragmented depth (AE14, AE21)
- [x] Stream candidates intersect vault `Deposited` origins with recipient Sablier transfers before hydration; spam is bounded and explicit (AE17, AE24)
- [x] Same-block conservation failure blocks routing rather than reporting empty/usable depth (AE23)
- [x] Independent Claim All verifier disagrees when one transport omits history; agreement alone never upgrades beyond “all discovered” (AE26, AE35)
- [x] Initial markets path needs no historical logs; Borrow scopes stay within indexed filters and recorded budgets (AE16)
- [x] R39 ledger instrumentation records attempts, bytes, duration, and provider-cost estimate; banned ad hoc log scans outside this module remain rejected

## Plan unit

U3 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
