// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/console2.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {LendingMockFixture} from "./helpers/LendingMockFixture.sol";

/// @title OVRFLOLendingGas
/// @notice Gas evidence for the two Success-Criteria claims the v1-lite design rests on.
/// @dev The contract name deliberately begins with `OVRFLOLending` so the Verification
///      Contract's snapshot gate (`forge snapshot --match-contract OVRFLOLending`) records
///      these measurements in `.gas-snapshot`.
///
///      Whole-test snapshot gas is dominated by fixture setup (the growth pair alone
///      appends 8,193 leaves), so the *claims* are asserted on isolated `gasleft()`
///      deltas measured around the `borrow` call itself. The `.gas-snapshot` line is the
///      durable regression record; the in-test assertion is what actually enforces
///      flatness, and it fails loudly rather than drifting silently.
contract OVRFLOLendingGas is LendingMockFixture {
    address internal constant LENDER = address(0xA11CE);
    address internal constant BORROWER = address(0xD0C);
    address internal constant GRIEFER = address(0x6816);

    /// @dev Tick used for the single-position leg of the flatness pair.
    uint16 internal constant APR_SPARSE = 1000;
    /// @dev Tick used for the fifty-position leg of the flatness pair.
    uint16 internal constant APR_DENSE = 1025;
    /// @dev Tick held at height 4 (exactly at capacity, pre-growth).
    uint16 internal constant APR_HEIGHT4 = 1050;
    /// @dev Tick pushed past the 4,096-leaf boundary into height 5.
    uint16 internal constant APR_HEIGHT5 = 1075;
    /// @dev Tick consumed by the discarded warm-up borrow. See `_warmUp`.
    uint16 internal constant APR_WARMUP = 1100;

    /// @dev Leaf capacity of a height-4 tree (`8 ** 4`). One more append grows the tree.
    uint32 internal constant HEIGHT4_CAPACITY = 4096;

    /// @notice Flatness tolerance: one cold `SLOAD`.
    /// @dev The bound is principled rather than fitted. A per-position implementation
    ///      would have to read each consumed position, costing at least one cold `SLOAD`
    ///      (2,100 gas) per extra position — 49 x 2,100 = 102,900 gas for the 1-vs-50
    ///      pair. Holding the excess under a *single* cold read is therefore a statement
    ///      that no per-position work happens at all, not merely that it is cheap. If a
    ///      refactor reintroduces a consumption loop, this assertion fails by ~50x.
    ///
    ///      The assertions are deliberately DIRECTIONAL — they bound how much more the
    ///      wider fill may cost, not the absolute difference. Flatness is the claim that
    ///      crossing more positions (or a taller tree) does not cost more; the wider leg
    ///      measuring *cheaper* is not a violation of it. As measured, the 50-position
    ///      leg is 2,000 gas cheaper than the 1-position leg and the two growth-boundary
    ///      legs are identical to the gas, so a symmetric bound here would be pinning
    ///      incidental constant-cost noise rather than the property.
    uint256 internal constant FLATNESS_TOLERANCE = 2_100;

    function setUp() public {
        _deployLendingSystem();
        // Widen the bounds so all four measurement ticks are valid spacing multiples.
        lending.setAprBounds(1000, 1100);
    }

    /*//////////////////////////////////////////////////////////////
        FLATNESS PAIR 1 — POSITION COUNT AT A FIXED TREE HEIGHT
    //////////////////////////////////////////////////////////////*/

    /// @notice Covers Success Criteria (gas flatness): a fill crossing 1 position and a
    ///         fill crossing 50 differ only by constant loan-record cost.
    /// @dev This is the measurable form of the blind-fill guarantee. Consumption is a
    ///      single packed slot write (`filled` + `loanCount`), so the number of lender
    ///      positions the interval spans cannot appear in the gas profile.
    function test_Gas_BorrowFlatness_OneVsFiftyPositions() public {
        uint128 depth = 5 ether;

        // Leg A: one position holding the entire tick depth.
        _fundLender(LENDER, 100 ether);
        vm.prank(LENDER);
        uint256 solePosition = lending.supply(MARKET, APR_SPARSE, depth);

        // Leg B: fifty positions summing to the same depth, at a different tick.
        uint128 slice = depth / 50;
        uint256 firstOfFifty;
        uint256 lastOfFifty;
        vm.startPrank(LENDER);
        for (uint256 i = 0; i < 50; ++i) {
            uint256 id = lending.supply(MARKET, APR_DENSE, slice);
            if (i == 0) firstOfFifty = id;
            lastOfFifty = id;
        }
        vm.stopPrank();

        _createStream(1, BORROWER, _faceForGross(100 ether));
        _createStream(2, BORROWER, _faceForGross(100 ether));

        _warmUp();

        uint256 sparseGas = _measureBorrow(APR_SPARSE, depth, 1);
        uint256 denseGas = _measureBorrow(APR_DENSE, depth, 2);

        // The fills must actually have spanned what the test claims, or the measurement
        // is vacuous: both ticks are fully consumed, so leg B crossed all fifty leaves.
        _assertFullyConsumed(solePosition);
        _assertFullyConsumed(firstOfFifty);
        _assertFullyConsumed(lastOfFifty);

        console2.log("borrow gas, interval spans 1 position :", sparseGas);
        console2.log("borrow gas, interval spans 50 positions:", denseGas);

        _logSignedDelta(sparseGas, denseGas);
        assertLe(denseGas, sparseGas + FLATNESS_TOLERANCE, "borrow gas scales with positions crossed");
    }

    /*//////////////////////////////////////////////////////////////
        FLATNESS PAIR 2 — ACROSS A TREE-HEIGHT GROWTH BOUNDARY
    //////////////////////////////////////////////////////////////*/

    /// @notice Covers Success Criteria (gas flatness) through tree growth.
    /// @dev Recorded by the U3 review (2026-08-08): a same-height pair does not pin
    ///      flatness *through growth*, because a taller tree could in principle cost the
    ///      borrower more to read. It does not — `root()` sums the eight nodes of the
    ///      active top segment regardless of height, which is two packed words at every
    ///      height — but that is exactly the kind of claim that needs a measurement
    ///      rather than an argument. One tick is parked at height 4's exact capacity
    ///      (4,096 leaves); the other is pushed one leaf past it, which grows the tree to
    ///      height 5 inside `TickTree.append`.
    function test_Gas_BorrowFlatness_AcrossTreeHeightGrowth() public {
        uint128 leafSize = lending.MIN_LIQUIDITY_AMOUNT();

        _fundLender(LENDER, 1_000 ether);

        vm.startPrank(LENDER);
        for (uint256 i = 0; i < HEIGHT4_CAPACITY; ++i) {
            lending.supply(MARKET, APR_HEIGHT4, leafSize);
        }
        for (uint256 i = 0; i < HEIGHT4_CAPACITY + 1; ++i) {
            lending.supply(MARKET, APR_HEIGHT5, leafSize);
        }
        vm.stopPrank();

        uint128 height4Depth = uint128(HEIGHT4_CAPACITY) * leafSize;
        uint128 height5Depth = uint128(HEIGHT4_CAPACITY + 1) * leafSize;

        _createStream(3, BORROWER, _faceForGross(100 ether));
        _createStream(4, BORROWER, _faceForGross(100 ether));

        _warmUp();

        uint256 height4Gas = _measureBorrow(APR_HEIGHT4, height4Depth, 3);
        uint256 height5Gas = _measureBorrow(APR_HEIGHT5, height5Depth, 4);

        console2.log("borrow gas, height 4 (4096 leaves):", height4Gas);
        console2.log("borrow gas, height 5 (4097 leaves):", height5Gas);

        _logSignedDelta(height4Gas, height5Gas);
        assertLe(height5Gas, height4Gas + FLATNESS_TOLERANCE, "borrow gas scales with tree height");
    }

    /*//////////////////////////////////////////////////////////////
        RISK #4 — TAPE-SPAM COST IS GAS-BOUNDED
    //////////////////////////////////////////////////////////////*/

    /// @notice Pins the Multicall-batched supply+withdraw cycle cost (plan risk #4).
    /// @dev The griefing model the plan prices: leaves are never reclaimed, so one
    ///      `MIN_LIQUIDITY_AMOUNT` of capital can be recycled indefinitely to append
    ///      leaves — batched into a single transaction via the book's inherited
    ///      `Multicall`, which is the cheapest form available to an attacker. Position
    ///      ids are sequential and readable, so the attacker predicts each id off-chain
    ///      and pairs it with its own `supply` in the same batch. The measurement is the
    ///      whole deterrent: the cost is per-cycle gas, and the capital is returned in
    ///      full, so `MIN_LIQUIDITY_AMOUNT` bounds the attacker's *stake*, never their
    ///      spend. This test records the number; it does not assert a ceiling, because a
    ///      gas ceiling asserted against a moving optimizer is a false regression signal.
    function test_Gas_MulticallSupplyWithdrawCycle() public {
        uint256 cycles = 20;
        uint128 atom = lending.MIN_LIQUIDITY_AMOUNT();

        // The attacker holds exactly one atom — never more — for the whole campaign.
        _fundLender(GRIEFER, atom);
        uint256 startBalance = underlying.balanceOf(GRIEFER);
        assertEq(startBalance, atom, "attacker starts with exactly one atom");

        uint256 firstId = lending.nextPositionId();
        bytes[] memory calls = new bytes[](cycles * 2);
        for (uint256 i = 0; i < cycles; ++i) {
            calls[i * 2] = abi.encodeCall(OVRFLOLending.supply, (MARKET, APR, atom));
            calls[i * 2 + 1] = abi.encodeCall(OVRFLOLending.withdraw, (firstId + i));
        }

        vm.prank(GRIEFER);
        uint256 gasBefore = gasleft();
        lending.multicall(calls);
        uint256 gasUsed = gasBefore - gasleft();

        console2.log("multicall supply+withdraw cycles  :", cycles);
        console2.log("total gas                         :", gasUsed);
        console2.log("gas per cycle                     :", gasUsed / cycles);

        // Capital-neutral: the atom comes back, so the deterrent is gas and only gas.
        assertEq(underlying.balanceOf(GRIEFER), startBalance, "griefing must not consume capital");
        assertEq(underlying.balanceOf(address(lending)), 0, "no residue escrowed after the cycle");

        // Leaves are permanent: every cycle appended a coordinate that will never be
        // reclaimed. This is the state cost the gas price is buying.
        assertEq(lending.nextPositionId(), firstId + cycles, "each cycle must append a fresh leaf");
        (OVRFLOLending.Position memory last,,,) = lending.positionState(firstId + cycles - 1);
        assertEq(uint256(last.leafIndex), cycles - 1, "leaf indexes are never reused");
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Reports the wider leg's cost relative to the narrower one, with its sign,
    ///      so the snapshot record shows which direction the residual runs.
    function _logSignedDelta(uint256 narrowGas, uint256 widerGas) internal pure {
        if (widerGas >= narrowGas) {
            console2.log("delta (wider leg costs MORE by)   :", widerGas - narrowGas);
        } else {
            console2.log("delta (wider leg costs LESS by)   :", narrowGas - widerGas);
        }
    }

    /// @dev Executes and discards one full borrow before any measurement is taken.
    ///
    ///      Without this, the *first* measured borrow silently absorbs every
    ///      once-per-transaction cold cost the two legs share — the treasury and
    ///      borrower ERC20 slots, the Sablier and token account accesses, the fee and
    ///      bounds slots — and the second leg reads ~50k cheaper purely because it ran
    ///      second. That artifact tracks measurement order, not positions crossed, and
    ///      an unwarmed pair reports a 50k "delta" whichever leg is measured first. The
    ///      warm-up moves those costs out of both measurements, leaving each leg paying
    ///      only for its own tick and stream — an identical set of slots on both sides,
    ///      which is precisely the comparison the flatness claim needs.
    function _warmUp() internal {
        _fundLender(LENDER, 1 ether);
        vm.prank(LENDER);
        lending.supply(MARKET, APR_WARMUP, 1 ether);
        _createStream(99, BORROWER, _faceForGross(100 ether));
        vm.prank(BORROWER);
        lending.borrow(MARKET, APR_WARMUP, 1 ether, 99, 0);
    }

    /// @dev Measures one `borrow` in isolation. `gasleft()` is the GAS opcode, not an
    ///      external call, so the pending prank survives the first read.
    function _measureBorrow(uint16 aprBps, uint128 target, uint256 streamId) internal returns (uint256 gasUsed) {
        vm.prank(BORROWER);
        uint256 gasBefore = gasleft();
        lending.borrow(MARKET, aprBps, target, streamId, 0);
        gasUsed = gasBefore - gasleft();
    }

    /// @dev A position whose unfilled remainder is zero was fully crossed by the fill.
    function _assertFullyConsumed(uint256 positionId) internal view {
        (,,, uint128 unfilled) = lending.positionState(positionId);
        assertEq(unfilled, 0, "position was not fully consumed by the fill");
    }
}
