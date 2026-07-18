---
title: src/ Simplification - Plan
type: refactor
date: 2026-07-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

## Goal Capsule

- **Objective:** Implement all 9 verified simplification findings from the 4-agent review of `src/` (~2,150 lines, 5 contracts). Delete vestigial state, consolidate redundant external calls, and replace hand-rolled code with audited library equivalents.
- **Authority:** User preferences: simplicity ("this is solidity not python"), deletions over additions, "don't duplicate what's already validated." Frontend is excluded — it will be rewritten separately.
- **Execution profile:** Three sequential commits, each with full build + test pass. All changes are behavior-preserving deletions, mechanical replacements, or documentation comments.
- **Stop conditions:** All tests pass after each commit (count adjusted for deleted fuzz properties per DoD). Any test failure that reveals a behavioral change (not just a reference update) stops the run.
- **Tail ownership:** Implementer runs `forge build` + `forge test` after each unit group. User reviews before push.

---

## Product Contract

### Summary

Refactor the 5 `src/` contracts to delete vestigial state from the removed standalone-loan design, drop dead and derivable checks, consolidate duplicate external calls and math, and replace hand-rolled implementations with audited OpenZeppelin code. Three commits: delete vestigial state, gas optimization, consolidate math.

### Problem Frame

A 4-agent parallel review of the entire `src/` tree found 9 findings (6 high-value, 3 medium) plus low-priority gas wins. The headline finding is that `loanId` and `loanPoolId` are provably always equal — residue of the removed standalone-loan design — which means two identity maps, a duplicate counter, a stored-constant field, and a duplicated obligation field are all maintained at ~40k gas per pool for zero functional value. The remaining findings follow the same pattern: construction-time invariants re-checked on every call, 8 external calls where 1 would do, fee math copy-pasted across preview and execution paths, and hand-rolled reimplementations of audited library code already in the tree.

### Requirements

R1. Collapse Loan/LoanPool to a single ID space. Delete `nextLoanPoolId`, `loanToLoanPool`, `loanPoolLoanId` (identity maps), `Loan.lender` (always `address(this)`), and `LoanPool.totalObligation` (duplicates `loans[id].obligation`). Update all internal references and events.

R2. Drop the dead `requireEligible` registration check. The constructor enforces `core`/`factory` registration; immutables cannot change; the factory has no deregistration path. Delete the `CoreNotRegistered` error and the zero-check.

R3. Drop `LiquidityPosition.active`. Every write site maintains `active iff availableLiquidity > 0`. Replace `require(liquidity.active, ...)` with `require(liquidity.availableLiquidity > 0, ...)`. Remove the `active = false` writes (the `availableLiquidity` zeroing already handles it). Update `gatherLiquidity` filter.

R4. Delete duplicate ABI getters. `getOvrfloInfo` duplicates the `ovrfloInfo` auto-getter; `getApprovedMarket` duplicates `approvedMarketAt`; `loanState`/`liquidityState`/`saleListingState` mirror the public mapping auto-getters (`loanState` adds only `outstanding`, derivable as `obligation - drawn - repaid`).

R5. Drop the dual market-approval registry. `addMarket` writes both `isMarketApproved` and `series.approved` atomically; neither can be unset. Remove the `isMarketApproved` external call from `marketActive`. Delete `SeriesInfo.approved` (derivable as `ptToken != address(0)`). Remove the `SeriesNotApproved` error.

R6. Replace 8 Sablier calls with 1 `getStream()` call in `requireEligible`. Add `getStream` to `ISablierV2LockupLinear` interface. Rewrite the function to destructure the struct return.

R7. Extract shared fee helper for `deposit`, `previewDeposit`, and `flashLoan`. The fee expression `info.feeBps == 0 ? 0 : PRBMath.mulDiv(toUser, info.feeBps, BASIS_POINTS)` appears verbatim in all three. Route through `StreamPricing.fee` (the designated home, already used by OVRFLOLending). Also extract `_freshRate` for the oracle-fresh + rate-read two-liner duplicated in `deposit`, `flashLoan`, and `_approvedRate`.

R8. Replace hand-rolled ceil/cast in `StreamPricing.obligation` with OZ `Math.mulDiv(x, f, WAD, Math.Rounding.Up)` + `SafeCast.toUint128`. Both are already in the tree. Add a comment to `OVRFLOToken` documenting the deliberate `renounceOwnership` omission (do not replace with OZ Ownable — the hand-rolled version intentionally omits `renounceOwnership` for a vault-controlled token).

R9. Fix sibling asymmetries. `gatherLiquidity` calls `StreamPricing.marketActive` raw instead of `_requireMarketActive` (one-line fix). Document the deposit-fee ceiling (`FEE_MAX_BPS` enforced only in factory) as a deliberate trust decision — the factory is the admin entry point and validates fee bounds at series approval time; moving enforcement to the leaf would duplicate that validation.

### Scope Boundaries

**In scope:**
- All 9 findings listed above across `src/` and test files
- Fuzz properties that test removed invariants (GL-22, GL-23, GL-24, SP-51, GL-11, GL-32) — delete as trivially true
- Test updates for all ABI changes (getter renames, struct field removals, function signature changes)

**Out of scope:**
- Frontend (`web/`) changes — user stated it will be deleted and rewritten
- Struct packing optimizations (`SeriesInfo` 3-to-1 slot, `SaleListing` 4-to-3) — deferred to follow-up
- Trivial wrapper inlining (`_timeToMaturity`, `_toUint128`, `_claimFair`)
- Repeated warm SLOAD caching
- `repayLoan` `_pullExact` → `safeTransferFrom` for ovrfloToken
- `createBorrowerLoanPool` `calldata` vs `memory` for array param
- Factory forwarder event asymmetry (lending forwarders double-emit; `LendingAprBoundsSet` has two different signatures across factory and lending) — rejected: picking a convention requires a cross-contract naming decision that doesn't fit this deletion-focused refactor; pattern #8 codifies the lending emit convention and can be updated separately if needed
- `DeploymentConfig.pending` derivable as `treasury != address(0)` — rejected: two-line deletion in the factory, but it touches deployment-flow code that's unrelated to the `src/` simplification targets; fold into a future factory cleanup

