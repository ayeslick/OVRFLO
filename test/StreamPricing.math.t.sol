// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PRBMath} from "prb-math/PRBMath.sol";
import {StreamPricing} from "../src/StreamPricing.sol";

/// @dev Harness to expose internal pure functions for testing.
contract MathHarness {
    function factor(uint16 aprBps, uint256 ttm) external pure returns (uint256) {
        return StreamPricing.factor(aprBps, ttm);
    }

    function grossPrice(uint128 remaining, uint16 aprBps, uint256 ttm) external pure returns (uint256) {
        return StreamPricing.grossPrice(remaining, aprBps, ttm);
    }

    function obligation(uint256 borrowAmount, uint16 aprBps, uint256 ttm) external pure returns (uint128) {
        return StreamPricing.obligation(borrowAmount, aprBps, ttm);
    }

    function obligationForFill(uint256 borrowAmount, uint256 grossPrice_, uint128 remaining, uint16 aprBps, uint256 ttm)
        external
        pure
        returns (uint128)
    {
        return StreamPricing.obligationForFill(borrowAmount, grossPrice_, remaining, aprBps, ttm);
    }

    function fee(uint256 amount, uint16 feeBps) external pure returns (uint256) {
        return StreamPricing.fee(amount, feeBps);
    }
}

