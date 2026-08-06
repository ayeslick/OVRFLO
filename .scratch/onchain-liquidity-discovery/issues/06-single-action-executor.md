# 06 — Single-action transaction executor

**What to build:** One executor owns connect, account/chain latch, identity-scoped snapshot load, action rebuild, approval handling, exact final simulation, signature submission, receipt classification, scoped invalidation, critical refresh (projection reconcile + direct hydration), terminal UI state, and one in-flight execution per flow identity. Submits only the exact request from the last successful simulation. Successful receipt + failed critical refresh preserves the hash in a recoverable refresh-failed state; retry never rebroadcasts. No delayed indexer convergence.

**Blocked by:** 01 — Fail-closed runtime and verified deployment anchors; 05 — Pure action definitions (Borrow on projected routes).

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/06-single-action-executor.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U6.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Goal Capsule stop conditions in the plan
- `docs/solutions/architecture-patterns/scoped-cache-invalidation-and-its-named-exception.md`
- this ticket's acceptance criteria


- [x] Exact simulated request is what gets submitted; simulation failure produces no wallet prompt
- [x] Account, chain, route, calldata, value, approval, or queue-predecessor change forces rebuild and resimulation
- [x] Mined revert is failure with no success invalidation (AE7)
- [x] Receipt success + refresh failure preserves hash; refresh retry never writes (AE8)
- [x] Critical refresh reconciles touched event scopes and resolves action-defined resources to fresh ready data for the latched identity before fully refreshed success
- [x] One discovery transport snapshot per reconciliation; execution reverts are never reinterpreted as provider availability failure
- [x] Duplicate confirmation / rerender / modal reopen cannot create a second prompt for one flow identity
- [x] Every single action path uses this executor (legacy dual write paths no longer authoritative)

## Plan unit

U6 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