#### Deferred to Follow-Up Work

- Struct packing (`SeriesInfo` `expiryCached` to `uint40`, `SaleListing` reordering) — free gas wins but additional churn on top of an already large change
- `calldata` optimization for `createBorrowerLoanPool` array param
- `_pullExact` simplification for ovrfloToken in `repayLoan`
- Warm SLOAD caching in `buyListing`, `sellStreamToLiquidity`, `_claimFair`, `closeLoan`, `repayLoan`, `flashLoan`

---

## Planning Contract

### Key Technical Decisions

KTD1. **OVRFLOToken: document, don't replace.** Add a one-line comment explaining the deliberate `renounceOwnership` omission. Do not replace with OZ `Ownable` — that would add `renounceOwnership` to a vault-controlled token, which is unwanted. The hand-rolled version is intentionally simpler.

KTD2. **SeriesInfo.approved: delete the field entirely.** It is derivable as `ptToken != address(0)` — `addMarket` sets both atomically, neither can be unset, and there is no disable toggle by design. Every `require(info.approved, ...)` becomes `require(info.ptToken != address(0), ...)`. The `series()` tuple ABI changes (loses first field), but frontend is excluded.

KTD3. **quote/createBorrowerLoanPool: leave as acceptable glue.** The reuse agent judged the fill-composition duplication (cap -> obligation -> fee -> net) as acceptable residual glue. Extracting a shared helper would add an abstraction the user would consider unnecessary. The drift risk is low because the sequence is simple and both sites are in the same contract.

KTD4. **Deposit-fee ceiling: document as trust decision.** `FEE_MAX_BPS` is enforced only in the factory (at `setSeriesApproved` time), not in the leaf `OVRFLO` contract. This is the lone exception to the "leaf enforces its own bounds" pattern, but it aligns with the user's "don't duplicate what's already validated" stance — the factory is the admin entry point and validates fee bounds at series approval time. Add a comment documenting this as deliberate.

KTD5. **Struct packing: deferred.** The plan is already large (8 units, ~40+ test reference updates). Packing changes add churn on top of the vestigial-state deletion. Can be done as a separate gas optimization pass with no frontend coordination needed.

KTD6. **Loan/LoanPool naming: keep pool mappings, key on loanId.** Keep `loanPoolProceeds`, `loanPoolContributions`, `loanPoolReceived` mappings (they still track per-lender contributions) but key them on `loanId` directly. Use `loanId` as the single ID in function params, events, and return values. The concept of a "loan pool" (shared contribution tracking) still exists; only the separate ID space and translation maps are vestigial.

KTD7. **Loan events: drop lender field.** `LoanClosed` and `LoanRepaid` emit `address indexed lender` which is always `address(this)`. Remove the field from the event definitions and all emit sites. This loses an indexed filter parameter, but the value is a constant — integrators can filter on the lending contract address instead.

### Assumptions

- `ISablierV2LockupLinear.getStream(uint256)` returns a struct with all 8 fields currently fetched individually (`sender`, `asset`, `endTime`, `cliffTime`, `startTime`, `isCancelable`, `amounts.deposited`, `amounts.withdrawn`). Needs interface addition and verification against the exact deployed contract — Sablier V2.0 and V2.1 return differently-shaped structs (`LockupLinear.Stream` vs `StreamLL`), so the interface must match the specific deployed version this project targets (AGENTS.md pins V2 deliberately). Pull the deployed contract's ABI for the exact address used in fork tests and mirror that struct shape.
- No external contract (beyond the frontend, which is excluded) depends on the current ABI of `loanState`, `liquidityState`, `saleListingState`, `getOvrfloInfo`, `getApprovedMarket`, or the `series()` tuple shape.
- The fuzz properties GL-22, GL-23, GL-24, SP-51, GL-11, GL-32 test invariants that become trivially true when the underlying state is removed. Deleting them is safe — they would never fail.

### Implementer Guardrails

These are hard constraints on the implementer, not suggestions:

1. **This plan is the spec.** Do not implement anything not listed in a unit, even if it looks like an obvious improvement. KTD1 (keep hand-rolled Ownable), KTD3 (leave quote/createBorrowerLoanPool duplication), KTD4 (no leaf-side fee-cap check), and the Out of scope list name things that were considered and deliberately NOT done — do not "fix" them.
2. **Do not touch** `web/`, `docs/plans/`, or any file not listed in a unit's Files section (except to fix a compile error the unit's change directly causes — and then note it).
3. **Counts are advisory; greps are authoritative.** Every "~N references" in this plan is an estimate. Before editing each unit, run the unit's discovery commands (listed per unit) and enumerate ALL hits. A site the grep finds that the plan doesn't mention still must be updated.
4. **Do not change revert-message strings or error names** except where a unit explicitly says so. Do not reformat, rename, or reorder code the unit doesn't touch. Run `forge fmt` only on files you edited.
5. **Struct field removals shift tuple positions.** Every public mapping auto-getter and hand-written view whose struct loses a field changes its return tuple shape. The exact before/after shapes are listed in each affected unit — update every destructure site to the new shape; never leave a placeholder comma count unchanged.
6. **After each unit:** `forge build` must succeed and the unit's named tests must pass before starting the next unit. If a test failure looks behavioral (not a reference update), STOP and report — do not patch around it.

---

## Implementation Units

### U1. Collapse Loan/LoanPool to single ID space

