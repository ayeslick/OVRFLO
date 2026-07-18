---
title: Consolidate fixed-point math to a single library (OpenZeppelin Math) to reduce attack surface
date: 2026-07-18
category: docs/solutions/tooling-decisions/
module: StreamPricing, OVRFLO
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - A Solidity protocol pulls in two fixed-point math libraries that overlap in functionality (e.g. PRBMath for floor rounding and OpenZeppelin Math for ceil rounding)
  - Choosing between PRBMath.mulDiv and OpenZeppelin Math.mulDiv for floor or ceil (Rounding.Up) fixed-point multiplication
  - Reducing dependency attack surface by consolidating to a single audited math library already present in the dependency tree
  - Removing a git submodule and its foundry.toml remapping after a library consolidation
symptoms:
  - Two math libraries imported across the codebase for operations one library can fully cover
  - A git submodule (prb-math) and foundry.toml remapping maintained solely for a handful of mulDiv call sites
  - Reviewers must reason about rounding semantics in two separate libraries for equivalent operations
resolution_type: code_fix
related_components:
  - StreamPricing
  - OVRFLO
  - foundry.toml
  - prb-math git submodule
  - test/StreamPricing.math.t.sol
  - test/fork/OVRFLOFlashLoanFork.t.sol
tags:
  - solidity
  - math-libraries
  - prbmath
  - openzeppelin-math
  - attack-surface
  - dependency-consolidation
  - git-submodule
  - foundry
---

# Consolidate fixed-point math to a single library (OpenZeppelin Math) to reduce attack surface

## Context

OVRFLO was carrying two fixed-point math libraries for overlapping work. PRBMath (pulled in via the `prb-math` git submodule and a `prb-math/=lib/prb-math/contracts/` remapping in `foundry.toml`) supplied `PRBMath.mulDiv` for five floor-rounded call sites: `StreamPricing.factor`, `StreamPricing.grossPrice`, `StreamPricing.fee`, `OVRFLO._computeSplit` (the deposit split), and the `OVRFLO.flashLoan` fee base. OpenZeppelin Math supplied `Math.mulDiv` for the one ceil-rounded site, `StreamPricing.obligation` (the debt-accrual calculation, where the lender must be owed at least the accrual), via the 4-arg `Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up)` form.

That ceil site had itself been migrated from a hand-rolled `PRBMath.mulDiv` + `mulmod != 0 ? +1` ceil in an earlier behavior-preserving refactor, which is what brought the OZ `Math` import into `StreamPricing.sol` in the first place. So by the time of this consolidation, `StreamPricing.sol` already imported `Math` from OpenZeppelin (for the obligation ceil) and still imported `PRBMath` (for the three floor sites); `OVRFLO.sol` imported `PRBMath` only for floor operations and did not import `Math` at all. Two libraries, one job, and the one already imported in `StreamPricing.sol` could do everything the other was doing. The prompt for this change was recognizing that the second library was pure attack surface: OVRFLO depends on OpenZeppelin non-removably for `ERC20`, `Ownable2Step`, `ReentrancyGuard`, `SafeCast`, and `Math`, so PRBMath was a redundant dependency whose entire used surface (`mulDiv` with floor rounding) was a strict subset of OZ `Math.mulDiv`.

## Guidance

When a project pulls in two third-party libraries for the same capability, audit whether one can cover every call site before accepting the duplication. For fixed-point `mulDiv` the rounding direction is the only behavioral axis that matters, and the two libraries map cleanly onto it:

- `PRBMath.mulDiv(a, b, denominator)` always floors.
- `Math.mulDiv(a, b, denominator)` (3-arg, OpenZeppelin) defaults to `Math.Rounding.Down` (floor).
- `Math.mulDiv(a, b, denominator, Math.Rounding.Up)` (4-arg) ceils.

So OZ `Math.mulDiv` is a strict superset of PRBMath's `mulDiv` capability: every floor site is a direct drop-in (`PRBMath.mulDiv(a, b, d)` becomes `Math.mulDiv(a, b, d)`, no rounding argument, no behavior change), and the ceil case is already handled by the 4-arg form. After consolidation, every `mulDiv` in the protocol is `Math.mulDiv`, and the only per-site fact left to verify is the rounding direction (3-arg floor vs 4-arg `Rounding.Up`).

Before consolidating, verify two things:

1. **Every call site of the removable library is floor.** Grep for `PRBMath.mulDiv` across `src/` and `test/` and read the NatSpec rounding direction on each function. In OVRFLO all five production sites were floor, confirmed by `grossPrice`'s NatSpec ("Floors (truncates) via `mulDiv`") and the directional rounding analysis in `StreamPricing.sol`. If any site needs ceil, it should already be (or become) `Math.mulDiv(..., Math.Rounding.Up)`; do not let a consolidation silently flip a floor to a ceil or vice versa.
2. **No other surface of the removable library is used.** PRBMath exports typed variants (`PRBMathUD60x18`, `PRBMathSD21x18`, `mulDiv18`, `exp`, `ln`, `pow`, `gm`) that OZ `Math` does not cover. If any of those are in use, PRBMath cannot be removed. In OVRFLO only `PRBMath.mulDiv` was referenced anywhere in `src/` or `test/`, so removal was clean.

