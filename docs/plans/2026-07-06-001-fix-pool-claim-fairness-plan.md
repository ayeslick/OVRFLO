---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
title: Fair Pool Claims - Plan
type: fix
date: 2026-07-06
execution: code
---

# Fair Pool Claims - Plan

## Goal Capsule

- **Objective:** Replace the first-come-first-served pool claim formula with a cumulative-recovered formula so every contributor can claim their pro-rata share without being blocked by faster claimants.
- **Product authority:** Brainstorm decisions: keep both `poolClaimLoan` and `claimPoolShare` as separate functions; harvest only the deficit from the stream, not all withdrawable.
- **Stop conditions:** `forge build` passes; all unit, fuzz, and invariant tests pass with updated SP-58/59/60; SP-25/24/23/20 invariants hold; no new storage; no API break.
- **Execution profile:** Code implementation, test-first.
- **Tail ownership:** Implementer handles cleanup of dead code (`_remainingEntitlement` removal).

---

## Product Contract

Product Contract unchanged from brainstorm.

### Summary

Both pool claim functions switch from `min(remainingEntitlement, poolProceeds)` (FCFS) to `contribution * (drawn + repaid) / totalContributed - poolReceived` (cumulative recovered). No new storage. No API break.

### Problem Frame

Current `claimPoolShare` caps at `min(remainingEntitlement, poolProceeds)`. A large contributor who claims first can drain `poolProceeds`, forcing smaller contributors to wait. `poolClaimLoan` draws directly from the stream to the caller, also FCFS. The old pro-rata cap (against the shrinking `poolProceeds` pot) caused permanent stranding; the current FCFS cap fixed stranding but introduced the fairness issue.

### Requirements

- R1. Both `poolClaimLoan` and `claimPoolShare` compute claimable using `contribution * (loan.drawn + loan.repaid) / pools[poolId].totalContributed - poolReceived[account]`.
- R2. Both functions harvest only the deficit (`requestAmount - poolProceeds`) from the stream when `poolProceeds` is insufficient and the loan is open.
- R3. No new storage variables are added.
- R4. Both public function signatures and events are preserved (no API break).
- R5. `poolClaimLoan` retains `!loan.closed` guard; `claimPoolShare` works whether the loan is open or closed.
- R6. Fuzz properties SP-58, SP-59, SP-60 are updated to reflect new behavior.
- R7. Invariants SP-25, SP-24, SP-23, SP-20 continue to hold.

### Scope Boundaries

- Merging `poolClaimLoan` and `claimPoolShare` into one function: out of scope (decided: keep both).
- New storage variables: out of scope (using existing `loan.drawn + loan.repaid`).
- Eliminating rounding dust: out of scope (accepted as inherent to integer math).
- Changing `closeLoan` or `repayLoan`: out of scope (they already feed `poolProceeds` correctly).

---

## Planning Contract

### Key Technical Decisions

- **KTD1. Use `loan.drawn + loan.repaid` as total recovered.** No new `poolRecovered` mapping. The data already exists on the loan struct; a parallel accumulator would be redundant storage and a second source of truth to keep in sync.

- **KTD2. Harvest only the deficit.** When `poolProceeds < requestAmount` and the loan is open, withdraw only `min(deficit, withdrawable, outstanding)` from the stream. Gas-efficient: after `closeLoan` draws full outstanding into `poolProceeds`, claims pay from the pot with zero stream interaction.

- **KTD3. Shared `_claimFair` internal.** Both external functions delegate to one internal that handles the cumulative formula, deficit harvest, and payment from `poolProceeds`. The only differences in the wrappers are the `!loan.closed` guard (`poolClaimLoan` only) and the event emitted.

- **KTD4. Remove `_remainingEntitlement`.** It was only used by the two claim functions. The cumulative formula inside `_claimFair` replaces it. Keeping it would be dead code.

### Invariants Preserved

- **SP-25** (conservation: `poolProceeds + sum(poolReceived) == drawn + repaid`): every harvest adds to both `drawn` and `poolProceeds`; every payment adds to `poolReceived` and subtracts from `poolProceeds`.
- **SP-24** (poolReceived <= entitlement): `claimable <= entitlement - poolReceived` because `drawn + repaid <= totalObligation`.
- **SP-23** (sum(poolReceived) <= totalObligation): follows from SP-24 summing across contributors.
- **SP-20** (pro-rata floored): cumulative formula uses integer flooring, same as current `_remainingEntitlement`.

### Edge Cases