- **Goal:** Delete the vestigial two-layer state machine. `loanId == loanPoolId` always; the translation maps, duplicate counter, stored-constant `lender` field, and duplicated `totalObligation` field are pure overhead.
- **Requirements:** R1
- **Dependencies:** None
- **Files:**
  - `src/OVRFLOLending.sol` — delete mappings, counter, struct fields; update `createBorrowerLoanPool`, `closeLoan`, `repayLoan`, `_claimFair`, `claimLoanPoolShare`; update events `LoanClosed`, `LoanRepaid`, `BorrowerLoanPoolCreated`, `LoanPoolShareClaimed` (drop `lender` from LoanClosed/LoanRepaid per KTD7; rename `loanPoolId` to `loanId` in BorrowerLoanPoolCreated/LoanPoolShareClaimed per KTD6 — note: renaming an indexed parameter does not change the event topic hash or signature, so no indexer breakage from the rename itself)
  - `test/fizz/Properties.sol` — delete GL-22, GL-23, GL-24, SP-51 (identity-map invariants); delete GL-10 (loan.obligation == pool.totalObligation is an identity once the field is gone); rework GL-39 to assert `loans[id].obligation` immutability instead of `loanPools().totalObligation` (the underlying quantity still exists and a future bug that mutates it mid-loan is exactly what this property catches — rename `ghost_poolTotalObligationInit` to `ghost_loanObligationInit`); rework SP-13, GL-09, SP-23, GL-76 to read `loans[id].obligation` via `loans()` auto-getter instead of `loanPools().totalObligation`; update ~20+ `nextLoanPoolId`/`loanPoolLoanId`/`loanToLoanPool` references to use `loanId` directly; update ~23 `loanPools()` destructuring sites that read the 5th field (`totalObligation`) to drop it
  - `test/fizz/handlers/OVRFLOLendingHandler.sol` — update ~7 references
  - `test/fizz/Snapshots.sol` — remove `nextLoanPoolId` field (line 42, 137) and `poolTotalObligation` field
  - `test/OVRFLOLending.t.sol` — update ~13 references; update any `expectEmit` assertions for renamed event parameters
  - `test/OVRFLOLendingInvariant.t.sol` — update ~9 references
  - `test/fork/OVRFLOLendingMainnetFork.t.sol` — the `loans()` destructures introduced by U3 (which runs first) use the 7-field shape; this unit reshapes them to 6 fields
- **Tuple shapes (before -> after):** removing struct fields changes the public auto-getters. Update EVERY destructure site to the new shape:
  - `loans(uint256)`: `(address borrower, address lender, uint256 streamId, uint128 obligation, uint128 drawn, uint128 repaid, bool closed)` [7 fields] -> `(address borrower, uint256 streamId, uint128 obligation, uint128 drawn, uint128 repaid, bool closed)` [6 fields]. `lender` is the SECOND field — every positional destructure after it shifts left by one (e.g. `(,, uint256 streamId,,,,)` becomes `(, uint256 streamId,,,,)`).
  - `loanPools(uint256)`: `(address borrower, uint16 aprBps, address market, uint128 totalContributed, uint128 totalObligation)` [5 fields] -> `(address borrower, uint16 aprBps, address market, uint128 totalContributed)` [4 fields]. `totalObligation` is the LAST field — destructures reading only earlier fields just drop a trailing comma.
- **Discovery commands (run before editing, enumerate all hits):**
  - `rg -n "loanToLoanPool|loanPoolLoanId|nextLoanPoolId" src/ test/`
  - `rg -n "\.loans\(|lending\.loans\(" test/` (every `loans()` destructure that must reshape 7 -> 6)
  - `rg -n "loanPools\(" src/ test/` (every `loanPools()` destructure that must reshape 5 -> 4)
  - `rg -n "totalObligation|poolTotalObligation|ghost_poolTotalObligationInit" src/ test/`
  - `rg -n "LoanClosed|LoanRepaid|BorrowerLoanPoolCreated|LoanPoolShareClaimed" src/ test/` (event definitions, emit sites, expectEmit assertions)
- **Approach:** Remove `nextLoanPoolId`, `loanToLoanPool`, `loanPoolLoanId` declarations. In `createBorrowerLoanPool`, use `nextLoanId++` as the single ID for both the loan and the pool. Remove `Loan.lender` from the struct and all emit sites (KTD7). Remove `LoanPool.totalObligation` from the struct — read `loans[id].obligation` directly where needed. This changes the `loanPools()` auto-getter from 5 return fields to 4, requiring all destructuring sites that read the 5th field to be updated. Update `closeLoan`/`repayLoan`/`_claimFair`/`claimLoanPoolShare` to use `loanId` directly instead of translating through `loanToLoanPool`/`loanPoolLoanId`. Key `loanPoolProceeds`/`loanPoolContributions`/`loanPoolReceived` on `loanId` (KTD6). Rename `loanPoolId` to `loanId` in `BorrowerLoanPoolCreated` and `LoanPoolShareClaimed` event definitions and all emit sites. In tests, replace all `loanPoolLoanId(x)` with `x`, `loanToLoanPool(x)` with `x`, `nextLoanPoolId()` with `nextLoanId()`. Delete properties that test the identity-map invariant (GL-22, GL-23, GL-24, SP-51) and the redundant equality invariant (GL-10 — `loan.obligation == pool.totalObligation` is an identity once the field is gone). Rework GL-39 to assert `loans[id].obligation` immutability (rename `ghost_poolTotalObligationInit` to `ghost_loanObligationInit`). Rework properties that read `loanPools().totalObligation` (SP-13, GL-09, SP-23, GL-76) to use `loans[id].obligation` instead.
- **Patterns to follow:** The codebase already uses single-ID patterns for liquidity positions and sale listings (each has one counter, no translation maps). Follow that pattern.
- **Test scenarios:**
  - Happy path: `createBorrowerLoanPool` creates a loan with `loanId == loanPoolId` (single ID), contributions tracked correctly
  - Happy path: `closeLoan` with `loanId` draws outstanding and returns stream; proceeds tracked on `loanPoolProceeds[loanId]`
  - Happy path: `repayLoan` with `loanId` reduces outstanding, updates `loanPoolProceeds[loanId]`
  - Happy path: `claimLoanPoolShare` with `loanId` distributes pro-rata from `loanPoolProceeds[loanId]`
  - Edge case: multiple loan pools created sequentially have sequential IDs (1, 2, 3...)
  - Edge case: `claimLoanPoolShare` on a closed loan with partial repay distributes correct pro-rata share
  - Error path: `closeLoan` on nonexistent loan reverts
  - Error path: `repayLoan` with amount > outstanding reverts