Then execute in source-before-config order, because the ordering is load-bearing:

1. Replace call sites and swap the `PRBMath` import for `import {Math} from "@openzeppelin/contracts/utils/math/Math.sol"` in `src/StreamPricing.sol` (drop the `PRBMath` import; the `Math` import is already present) and `src/OVRFLO.sol` (swap the import).
2. Update `test/StreamPricing.math.t.sol` (replace the one `PRBMath.mulDiv` call, swap the import, update four comment references) and `test/fork/OVRFLOFlashLoanFork.t.sol` (two comment-only references).
3. Remove the `prb-math` remapping from `foundry.toml` — only safe once no file imports `prb-math`, which is why this step comes after the source and test edits. A stale remapping pointing at a deleted submodule breaks `forge build`.
4. Delete the `prb-math` git submodule (`git submodule deinit -f lib/prb-math`, `git rm -f lib/prb-math`, `rm -rf .git/modules/lib/prb-math`).

The gate that proves the swap was a true drop-in: `forge build` clean, `forge test` 365 passed / 0 failed, and the medusa fuzz suite 140 passed / 0 failed / 0 warnings, all without touching a single assertion. A test suite passing unchanged across a library swap is the signature of behavior-preserving consolidation; if any assertion had to change, the swap was not a drop-in and the rounding semantics need re-examination.

## Why This Matters

- **Attack surface shrinks by one whole dependency.** Every third-party library is code a reviewer has to trust and an upstream that can ship a vulnerability or a breaking change. PRBMath is well-audited, but it is still an extra dependency with its own 512-bit multiplier path. OVRFLO already depends on OpenZeppelin non-removably (ERC20, Ownable2Step, ReentrancyGuard, SafeCast, Math), so PRBMath was a redundant dependency whose entire used surface could be deleted at zero capability cost. Removing it also removes the `prb-math` git submodule and its `foundry.toml` remapping, which are themselves recurring sources of clone breakage and CI drift (a stale submodule pointer after an upstream change, a remapping that silently points at a moved path).
- **One rounding primitive instead of two.** Mixing floor-from-PRB and ceil-from-OZ in the same file (`StreamPricing.sol` had both) forces a reader to hold two libraries' semantics in their head when reasoning about rounding. After consolidation, every `mulDiv` in the protocol is `Math.mulDiv`, and the only thing left to verify per site is the rounding direction. That is one fact per call site instead of a library lookup plus a rounding direction. A security reviewer's job at each `mulDiv` collapses from "which library is this, what does it do, is the direction right" to "is the direction right".
- **The capability check is cheap and the payoff is permanent.** The audit that justified removal was two grep passes (one for `PRBMath.mulDiv` call sites, one for any other PRBMath symbol) plus reading the NatSpec rounding direction on each call site. That is minutes of work for a permanent reduction in dependency count, submodule count, and remapping-table size. The saving is permanent and diffuse; the cost is one-time and visible, which is exactly the profile that makes this kind of cleanup get deferred. Do it anyway.
- **No behavior change, provably.** Because `Math.mulDiv` 3-arg and `PRBMath.mulDiv` are both `(a * b) / d` with floor rounding, the swap is equivalent at the rounding boundary. The existing test and fuzz suites passing untouched is the proof, not a claim. This is the bar for any "consolidation" or "cleanup" refactor: the verification artifact should be a green suite with zero assertion edits, not a suite that had to be rewritten to accommodate the new library.

## When to Apply

Apply when all of the following hold:

- Two or more third-party libraries are providing the same capability (here, fixed-point `mulDiv`).
- One library is a non-removable dependency already imported for other uses (OZ Math, pulled in by `SafeCast`, `Ownable2Step`, `ReentrancyGuard`, `Math` for the ceil site), and the other is removable.
- The removable library's entire used surface is a strict subset of the non-removable library's surface (PRBMath `mulDiv` floor is a subset of OZ `Math.mulDiv` floor + ceil). Verify by grepping for every symbol imported from the removable library, not just the one you remember using.
- Every call site of the removable library can be re-expressed as a call to the non-removable library with identical semantics, verified by reading the NatSpec rounding direction and by the existing test suite (and, for arithmetic, a differential fuzz or the fuzz suite) passing unchanged.

Do not apply when:

- The removable library provides a capability the non-removable one does not. PRBMath's typed `UD60x18`/`SD21x18` variants, `exp`, `ln`, `pow`, `gm` have no OZ `Math` equivalents. If any are in use, PRBMath stays. The capability audit is what tells you this; skip it and you will break the build mid-consolidation.
- A call site relies on a behavior difference that is not just rounding direction (revert strings, overflow semantics at the 512-bit boundary, gas cost on a hot path). `Math.mulDiv` and `PRBMath.mulDiv` have different internal branching and are not guaranteed gas-identical; if a swapped call is on a hot path, gas-diff before/after rather than assuming parity.
- The consolidation would flip a rounding direction. This is the one rule that must not bend: floor and ceil are not interchangeable. A "consolidation" that silently changed `grossPrice` from floor to ceil would move value from buyer to seller; a change that flipped `obligation` from ceil to floor would underpay the lender. The directional rounding analysis in `StreamPricing.sol` (floor on `grossPrice`, ceil on `obligation`) is load-bearing, and the consolidation preserved it exactly — floor sites stayed floor (3-arg), the ceil site stayed ceil (4-arg `Rounding.Up`).