1. **Rounding dust:** With a 99/1 contribution split and small recovered amounts, the minority share may floor to 0. Same flooring as current `_remainingEntitlement`. Dust becomes claimable as `recovered` approaches `totalObligation`.
2. **Loan closed:** `_claimFair` skips harvest when `loan.closed`. Pays from accumulated `poolProceeds` only.
3. **Multiple claims same block:** Each claim computes `claimable` from updated `drawn + repaid` and `poolReceived`. No double-claim because `poolReceived` is incremented atomically.
4. **Amount > claimable:** Capped at `claimable`. Callers can pass `type(uint128).max` to claim full share.
5. **Nothing to harvest:** If `withdrawable == 0` and `poolProceeds == 0`, `payAmount` is 0 and the function reverts with "nothing claimable."

---

## Implementation Units

### U1. Implement `_claimFair` and rewrite both claim functions

**Goal:** Replace the FCFS claim logic with the cumulative-recovered formula and deficit-based harvest.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- `src/OVRFLOBook.sol` (modify)

**Approach:**

Add internal `_claimFair(uint256 poolId, address account, uint128 amount) returns (uint128 payAmount)`:

1. Load `contribution = poolContributions[poolId][account]`; require > 0.
2. Load `loan = loans[poolLoanId[poolId]]`; compute `recovered = loan.drawn + loan.repaid`.
3. Compute `claimable = contribution * recovered / pools[poolId].totalContributed - poolReceived[poolId][account]`.
4. Cap `requestAmount = min(amount, claimable)`.
5. If `!loan.closed` and `poolProceeds[poolId] < requestAmount`: compute `deficit = requestAmount - poolProceeds[poolId]`; compute `harvestable = min(withdrawableAmountOf, outstanding)`; `harvestAmount = min(deficit, harvestable)`; if > 0, `sablier.withdraw(streamId, address(this), harvestAmount)`, `loan.drawn += harvestAmount`, `poolProceeds += harvestAmount`.
6. `payAmount = min(requestAmount, poolProceeds[poolId])`; require > 0.
7. `poolReceived += payAmount`; `poolProceeds -= payAmount`; `safeTransfer(account, payAmount)`.

Rewrite `poolClaimLoan`: keep contributor check, loanId lookup, `_requireLoanExists`, `!loan.closed` guard; replace body with `payAmount = _claimFair(poolId, msg.sender, amount)`; emit `PoolLoanClaimed(poolId, msg.sender, loanId, payAmount)`.

Rewrite `claimPoolShare`: replace body with `payAmount = _claimFair(poolId, msg.sender, amount)`; emit `PoolShareClaimed(poolId, msg.sender, payAmount)`.

Remove `_remainingEntitlement` (dead code after rewrite).

**Patterns to follow:** Existing `_minUint128`, `_toUint128`, `_outstanding`, `_requireLoanExists` helpers. `safeTransfer` for ovrfloToken payout (same as current `claimPoolShare`). `nonReentrant` on both external functions (already present).

**Test scenarios:**
- Happy path: single contributor claims full share after `closeLoan` drew outstanding into `poolProceeds`; receives exact pro-rata amount.
- Fairness: pool with A=99, B=1; A claims first and receives 99% of recovered; B claims immediately after and receives their 1% without waiting.
- Harvest deficit: loan open, stream accrued, `poolProceeds == 0`; claim harvests only the deficit from the stream, not all withdrawable.
- No harvest needed: `poolProceeds` covers claim (from prior `repayLoan`); no stream interaction occurs.
- Loan closed: `poolClaimLoan` reverts with "loan closed"; `claimPoolShare` pays from `poolProceeds` without harvest.
- Rounding dust: 99/1 split with small recovered amount; minority `claimable` floors to 0; reverts with "nothing claimable".
- Amount > claimable: caller passes `type(uint128).max`; receives exactly `claimable`.
- Nothing claimable: `withdrawable == 0` and `poolProceeds == 0`; reverts with "nothing claimable".
- Conservation: after each claim, `poolProceeds + sum(poolReceived) == drawn + repaid` holds.

**Verification:** `forge build` passes; existing claim tests in `test/OVRFLOBook.t.sol` pass with updated assertions.

**Execution note:** Implement new behavior test-first: write the fairness test (A=99, B=1, both can claim) before changing the claim functions.

---

### U2. Update unit tests for new claim behavior

**Goal:** Update existing claim tests to match new semantics and add fairness-specific tests.

**Requirements:** R1, R4, R5

**Dependencies:** U1

**Files:**
- `test/OVRFLOBook.t.sol` (modify)

**Approach:**

Update existing tests that assert FCFS-specific behavior (e.g., tests that expect `poolClaimLoan` to leave `poolProceeds` unchanged, or tests that expect `claimPoolShare` to be capped by `poolProceeds` rather than cumulative claimable).