- **Verification:** `forge build` succeeds. `forge test` passes with updated test references. No fuzz property references `loanToLoanPool` or `loanPoolLoanId`.

### U2. Drop LiquidityPosition.active derived boolean

- **Goal:** Remove the `active` field from `LiquidityPosition`. It is fully derivable as `availableLiquidity > 0` — every mutation site maintains this invariant.
- **Requirements:** R3
- **Dependencies:** None (can be done in parallel with U1)
- **Files:**
  - `src/OVRFLOLending.sol` — remove `active` from struct; replace 4 `require(liquidity.active, ...)` with `require(liquidity.availableLiquidity > 0, ...)`; remove 3 `liquidity.active = false` writes; update `gatherLiquidity` filter (remove `liquidity.active &&`); update `liquidityState` getter (or delete it per U3)
  - `test/fizz/Properties.sol` — delete GL-11 (active never goes false -> true); update GL-32 (active iff availableLiquidity > 0 becomes trivially true, delete)
  - `test/fizz/Snapshots.sol` — remove `liquidityActive` field (line 35)
  - `test/OVRFLOLending.t.sol` — update all `liquidityPositions()` destructuring sites (the auto-getter tuple drops from 5 fields to 4 when `active` is removed, shifting every destructure that reads fields after `active`); update any `require(liquidity.active, ...)` assertions to `require(liquidity.availableLiquidity > 0, ...)` equivalents
- **Tuple shape (before -> after):** `liquidityPositions(uint256)`: `(address lender, address market, uint16 aprBps, uint128 availableLiquidity, bool active)` [5 fields] -> `(address lender, address market, uint16 aprBps, uint128 availableLiquidity)` [4 fields]. `active` is the LAST field — destructures like `(,,,, bool active)` must switch to reading `availableLiquidity` (field 4) and testing `> 0`; destructures reading only earlier fields just drop a trailing comma.
- **Discovery commands (run before editing, enumerate all hits):**
  - `rg -n "\.active" src/OVRFLOLending.sol` (distinguish `liquidity.active` [remove] from `listing.active` [KEEP — SaleListing.active stays])
  - `rg -n "liquidityPositions\(" src/ test/` (every destructure that must reshape 5 -> 4)
  - `rg -n "liquidityActive" test/`
- **Approach:** The invariant `active iff availableLiquidity > 0` holds at all 3 mutation sites: `withdrawLiquidity` (zeroes both), `sellStreamToLiquidity` (flips `active` exactly when `availableLiquidity` hits 0), `_consumeLiquidity` (same pattern). Removing `active` eliminates dual bookkeeping at 3 sites where a missed sync would be an accounting bug. Replace all `active` reads with `availableLiquidity > 0` checks. The `gatherLiquidity` filter simplifies from `liquidity.active && liquidity.market == market && liquidity.aprBps == aprBps` to `liquidity.availableLiquidity > 0 && liquidity.market == market && liquidity.aprBps == aprBps`.
- **Patterns to follow:** `SaleListing.active` and `Loan.closed` are NOT derivable and should stay. Only `LiquidityPosition.active` is derivable.
- **Test scenarios:**
  - Happy path: `supplyLiquidity` with amount > 0 creates a position with `availableLiquidity > 0`
  - Happy path: `withdrawLiquidity` zeroes `availableLiquidity`; subsequent access reverts with "insufficient availableLiquidity" (or equivalent)
  - Happy path: `sellStreamToLiquidity` partially consumes; position remains accessible until `availableLiquidity` hits 0
  - Happy path: `gatherLiquidity` skips positions with `availableLiquidity == 0`
  - Error path: operations on a withdrawn (zero-capacity) position revert
- **Verification:** `forge build` succeeds. `forge test` passes. No reference to `liquidity.active` or `liquidityActive` in tests.

### U3. Delete duplicate ABI getters

- **Goal:** Remove wrapper getters that duplicate auto-generated public mapping getters. Each struct has one accessor (the auto-getter), not two.
- **Requirements:** R4
- **Dependencies:** None (hard dependency). Ordering U3 before U1 simplifies U1 by deleting `loanState` before U1 updates tests.
- **Files:**
  - `src/OVRFLOFactory.sol` — delete `getOvrfloInfo` (line 308), `getApprovedMarket` (line 312)
  - `src/OVRFLOLending.sol` — delete `loanState`, `liquidityState`, `saleListingState` (~90 lines total)
  - `test/OVRFLOFactory.t.sol` — replace `getOvrfloInfo` with `ovrfloInfo`, `getApprovedMarket` with `approvedMarketAt` (lines 264, 487)
  - `test/fork/OVRFLOFactoryMainnetFork.t.sol` — replace `getApprovedMarket` with `approvedMarketAt` (lines 81, 112, 113)
  - `test/OVRFLOLending.t.sol` — replace `loanState` with `loans` (compute `outstanding` as `obligation - drawn - repaid`), `liquidityState` with `liquidityPositions`, `saleListingState` with `saleListings` (lines 627, 637, 702, 718, 833, 838)
  - `test/fork/OVRFLOLendingMainnetFork.t.sol` — replace `loanState` with `loans` (lines 66, 100, 199)
  - `test/fizz/Properties.sol` — delete `property_loanState_view`, `property_liquidityState_view`, `property_saleListingState_view` (lines 2074-2103); these properties existed to cover the wrapper getters
  - `test/fizz/handlers/OVRFLOLendingHandler.sol` — delete `liquidityState`/`saleListingState`/`loanState` call sites (lines 291, 325, 375)