## Examples

### Before: two libraries in one file (`src/StreamPricing.sol`)

```solidity
import {PRBMath} from "prb-math/contracts/PRBMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

function factor(uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
    return WAD + PRBMath.mulDiv(timeToMaturity, uint256(aprBps) * WAD, YEAR * BASIS_POINTS);
}

function grossPrice(uint128 remaining, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
    return PRBMath.mulDiv(uint256(remaining), WAD, factor(aprBps, timeToMaturity));
}

function fee(uint256 borrowAmount, uint16 feeBps) internal pure returns (uint256) {
    return PRBMath.mulDiv(borrowAmount, feeBps, BASIS_POINTS);
}

function obligation(uint256 borrowAmount, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint128) {
    uint256 f = factor(aprBps, timeToMaturity);
    return SafeCast.toUint128(Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up));
}
```

### After: one library, both rounding directions

```solidity
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

function factor(uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
    return WAD + Math.mulDiv(timeToMaturity, uint256(aprBps) * WAD, YEAR * BASIS_POINTS);
}

function grossPrice(uint128 remaining, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
    return Math.mulDiv(uint256(remaining), WAD, factor(aprBps, timeToMaturity));
}

function fee(uint256 borrowAmount, uint16 feeBps) internal pure returns (uint256) {
    return Math.mulDiv(borrowAmount, feeBps, BASIS_POINTS);
}

function obligation(uint256 borrowAmount, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint128) {
    uint256 f = factor(aprBps, timeToMaturity);
    return SafeCast.toUint128(Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up));
}
```

The `PRBMath` import is gone; the `Math` import that was already there for `obligation` now serves every site. The three floor calls (3-arg) and the one ceil call (4-arg `Rounding.Up`) live side by side under one symbol.

### The floor-vs-ceil distinction the consolidation must preserve

```solidity
// Floor (3-arg, default Rounding.Down): buyer pays AT MOST the discounted value.
// grossPrice must floor so the buyer never overpays.
return Math.mulDiv(uint256(remaining), WAD, factor(aprBps, timeToMaturity));

// Ceil (4-arg, Rounding.Up): lender is owed AT LEAST the accrual.
// obligation must ceil so the lender is never underpaid.
return SafeCast.toUint128(Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up));
```

Both are `Math.mulDiv` after consolidation. The rounding direction is now the only thing distinguishing them, expressed as a trailing argument rather than as a different library. That is the whole point of the swap: one primitive, one fact per call site.

### `src/OVRFLO.sol`: floor call sites in the vault

```solidity
// Before
import {PRBMath} from "prb-math/contracts/PRBMath.sol";
// ...
toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD);                 // _computeSplit
// ...
uint256 fee = StreamPricing.fee(PRBMath.mulDiv(amount, rateE18, WAD), flashFeeBps);  // flash fee base

// After
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
// ...
toUser = Math.mulDiv(ptAmount, rateE18, WAD);                    // _computeSplit
// ...
uint256 fee = StreamPricing.fee(Math.mulDiv(amount, rateE18, WAD), flashFeeBps);     // flash fee base
```

### Config and submodule cleanup

```toml
# foundry.toml — before
remappings = [
    "prb-math/=lib/prb-math/contracts/",
    # ...
]

# foundry.toml — after
remappings = [
    # prb-math entry deleted; no file imports it anymore
    # ...
]
```

```bash
# Remove the submodule once no file imports it and the remapping is gone.
git submodule deinit -f lib/prb-math
git rm -f lib/prb-math
rm -rf .git/modules/lib/prb-math
```

After this, `lib/` contains only `forge-std` and `openzeppelin-contracts`, and `.gitmodules` lists only those two. The verification gate: `forge build` clean, `forge test` 365 passed / 0 failed, medusa fuzz 140 passed / 0 failed / 0 warnings — the drop-in swap confirmed by the existing suite passing untouched.

## Related

- [Behavior-preserving simplification refactor](../architecture-patterns/behavior-preserving-simplification-refactor.md) — direct precursor. Its U7 unit migrated the obligation calculation from hand-rolled ceil (PRBMath.mulDiv + mulmod) to OZ Math.mulDiv(Rounding.Up), which brought the OZ Math import into StreamPricing.sol and made this consolidation possible. This doc is the dependency-removal capstone of that work.
- [Solidity hot-path optimization patterns](../best-practices/solidity-hot-path-optimization-patterns.md) — references "OpenZeppelin and PRB-Math" in its project context line, which is now stale after this consolidation. Refresh candidate for `/ce-compound-refresh`.
