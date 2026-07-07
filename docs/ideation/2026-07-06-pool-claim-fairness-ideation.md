# Pool Claim Fairness Ideation

> **Subject:** Make pool claims fair so no contributor is blocked by faster claimants.
> **Constraint:** As simple as possible. No new storage if avoidable. No unnecessary abstractions.
> **Date:** 2026-07-06

## Problem

Current `claimPoolShare` caps at `min(remainingEntitlement, poolProceeds)` -- first-come-first-served. A large contributor who claims first can drain `poolProceeds`, forcing smaller contributors to wait for future repayments or stream accrual. `poolClaimLoan` is also FCFS: it draws directly from the stream to the caller, bypassing `poolProceeds` entirely.

The old pro-rata cap (computed against the shrinking `poolProceeds` pot) caused permanent stranding of minority contributors. The current FCFS cap fixed stranding but introduced the fairness issue.

## Key Insight

`loan.drawn + loan.repaid` already tracks total recovered value. No new storage variable is needed. The cumulative claimable formula is:

```
claimable = contribution * (drawn + repaid) / totalContributed - poolReceived[account]
```

Because `sum(claimable_i) <= drawn + repaid - sum(claimed) = poolProceeds` (flooring), `poolProceeds` is always sufficient for any individual claim. The `min(claimable, poolProceeds)` cap becomes redundant.

## Generated Ideas (6)

### 1. Cumulative formula + route poolClaimLoan through poolProceeds

Both claim functions use `contribution * (drawn + repaid) / totalContributed - poolReceived`. `poolClaimLoan` harvests withdrawable stream value into `poolProceeds` before paying. No new storage.

**Critique:** Mathematically sound. `poolProceeds >= claimable` is guaranteed by conservation. Both paths become fair. Moderate code change: rewrite two functions + one internal helper. Fuzz properties SP-58, SP-59 need updating (poolClaimLoan now changes poolProceeds). **SURVIVES.**

### 2. Merge poolClaimLoan and claimPoolShare into single `claim` function

One `claim(poolId, amount)` that auto-harvests withdrawable stream value into `poolProceeds`, computes claimable via cumulative formula, pays from `poolProceeds`. Delete `poolClaimLoan` and `claimPoolShare`.

**Critique:** Cleanest end state: one function, one code path, one event. But removes two public functions -- API break. Tests, fuzz handlers, and any integrators must update. Highest disruption for the same fairness result. **SURVIVES** but higher cost than Idea 1.

### 3. Auto-harvest helper shared by both functions

Add internal `_harvestAndClaim(poolId, account, amount)` that: (1) draws withdrawable into `poolProceeds`, (2) computes cumulative claimable, (3) pays from `poolProceeds`. Both `poolClaimLoan` and `claimPoolShare` become thin wrappers calling it. Keeps both public functions and their events.

**Critique:** Same behavior as Idea 1, more code (two wrappers + one internal vs rewriting two functions). The wrappers would be nearly identical, differing only in event emission. Adds indirection for no benefit over Idea 1. **SURVIVES** but Idea 1 is strictly simpler.

### 4. Cumulative formula on claimPoolShare only, leave poolClaimLoan as-is

Change `claimPoolShare` to use cumulative formula. Leave `poolClaimLoan` as direct stream draw (FCFS).

**Critique:** Does not solve the problem. A large contributor can still drain the stream via `poolClaimLoan` before others claim. The unfairness just moves channels. **REJECTED.**

### 5. New `poolRecovered` mapping

Track cumulative recovered in a new `mapping(uint256 => uint128) public poolRecovered`. Increment on every recovery (closeLoan, repayLoan, poolClaimLoan harvest). Use it in the claim formula instead of `loan.drawn + loan.repaid`.

**Critique:** Same result as Idea 1 but with redundant storage. `loan.drawn + loan.repaid` already is cumulative recovered. Adding a parallel accumulator creates a second source of truth that must be kept in sync. Violates "as simple as possible." **REJECTED.**

### 6. Epoch-based claiming

Divide time into epochs. Track per-epoch recovered and claimed. Distribute each epoch's recovery pro-rata within that epoch.

**Critique:** Complex. Requires per-epoch storage, epoch transition logic, and tracking which epoch each contributor last claimed in. Massive overkill for a pool with 2-5 contributors. **REJECTED.**

## Survivors (3, ranked by simplicity)

| Rank | Idea | New storage | API change | Code change | Fair? |
|------|------|-------------|------------|-------------|-------|
| 1 | Cumulative formula + route through poolProceeds | None | No (same functions) | Moderate | Yes |
| 2 | Merge into single `claim` | None | Yes (removes 2 fns) | Moderate | Yes |
| 3 | Shared `_harvestAndClaim` helper | None | No (same functions) | More code | Yes |

## Recommended: Idea 1

Simplest path to fairness with no API break and no new storage. The change is:

1. Add internal `_harvest(poolId)` that draws `min(withdrawable, outstanding)` from the stream into `poolProceeds` (only if loan is not closed).
2. Both `poolClaimLoan` and `claimPoolShare` call `_harvest` first.
3. Both use `claimable = contribution * (drawn + repaid) / totalContributed - poolReceived` instead of `min(remaining, poolProceeds)`.
4. `poolClaimLoan` pays from `poolProceeds` (via `safeTransfer`) instead of direct stream draw to caller.

### Why it works

- `poolProceeds = (drawn + repaid) - sum(poolReceived)` (conservation invariant SP-25)
- `claimable_i = contribution_i * (drawn + repaid) / totalContributed - poolReceived_i`
- `sum(claimable_i) <= (drawn + repaid) - sum(poolReceived) = poolProceeds` (flooring)
- Therefore `poolProceeds >= claimable_i` for every contributor. No one is blocked.
- `claimable_i <= contribution_i * totalObligation / totalContributed - poolReceived_i = entitlement_i - poolReceived_i <= remaining_i`. So SP-24 (poolReceived <= entitlement) still holds.

### Fuzz properties affected

- **SP-58** (poolClaimLoan: drawn += drawAmount, poolReceived += drawAmount): needs update -- drawn now increases by harvestAmount, poolReceived by claimAmount (they may differ).
- **SP-59** (poolClaimLoan: poolProceeds unchanged): needs update -- poolProceeds now increases by harvestAmount then decreases by claimAmount.
- **SP-25** (conservation): still holds.
- **SP-24** (poolReceived <= entitlement): still holds.
- **GL-14** (pool.active always true): unaffected.

## Edge Cases

1. **Rounding dust:** With 99/1 split and obligation 110, entitlements floor to 108 + 1 = 109, leaving 1 wei dust in poolProceeds. Acceptable -- dust is claimable by any contributor whose `claimable > 0` after flooring, or swept by admin.

2. **Harvest gas cost:** Every claim auto-harvests all withdrawable stream value. For pools with slow accrual this is one extra `sablier.withdraw` per claim. Acceptable since the stream is already being interacted with in `poolClaimLoan`, and `claimPoolShare` needs the harvest for fairness.

3. **Loan closed:** After `closeLoan`, the stream is returned to the borrower. `_harvest` is a no-op (loan.closed check). `claimPoolShare` pays from accumulated `poolProceeds` only. `poolClaimLoan` already requires `!loan.closed`.

4. **Multiple claims in same block:** Each claim harvests (getting 0 if nothing new accrued) and computes claimable from the updated `drawn + repaid`. Since `poolReceived` is updated atomically, no double-claim is possible.

5. **Contributor calls claim with amount > claimable:** `amount` is capped at `claimable` (same as current behavior where amount is capped at available). Caller can pass `type(uint128).max` to claim their full share.