- **Tuple shapes at this point (U3 runs before U1/U2, so structs still have all fields):** replacements use the CURRENT shapes — `loans(uint256)` returns 7 fields `(borrower, lender, streamId, obligation, drawn, repaid, closed)`; `liquidityPositions(uint256)` returns 5 fields `(lender, market, aprBps, availableLiquidity, active)`; `saleListings(uint256)` returns 6 fields `(seller, market, streamId, aprBps, feeBps, active)`. U1/U2 reshape the first two afterward.
- **Discovery commands (run before editing, enumerate all hits):**
  - `rg -n "loanState|liquidityState|saleListingState" src/ test/`
  - `rg -n "getOvrfloInfo|getApprovedMarket" src/ test/`
- **Approach:** The auto-getters `ovrfloInfo(address)`, `approvedMarketAt(address,uint256)`, `loans(uint256)`, `liquidityPositions(uint256)`, `saleListings(uint256)` already return the struct data. The wrapper getters add only `outstanding` (in `loanState`, computed as `obligation - drawn - repaid`) which is trivially computed by the caller. Delete the wrappers and update all test call sites to use the auto-getters directly. For tests that need `outstanding`, compute it inline from the `loans()` return tuple. Delete the three view-coverage fuzz properties — they existed only to exercise the wrapper getters.
- **Test scenarios:**
  - Happy path: all tests that previously called `loanState`/`liquidityState`/`saleListingState` pass using auto-getters with inline `outstanding` computation
  - Happy path: all tests that previously called `getOvrfloInfo`/`getApprovedMarket` pass using auto-getters
- **Verification:** `forge build` succeeds. `forge test` passes. No reference to deleted getter names in tests or source.

### U4. Drop dual market-approval registry

- **Goal:** Remove the redundant `isMarketApproved` external call from `marketActive` and delete the derivable `SeriesInfo.approved` field.
- **Requirements:** R5
- **Dependencies:** None
- **Files:**
  - `src/StreamPricing.sol` — remove `isMarketApproved` call from `marketActive` (line 190); remove `SeriesNotApproved` error (line 79); remove `approved` from `marketActive`'s series destructuring (line 191-192); change the approval check to `ptToken == address(0)` (reverses the check — if no ptToken, the market is not approved); update `IOVRFLOSeriesRegistry` interface `series()` declaration to remove the `bool approved` return and its `@return` NatSpec line (line 40-44)
  - `src/OVRFLO.sol` — delete `approved` field from `SeriesInfo` struct (line 85); delete `info.approved = true` write in `setSeriesApproved` (line 259); update `deposit` gate at line 378 from `require(info.approved, ...)` to `require(info.ptToken != address(0), ...)`; update `_approvedRate` at line 583 the same way; update the hand-written `series()` view function (line 515-530) to return 7 values (drop `approved`, keep synthesized `ovrfloToken`/`underlying`/`oracle`)
  - `src/OVRFLOFactory.sol` — keep `isMarketApproved` mapping (for off-chain queries) but it's no longer read on-chain; the factory only forwards `setSeriesApproved` to the vault — no struct change needed here since `SeriesInfo` lives in OVRFLO.sol
  - `test/OVRFLOFactory.t.sol` — update any `info.approved` assertions to `info.ptToken != address(0)`
  - `test/OVRFLO.t.sol` — update any `approved` field references in series struct assertions
  - `test/fork/OVRFLOFactoryMainnetFork.t.sol` — update series struct assertions (the tuple loses the `approved` field, shifting all subsequent indices)
  - `test/fizz/Properties.sol` — update the two `series()` destructuring sites (lines 531, 738) whose 8-tuples shift by one when `approved` is dropped
- **Tuple shape (before -> after):** `series(address)`: `(bool approved, uint32 twapDurationFixed, uint16 feeBps, uint256 expiryCached, address ptToken, address ovrfloToken_, address underlying_, address oracle_)` [8 fields] -> `(uint32 twapDurationFixed, uint16 feeBps, uint256 expiryCached, address ptToken, address ovrfloToken_, address underlying_, address oracle_)` [7 fields]. `approved` is the FIRST field — every positional destructure shifts left by one (e.g. `(,,, uint256 expiry,,,,)` becomes `(,, uint256 expiry,,,)`). The same shape change applies to the `IOVRFLOSeriesRegistry.series()` interface declaration in StreamPricing.sol.
- **Discovery commands (run before editing, enumerate all hits):**
  - `rg -n "\.series\(" src/ test/` (every destructure that must reshape 8 -> 7)
  - `rg -n "info\.approved|s\.approved|\.approved = " src/ test/`
  - `rg -n "SeriesNotApproved|isMarketApproved" src/ test/`
