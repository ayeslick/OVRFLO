// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {StreamPricing} from "../src/StreamPricing.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {VaultMockHelpers} from "./helpers/VaultMockHelpers.sol";
import {LendingMockFixture} from "./helpers/LendingMockFixture.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";

contract FuzzMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FuzzFlashBorrower is IFlashBorrower {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;

    constructor(OVRFLO vault_) {
        vault = vault_;
    }

    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external view returns (bytes32) {
        require(msg.sender == address(vault), "not vault");
        return CALLBACK_SUCCESS;
    }
}

contract OVRFLOFuzzTest is VaultMockHelpers {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x1001);

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    FuzzMockERC20 internal underlying;
    FuzzMockERC20 internal pt;
    FuzzFlashBorrower internal borrower;

    uint256 internal constant DEPOSIT_AMOUNT = 100 ether;
    uint256 internal constant RATE_95 = 0.95e18;

    function setUp() public {
        uint256 expiry = block.timestamp + 365 days;

        underlying = new FuzzMockERC20("Underlying", "UND");
        pt = new FuzzMockERC20("PT", "PT");

        ovrflo = new OVRFLO(ADMIN, TREASURY, address(underlying), "OVRFLO UND", "ovrfloUND", PENDLE_ORACLE);
        ovrfloToken = OVRFLOToken(ovrflo.ovrfloToken());

        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(MARKET, address(pt), TWAP_DURATION, expiry, 0);

        _mockRate(MARKET, RATE_95);
        vm.mockCall(
            SABLIER_LL, abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector), abi.encode(1)
        );

        // Deposit PT to populate marketTotalDeposited
        address user = makeAddr("user");
        pt.mint(user, DEPOSIT_AMOUNT);
        vm.startPrank(user);
        pt.approve(address(ovrflo), DEPOSIT_AMOUNT);
        ovrflo.deposit(MARKET, DEPOSIT_AMOUNT, 0);
        vm.stopPrank();

        borrower = new FuzzFlashBorrower(ovrflo);

        underlying.mint(address(borrower), 1_000 ether);
        vm.startPrank(address(borrower));
        pt.approve(address(ovrflo), type(uint256).max);
        underlying.approve(address(ovrflo), type(uint256).max);
        vm.stopPrank();

        // Fund wrap reserve
        underlying.mint(address(this), 200 ether);
        underlying.approve(address(ovrflo), 200 ether);
        ovrflo.wrap(200 ether);
    }

    /*//////////////////////////////////////////////////////////////
                    R10: DEPOSIT SPLIT INVARIANT
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_DepositSplit(uint256 rateSeed, uint256 ptAmountSeed) public {
        uint256 rateE18 = bound(rateSeed, 0.01e18, 0.99e18);
        uint256 ptAmount = bound(ptAmountSeed, ovrflo.MIN_PT_AMOUNT(), 1000 ether);

        _mockRate(MARKET, rateE18);

        (uint256 toUser, uint256 toStream,,) = ovrflo.previewDeposit(MARKET, ptAmount);

        assertEq(toUser + toStream, ptAmount, "split doesn't sum to ptAmount");
        assertLe(toUser, ptAmount, "toUser exceeds ptAmount");
        assertGt(toStream, 0, "toStream should be > 0 for rate < 1e18");
    }

    /*//////////////////////////////////////////////////////////////
                    R11: FLASH LOAN FEE CORRECTNESS
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_FlashLoanFee(uint256 amountSeed, uint256 rateSeed, uint16 feeBpsSeed) public {
        uint256 amount = bound(amountSeed, 1, DEPOSIT_AMOUNT);
        uint256 rateE18 = bound(rateSeed, 0, 1.5e18);
        uint16 feeBps = uint16(bound(uint256(feeBpsSeed), 0, 100));

        _mockRate(MARKET, rateE18);
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(feeBps);

        uint256 expectedFee = _computeFee(amount, rateE18, feeBps);
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), amount, "");

        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "fee mismatch");
    }

    /*//////////////////////////////////////////////////////////////
                    R12: STREAMPRICING BOUNDS
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_StreamPricing_Bounds(uint128 remainingSeed, uint16 aprBps, uint256 ttmSeed) public pure {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1, 1000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 10000));
        uint256 ttm = bound(ttmSeed, 0, 365 days);

        uint256 gp = StreamPricing.grossPrice(remaining, apr, ttm);
        assertLe(gp, remaining, "grossPrice exceeds remaining");

        if (gp > 0) {
            // Use partial borrow (gp / 2) to exercise the non-fast-path obligation calculation
            uint128 ob = StreamPricing.obligationForFill(gp / 2, gp, remaining, apr, ttm);
            assertLe(ob, remaining, "obligation exceeds remaining");
        }
    }

    function test_Fuzz_StreamPricing_ObligationForFill(
        uint128 remainingSeed,
        uint16 aprBps,
        uint256 ttmSeed,
        uint256 borrowSeed
    ) public pure {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1 ether, 10_000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 5000));
        uint256 ttm = bound(ttmSeed, 0, 2 * 365 days);

        uint256 gp = StreamPricing.grossPrice(remaining, apr, ttm);
        vm.assume(gp > 0);

        uint256 borrowAmount = bound(borrowSeed, 1, gp);
        uint128 ob = StreamPricing.obligationForFill(borrowAmount, gp, remaining, apr, ttm);
        assertLe(ob, remaining, "obligation exceeds remaining");
    }

    /*//////////////////////////////////////////////////////////////
                    R13: DUST AMOUNTS
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_DustWrapUnwrap(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, 1, 100);

        address user = makeAddr("dustUser");
        underlying.mint(user, amount);
        vm.startPrank(user);
        underlying.approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        assertEq(ovrfloToken.balanceOf(user), amount, "wrap dust failed");
        ovrflo.unwrap(amount);
        assertEq(underlying.balanceOf(user), amount, "unwrap dust failed");
        vm.stopPrank();
    }

    function test_Fuzz_DustFlashLoan(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, 1, 100);

        borrower.executeFlashLoan(address(pt), amount, "");

        assertEq(pt.balanceOf(address(ovrflo)), DEPOSIT_AMOUNT, "vault PT changed after dust flash");
    }

    function test_Fuzz_DepositMinAmount(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, ovrflo.MIN_PT_AMOUNT(), 100e6);

        address user = makeAddr("minDepositUser");
        pt.mint(user, amount);
        // No specific Sablier mock needed — setUp's selector-wide mock covers createWithDurations

        vm.startPrank(user);
        pt.approve(address(ovrflo), amount);
        (uint256 toUser, uint256 toStream,) = ovrflo.deposit(MARKET, amount, 0);
        vm.stopPrank();

        assertEq(toUser + toStream, amount, "deposit split wrong at min amount");
    }

    /*//////////////////////////////////////////////////////////////
                    R14: ORACLE EDGE RATES
    //////////////////////////////////////////////////////////////*/

    function test_OracleEdge_RateZero() public {
        _mockRate(MARKET, 0);

        (uint256 toUser, uint256 toStream,,) = ovrflo.previewDeposit(MARKET, 10 ether);
        assertEq(toUser, 0, "toUser should be 0 when rate is 0");
        assertEq(toStream, 10 ether, "toStream should be full amount when rate is 0");
    }

    function test_OracleEdge_RateAtPar_Reverts() public {
        _mockRate(MARKET, 1e18);
        vm.expectRevert(OVRFLO.NothingToStream.selector);
        ovrflo.previewDeposit(MARKET, 10 ether);
    }

    function test_OracleEdge_RateAbovePar_Reverts() public {
        _mockRate(MARKET, 1.1e18);
        vm.expectRevert(OVRFLO.NothingToStream.selector);
        ovrflo.previewDeposit(MARKET, 10 ether);
    }

    function test_OracleEdge_RateZero_FlashLoanFeeZero() public {
        _mockRate(MARKET, 0);
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(50);

        uint256 treasuryBefore = underlying.balanceOf(TREASURY);
        borrower.executeFlashLoan(address(pt), 10 ether, "");
        assertEq(underlying.balanceOf(TREASURY), treasuryBefore, "fee should be 0 when rate is 0");
    }

    function test_OracleEdge_FlashLoanFeeScalesWithRate(uint256 rateSeed) public {
        uint256 rateE18 = bound(rateSeed, 0.01e18, 1.5e18);
        uint16 feeBps = 50;

        _mockRate(MARKET, rateE18);
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(feeBps);

        uint256 amount = 50 ether;
        uint256 expectedFee = _computeFee(amount, rateE18, feeBps);
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), amount, "");

        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "fee doesn't scale with rate");
    }

    /*//////////////////////////////////////////////////////////////
                    R10/R14: FLASH LOAN EXCEEDS DEPOSITED
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_FlashLoanExceedsDeposited_Reverts(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, DEPOSIT_AMOUNT + 1, DEPOSIT_AMOUNT + 100 ether);
        vm.expectRevert(OVRFLO.ExceedsDeposited.selector);
        borrower.executeFlashLoan(address(pt), amount, "");
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/
}

/// @title OVRFLOFuzzLendingTest
/// @notice Stateless fuzz over the v1-lite book's lender/borrower interleavings.
/// @dev The pre-rewrite fuzz suite carried no lending cases — its only lending-adjacent
///      coverage was the two `StreamPricing` pure-math tests above, which are unchanged
///      and stay in `OVRFLOFuzzTest`. Sale-path fuzz is deleted with the sale path. What
///      is new here is the loan-only surface: UNIT granularity, blind-fill sizing, and
///      the concurrency property that replaced the old collision problem.
///
///      Assertions are written as conservation and bound properties, never as a mirror
///      of the implementation's own arithmetic. The fee is deliberately non-zero so the
///      payout split is exercised, but no test recomputes `StreamPricing.fee` — they
///      assert that principal is conserved across borrower and treasury, which holds for
///      any fee formula and fails for any leak.
contract OVRFLOFuzzLendingTest is LendingMockFixture {
    address internal constant LENDER = address(0xA11CE);
    address internal constant SECOND_LENDER = address(0xB0B);
    address internal constant BORROWER = address(0xD0C);

    /// @dev Upper bound on fuzzed supply amounts. Comfortably below the uint64 UNIT
    ///      ceiling and below the streams' gross price, so the price cap does not
    ///      silently truncate every fill and hide the depth-driven behaviour.
    uint128 internal constant MAX_SUPPLY = 20 ether;

    uint128 internal unit;
    uint128 internal minLiquidity;

    function setUp() public {
        _deployLendingSystem();
        unit = lending.UNIT();
        minLiquidity = lending.MIN_LIQUIDITY_AMOUNT();
        // A non-zero fee keeps the borrower/treasury split live in every sequence.
        // The lending is factory-owned from construction, so owner calls are pranked.
        vm.prank(address(factory));
        lending.setFee(50);
    }

    /*//////////////////////////////////////////////////////////////
              UNIT-GRANULAR SUPPLY / WITHDRAW / BORROW SEQUENCES
    //////////////////////////////////////////////////////////////*/

    /// @notice Randomized UNIT-granular supply/withdraw/borrow interleavings conserve value.
    /// @dev The crown property: underlying is escrowed, refunded, or paid out — never
    ///      created or stranded. Checked across all four parties (pattern #6), so a
    ///      misrouted payment or a skipped fee fails here even though every state flag
    ///      would still read correctly.
    function testFuzz_Lending_SupplyWithdrawBorrowInterleaving(
        uint128 seedA,
        uint128 seedB,
        uint128 targetSeed,
        bool withdrawFirst
    ) public {
        uint128 amountA = _unitAmount(seedA);
        uint128 amountB = _unitAmount(seedB);

        _fundLender(LENDER, amountA);
        _fundLender(SECOND_LENDER, amountB);

        vm.prank(LENDER);
        uint256 positionA = lending.supply(MARKET, APR, amountA);
        vm.prank(SECOND_LENDER);
        uint256 positionB = lending.supply(MARKET, APR, amountB);

        uint128 refunded;
        if (withdrawFirst) {
            uint256 before = underlying.balanceOf(LENDER);
            vm.prank(LENDER);
            lending.withdraw(positionA);
            refunded = uint128(underlying.balanceOf(LENDER) - before);
        }

        uint128 target = uint128(bound(uint256(targetSeed), minLiquidity, uint256(amountA) + amountB));
        _createStream(1, BORROWER, _faceForGross(100 ether));

        vm.prank(BORROWER);
        uint256 loanId = lending.borrow(MARKET, APR, target, 1, 0);

        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        uint128 actualBorrow = uint128(uint256(loan.fillEnd - loan.fillStart) * unit);

        // The fill is expressed in whole UNITs and never exceeds what was asked for.
        assertEq(actualBorrow % unit, 0, "fill is not UNIT-aligned");
        assertLe(actualBorrow, target, "fill exceeded the borrow target");
        assertGe(actualBorrow, minLiquidity, "fill landed below the borrow atom");

        // Principal is split between borrower and treasury with nothing left over.
        uint256 borrowerGot = underlying.balanceOf(BORROWER);
        uint256 treasuryGot = underlying.balanceOf(LENDING_TREASURY);
        assertEq(borrowerGot + treasuryGot, actualBorrow, "principal leaked across the payout split");

        // All-party conservation: everything supplied is still accounted for.
        assertEq(
            underlying.balanceOf(address(lending)) + refunded + borrowerGot + treasuryGot,
            uint256(amountA) + amountB,
            "underlying was created or stranded"
        );

        // Frozen history: the loan's interval sits entirely at or below the tape's
        // consumed frontier, which is what makes later attribution exact.
        assertLe(loan.fillStart, loan.fillEnd, "inverted fill interval");
        assertTrue(positionA != positionB, "position ids must be distinct");
    }

    /*//////////////////////////////////////////////////////////////
            WITHDRAW FRONT-RUNNING A BORROW IS BENIGN (AE1, R10)
    //////////////////////////////////////////////////////////////*/

    /// @notice Covers AE1/R10: a lender withdrawing ahead of a borrow degrades the fill,
    ///         never the transaction's interpretability.
    /// @dev This is the property that replaced the old collision problem. Under the
    ///      pre-rewrite API a borrower named explicit `liquidityIds`, so any concurrent
    ///      consumption reverted the whole borrow with an "inactive position" failure.
    ///      Blind fills cannot collide: the borrower is bounded only by `minAcceptable`,
    ///      so the outcome is either an acceptable fill or one of three named, actionable
    ///      errors. The assertion that matters is the NEGATIVE one — no low-level tree
    ///      failure, no panic, no unnamed revert ever surfaces to a borrower.
    function testFuzz_Lending_WithdrawFrontRunningBorrowIsBenign(
        uint128 seedA,
        uint128 seedB,
        uint128 targetSeed,
        uint128 minAcceptableSeed
    ) public {
        uint128 amountA = _unitAmount(seedA);
        uint128 amountB = _unitAmount(seedB);

        _fundLender(LENDER, amountA);
        _fundLender(SECOND_LENDER, amountB);

        vm.prank(LENDER);
        uint256 positionA = lending.supply(MARKET, APR, amountA);
        vm.prank(SECOND_LENDER);
        lending.supply(MARKET, APR, amountB);

        // The front-run: the first position in the tape pulls its liquidity out from
        // under the pending borrow. Position B's interval compacts left as a result.
        vm.prank(LENDER);
        lending.withdraw(positionA);

        uint128 target = uint128(bound(uint256(targetSeed), minLiquidity, uint256(amountA) + amountB));
        uint128 minAcceptable = uint128(bound(uint256(minAcceptableSeed), 0, uint256(amountA) + amountB));
        _createStream(1, BORROWER, _faceForGross(100 ether));

        vm.prank(BORROWER);
        try lending.borrow(MARKET, APR, target, 1, minAcceptable) returns (uint256 loanId) {
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            uint128 actualBorrow = uint128(uint256(loan.fillEnd - loan.fillStart) * unit);

            // Success is only legitimate if the borrower's floor was honoured.
            assertGe(underlying.balanceOf(BORROWER), minAcceptable, "net proceeds below minAcceptable");
            // The withdrawn position contributed nothing, so the fill cannot exceed
            // what actually remained resting at the tick.
            assertLe(actualBorrow, amountB, "fill drew on withdrawn liquidity");
        } catch (bytes memory reason) {
            assertEq(reason.length, 4, "borrow failed without a named error");
            bytes4 selector = bytes4(reason);
            assertTrue(
                selector == OVRFLOLending.BelowMinAcceptable.selector || selector == OVRFLOLending.BelowMinimum.selector
                    || selector == OVRFLOLending.EmptyTick.selector,
                "borrow reverted with an uninterpretable error"
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                        BORROW TARGET QUANTIZATION
    //////////////////////////////////////////////////////////////*/

    /// @notice An arbitrary wei-denominated target always floors onto the UNIT lattice.
    /// @dev Covers the pinned convention that `borrow` floors rather than reverting, so
    ///      an oversized target (`type(uint128).max` as "max borrow") partial-fills
    ///      instead of failing the checked narrowing.
    function testFuzz_Lending_BorrowTargetFloorsToUnit(uint128 targetSeed) public {
        uint128 depth = 10 ether;
        _fundLender(LENDER, depth);
        vm.prank(LENDER);
        lending.supply(MARKET, APR, depth);

        uint128 target = uint128(bound(uint256(targetSeed), minLiquidity, type(uint128).max));
        _createStream(1, BORROWER, _faceForGross(100 ether));

        vm.prank(BORROWER);
        uint256 loanId = lending.borrow(MARKET, APR, target, 1, 0);

        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        uint128 actualBorrow = uint128(uint256(loan.fillEnd - loan.fillStart) * unit);

        assertEq(actualBorrow % unit, 0, "fill is not UNIT-aligned");
        assertLe(actualBorrow, target, "fill exceeded an unrounded target");
        assertLe(actualBorrow, depth, "fill exceeded available depth");
    }

    /// @notice Sub-UNIT precision is rejected at the supply boundary, never truncated.
    /// @dev R2 requires supply amounts to be exact multiples; silently flooring them
    ///      would strand the remainder in the contract with no leaf to withdraw it.
    function testFuzz_Lending_SupplyRejectsNonUnitAlignedAmounts(uint128 amountSeed, uint128 dustSeed) public {
        uint128 aligned = _unitAmount(amountSeed);
        uint128 dust = uint128(bound(uint256(dustSeed), 1, uint256(unit) - 1));
        uint128 misaligned = aligned + dust;

        _fundLender(LENDER, misaligned);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NotUnitAligned.selector);
        lending.supply(MARKET, APR, misaligned);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Reshapes a raw seed into a valid supply amount: at least one atom, an exact
    ///      UNIT multiple, and below the gross price of the fixture's streams.
    function _unitAmount(uint128 seed) internal view returns (uint128) {
        uint256 raw = bound(uint256(seed), minLiquidity, MAX_SUPPLY);
        // forge-lint: disable-next-line(divide-before-multiply) — flooring to a UNIT multiple is the point.
        return uint128((raw / unit) * unit);
    }
}