contract StreamPricingMathTest is Test {
    MathHarness internal h;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant BPS = 10_000;

    function setUp() public {
        h = new MathHarness();
    }

    /*//////////////////////////////////////////////////////////////
                     FACTOR PROPERTIES
    //////////////////////////////////////////////////////////////*/

    function test_Factor_AlwaysAtLeastWAD(uint16 aprBps, uint256 ttm) public pure {
        ttm = ttm % (1000 * 365 days); // bound to avoid PRBMath mulDiv overflow
        assertGe(StreamPricing.factor(aprBps, ttm), WAD);
    }

    function test_Factor_ZeroAprIsWAD(uint256 ttm) public pure {
        assertEq(StreamPricing.factor(0, ttm), WAD);
    }

    function test_Factor_ZeroTtmIsWAD(uint16 aprBps) public pure {
        assertEq(StreamPricing.factor(aprBps, 0), WAD);
    }

    function test_Factor_KnownValue_10pct_1yr() public view {
        // f = 1 + 0.10 * 1 = 1.1
        assertEq(h.factor(1000, 365 days), 1.1e18);
    }

    function test_Factor_KnownValue_25pct_6mo() public view {
        // f = 1 + 0.25 * 0.5 = 1.125
        assertEq(h.factor(2500, 182 days + 12 hours), 1.125e18);
    }

    function test_Factor_GrowsMonotonicallyWithApr() public view {
        uint256 ttm = 180 days;
        assertLt(h.factor(500, ttm), h.factor(1000, ttm));
        assertLt(h.factor(1000, ttm), h.factor(5000, ttm));
    }

    function test_Factor_GrowsMonotonicallyWithTtm() public view {
        uint16 apr = 1000;
        assertLt(h.factor(apr, 30 days), h.factor(apr, 90 days));
        assertLt(h.factor(apr, 90 days), h.factor(apr, 365 days));
    }

    /*//////////////////////////////////////////////////////////////
                     GROSSPRICE PROPERTIES
    //////////////////////////////////////////////////////////////*/

    function test_GrossPrice_NeverExceedsRemaining(uint128 remaining, uint16 aprBps, uint256 ttm) public view {
        ttm = ttm % (1000 * 365 days); // bound to avoid PRBMath mulDiv overflow
        vm.assume(remaining > 0);
        uint256 price = h.grossPrice(remaining, aprBps, ttm);
        assertLe(price, uint256(remaining));
    }

    function test_GrossPrice_EqualsRemainingWhenNoDiscount() public view {
        // apr = 0 → f = WAD → price = remaining
        assertEq(h.grossPrice(100 ether, 0, 365 days), 100 ether);
        // ttm = 0 → f = WAD → price = remaining
        assertEq(h.grossPrice(100 ether, 1000, 0), 100 ether);
    }

    function test_GrossPrice_KnownValue_10pct_1yr() public view {
        // remaining = 110 ether, f = 1.1 → price = 100 ether
        assertEq(h.grossPrice(110 ether, 1000, 365 days), 100 ether);
    }

    function test_GrossPrice_FloorsToZeroWithDustAndExtremeRate() public view {
        // 1 wei remaining, 655.35% APR, 10 years → price = 0
        assertEq(h.grossPrice(1, type(uint16).max, 10 * 365 days), 0);
    }

    function test_GrossPrice_DecreasesAsAprIncreases() public view {
        uint128 remaining = 100 ether;
        uint256 ttm = 180 days;
        assertGt(h.grossPrice(remaining, 100, ttm), h.grossPrice(remaining, 500, ttm));
        assertGt(h.grossPrice(remaining, 500, ttm), h.grossPrice(remaining, 2500, ttm));
    }

    function test_GrossPrice_DecreasesAsTtmIncreases() public view {
        uint128 remaining = 100 ether;
        uint16 apr = 1000;
        assertGt(h.grossPrice(remaining, apr, 30 days), h.grossPrice(remaining, apr, 180 days));
        assertGt(h.grossPrice(remaining, apr, 180 days), h.grossPrice(remaining, apr, 365 days));
    }

    /*//////////////////////////////////////////////////////////////
                     OBLIGATION PROPERTIES
    //////////////////////////////////////////////////////////////*/

    function test_Obligation_NeverBelowBorrowAmount(uint256 borrowAmount, uint16 aprBps, uint256 ttm) public view {
        ttm = ttm % (1000 * 365 days); // bound to avoid PRBMath mulDiv overflow
        vm.assume(borrowAmount > 0 && borrowAmount <= type(uint128).max);
        // Skip cases that overflow uint128 (tested separately)
        uint256 f = StreamPricing.factor(aprBps, ttm);
        vm.assume(borrowAmount * f / WAD <= type(uint128).max);
        assertGe(uint256(h.obligation(borrowAmount, aprBps, ttm)), borrowAmount);
    }

    function test_Obligation_EqualsBorrowAmountWhenNoAccrual() public view {
        assertEq(h.obligation(50 ether, 0, 365 days), 50 ether);
        assertEq(h.obligation(50 ether, 1000, 0), 50 ether);
    }

    function test_Obligation_KnownValue_10pct_1yr() public view {
        // borrowAmount = 100 ether, f = 1.1 → obligation = 110 ether
        assertEq(h.obligation(100 ether, 1000, 365 days), 110 ether);
    }

    function test_Obligation_CeilIsAtMostOneWeiAboveFloor() public view {
        // For any inputs, ceil(x) - floor(x) <= 1
        uint256 borrowAmount = 97 ether;
        uint16 apr = 333;
        uint256 ttm = 77 days;
        uint256 f = StreamPricing.factor(apr, ttm);

        uint256 floored = borrowAmount * f / WAD;
        uint128 ceiled = h.obligation(borrowAmount, apr, ttm);
        assertLe(uint256(ceiled) - floored, 1);
    }

    function test_Obligation_CeilPinnedExercisesAddOne() public view {
        // Pinned case where mulmod != 0, so the ceil branch (value += 1) fires.
        // borrowAmount = 97e18 + 1, apr = 1000 (10%), ttm = 365 days
        // factor = 1.1e18, floor = 106.7e18, ceil = 106.7e18 + 1
        // Deleting the `value += 1` line would make this test fail.
        uint256 borrowAmount = 97e18 + 1;
        uint256 f = StreamPricing.factor(1000, 365 days);
        uint256 floored = borrowAmount * f / WAD;
        uint128 ceiled = h.obligation(borrowAmount, 1000, 365 days);
        assertEq(uint256(ceiled), floored + 1, "ceil must be floor + 1 when mulmod != 0");
    }

    function test_Obligation_OverflowsReverts(uint16 aprBps) public {
        // Use ttm that creates a large factor, combined with max uint128 borrow
        uint256 ttm = 50 * 365 days;
        uint256 f = StreamPricing.factor(aprBps, ttm);
        vm.assume(f > WAD); // skip zero-apr which won't overflow
        uint256 borrowAmount = type(uint128).max;
        // OZ SafeCast.toUint128 revert message (replaces the hand-rolled check).
        vm.expectRevert("SafeCast: value doesn't fit in 128 bits");
        h.obligation(borrowAmount, aprBps, ttm);
    }

    /*//////////////////////////////////////////////////////////////
                     OBLIGATION vs OLD HAND-ROLLED CEIL (U7 DIFFERENTIAL)
    //////////////////////////////////////////////////////////////*/

    /// @dev Reference implementation of the pre-U7 hand-rolled ceil + manual uint128 cast.
    ///      Proves behavior-identity with the new OZ `Math.mulDiv(Rounding.Up)` +
    ///      `SafeCast.toUint128` path. Keep in sync with the old `obligation` body.
    function _oldObligation(uint256 borrowAmount, uint16 aprBps, uint256 timeToMaturity)
        internal
        pure
        returns (uint128)
    {
        uint256 f = StreamPricing.factor(aprBps, timeToMaturity);
        uint256 value = PRBMath.mulDiv(borrowAmount, f, WAD);
        if (mulmod(borrowAmount, f, WAD) != 0) {
            value += 1;
        }
        require(value <= type(uint128).max, "StreamPricing: obligation overflow");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(value);
    }

    /// @dev Differential fuzz: new OZ-based `obligation` must equal the old hand-rolled
    ///      ceil for all non-overflowing inputs (overflow reverts are tested separately).
    function test_Fuzz_Obligation_MatchesOldHandRolledCeil(uint256 borrowAmount, uint16 aprBps, uint256 ttm)
        public
        view
    {
        ttm = ttm % (1000 * 365 days); // bound to avoid PRBMath mulDiv overflow
        // Bound borrowAmount to uint128 first so the overflow-check below cannot panic
        // on `borrowAmount * f` exceeding uint256 (obligation >= borrowAmount since
        // f >= WAD, so any borrowAmount > uint128.max reverts in both implementations).
        vm.assume(borrowAmount <= type(uint128).max);
        // Skip cases that overflow uint128 — both implementations revert identically
        // there (covered by test_Obligation_OverflowsReverts). Use strict < so the
        // ceiling rounding (+1) can't push the result to exactly uint128.max + 1.
        uint256 f = StreamPricing.factor(aprBps, ttm);
        vm.assume(borrowAmount * f / WAD < type(uint128).max);

        assertEq(
            uint256(h.obligation(borrowAmount, aprBps, ttm)),
            uint256(_oldObligation(borrowAmount, aprBps, ttm)),
            "new OZ obligation != old hand-rolled ceil"
        );
    }

    /// @dev Pinned edge cases: zero borrow, zero APR (exact), exact division,
    ///      non-exact division (ceil fires), and the uint128 boundary (exact, no overflow).
    ///      All must be identical between the new and reference implementations.
    function test_Obligation_Differential_EdgeCases() public view {
        // Zero borrow amount → 0 under both.
        assertEq(uint256(h.obligation(0, 1000, 365 days)), uint256(_oldObligation(0, 1000, 365 days)));
        assertEq(uint256(h.obligation(0, 1000, 365 days)), 0);

        // Zero APR → f = WAD → obligation == borrowAmount (exact division).
        assertEq(uint256(h.obligation(100 ether, 0, 365 days)), uint256(_oldObligation(100 ether, 0, 365 days)));

        // Exact division: 100e18 * 1.1e18 / 1e18 = 110e18 exactly.
        assertEq(uint256(h.obligation(100 ether, 1000, 365 days)), uint256(_oldObligation(100 ether, 1000, 365 days)));
        assertEq(uint256(h.obligation(100 ether, 1000, 365 days)), 110 ether);

        // Non-exact division: mulmod != 0, ceil branch fires (97e18 + 1).
        uint256 nonExact = 97e18 + 1;
        assertEq(uint256(h.obligation(nonExact, 1000, 365 days)), uint256(_oldObligation(nonExact, 1000, 365 days)));

        // uint128 boundary: borrowAmount == type(uint128).max with f == WAD (zero APR)
        // → exact, no overflow, returns type(uint128).max.
        assertEq(
            uint256(h.obligation(type(uint128).max, 0, 365 days)),
            uint256(_oldObligation(type(uint128).max, 0, 365 days))
        );
        assertEq(uint256(h.obligation(type(uint128).max, 0, 365 days)), uint256(type(uint128).max));
    }

    /*//////////////////////////////////////////////////////////////
                     OBLIGATIONFORFULL — THE CRITICAL INVARIANT
    //////////////////////////////////////////////////////////////*/

    function test_ObligationForFill_FullBorrowReturnsRemainingExactly() public view {
        uint128 remaining = 100 ether;
        uint16 apr = 1000;
        uint256 ttm = 365 days;
        uint256 gp = h.grossPrice(remaining, apr, ttm);

        // Full-borrow fast path: obligation == remaining (no rounding dust)
        assertEq(h.obligationForFill(gp, gp, remaining, apr, ttm), remaining);
    }

    function test_ObligationForFill_FullBorrowAvoidsRoundingDust() public view {
        uint128 remaining = 100 ether;
        uint16 apr = 1000;
        uint256 ttm = 365 days;
        uint256 gp = h.grossPrice(remaining, apr, ttm);

        // The non-fast-path obligation of grossPrice is remaining - 1 (dust)
        assertEq(h.obligation(gp, apr, ttm), remaining - 1);
        // But obligationForFill returns remaining exactly
        assertEq(h.obligationForFill(gp, gp, remaining, apr, ttm), remaining);
    }

    function test_ObligationForFill_Boundary_OneWeiBelowGrossPrice() public view {
        uint128 remaining = 100 ether;
        uint16 apr = 1000;
        uint256 ttm = 365 days;
        uint256 gp = h.grossPrice(remaining, apr, ttm);
        vm.assume(gp > 0);

        // 1 wei below grossPrice → partial-borrow path, not fast path
        uint256 borrowAmount = gp - 1;
        uint128 ob = h.obligationForFill(borrowAmount, gp, remaining, apr, ttm);

        // Must still be <= remaining
        assertLe(ob, remaining);
        // Must be < remaining (not the fast path)
        assertLt(ob, remaining);
    }

    function test_Fuzz_ObligationForFill_NeverExceedsRemaining(
        uint128 remaining,
        uint16 aprBps,
        uint256 ttm,
        uint256 borrowSeed
    ) public view {
        remaining = uint128(bound(uint256(remaining), 1, type(uint128).max));
        ttm = bound(ttm, 0, 100 * 365 days);

        uint256 gp = h.grossPrice(remaining, aprBps, ttm);
        vm.assume(gp > 0); // skip zero-price cases

        uint256 borrowAmount = bound(borrowSeed, 0, gp);

        uint128 ob = h.obligationForFill(borrowAmount, gp, remaining, aprBps, ttm);
        assertLe(ob, remaining, "obligation exceeds remaining");
    }

    function test_Fuzz_ObligationForFill_FastPathOnlyWhenExactMatch(uint128 remaining, uint16 aprBps, uint256 ttm)
        public
        view
    {
        remaining = uint128(bound(uint256(remaining), 1, type(uint128).max));
        ttm = bound(ttm, 0, 100 * 365 days);

        uint256 gp = h.grossPrice(remaining, aprBps, ttm);
        vm.assume(gp > 0);

        // Fast path: borrowAmount == gp → obligation == remaining
        assertEq(h.obligationForFill(gp, gp, remaining, aprBps, ttm), remaining);

        // One off: borrowAmount == gp - 1 → obligation < remaining (partial path)
        if (gp > 1) {
            assertLt(h.obligationForFill(gp - 1, gp, remaining, aprBps, ttm), remaining);
        }
    }

    /*//////////////////////////////////////////////////////////////
                     REALISTIC-RANGE FUZZ (OVRFLO OPERATING ENVELOPE)
    //////////////////////////////////////////////////////////////*/

    /// @dev Constrains inputs to OVRFLO's actual operating range:
    ///      remaining: 1 ether to 10,000 ether
    ///      aprBps: 0 to 5,000 (0% to 50%)
    ///      ttm: 0 to 2 years
    function test_Fuzz_RealisticRange_ObligationNeverExceedsRemaining(
        uint128 remainingSeed,
        uint16 aprBps,
        uint256 ttmSeed,
        uint256 borrowSeed
    ) public view {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1 ether, 10_000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 5000));
        uint256 ttm = bound(ttmSeed, 0, 2 * 365 days);

        uint256 gp = h.grossPrice(remaining, apr, ttm);
        vm.assume(gp > 0);

        uint256 borrowAmount = bound(borrowSeed, 0, gp);
        uint128 ob = h.obligationForFill(borrowAmount, gp, remaining, apr, ttm);

        assertLe(ob, remaining, "obligation exceeds remaining");
        assertGe(uint256(ob), borrowAmount, "obligation below borrow");
    }

    function test_Fuzz_RealisticRange_GrossPricePositive(uint128 remainingSeed, uint16 aprBps, uint256 ttmSeed)
        public
        view
    {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1 ether, 10_000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 5000));
        uint256 ttm = bound(ttmSeed, 1, 2 * 365 days);

        uint256 gp = h.grossPrice(remaining, apr, ttm);
        assertGt(gp, 0, "grossPrice zero in realistic range");
        assertLe(gp, uint256(remaining), "grossPrice exceeds remaining");
    }

    function test_Fuzz_RealisticRange_FactorReasonable(uint16 aprBps, uint256 ttmSeed) public view {
        uint16 apr = uint16(bound(uint256(aprBps), 0, 5000));
        uint256 ttm = bound(ttmSeed, 0, 2 * 365 days);
        uint256 f = h.factor(apr, ttm);

        // At 50% APR, 2yr: f = 1 + 0.50 * 2 = 2.0 → f <= 2 * WAD
        assertLe(f, 2 * WAD, "factor exceeds 2x in realistic range");
        assertGe(f, WAD, "factor below WAD");
    }

    function test_Fuzz_RealisticRange_ResidualNeverUnderflows(
        uint128 remainingSeed,
        uint16 aprBps,
        uint256 ttmSeed,
        uint256 borrowSeed
    ) public view {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1 ether, 10_000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 5000));
        uint256 ttm = bound(ttmSeed, 0, 2 * 365 days);

        uint256 gp = h.grossPrice(remaining, apr, ttm);
        vm.assume(gp > 0);

        uint256 borrowAmount = bound(borrowSeed, 0, gp);
        uint128 ob = h.obligationForFill(borrowAmount, gp, remaining, apr, ttm);

        // residual = remaining - obligation must not underflow
        assertLe(ob, remaining, "residual underflow");
        uint128 residual = remaining - ob;
        assertLe(residual, remaining, "residual exceeds remaining");
    }

    /*//////////////////////////////////////////////////////////////
                     ROUND-TRIP CONSISTENCY
    //////////////////////////////////////////////////////////////*/

    /// @dev The round-trip gap (remaining - obligation(grossPrice)) is not
    ///      always 1 wei — it can be up to floor(F/W) - 1 when the factor is
    ///      large. But the invariant obligation <= remaining always holds.
    function test_Fuzz_RoundTrip_ObligationOfGrossPriceLeRemaining(uint128 remaining, uint16 aprBps, uint256 ttm)
        public
        view
    {
        remaining = uint128(bound(uint256(remaining), 1, type(uint128).max));
        ttm = bound(ttm, 0, 100 * 365 days);

        uint256 gp = h.grossPrice(remaining, aprBps, ttm);
        vm.assume(gp > 0 && gp <= type(uint128).max);

        uint128 ob = h.obligation(gp, aprBps, ttm);
        assertLe(ob, remaining, "obligation exceeds remaining");
        // The gap is non-negative (obligation <= remaining)
        assertGe(uint256(remaining) - uint256(ob), 0, "negative gap");
    }

    function test_Fuzz_RoundTrip_ObligationForFillConsistentWithObligation(
        uint128 remaining,
        uint16 aprBps,
        uint256 ttm,
        uint256 borrowSeed
    ) public view {
        remaining = uint128(bound(uint256(remaining), 1, type(uint128).max));
        ttm = bound(ttm, 0, 100 * 365 days);

        uint256 gp = h.grossPrice(remaining, aprBps, ttm);
        vm.assume(gp > 0);

        uint256 borrowAmount = bound(borrowSeed, 0, gp);

        // For partial borrows, obligationForFill == obligation
        if (borrowAmount != gp) {
            uint128 obForFill = h.obligationForFill(borrowAmount, gp, remaining, aprBps, ttm);
            // May revert on overflow — skip those cases
            (bool ok,) = address(h).staticcall(abi.encodeCall(MathHarness.obligation, (borrowAmount, aprBps, ttm)));
            if (ok) {
                uint128 ob = h.obligation(borrowAmount, aprBps, ttm);
                assertEq(obForFill, ob, "partial-borrow mismatch");
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                     FEE PROPERTIES
    //////////////////////////////////////////////////////////////*/

    function test_Fee_ZeroBpsIsZero(uint256 amount) public view {
        assertEq(h.fee(amount, 0), 0);
    }

    function test_Fee_FloorsCorrectly() public view {
        // 99 * 100 / 10000 = 0.99 → floors to 0
        assertEq(h.fee(99, 100), 0);
        // 100 * 100 / 10000 = 1
        assertEq(h.fee(100, 100), 1);
    }

    function test_Fuzz_FeeNeverExceedsInput(uint256 amount, uint16 feeBps) public view {
        vm.assume(amount <= type(uint128).max);
        feeBps = uint16(bound(uint256(feeBps), 0, BPS)); // cap at 100%
        uint256 f = h.fee(amount, feeBps);
        assertLe(f, amount);
    }
}
