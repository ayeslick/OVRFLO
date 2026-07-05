# Refactor: .sol deduplication and section cleanup

Date: 2026-07-04
Status: proposed
Scope: `src/OVRFLOBook.sol`, `src/OVRFLO.sol` (no changes to `OVRFLOFactory.sol`, `OVRFLOToken.sol`, `StreamPricing.sol`, `interfaces/`)

## Motivation

Full review of all `src/*.sol` files (2,131 lines) after the audit-findings fixes.
The contracts are in good shape: consistent style, well-documented, all 13 critical
patterns honored. Only three small, strictly behavior-preserving refactors are
justified. Everything else reviewed was intentionally left alone (see "Considered
and rejected" below), consistent with the project's minimal-abstraction preference.

No storage layout changes, no ABI changes, no event changes, no new external
functions. All items are internal-only.

## Item 1: Extract `_remainingEntitlement` in OVRFLOBook (dedup, correctness-critical math)

`poolClaimLoan` and `claimPoolShare` duplicate this verbatim:

```solidity
require(poolContributions[poolId][msg.sender] > 0, "OVRFLOBook: not contributor");
...
uint256 entitlement = uint256(poolContributions[poolId][msg.sender]) * pools[poolId].totalObligation
    / pools[poolId].totalContributed;
uint256 remaining = entitlement - poolReceived[poolId][msg.sender];
require(remaining > 0, "OVRFLOBook: fully claimed");
```

This is the pro-rata entitlement math that pattern #12 governs. Two copies means a
future fix to one claim channel can silently miss the other. Extract a single
internal view helper in the INTERNALS section:

```solidity
/// @dev Contributor's remaining pool entitlement: pro-rata share of totalObligation
///      minus what they already received. Reverts for non-contributors and when
///      fully claimed.
function _remainingEntitlement(uint256 poolId, address account) internal view returns (uint256 remaining) {
    uint128 contribution = poolContributions[poolId][account];
    require(contribution > 0, "OVRFLOBook: not contributor");
    uint256 entitlement = uint256(contribution) * pools[poolId].totalObligation / pools[poolId].totalContributed;
    remaining = entitlement - poolReceived[poolId][account];
    require(remaining > 0, "OVRFLOBook: fully claimed");
}
```

Both callers replace their inline blocks with:

```solidity
uint256 remaining = _remainingEntitlement(poolId, msg.sender);
```

Note: `poolClaimLoan` currently checks `not contributor` before resolving the loan
and `fully claimed` after; the helper folds both checks into one call site placed
where the entitlement is first needed. Revert reasons are unchanged; only the
ordering of `not contributor` relative to `loan not in pool` / `loan closed` in
`poolClaimLoan` stays as-is by calling the helper after the loan checks. Existing
revert-reason tests must still pass unmodified; if any test depends on a check
ordering the helper would change, keep the standalone `poolContributions` require
in place at the top of `poolClaimLoan` and let the helper's require be redundant
there (decide during implementation based on test results, favoring zero test churn).

## Item 2: Extract `_computeSplit` in OVRFLO (dedup, 3 copies of the deposit split math)

`deposit`, `previewStream`, and `previewDeposit` each repeat:

```solidity
toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD);
if (toUser > ptAmount) toUser = ptAmount;
toStream = ptAmount - toUser;
require(toStream > 0, "OVRFLO: nothing to stream");
```

This is the core value-split invariant (`toUser + toStream == ptAmount`, capped at
face value). Three copies invite drift. Extract one internal pure helper:

```solidity
/// @dev Splits a PT deposit into the immediate mint and the streamed remainder,
///      capping the immediate portion at face value (rate can exceed 1e18 briefly).
function _computeSplit(uint256 ptAmount, uint256 rateE18) internal pure returns (uint256 toUser, uint256 toStream) {
    toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD);
    if (toUser > ptAmount) toUser = ptAmount;
    toStream = ptAmount - toUser;
    require(toStream > 0, "OVRFLO: nothing to stream");
}
```

All three call sites become:

```solidity
(toUser, toStream) = _computeSplit(ptAmount, rateE18);
```

Identical math, identical revert reason, identical ordering (the require fires
after the rate read in all three today).

## Item 3: Move misplaced constants in OVRFLOBook (cosmetic, zero-risk)

`APR_MAX_CEILING` and `MAX_FEE_BPS` are `constant` but declared under the
`IMMUTABLES` section header. Move both declarations up into the `CONSTANTS`
section next to `LAUNCH_APR_BPS` / `APR_STEP_BPS`. Pure source reorder; constants
are inlined by the compiler so bytecode is unaffected.

## Considered and rejected

- **OVRFLOToken -> OZ `Ownable`:** the hand-rolled 33-line owner pattern works, is
  audited, and swapping it changes bytecode for zero functional gain.
- **Fee ternary helper (`feeBps == 0 ? 0 : mulDiv(...)`) in OVRFLO:** only two
  occurrences with slightly different inputs; a helper adds indirection without
  removing meaningful duplication ("this is solidity not python").
- **Reuse a `_pullExact`-style helper for `wrap`'s balance-delta check:** single
  occurrence in OVRFLO; not duplication.
- **Interfaces:** minimal by design; no changes.

## Verification

1. `forge build` (build first, per workflow preference).
2. `forge fmt` on touched files.
3. On approval, full test pass: `forge test` (unit, fuzz 1000 runs, invariant
   500 runs depth 25, attack scenarios). Zero test-file changes expected; any
   test churn means the refactor is not behavior-preserving and must be revisited.
4. Grep checks from the critical-patterns doc still pass:
   - `rg "self-match" src/OVRFLOBook.sol` (1 match)
   - `rg "duplicate or unsorted ids" src/OVRFLOBook.sol` (1 match)
   - `rg "poolProceeds\[poolId\] < available" src/OVRFLOBook.sol` (1 match)
   - `rg "unknown PT" src/OVRFLO.sol` (matches in sweepExcessPt and claim/flashLoan lookups)

## Out of scope

- `script/`, `test/`, `web/` files.
- Gas optimization passes, natspec rewrites, error-string to custom-error migration.