Add new tests:
- `test_ClaimFair_BothContributorsCanClaim`: A=99, B=1, `closeLoan` draws full outstanding, A claims 99%, B claims 1% immediately after.
- `test_ClaimFair_HarvestDeficit`: loan open, stream accrued, `poolProceeds == 0`, contributor claims and harvests only the deficit.
- `test_ClaimFair_NoHarvestWhenProceedsSufficient`: `repayLoan` adds to `poolProceeds`, subsequent claim does not interact with stream.
- `test_ClaimFair_LoanClosedPoolClaimReverts`: `poolClaimLoan` after `closeLoan` reverts; `claimPoolShare` succeeds.
- `test_ClaimFair_AmountCappedAtClaimable`: caller passes `type(uint128).max`, receives exact `claimable`.

**Patterns to follow:** Existing test patterns in `test/OVRFLOBook.t.sol` (mock Sablier, mock oracle, assert all-party balances per pattern #7).

**Test scenarios:**
- Existing claim tests pass with updated assertions.
- New fairness tests verify pro-rata distribution regardless of claim order.
- Balance assertions: check `poolProceeds`, `poolReceived`, `loan.drawn`, `ovrfloToken.balanceOf` for all parties.

**Verification:** `forge test --match-contract OVRFLOBookTest` passes.

---

### U3. Update fuzz properties and handlers

**Goal:** Update SP-58, SP-59, SP-60 to reflect the new claim behavior where `drawn` and `poolReceived` deltas may differ, and `poolProceeds` may change in `poolClaimLoan`.

**Requirements:** R6, R7

**Dependencies:** U1

**Files:**
- `test/fizz/Properties.sol` (modify)
- `test/fizz/handlers/OVRFLOBookHandler.sol` (modify)

**Approach:**

**SP-58** (poolClaimLoan: drawn += drawAmount, poolReceived += drawAmount): update to check that `drawn` increases by `harvestAmount` (may be 0 if no harvest needed) and `poolReceived` increases by `payAmount`. These may differ when `poolProceeds` had pre-existing balance that covered part of the claim.

**SP-59** (poolClaimLoan: poolProceeds unchanged): update to check that `poolProceeds` net change equals `harvestAmount - payAmount`. When no pre-existing proceeds, this is 0 (harvest == pay). When pre-existing proceeds cover part of the claim, `poolProceeds` decreases.

**SP-60** (claimPoolShare: poolReceived += amount, poolProceeds -= amount): update to also account for `drawn` increasing by `harvestAmount` (if claimPoolShare harvested a deficit) and `poolProceeds` net change being `harvestAmount - payAmount`.

Update handler property calls in `oVRFLOBook_poolClaimLoan` and `oVRFLOBook_claimPoolShare` to call the updated properties.

**Patterns to follow:** Existing SP-XX property patterns in `Properties.sol` (snapshot before/after, delta assertions).

**Test scenarios:**
- SP-58 updated: tolerates `drawn` delta != `poolReceived` delta.
- SP-59 updated: tolerates `poolProceeds` net change != 0 in `poolClaimLoan`.
- SP-60 updated: tolerates `drawn` increase and `poolProceeds` net change in `claimPoolShare`.
- SP-25, SP-24, SP-23, SP-20 still pass unchanged.

**Verification:** `forge test --match-contract OVRFLOBookInvariant` passes (1000 runs, 500k calls).

---

## Verification Contract

| Gate | Command | Applies to |
|------|---------|------------|
| Build | `forge build` | All units |
| Unit tests | `forge test --match-contract OVRFLOBookTest` | U1, U2 |
| Invariant tests | `forge test --match-contract OVRFLOBookInvariant` | U1, U3 |
| Fuzz tests | `forge test --match-contract OVRFLOFuzz` | U1 |
| Full suite (no fork) | `forge test --no-match-path "test/fork/*"` | All units |
| Fork tests | `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` | U1 (if book fork tests touch claims) |

---

## Definition of Done

- `forge build` passes with no warnings.
- All unit tests pass, including new fairness tests.
- All invariant tests pass (1000 runs, 500k calls, 0 reverts).
- SP-58, SP-59, SP-60 updated and passing.
- SP-25, SP-24, SP-23, SP-20 unchanged and passing.
- No new storage variables in `OVRFLOBook`.
- `_remainingEntitlement` removed (no dead code).
- Both `poolClaimLoan` and `claimPoolShare` signatures and events unchanged.
- Fork tests pass (if they exercise claim paths).
- No abandoned/experimental code left in the diff.