- **Approach:** `marketActive` currently makes an external call to `factory.isMarketApproved` AND reads `series.approved` from the vault. Both are written atomically in `addMarket` and neither can be unset. The series read is needed anyway (for `expiryCached` and `ptToken`), so gating on `ptToken != address(0)` alone drops the external call (~2.6k gas per pricing operation) without losing any safety. Delete `SeriesInfo.approved` from the struct — it duplicates `ptToken != address(0)`. The `series()` auto-getter tuple loses its first field, shifting all subsequent indices in any test that destructures the tuple. Keep the `isMarketApproved` mapping in the factory for off-chain queries (it's a public auto-getter with no on-chain readers after this change).
- **Test scenarios:**
  - Happy path: `marketActive` on an approved market returns correct expiry and token
  - Error path: `marketActive` on an unapproved market (`ptToken == address(0)`) reverts with `MarketNotApproved`
  - Happy path: `deposit`/`previewDeposit` on an approved market work correctly
  - Happy path: all fork tests pass with updated series tuple destructuring
- **Verification:** `forge build` succeeds. `forge test` passes. No `SeriesNotApproved` error reference in source. No `info.approved` reference in source.

### U5. Rewrite requireEligible (dead check + getStream consolidation)

- **Goal:** Delete the dead `CoreNotRegistered` branch (construction-time invariant re-checked on every fill) and replace 8 individual Sablier calls with 1 `getStream()` struct return.
- **Requirements:** R2, R6
- **Dependencies:** None
- **Files:**
  - `interfaces/ISablierV2LockupLinear.sol` — add `getStream` function declaration returning a struct with `sender`, `asset`, `endTime`, `cliffTime`, `startTime`, `isCancelable`, `amounts` (containing `deposited` and `withdrawn`)
  - `src/StreamPricing.sol` — delete `CoreNotRegistered` error and the `treasury == address(0) || registeredToken == address(0)` check (lines 217-218); rewrite the 8 individual Sablier calls (lines 221-230) to use a single `getStream(streamId)` call and destructure the struct
  - `test/fizz/mocks/MockSablier.sol` — implement `getStream` returning the struct (populate from the mock's existing internal `Stream` struct, which already stores `sender`, `asset`, `startTime`, `endTime`, `cliffTime`, `depositedAmount`, `withdrawnAmount`, `cancelable`); keep individual getters only if other code still calls them after the switch. NOTE: `MockSablier is ISablierV2LockupLinear` — adding `getStream` to the interface makes this mock FAIL TO COMPILE until it implements the function, so the interface change and this mock's implementation must land together.
  - `test/mocks/LendingMocks.sol` — implement `getStream` in `MockLendingSablier` the same way. NOTE: `MockLendingSablier` does NOT declare the interface (duck-typed) — it will still COMPILE without `getStream` but every unit test hitting a fill path will REVERT AT RUNTIME. Do not interpret those reverts as a source bug; implement `getStream` here in the same change.
  - `test/StreamPricing.t.sol` — update if any test expects `CoreNotRegistered` revert
  - `test/StreamPricing.math.t.sol` — update if any test exercises the eligibility check directly
- **Discovery commands (run before editing, enumerate all hits):**
  - `rg -n "CoreNotRegistered" src/ test/`
  - `rg -n "getSender|getAsset|getEndTime|getCliffTime|getStartTime|isCancelable|getDepositedAmount|getWithdrawnAmount" src/ test/ interfaces/` (any caller of an individual getter outside `requireEligible` means that getter must be KEPT in the interface and mocks)
- **Approach:** The `CoreNotRegistered` check reads `registry.ovrfloInfo(core)` (~7k gas, 3-slot struct read) on every sale, listing, buy, and loan-pool creation, but the lending constructor already enforces exactly this and `core`/`factory` are immutables. Delete the check and the error. Then replace the 8 individual Sablier calls (`getSender`, `getAsset`, `getEndTime`, `getCliffTime`, `getStartTime`, `isCancelable`, `getDepositedAmount`, `getWithdrawnAmount`) with a single `getStream(streamId)` call. Add the `getStream` return struct to the interface. **Pre-implementation verification:** The target contract is the mainnet SablierV2LockupLinear at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` — the same address `test/fizz/Base.sol:127` etches `MockSablier` over, and the address the fork-deployed vaults expose via `ovrflo.sablierLL()`. Pull that deployed contract's verified ABI (e.g. `cast interface 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9 --etherscan-api-key $ETHERSCAN_API_KEY`, or Etherscan's verified source) and mirror its `getStream` return struct exactly (Sablier V2.0 and V2.1 return differently-shaped structs — `LockupLinear.Stream` vs `StreamLL` — so do not write the struct from docs or memory). Confirm exact field names, ordering, nesting of the amounts sub-struct, and types before writing the interface. The `isCancelable` field mapping is security-critical — if mapped to a zero-valued field, cancelable streams would pass the `CancelableStream` check, letting borrowers pledge and then cancel streams mid-loan. Map the struct fields to the existing local variables. The `Eligibility` return struct and all downstream behavior stay unchanged. Both `MockSablier` and `MockLendingSablier` must implement `getStream` returning the same struct shape before any non-fork test can pass. Fork tests against real Sablier streams are the verification gate — U5 is not complete until fork tests pass with the single-call path.
- **Patterns to follow:** The interface addition must match the exact deployed Sablier V2 LockupLinear contract's `getStream` ABI for the address used in fork tests. Do not rely on generic Sablier V2 docs — V2.0 and V2.1 have different struct shapes.
- **Test scenarios:**
  - Happy path: `requireEligible` on a valid stream returns correct `Eligibility` (maturity, remaining)
  - Error path: wrong sender reverts with `WrongSender`
  - Error path: wrong asset reverts with `WrongAsset`
  - Error path: wrong end time reverts with `WrongEndTime`
  - Error path: cliff present reverts with `CliffPresent`
  - Error path: cancelable stream reverts with `CancelableStream`
  - Error path: deposited <= withdrawn reverts with `RemainingZero`
  - Integration: fork tests pass with the new single-call pattern against real Sablier streams
- **Verification:** `forge build` succeeds. `forge test` passes including fork tests (if `MAINNET_RPC_URL` is set). No `CoreNotRegistered` reference in source. `requireEligible` makes exactly 1 Sablier call (verifiable in trace).

### U6. Extract shared fee helper

- **Goal:** Eliminate the preview/execute fee math drift risk by routing the duplicated fee expression through `StreamPricing.fee`.
- **Requirements:** R7
- **Dependencies:** None
- **Files:**
  - `src/OVRFLO.sol` — replace inline fee expression in `deposit` (line 401), `previewDeposit` (line 578), and `flashLoan` (line 477) with a call to a shared helper; extract `_freshRate` for the oracle-fresh + rate-read two-liner in `deposit`/`flashLoan`/`_approvedRate`
  - `src/StreamPricing.sol` — may need a deposit-fee variant if the signature differs from the lending fee (both use `PRBMath.mulDiv(amount, feeBps, BASIS_POINTS)` with a zero-bps fast path)
- **Discovery commands (run before editing, enumerate all hits):**
  - `rg -n "feeBps, BASIS_POINTS|BASIS_POINTS\b|WAD\b" src/OVRFLO.sol` (all inline fee expressions and constant consumers — decides whether local `BASIS_POINTS`/`WAD` can be deleted)
  - `rg -n "_requireOracleFresh|getPtToSyRate|_approvedRate" src/OVRFLO.sol`
- **Approach:** The fee expression `info.feeBps == 0 ? 0 : PRBMath.mulDiv(toUser, info.feeBps, BASIS_POINTS)` is identical in `deposit` and `previewDeposit`, with a variant in `flashLoan` (operates on `amount * rateE18 / WAD` first). `StreamPricing.fee` already exists as the designated home for fee math (OVRFLOLending routes every fee through it) — note that `StreamPricing.fee` lacks the zero-bps fast path (`feeBps == 0 ? 0 :`) but routing through it is behavior-identical since `PRBMath.mulDiv(x, 0, BPS)` returns 0. Route the deposit/flash fee through `StreamPricing.fee` or a sibling helper to keep preview and execution in lockstep. Once the deposit fee routes through `StreamPricing.fee`, OVRFLO's local `BASIS_POINTS` constant loses its main consumer — delete it if no other reference remains after the routing; keep `WAD` if `flashLoan` still uses it for the `amount * rateE18 / WAD` computation. For the oracle-fresh + rate-read consolidation: `previewDeposit` already calls the existing `_approvedRate(market)` which encapsulates `require(info.approved)`, `_requireOracleFresh`, and `getPtToSyRate`. Route `deposit` through `_approvedRate` as well (eliminating both the inline approval check and the oracle-fresh+rate-read duplication). Reserve `_freshRate` for `flashLoan` only, which has a different approval path (`ptToMarket[ptToken] != address(0)` instead of `info.approved`). Optionally refactor `_approvedRate` to call `_freshRate` internally so the layering is `_freshRate` (oracle-fresh+rate) -> `_approvedRate` (+approval check) -> `deposit`/`previewDeposit`, with `flashLoan` calling `_freshRate` directly.
- **Test scenarios:**
  - Happy path: `deposit` and `previewDeposit` produce identical fee amounts for the same inputs
  - Happy path: `flashLoan` fee matches `PRBMath.mulDiv(amount * rateE18 / WAD, flashFeeBps, BASIS_POINTS)`
  - Happy path: zero-fee series (`feeBps == 0`) produces zero fee in all three paths
  - Edge case: fee math rounding matches between preview and execution (no drift)
- **Verification:** `forge build` succeeds. `forge test` passes. No `PRBMath.mulDiv(..., feeBps, BASIS_POINTS)` fee expression remains inline in `src/OVRFLO.sol` — all fee computation routes through the shared helper.

### U7. Replace hand-rolled ceil/cast with OZ

- **Goal:** Replace the hand-rolled ceiling division and uint128 cast in `StreamPricing.obligation` with audited OpenZeppelin equivalents already in the tree.
- **Requirements:** R8
- **Dependencies:** None
- **Files:**
  - `src/StreamPricing.sol` — replace the `mulmod != 0 ? +1` ceiling pattern and manual `require(value <= type(uint128).max)` + raw cast (lines 134-140) with `Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up)` + `SafeCast.toUint128`
  - `src/OVRFLOToken.sol` — add one-line comment above the hand-rolled Ownable explaining the deliberate `renounceOwnership` omission
  - `test/StreamPricing.math.t.sol` — verify rounding behavior is preserved (ceiling division rounds up)
- **Discovery commands (run before editing, enumerate all hits):** `rg -n "mulmod|unsafe-typecast|type\(uint128\)\.max" src/StreamPricing.sol` and `rg -n "openzeppelin.*Math|SafeCast" src/ lib/openzeppelin-contracts/contracts/utils/math/ --files-with-matches` (confirm import paths before writing them)
- **Approach:** `StreamPricing.obligation` is the most rounding-sensitive function in the repo. The current hand-rolled ceil (`PRBMath.mulDiv` + `mulmod != 0 ? +1`) is behavior-identical to `Math.mulDiv(x, f, WAD, Math.Rounding.Up)`. The manual overflow check + raw cast is behavior-identical to `SafeCast.toUint128` (reverts on overflow). Both OZ contracts are already in the tree. The swap is mechanical but the rounding test suite must pass to confirm identical behavior. Add the comment to `OVRFLOToken` per KTD1 — do not replace with OZ Ownable.
- **Patterns to follow:** OZ `Math.mulDiv` with `Math.Rounding.Up` and `SafeCast.toUint128` are already used elsewhere in the Foundry ecosystem. Check if the codebase already imports from `@openzeppelin/contracts/utils/math/Math.sol` and `SafeCast.sol`.
- **Test scenarios:**
  - Happy path: `obligation` with exact division (no rounding needed) returns same result
  - Happy path: `obligation` with non-exact division rounds up (ceiling) — same as before
  - Edge case: `obligation` at uint128 boundary — `SafeCast.toUint128` reverts on overflow (same as manual check)
  - Edge case: zero borrow amount returns zero
  - Edge case: zero APR (aprBps == 0) returns borrowAmount unchanged
  - Differential fuzz: compare old hand-rolled ceil (`PRBMath.mulDiv` + `mulmod != 0 ? +1`) against `Math.mulDiv(x, f, WAD, Rounding.Up)` for randomized `borrowAmount`, `aprBps`, and `timeToMaturity` values, asserting exact equality across the input space — the test temporarily inlines the old ceil as a reference function alongside the new implementation, so both paths exist in the same commit (no cross-commit diffing needed); run as a gate before and after the swap to confirm no rounding drift
- **Verification:** `forge build` succeeds. `forge test` passes. `StreamPricing.obligation` rounding tests confirm identical behavior. No `forge-lint` suppression needed for the cast (SafeCast handles it).

### U8. Fix sibling asymmetries

- **Goal:** Fix the `gatherLiquidity` raw `marketActive` call and document the deposit-fee ceiling as a deliberate trust decision.
- **Requirements:** R9
- **Dependencies:** None (the one-line `gatherLiquidity` → `_requireMarketActive` refactor works identically before or after U4)
- **Files:**
  - `src/OVRFLOLending.sol` — change `gatherLiquidity` to call `_requireMarketActive(market)` instead of `StreamPricing.marketActive(address(factory), core, market)` raw (line 804)
  - `src/OVRFLO.sol` — add comment above `deposit`/`flashLoan` documenting that `FEE_MAX_BPS` is enforced only in the factory at `setSeriesApproved` time, per KTD4
- **Discovery commands (run before editing, enumerate all hits):** `rg -n "marketActive|_requireMarketActive" src/OVRFLOLending.sol`
- **Approach:** `gatherLiquidity` is the only call site that uses `StreamPricing.marketActive` raw instead of the `_requireMarketActive` wrapper. The wrapper exists for exactly this purpose. Change the one line. For the deposit-fee ceiling, add a NatSpec comment to `deposit` and `flashLoan` explaining that fee bounds are validated at the factory level (`setSeriesApproved` enforces `FEE_MAX_BPS`), so the leaf does not re-validate. This documents the intentional exception to the "leaf enforces its own bounds" pattern.
- **Test scenarios:**
  - Happy path: `gatherLiquidity` on an active market returns matching liquidity IDs
  - Error path: `gatherLiquidity` on an expired market reverts (via `_requireMarketActive`)
- **Verification:** `forge build` succeeds. `forge test` passes. `gatherLiquidity` uses `_requireMarketActive`, not the raw `marketActive` call.

---

## Verification Contract

**Commit grouping:** Commit 1 (vestigial state deletion): U1, U2, U3, U4. Commit 2 (gas optimization): U5, U8. Commit 3 (math consolidation): U6, U7.

| Gate | Command | When | Applies to |
|---|---|---|---|
| Build | `forge build` | After each unit | All units |
| Full test suite | `forge test` | After each commit | All units |
| Fuzz tests | `forge test --match-contract OVRFLOFuzz` | After commit 1 (vestigial state deletion) | U1, U2, U3, U4 |
| Invariant tests | `forge test --match-contract OVRFLOLendingInvariant` | After commit 1 | U1, U2, U3, U4 |
| Math tests | `forge test --match-test test_Obligation` | After U7 | U7 |
| Differential fuzz | Fuzz test comparing old ceil vs `Math.Rounding.Up` | Before and after U7 | U7 |
| Fork tests | `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` | After U5, U3, U4 | U5, U3, U4 |
| No stale references (commit 1) | `rg -e "loanToLoanPool" -e "loanPoolLoanId" -e "nextLoanPoolId" -e "liquidity\.active" -e "liquidityActive" -e "loanState" -e "liquidityState" -e "saleListingState" -e "getOvrfloInfo" -e "getApprovedMarket" -e "SeriesNotApproved" -e "info\.approved" -e "totalObligation" -e "poolTotalObligation" src/ test/` | After commit 1 | U1, U2, U3, U4 |
| No stale references (commit 2) | `rg "CoreNotRegistered" src/ test/` | After commit 2 | U5 |
| Gas snapshot | `forge snapshot` | After all commits | All units (verify no regression) |

---

## Definition of Done

### Global

- All tests pass after each commit (count adjusted for deleted fuzz properties: 7 fuzz properties deleted — GL-22, GL-23, GL-24, SP-51, GL-10 in U1; GL-11, GL-32 in U2 — plus 3 view-coverage properties in U3 = ~10 fewer; GL-39 is reworked, not deleted; new tests for changed behavior may offset)
- `forge build` succeeds with no warnings beyond existing unused-variable warnings
- No stale references to deleted state (mappings, struct fields, getters, errors) in `src/` or `test/`
- `forge snapshot` shows no gas regression on core operations (gas should improve from deleted state)
- Three commits landed: vestigial state deletion (U1-U4), gas optimization (U5, U8), math consolidation (U6, U7)

### Per-unit

- U1: No reference to `loanToLoanPool`, `loanPoolLoanId`, `nextLoanPoolId`, `Loan.lender`, `LoanPool.totalObligation`, or `poolTotalObligation` in source or tests
- U2: No reference to `LiquidityPosition.active` or `liquidityActive` in source or tests
- U3: No reference to `loanState`, `liquidityState`, `saleListingState`, `getOvrfloInfo`, or `getApprovedMarket` in source or tests
- U4: No reference to `SeriesNotApproved` or `info.approved` in source or tests; `marketActive` makes no external call to `isMarketApproved`; `series()` function and interface updated to 7-value return
- U5: `requireEligible` makes exactly 1 Sablier call; no `CoreNotRegistered` error
- U6: Fee expression appears in exactly one location (the helper), not duplicated across `deposit`/`previewDeposit`/`flashLoan`
- U7: `StreamPricing.obligation` uses `Math.mulDiv` with `Rounding.Up` and `SafeCast.toUint128`; no `forge-lint` suppression for the cast; differential fuzz test confirms identical rounding behavior
- U8: `gatherLiquidity` calls `_requireMarketActive`; deposit-fee ceiling has documentation comment
