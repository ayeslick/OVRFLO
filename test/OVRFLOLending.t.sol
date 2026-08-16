// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {StreamPricing} from "../src/StreamPricing.sol";
import {TickTree} from "../src/TickTree.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";

/// @dev Exposes only the internal tick state needed to model a prior blind fill.
contract LendingInternalHarness is OVRFLOLending {
    using TickTree for TickTree.Tree;

    constructor(address factory, address core, address sablier) OVRFLOLending(factory, core, sablier) {}

    function exposed_setFilled(address market, uint16 aprBps, uint32 epoch, uint64 filled) external {
        _ticks[market][aprBps].epochs[epoch].filled = filled;
    }

    function exposed_epochState(address market, uint16 aprBps, uint32 epoch)
        external
        view
        returns (uint64 root, uint64 filled, uint32 leaves, uint32 oldestLiveEpoch, uint32 currentEpoch)
    {
        Tick storage tick = _ticks[market][aprBps];
        Epoch storage epochState = tick.epochs[epoch];
        return
            (epochState.tree.root(), epochState.filled, epochState.tree.leaves, tick.oldestLiveEpoch, tick.currentEpoch);
    }

    function exposed_loanCount(address market, uint16 aprBps, uint32 epoch) external view returns (uint64) {
        return _ticks[market][aprBps].epochs[epoch].loanCount;
    }

    /// @dev Fabricates cursor/current gaps directly (backlog tests) and remains the
    ///      cheap way to stage the cross-epoch claim guard proof (plan risk #3).
    function exposed_setEpochs(address market, uint16 aprBps, uint32 oldestLiveEpoch, uint32 currentEpoch) external {
        Tick storage tick = _ticks[market][aprBps];
        tick.oldestLiveEpoch = oldestLiveEpoch;
        tick.currentEpoch = currentEpoch;
    }

    /// @dev Simulated terminal-capacity threshold in leaves; zero defers to the
    ///      production predicate. Lets rollover fire at a handful of leaves instead
    ///      of 8^7 appends.
    uint32 internal capacityOverride;

    function exposed_setCapacityOverride(uint32 leavesThreshold) external {
        capacityOverride = leavesThreshold;
    }

    function _epochAtCapacity(TickTree.Tree storage tree) internal view override returns (bool) {
        if (capacityOverride != 0) return tree.leaves >= capacityOverride;
        return super._epochAtCapacity(tree);
    }
}

contract OVRFLOLendingTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant STRANGER = address(0x3333);
    address internal constant MARKET = address(0x5555);
    address internal constant BARE_MARKET = address(0x5556);
    address internal constant LENDER = address(0xA11CE);
    address internal constant SECOND_LENDER = address(0xB0B);
    address internal constant THIRD_LENDER = address(0xC0C);
    address internal constant BORROWER = address(0xD0C);
    address internal constant SECOND_BORROWER = address(0xD0D);

    uint16 internal constant APR = 1000;
    uint16 internal constant SPACING = 25;
    uint256 internal constant STREAM_ONE = 401;
    uint256 internal constant STREAM_TWO = 402;
    uint256 internal constant STREAM_THREE = 403;
    uint256 internal constant STREAM_FOUR = 404;
    /// @dev Storage slot of the `_ticks` mapping (`forge inspect OVRFLOLending storage-layout`).
    uint256 internal constant TICKS_SLOT = 6;

    event Supplied(
        uint256 indexed positionId,
        address indexed lender,
        address indexed market,
        uint16 aprBps,
        uint32 epoch,
        uint32 leafIndex,
        uint128 amount
    );
    event Withdrawn(uint256 indexed positionId, address indexed lender, uint128 refund, uint128 remainingLeaf);
    event TickSpacingSet(address indexed market, uint16 spacing);
    event Borrowed(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed market,
        uint16 aprBps,
        uint32 epoch,
        uint64 seq,
        uint64 fillStart,
        uint64 fillEnd,
        uint128 actualBorrow,
        uint128 feeAmount,
        uint128 obligation,
        uint256 streamId
    );
    event Repaid(uint256 indexed loanId, uint128 amount, uint128 outstanding);
    event Closed(uint256 indexed loanId, uint128 drawn);
    event StreamDisposed(uint256 indexed loanId, address indexed borrower, uint256 streamId, bool burned);
    event Claimed(uint256 indexed loanId, uint256 indexed positionId, uint128 amount, uint128 receivedTotal);
    event EpochOpened(address indexed market, uint16 aprBps, uint32 epoch);
    event EpochCursorAdvanced(address indexed market, uint16 aprBps, uint32 fromEpoch, uint32 toEpoch);

    MockLendingFactory internal factory;
    MockLendingCore internal core;
    MockLendingSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    LendingInternalHarness internal lending;
    uint256 internal expiry;

    function setUp() public {
        factory = new MockLendingFactory();
        core = new MockLendingCore();
        sablier = new MockLendingSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO Token", "OVRFLO");

        // 73 days = YEAR / 5, so at APR 1000 the accrual factor is exactly
        // 1 + 0.10 * 0.2 = 1.02e18 and acceptance values compute without rounding.
        expiry = block.timestamp + 73 days;
        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        core.setSeries(MARKET, expiry, address(ovrfloToken), address(underlying));
        lending = new LendingInternalHarness(address(factory), address(core), address(sablier));

        underlying.mint(LENDER, 1_000 ether);
        underlying.mint(SECOND_LENDER, 1_000 ether);
        underlying.mint(THIRD_LENDER, 1_000 ether);
        vm.prank(LENDER);
        underlying.approve(address(lending), type(uint256).max);
        vm.prank(SECOND_LENDER);
        underlying.approve(address(lending), type(uint256).max);
        vm.prank(THIRD_LENDER);
        underlying.approve(address(lending), type(uint256).max);
    }

    function test_Constructor_WiresRegistryAndInitialAdminState() public view {
        assertEq(address(lending.factory()), address(factory));
        assertEq(lending.core(), address(core));
        assertEq(address(lending.sablier()), address(sablier));
        assertEq(lending.treasury(), TREASURY);
        assertEq(lending.underlying(), address(underlying));
        assertEq(lending.ovrfloToken(), address(ovrfloToken));
        assertEq(lending.aprMinBps(), lending.LAUNCH_APR_BPS());
        assertEq(lending.aprMaxBps(), lending.LAUNCH_APR_BPS());
        assertEq(lending.UNIT(), 1e12);
        assertEq(lending.MIN_LIQUIDITY_AMOUNT(), 1e15);
        assertEq(lending.CURSOR_CAP(), 32);
        assertEq(lending.nextLoanId(), 1);
    }

    function test_SetTickSpacing_SetsOnceAndEmits() public {
        vm.expectEmit(true, false, false, true, address(lending));
        emit TickSpacingSet(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);

        assertEq(lending.tickSpacing(MARKET), SPACING);

        vm.expectRevert(OVRFLOLending.SpacingAlreadySet.selector);
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
    }

    function test_SetTickSpacing_ZeroReverts() public {
        vm.expectRevert(OVRFLOLending.ZeroSpacing.selector);
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, 0);
    }

    /// Encodes I-11 (`aprMinBps <= aprMaxBps <= APR_MAX_CEILING`). The bound is admin-only, so no fuzz
    /// sequence reaches it and the invariant suite dispositions it as covered here.
    function test_SetAprBounds_RejectsInvertedRangeAndAboveCeiling() public {
        // Read the ceiling first: an external call inside the argument list would be the "next call" the
        // pending `expectRevert` judges, and it does not revert.
        uint16 ceiling = lending.APR_MAX_CEILING();

        vm.expectRevert(OVRFLOLending.BadAprBounds.selector);
        vm.prank(address(factory));
        lending.setAprBounds(1500, 1000);

        vm.expectRevert(OVRFLOLending.AprTooHigh.selector);
        vm.prank(address(factory));
        lending.setAprBounds(1000, ceiling + 1);

        // The boundary itself is accepted, so the guard is `>` and not `>=`.
        vm.prank(address(factory));
        lending.setAprBounds(1000, ceiling);
        assertEq(lending.aprMaxBps(), ceiling);
    }

    /// Encodes I-12 (`feeBps <= MAX_FEE_BPS`), which is what makes `actualBorrow - feeAmount` safe.
    function test_SetFee_RejectsAboveMaxFeeBps() public {
        uint16 maxFee = lending.MAX_FEE_BPS();

        vm.expectRevert(OVRFLOLending.FeeTooHigh.selector);
        vm.prank(address(factory));
        lending.setFee(maxFee + 1);

        vm.prank(address(factory));
        lending.setFee(maxFee);
        assertEq(lending.feeBps(), maxFee);
    }

    /// Encodes the enforceable half of X-4: the fee sink is mutable, but it can never be set to the burn
    /// address. The "stays a live sink" half is an off-chain multisig assumption.
    function test_SetTreasury_RejectsZeroAddress() public {
        vm.expectRevert(OVRFLOLending.ZeroAddress.selector);
        vm.prank(address(factory));
        lending.setTreasury(address(0));

        vm.prank(address(factory));
        lending.setTreasury(STRANGER);
        assertEq(lending.treasury(), STRANGER);
    }

    function test_Supply_RevertsBeforeSpacingIsSet() public {
        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        lending.supply(MARKET, APR, 1 ether);
    }

    function test_Supply_EscrowsAppendsIndexesAndEmits() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint128 amount = lending.MIN_LIQUIDITY_AMOUNT();

        vm.expectEmit(true, true, true, true, address(lending));
        emit Supplied(1, LENDER, MARKET, APR, 0, 0, amount);

        vm.prank(LENDER);
        uint256 positionId = lending.supply(MARKET, APR, amount);

        assertEq(positionId, 1);
        assertEq(underlying.balanceOf(LENDER), 1_000 ether - amount);
        assertEq(underlying.balanceOf(address(lending)), amount);

        (address lender, address market, uint16 aprBps, uint32 epoch, uint32 leafIndex) = lending.positions(positionId);
        assertEq(lender, LENDER);
        assertEq(market, MARKET);
        assertEq(aprBps, APR);
        assertEq(epoch, 0);
        assertEq(leafIndex, 0);

        assertEq(lending.lenderPositionCount(LENDER), 1);
        assertEq(lending.lenderPositionAt(LENDER, 0), positionId);

        (uint64 root, uint64 filled, uint32 leaves, uint32 oldestLiveEpoch, uint32 currentEpoch) =
            lending.exposed_epochState(MARKET, APR, 0);
        assertEq(root, amount / lending.UNIT());
        assertEq(filled, 0);
        assertEq(leaves, 1);
        assertEq(oldestLiveEpoch, 0);
        assertEq(currentEpoch, 0);
    }

    function test_Supply_PerUserIndexesEnumerateExactlyCreatedPositions() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);

        uint256 first = _supply(LENDER, 1 ether, APR);
        uint256 second = _supply(SECOND_LENDER, 2 ether, APR);
        uint256 third = _supply(LENDER, 3 ether, APR);

        assertEq(lending.lenderPositionCount(LENDER), 2);
        assertEq(lending.lenderPositionAt(LENDER, 0), first);
        assertEq(lending.lenderPositionAt(LENDER, 1), third);
        assertEq(lending.lenderPositionCount(SECOND_LENDER), 1);
        assertEq(lending.lenderPositionAt(SECOND_LENDER, 0), second);
    }

    function test_Supply_AcceptsBoundsAndReadsUpdatedBoundsAtCallTime() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setAprBounds(500, 1500);

        _supply(LENDER, 1 ether, 500);
        _supply(LENDER, 1 ether, 1500);

        vm.prank(address(factory));
        lending.setAprBounds(750, 1250);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.supply(MARKET, 500, 1 ether);

        _supply(LENDER, 1 ether, 750);
        _supply(LENDER, 1 ether, 1250);
    }

    function test_Supply_RejectsInvalidTicks() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setAprBounds(500, 1500);

        vm.startPrank(LENDER);
        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.supply(MARKET, 999, 1 ether);

        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.supply(MARKET, 475, 1 ether);

        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.supply(MARKET, 1525, 1 ether);
        vm.stopPrank();
    }

    function test_Supply_RejectsInvalidAmounts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint128 minimum = lending.MIN_LIQUIDITY_AMOUNT();
        uint128 unit = lending.UNIT();

        vm.startPrank(LENDER);
        vm.expectRevert(OVRFLOLending.ZeroAmount.selector);
        lending.supply(MARKET, APR, 0);

        vm.expectRevert(OVRFLOLending.NotUnitAligned.selector);
        lending.supply(MARKET, APR, minimum + 1);

        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.supply(MARKET, APR, minimum - unit);
        vm.stopPrank();
    }

    function test_Supply_CheckedUnitNarrowingRejectsOversizedAmount() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint128 amount = uint128((uint256(type(uint64).max) + 1) * lending.UNIT());
        underlying.mint(LENDER, amount);

        vm.prank(LENDER);
        vm.expectRevert("SafeCast: value doesn't fit in 64 bits");
        lending.supply(MARKET, APR, amount);
    }

    function test_Supply_RevertsAtAndAfterMaturity() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);

        vm.warp(expiry);
        vm.prank(LENDER);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.supply(MARKET, APR, 1 ether);

        vm.warp(expiry + 1);
        vm.prank(LENDER);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.supply(MARKET, APR, 1 ether);
    }

    function test_Withdraw_RefundsEntireUnfilledPositionAndEmitsAbsoluteLeaf() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 6 ether, APR);

        vm.expectEmit(true, true, false, true, address(lending));
        emit Withdrawn(positionId, LENDER, 6 ether, 0);

        vm.prank(LENDER);
        lending.withdraw(positionId);

        assertEq(underlying.balanceOf(LENDER), 1_000 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        (uint64 root,,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(root, 0);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NothingToWithdraw.selector);
        lending.withdraw(positionId);
    }

    /// Covers AE2 (first half): only the suffix above `filled` is refundable.
    function test_Withdraw_AfterPartialFillRefundsOnlyUnfilledAndPreservesHistory() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(SECOND_LENDER, 10 ether, APR);
        uint256 positionId = _supply(LENDER, 6 ether, APR);
        lending.exposed_setFilled(MARKET, APR, 0, uint64(12 ether / lending.UNIT()));

        vm.expectEmit(true, true, false, true, address(lending));
        emit Withdrawn(positionId, LENDER, 4 ether, 2 ether);

        vm.prank(LENDER);
        lending.withdraw(positionId);

        assertEq(underlying.balanceOf(LENDER), 998 ether);
        assertEq(underlying.balanceOf(SECOND_LENDER), 990 ether);
        assertEq(underlying.balanceOf(address(lending)), 12 ether);
        (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(root, 12 ether / lending.UNIT());
        assertEq(filled, 12 ether / lending.UNIT());

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NothingToWithdraw.selector);
        lending.withdraw(positionId);
    }

    function test_Withdraw_RevertsForNonLender() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 1 ether, APR);

        vm.prank(STRANGER);
        vm.expectRevert(OVRFLOLending.NotLender.selector);
        lending.withdraw(positionId);
    }

    function test_Withdraw_RemainsAvailableAfterMaturity() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 1 ether, APR);

        vm.warp(expiry);
        vm.prank(LENDER);
        lending.withdraw(positionId);

        assertEq(underlying.balanceOf(LENDER), 1_000 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                 BORROW
    //////////////////////////////////////////////////////////////*/

    function test_Borrow_PartialFillStoresLoanPaysAndEscrows() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        vm.expectEmit(true, true, true, true, address(lending));
        emit Borrowed(1, BORROWER, MARKET, APR, 0, 0, 0, 5_000_000, 5 ether, 0, 5.1 ether, STREAM_ONE);

        uint256 loanId = _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);

        assertEq(loanId, 1);
        assertEq(lending.nextLoanId(), 2);
        assertEq(underlying.balanceOf(BORROWER), 5 ether);
        assertEq(underlying.balanceOf(LENDER), 980 ether);
        assertEq(underlying.balanceOf(address(lending)), 15 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));

        LoanView memory loan = _loan(loanId);
        assertEq(loan.borrower, BORROWER);
        assertEq(loan.aprBps, APR);
        assertEq(loan.epoch, 0);
        assertFalse(loan.closed);
        assertEq(loan.market, MARKET);
        assertEq(loan.seq, 0);
        assertEq(loan.streamId, STREAM_ONE);
        assertEq(loan.fillStart, 0);
        assertEq(loan.fillEnd, 5_000_000);
        assertEq(loan.obligation, 5.1 ether);
        assertEq(loan.drawn, 0);
        assertEq(loan.repaid, 0);

        assertEq(lending.loanAt(MARKET, APR, 0, 0), loanId);
        assertEq(lending.borrowerLoanCount(BORROWER), 1);
        assertEq(lending.borrowerLoanAt(BORROWER, 0), loanId);

        // The blind fill advances `filled` without touching the tree: root unchanged.
        (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(root, 20_000_000);
        assertEq(filled, 5_000_000);
        assertEq(lending.exposed_loanCount(MARKET, APR, 0), 1);
    }

    /// A second hand-derived obligation, at a different tick. Every other pinned obligation in this suite
    /// sits at APR 1000, where the 73-day fixture makes the accrual factor exactly 1.02e18 — a pricing path
    /// that ignored the tick's rate entirely would reproduce all of them. At APR 1025 the factor is
    /// 1 + 0.1025 * (73/365) = 1.0205e18, so a 5-ether fill owes 5.1025 ether: the same borrow at the
    /// neighbouring tick, and a value the 1000-rate arithmetic cannot produce.
    function test_Borrow_ObligationTracksTheTickRate() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setAprBounds(APR, 1025);
        _supply(LENDER, 20 ether, 1025);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        vm.prank(BORROWER);
        uint256 loanId = lending.borrow(MARKET, 1025, 5 ether, STREAM_ONE, 5 ether);

        LoanView memory loan = _loan(loanId);
        assertEq(loan.aprBps, 1025);
        assertEq(loan.fillEnd - loan.fillStart, 5_000_000);
        assertEq(loan.obligation, 5.1025 ether, "obligation must price at the loan's own tick");
        assertTrue(loan.obligation != 5.1 ether, "obligation collapsed onto the APR 1000 value");
    }

    /// Covers AE1. Two same-block borrowers targeting 12 each against 16 available:
    /// the first receives 12, the second receives the 4 residue — no "inactive
    /// position" failure mode exists anywhere.
    function test_Borrow_ConcurrentTargets_SecondFillsResidue() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _supply(SECOND_LENDER, 6 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        uint256 firstLoan = _borrow(BORROWER, 12 ether, STREAM_ONE, 12 ether);
        uint256 secondLoan = _borrow(SECOND_BORROWER, 12 ether, STREAM_TWO, 4 ether);

        assertEq(underlying.balanceOf(BORROWER), 12 ether);
        assertEq(underlying.balanceOf(SECOND_BORROWER), 4 ether);
        assertEq(underlying.balanceOf(LENDER), 990 ether);
        assertEq(underlying.balanceOf(SECOND_LENDER), 994 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
        assertEq(sablier.ownerOf(STREAM_TWO), address(lending));

        LoanView memory first = _loan(firstLoan);
        LoanView memory second = _loan(secondLoan);
        assertEq(first.fillStart, 0);
        assertEq(first.fillEnd, 12_000_000);
        assertEq(first.obligation, 12.24 ether);
        assertEq(second.seq, 1);
        assertEq(second.fillStart, 12_000_000);
        assertEq(second.fillEnd, 16_000_000);
        assertEq(second.obligation, 4.08 ether);
        assertEq(lending.loanAt(MARKET, APR, 0, 0), firstLoan);
        assertEq(lending.loanAt(MARKET, APR, 0, 1), secondLoan);

        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, 16_000_000);
        assertEq(lending.exposed_loanCount(MARKET, APR, 0), 2);
    }

    /// Covers AE1. The losing borrower's floor turns the residue fill into a clean
    /// slippage revert instead of any position-level failure.
    function test_Borrow_ConcurrentTargets_SecondRevertsBelowMinAcceptable() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _supply(SECOND_LENDER, 6 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        _borrow(BORROWER, 12 ether, STREAM_ONE, 12 ether);

        vm.prank(SECOND_BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinAcceptable.selector);
        lending.borrow(MARKET, APR, 12 ether, STREAM_TWO, 12 ether);
    }

    /// Covers AE7. A borrower's own resting liquidity is consumable like any other
    /// (self-neutral minus the protocol fee); no self-match guard exists.
    function test_Borrow_SelfFillConsumesOwnLiquidityMinusFee() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setFee(100);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, LENDER, 10.2 ether);

        // The fee is a first-class event field because `feeBps` is owner-mutable and
        // never snapshotted per loan: without it, net proceeds (10 - 0.1) cannot be
        // reconstructed from logs alone.
        vm.expectEmit(true, true, true, true, address(lending));
        emit Borrowed(1, LENDER, MARKET, APR, 0, 0, 0, 10_000_000, 10 ether, 0.1 ether, 10.2 ether, STREAM_ONE);

        uint256 loanId = _borrow(LENDER, 10 ether, STREAM_ONE, 9.9 ether);

        LoanView memory loan = _loan(loanId);
        assertEq(loan.borrower, LENDER);
        assertEq(loan.obligation, 10.2 ether);
        (address positionLender,,,,) = lending.positions(1);
        assertEq(positionLender, LENDER);

        assertEq(underlying.balanceOf(LENDER), 999.9 ether);
        assertEq(underlying.balanceOf(TREASURY), 0.1 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
    }

    /// The minAcceptable floor is net of fee: gross 10 ether clears 9.95 but net
    /// 9.9 does not — a gross-side comparison would let this call succeed.
    function test_Borrow_MinAcceptableComparesNetOfFee() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setFee(100);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinAcceptable.selector);
        lending.borrow(MARKET, APR, 10 ether, STREAM_ONE, 9.95 ether);
    }

    /// Max borrow = sale (R11): a target above the stream's discounted value fills
    /// exactly the gross price and owes the stream's entire remaining face.
    function test_Borrow_MaxBorrowObligationEqualsEntireRemaining() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, type(uint128).max, STREAM_ONE, 10 ether);

        uint128 obligation = _loan(loanId).obligation;
        assertEq(obligation, 10.2 ether);
        assertEq(obligation, sablier.getDepositedAmount(STREAM_ONE) - sablier.getWithdrawnAmount(STREAM_ONE));

        assertEq(underlying.balanceOf(BORROWER), 10 ether);
        assertEq(underlying.balanceOf(address(lending)), 10 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, 10_000_000);
    }

    function test_Borrow_TargetFlooredToUnit() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        _borrow(BORROWER, 5 ether + (1e12 - 1), STREAM_ONE, 0);

        assertEq(underlying.balanceOf(BORROWER), 5 ether);
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, 5_000_000);
    }

    function test_Borrow_ConsumesExactlyLastUnitThenEmptyTick() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 1 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        _borrow(BORROWER, 1 ether, STREAM_ONE, 1 ether);

        (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, root);

        vm.prank(SECOND_BORROWER);
        vm.expectRevert(OVRFLOLending.EmptyTick.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_TWO, 0);
    }

    /// The fill consumption is one storage slot: `filled` and `loanCount` are
    /// packed side by side in the epoch struct, proven by decoding the raw word.
    function test_Borrow_FilledAndLoanCountSharePackedSlot() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);

        // Epoch struct layout: slot+0 tree {leaves,height}, slot+1 tree nodes
        // mapping, slot+2 packed {uint64 filled | uint64 loanCount << 64}.
        bytes32 tickSlot = keccak256(abi.encode(uint256(APR), keccak256(abi.encode(MARKET, TICKS_SLOT))));
        bytes32 epochSlot = keccak256(abi.encode(uint256(0), bytes32(uint256(tickSlot) + 1)));
        uint256 packed = uint256(vm.load(address(lending), bytes32(uint256(epochSlot) + 2)));

        assertEq(uint64(packed), 5_000_000);
        assertEq(uint64(packed >> 64), 1);
        assertEq(packed >> 128, 0);

        // Cross-check the raw decode against the harness views so a layout shift
        // fails loudly instead of silently passing on a stale slot constant.
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(uint64(packed), filled);
        assertEq(uint64(packed >> 64), lending.exposed_loanCount(MARKET, APR, 0));
    }

    function test_Borrow_SucceedsOneSecondBeforeMaturityRevertsAtMaturity() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        vm.warp(expiry - 1);
        _borrow(BORROWER, 1 ether, STREAM_ONE, 0);
        assertEq(underlying.balanceOf(BORROWER), 1 ether);

        vm.warp(expiry);
        vm.prank(SECOND_BORROWER);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_TWO, 0);
    }

    function test_Borrow_ZeroTargetReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.ZeroTarget.selector);
        lending.borrow(MARKET, APR, 0, STREAM_ONE, 0);
    }

    function test_Borrow_SpacingUnsetReverts() public {
        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        lending.borrow(BARE_MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    function test_Borrow_InvalidTickReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.borrow(MARKET, 1025, 1 ether, STREAM_ONE, 0);
    }

    function test_Borrow_NeverSuppliedTickRevertsEmptyTick() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.EmptyTick.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    function test_Borrow_TargetBelowFillFloorReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.borrow(MARKET, APR, 0.5e15, STREAM_ONE, 0);
    }

    function test_Borrow_ResidueBelowFillFloorReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 1.5e15, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        _borrow(BORROWER, 1e15, STREAM_ONE, 0);

        vm.prank(SECOND_BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_TWO, 0);
    }

    function test_Borrow_IneligibleStreamReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        sablier.setStream(
            STREAM_ONE, BORROWER, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, true, 15.3 ether, 0
        );

        vm.prank(BORROWER);
        vm.expectRevert(StreamPricing.CancelableStream.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    /// A stream minted by a rogue vault (any sender other than this lending's core)
    /// fails eligibility — the disconnection mechanism that keeps unregistered
    /// lookalike vaults from contaminating the real market.
    function test_Lending_RogueVaultStreamIsIneligible() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        address rogueVault = address(0xBAD0);
        sablier.setStream(
            STREAM_ONE, BORROWER, rogueVault, IERC20(address(ovrfloToken)), uint40(expiry), 0, false, 15.3 ether, 0
        );
        vm.prank(BORROWER);
        sablier.approve(address(lending), STREAM_ONE);

        vm.prank(BORROWER);
        vm.expectRevert(StreamPricing.WrongSender.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    /// The MIN_STREAM_AMOUNT wrapper rejects dust streams before any fill math runs.
    function test_Borrow_StreamBelowMinimumRemainingReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        _createStream(STREAM_ONE, BORROWER, uint128(lending.MIN_STREAM_AMOUNT()) - 1);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    /// A stream backing an open loan is owned by the lending contract, so a second
    /// pledge fails ERC-721's owner check inside Sablier itself — no bespoke
    /// lending-side guard exists (user decision 2026-08-08).
    function test_Borrow_AlreadyPledgedStreamRevertsViaErc721OwnerCheck() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));

        vm.prank(BORROWER);
        vm.expectRevert(bytes("wrong from"));
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    /// Informal gas-flatness check (measured properly in U7): a fill spanning one
    /// position costs the same as a fill spanning twelve, because consumption never
    /// reads or writes any position.
    function test_Borrow_GasFlatAcrossPositionsSpanned() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setAprBounds(500, 1500);

        // Warm-up borrow so shared slots (loan counter, guard, balances) are warm
        // for both measured calls.
        _supply(LENDER, 12 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 12 ether, STREAM_ONE, 0);

        _supply(LENDER, 12 ether, 1200);
        for (uint256 i = 0; i < 12; ++i) {
            _supply(i % 2 == 0 ? LENDER : SECOND_LENDER, 1 ether, 1300);
        }
        _createStream(STREAM_TWO, BORROWER, 15.3 ether);
        _createStream(STREAM_THREE, BORROWER, 15.3 ether);

        vm.prank(BORROWER);
        uint256 checkpoint = gasleft();
        lending.borrow(MARKET, 1200, 12 ether, STREAM_TWO, 0);
        uint256 gasSinglePosition = checkpoint - gasleft();

        vm.prank(BORROWER);
        checkpoint = gasleft();
        lending.borrow(MARKET, 1300, 12 ether, STREAM_THREE, 0);
        uint256 gasTwelvePositions = checkpoint - gasleft();

        assertApproxEqAbs(gasSinglePosition, gasTwelvePositions, 5_000);
    }

    /*//////////////////////////////////////////////////////////////
                          CONTRIBUTION ATTRIBUTION
    //////////////////////////////////////////////////////////////*/

    /// Covers AE3. Positions A(10)/B(6)/C(4); loan 1 consumes 12; B then withdraws
    /// its unfilled 4; loan 2 consumes the remaining 4. Contributions are derived
    /// from the live tape at call time — nothing is written at fill time, and B's
    /// answer survives its own later withdraw because the withdraw could only remove
    /// coordinates above `filled`.
    function test_ContributionOf_DerivedAcrossCancellation() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 10 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 6 ether, APR);
        uint256 positionC = _supply(THIRD_LENDER, 4 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        uint256 firstLoan = _borrow(BORROWER, 12 ether, STREAM_ONE, 12 ether);

        vm.prank(SECOND_LENDER);
        lending.withdraw(positionB);

        uint256 secondLoan = _borrow(SECOND_BORROWER, 4 ether, STREAM_TWO, 4 ether);

        assertEq(_loan(firstLoan).fillStart, 0);
        assertEq(_loan(firstLoan).fillEnd, 12_000_000);
        assertEq(_loan(secondLoan).fillStart, 12_000_000);
        assertEq(_loan(secondLoan).fillEnd, 16_000_000);

        assertEq(lending.contributionOf(firstLoan, positionA), 10 ether);
        assertEq(lending.contributionOf(firstLoan, positionB), 2 ether);
        assertEq(lending.contributionOf(secondLoan, positionC), 4 ether);

        // The complements: no position bleeds into the other loan's interval.
        vm.expectRevert(OVRFLOLending.NoOverlap.selector);
        lending.contributionOf(firstLoan, positionC);
        vm.expectRevert(OVRFLOLending.NoOverlap.selector);
        lending.contributionOf(secondLoan, positionA);
        vm.expectRevert(OVRFLOLending.NoOverlap.selector);
        lending.contributionOf(secondLoan, positionB);
    }

    function test_ContributionOf_RevertsForMissingLoan() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 1 ether, APR);

        vm.expectRevert(OVRFLOLending.LoanMissing.selector);
        lending.contributionOf(1, positionId);
    }

    /*//////////////////////////////////////////////////////////////
                                  CLAIM
    //////////////////////////////////////////////////////////////*/

    /// Covers AE4. Mid-term, with nothing yet drawn or repaid, each contributor's
    /// entitlement is its share of the stream's live accrual, and the deficit is
    /// harvested from the stream inside the same claim transaction.
    function test_Claim_MidTermPaysShareAndHarvestsDeficit() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 6 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 4 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        assertEq(_loan(loanId).obligation, 10.2 ether);

        // Two months into the term: half the collateral has vested, none drawn.
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        assertEq(lending.proceeds(loanId), 0);

        // recovered = 0 + 0 + min(5.1, 10.2) = 5.1; A's share = 6/10 * 5.1 = 3.06.
        vm.expectEmit(true, true, false, true, address(lending));
        emit Claimed(loanId, positionA, 3.06 ether, 3.06 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionA, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(LENDER), 3.06 ether);
        assertEq(_loan(loanId).drawn, 3.06 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 3.06 ether);
        assertEq(lending.received(loanId, positionA), 3.06 ether);
        assertEq(lending.proceeds(loanId), 0);

        // recovered is unchanged by the harvest: 3.06 drawn + min(2.04, 7.14).
        vm.prank(SECOND_LENDER);
        lending.claim(loanId, positionB, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(SECOND_LENDER), 2.04 ether);
        assertEq(_loan(loanId).drawn, 5.1 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 5.1 ether);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);

        // Nothing further accrued, so the entitlement is exhausted for both.
        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NothingToClaim.selector);
        lending.claim(loanId, positionA, type(uint128).max);
    }

    /// Covers AE4 with the contributors claiming in the opposite order. Same fixture as
    /// `test_Claim_MidTermPaysShareAndHarvestsDeficit` (positions 6/4, borrow 10,
    /// obligation 10.2, mid-term withdrawable 5.1) but the 4/10 lender goes first.
    /// Every literal is derived here independently, so matching totals across the two
    /// orders is evidence of order independence on a LIVE loan — where each claim
    /// mutates `drawn` and the stream's remaining withdrawable, and the cap therefore
    /// has to hold across a moving `recovered`.
    function test_Claim_OpenLoanOrderIndependentWhenSmallerShareClaimsFirst() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 6 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 4 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        assertEq(_loan(loanId).obligation, 10.2 ether);

        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);

        // B first. recovered = 0 + 0 + min(5.1, 10.2) = 5.1;
        // B's share = 4e18/10e18 * 5.1e18 = 2.04e18.
        vm.expectEmit(true, true, false, true, address(lending));
        emit Claimed(loanId, positionB, 2.04 ether, 2.04 ether);
        vm.prank(SECOND_LENDER);
        lending.claim(loanId, positionB, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(SECOND_LENDER), 2.04 ether);
        assertEq(_loan(loanId).drawn, 2.04 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 2.04 ether);

        // A second. recovered = 2.04 + 0 + min(5.1 - 2.04, 10.2 - 2.04)
        //                     = 2.04 + min(3.06, 8.16) = 5.1;
        // A's share = 6e18/10e18 * 5.1e18 = 3.06e18.
        vm.expectEmit(true, true, false, true, address(lending));
        emit Claimed(loanId, positionA, 3.06 ether, 3.06 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionA, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(LENDER), 3.06 ether);
        assertEq(_loan(loanId).drawn, 5.1 ether);

        // Identical totals to the ascending-order run: 2.04 + 3.06 = 5.1 drawn, nothing
        // left over, and neither order leaves the other lender short.
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 5.1 ether);
        assertEq(ovrfloToken.balanceOf(LENDER) + ovrfloToken.balanceOf(SECOND_LENDER), 5.1 ether);
        assertEq(lending.proceeds(loanId), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);
    }

    /// The `min(withdrawable, outstanding)` clamp inside `recovered` is a named security
    /// invariant, not arithmetic detail. An over-vested open loan is routine — a
    /// partially borrowed stream keeps vesting past the obligation it backs — and here
    /// the stream is worth 20.4 while only 10.2 is owed.
    ///
    /// MUTATION TARGET: replacing the clamp with a bare `withdrawable` makes
    /// `recovered` 20.4, so the first claimer's entitlement becomes 6/10 * 20.4 = 12.24
    /// and it harvests far past its 6.12 share — the co-lender's 4.08 is drained out of
    /// the stream before it ever claims. The exact-literal assertions below fail under
    /// that mutant and pass only with the clamp in place.
    ///
    /// The warp past expiry also supplies KTD7's otherwise-missing coverage that a
    /// claim is never market-gated: both claims here run on a MATURED series.
    function test_Claim_OverVestedStreamClampsRecoveredToOutstanding() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 6 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 4 ether, APR);
        // Deposited 20.4 prices to a gross of 20.4 / 1.02 = 20 ether at the fixture's
        // APR 1000 over 73 days (YEAR / 5), so the 10 ether target fills below the
        // price cap and owes 10 * 1.02 = 10.2 ether.
        _createStream(STREAM_ONE, BORROWER, 20.4 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        assertEq(_loan(loanId).obligation, 10.2 ether);

        // Fully vested at expiry: withdrawable 20.4 is double the 10.2 outstanding.
        vm.warp(expiry + 1);
        sablier.setWithdrawable(STREAM_ONE, 20.4 ether);
        assertEq(sablier.withdrawableAmountOf(STREAM_ONE), 20.4 ether);

        // recovered = 0 + 0 + min(20.4, 10.2) = 10.2;
        // A's share = 6e18/10e18 * 10.2e18 = 6.12e18 (NOT 6/10 of 20.4 = 12.24).
        vm.prank(LENDER);
        lending.claim(loanId, positionA, type(uint128).max);
        assertEq(ovrfloToken.balanceOf(LENDER), 6.12 ether);

        // recovered = 6.12 + min(20.4 - 6.12, 10.2 - 6.12) = 6.12 + min(14.28, 4.08) = 10.2;
        // B's share = 4e18/10e18 * 10.2e18 = 4.08e18, still fully available.
        vm.prank(SECOND_LENDER);
        lending.claim(loanId, positionB, type(uint128).max);
        assertEq(ovrfloToken.balanceOf(SECOND_LENDER), 4.08 ether);

        // The harvest never exceeded the obligation: 6.12 + 4.08 = 10.2 drawn out of a
        // 20.4 stream, leaving 10.2 of over-vested value untouched for the borrower.
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);
        assertEq(_loan(loanId).drawn, 10.2 ether);
        assertEq(sablier.withdrawableAmountOf(STREAM_ONE), 10.2 ether);
        assertEq(ovrfloToken.balanceOf(LENDER) + ovrfloToken.balanceOf(SECOND_LENDER), 10.2 ether);
        assertEq(lending.proceeds(loanId), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);
    }

    /// Harvest polarity (pattern #13, plan risk #7): the deficit harvest fires if and
    /// only if the loan is open.
    ///
    /// What each phase actually proves — the closed phase is NOT the guard's
    /// mutation-kill. Deleting the `!loan.closed` guard cannot be discriminated here,
    /// because `close` drains `outstanding` to zero by construction, so the harvest cap
    /// `min(withdrawable, outstanding)` is zero on a closed loan whether or not the
    /// guard is read. The guard's real kill is the open-phase behavior, shared with
    /// `test_Claim_MidTermPaysShareAndHarvestsDeficit`.
    ///
    /// The closed-phase assertions below prove the property that matters downstream:
    /// a closed loan's claim pays from the frozen pot and never touches the stream,
    /// even with 5.1 of live withdrawable value sitting in it and now owned by the
    /// borrower. That is guaranteed jointly by the guard and by `close`'s own
    /// zero-outstanding invariant, and it is what keeps a returned stream safe.
    function test_Claim_HarvestFiresOnlyWhileLoanIsOpen() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 6 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 4 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        assertEq(_loan(loanId).obligation, 10.2 ether);

        // Open: the claim must draw from the stream.
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionA, type(uint128).max);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 3.06 ether);
        assertEq(_loan(loanId).drawn, 3.06 ether);

        // Close pulls the remaining 7.14 obligation into the pot.
        sablier.setWithdrawable(STREAM_ONE, 7.14 ether);
        lending.close(loanId);
        assertTrue(_loan(loanId).closed);
        assertEq(_loan(loanId).drawn, 10.2 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);
        assertEq(lending.proceeds(loanId), 7.14 ether);

        // Closed, yet the stream still has 5.1 of live withdrawable value. Claims
        // must come from the pot only; the stream must not move.
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        assertEq(sablier.withdrawableAmountOf(STREAM_ONE), 5.1 ether);

        vm.prank(SECOND_LENDER);
        lending.claim(loanId, positionB, type(uint128).max);
        assertEq(ovrfloToken.balanceOf(SECOND_LENDER), 4.08 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);
        assertEq(_loan(loanId).drawn, 10.2 ether);

        vm.prank(LENDER);
        lending.claim(loanId, positionA, type(uint128).max);
        assertEq(ovrfloToken.balanceOf(LENDER), 6.12 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);

        // recovered = drawn + repaid = 10.2, fully distributed 6.12 + 4.08.
        assertEq(lending.proceeds(loanId), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);
    }

    /// Claim order across contributors is irrelevant: two structurally identical
    /// loans claimed in opposite orders pay each role the same wei. The odd 1-wei
    /// obligation makes the pro-rata division inexact, so the run also pins the dust
    /// policy (plan risk #5): lender-unfavorable, one wei per loan (≤ the number of
    /// contributing positions), stranded in the contract.
    function test_Claim_OrderIndependentWithBoundedLenderUnfavorableDust() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 3 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 3 ether, APR);
        uint256 positionC = _supply(THIRD_LENDER, 4 ether, APR);
        uint256 positionD = _supply(LENDER, 3 ether, APR);
        uint256 positionE = _supply(SECOND_LENDER, 3 ether, APR);
        uint256 positionF = _supply(THIRD_LENDER, 4 ether, APR);

        // deposited = 10.2 ether + 1 wei prices to a gross of exactly 10 ether, so a
        // max borrow takes the full-borrow path and owes the entire odd remaining.
        uint128 deposited = 10.2 ether + 1;
        _createStream(STREAM_ONE, BORROWER, deposited);
        _createStream(STREAM_TWO, SECOND_BORROWER, deposited);

        uint256 firstLoan = _borrow(BORROWER, type(uint128).max, STREAM_ONE, 10 ether);
        uint256 secondLoan = _borrow(SECOND_BORROWER, type(uint128).max, STREAM_TWO, 10 ether);
        assertEq(_loan(firstLoan).obligation, deposited);
        assertEq(_loan(secondLoan).obligation, deposited);
        assertEq(_loan(firstLoan).fillEnd - _loan(firstLoan).fillStart, 10_000_000);
        assertEq(_loan(secondLoan).fillEnd - _loan(secondLoan).fillStart, 10_000_000);

        sablier.setWithdrawable(STREAM_ONE, deposited);
        sablier.setWithdrawable(STREAM_TWO, deposited);
        lending.close(firstLoan);
        lending.close(secondLoan);

        // Ascending order on loan 1.
        _claim(LENDER, firstLoan, positionA);
        _claim(SECOND_LENDER, firstLoan, positionB);
        _claim(THIRD_LENDER, firstLoan, positionC);
        // Descending order on loan 2.
        _claim(THIRD_LENDER, secondLoan, positionF);
        _claim(SECOND_LENDER, secondLoan, positionE);
        _claim(LENDER, secondLoan, positionD);

        // floor(0.3 * (10.2e18 + 1)) = 3.06e18 and floor(0.4 * (10.2e18 + 1)) = 4.08e18.
        assertEq(lending.received(firstLoan, positionA), 3.06 ether);
        assertEq(lending.received(firstLoan, positionB), 3.06 ether);
        assertEq(lending.received(firstLoan, positionC), 4.08 ether);
        assertEq(lending.received(secondLoan, positionD), lending.received(firstLoan, positionA));
        assertEq(lending.received(secondLoan, positionE), lending.received(firstLoan, positionB));
        assertEq(lending.received(secondLoan, positionF), lending.received(firstLoan, positionC));

        // Per loan: paid out = recovered - 1 wei of dust, and the dust stays put.
        assertEq(lending.proceeds(firstLoan), 1);
        assertEq(lending.proceeds(secondLoan), 1);
        assertEq(ovrfloToken.balanceOf(address(lending)), 2);
        assertEq(ovrfloToken.balanceOf(LENDER) + ovrfloToken.balanceOf(SECOND_LENDER), 12.24 ether);
        assertEq(ovrfloToken.balanceOf(THIRD_LENDER), 8.16 ether);

        // The stranded wei is nobody's: the caps are exhausted.
        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NothingToClaim.selector);
        lending.claim(firstLoan, positionA, type(uint128).max);
    }

    /// Covers AE9. Leaf numbering restarts per epoch, so two loans can carry
    /// byte-identical intervals. What blocks the cross-epoch claim is the
    /// `(market, aprBps, epoch)` equality check — proven by the control claim, which
    /// succeeds on the same position against its own epoch's loan.
    function test_Claim_EpochCheckBlocksNumericallyIdenticalIntervals() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 epochZeroPosition = _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 epochZeroLoan = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);

        lending.exposed_setEpochs(MARKET, APR, 1, 1);
        uint256 epochOnePosition = _supply(SECOND_LENDER, 10 ether, APR);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);
        uint256 epochOneLoan = _borrow(SECOND_BORROWER, 10 ether, STREAM_TWO, 10 ether);

        // The forgery premise: the intervals are numerically identical.
        assertEq(_loan(epochZeroLoan).epoch, 0);
        assertEq(_loan(epochOneLoan).epoch, 1);
        assertEq(_loan(epochZeroLoan).fillStart, _loan(epochOneLoan).fillStart);
        assertEq(_loan(epochZeroLoan).fillEnd, _loan(epochOneLoan).fillEnd);

        vm.expectRevert(OVRFLOLending.EpochMismatch.selector);
        lending.contributionOf(epochZeroLoan, epochOnePosition);
        vm.expectRevert(OVRFLOLending.EpochMismatch.selector);
        lending.contributionOf(epochOneLoan, epochZeroPosition);

        sablier.setWithdrawable(STREAM_ONE, 10.2 ether);
        vm.prank(SECOND_LENDER);
        vm.expectRevert(OVRFLOLending.EpochMismatch.selector);
        lending.claim(epochZeroLoan, epochOnePosition, type(uint128).max);

        // Control: the same position claims its own epoch's loan for the full fill.
        assertEq(lending.contributionOf(epochOneLoan, epochOnePosition), 10 ether);
        sablier.setWithdrawable(STREAM_TWO, 10.2 ether);
        vm.prank(SECOND_LENDER);
        lending.claim(epochOneLoan, epochOnePosition, type(uint128).max);
        assertEq(ovrfloToken.balanceOf(SECOND_LENDER), 10.2 ether);
    }

    /// Covers AE9. A position posted entirely after the fill window has zero overlap,
    /// and only the position's own lender may claim at all.
    function test_Claim_ZeroOverlapAndAuthorizationReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 filledPosition = _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        uint256 laterPosition = _supply(SECOND_LENDER, 5 ether, APR);

        vm.prank(SECOND_LENDER);
        vm.expectRevert(OVRFLOLending.NoOverlap.selector);
        lending.claim(loanId, laterPosition, type(uint128).max);

        vm.prank(STRANGER);
        vm.expectRevert(OVRFLOLending.NotLender.selector);
        lending.claim(loanId, filledPosition, type(uint128).max);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.LoanMissing.selector);
        lending.claim(loanId + 1, filledPosition, type(uint128).max);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NotLender.selector);
        lending.claim(loanId, laterPosition + 1, type(uint128).max);
    }

    /// The protocol fee touches the borrow leg only: recovered value flows to
    /// contributors in full and the treasury never receives ovrfloToken.
    function test_Claim_RecoveredValueIsFeeFree() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setFee(100);
        uint256 positionId = _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 9.9 ether);
        assertEq(underlying.balanceOf(TREASURY), 0.1 ether);

        sablier.setWithdrawable(STREAM_ONE, 10.2 ether);
        lending.close(loanId);

        vm.prank(LENDER);
        lending.claim(loanId, positionId, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(LENDER), 10.2 ether);
        assertEq(ovrfloToken.balanceOf(TREASURY), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                               REPAY / CLOSE
    //////////////////////////////////////////////////////////////*/

    /// Covers AE5. Repayment is at face with no early-repayment discount: the loan
    /// originated and settled in the same block still costs the full 4.08 obligation
    /// on a 4 ether principal. Full repayment closes and returns the stream.
    function test_Repay_AtFaceClosesAndReturnsStream() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 4 ether, STREAM_ONE, 4 ether);
        assertEq(_loan(loanId).obligation, 4.08 ether);
        _fundOvrflo(BORROWER, 4.08 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.RepayExceedsOutstanding.selector);
        lending.repay(loanId, 4.08 ether + 1);

        vm.expectEmit(true, false, false, true, address(lending));
        emit Repaid(loanId, 1 ether, 3.08 ether);
        vm.prank(BORROWER);
        lending.repay(loanId, 1 ether);

        assertEq(_loan(loanId).repaid, 1 ether);
        assertFalse(_loan(loanId).closed);
        assertEq(lending.proceeds(loanId), 1 ether);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));

        // Both terminal events fire, in order: `Repaid(…, outstanding = 0)` then
        // `Closed(loanId, drawn)`. `Closed` fires exactly once per loan on whichever
        // path ends it, and repay draws nothing, so the absolute `drawn` is still 0.
        vm.expectEmit(true, true, false, true, address(lending));
        emit StreamDisposed(loanId, BORROWER, STREAM_ONE, false);
        vm.expectEmit(true, false, false, true, address(lending));
        emit Repaid(loanId, 3.08 ether, 0);
        vm.expectEmit(true, false, false, true, address(lending));
        emit Closed(loanId, 0);
        vm.prank(BORROWER);
        lending.repay(loanId, 3.08 ether);

        assertTrue(_loan(loanId).closed);
        assertEq(_loan(loanId).repaid, 4.08 ether);
        assertEq(_loan(loanId).drawn, 0);
        assertEq(lending.proceeds(loanId), 4.08 ether);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
        assertEq(ovrfloToken.balanceOf(BORROWER), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 4.08 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.LoanClosed.selector);
        lending.repay(loanId, 1);
    }

    /// Covers AE5 (maturity half) and KTD7: servicing is never market-gated.
    function test_Repay_WorksAfterMaturity() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 4 ether, STREAM_ONE, 4 ether);
        _fundOvrflo(BORROWER, 4.08 ether);

        vm.warp(expiry + 1 days);
        vm.prank(BORROWER);
        lending.repay(loanId, 4.08 ether);

        assertTrue(_loan(loanId).closed);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
    }

    /// Repayment carries no caller check: a third party may settle the debt, and the
    /// released stream still goes to the borrower, never to the payer.
    function test_Repay_ByThirdPartyReturnsStreamToBorrower() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 4 ether, STREAM_ONE, 4 ether);
        _fundOvrflo(STRANGER, 4.08 ether);

        vm.prank(STRANGER);
        lending.repay(loanId, 4.08 ether);

        assertTrue(_loan(loanId).closed);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
        assertEq(ovrfloToken.balanceOf(STRANGER), 0);
        assertEq(lending.proceeds(loanId), 4.08 ether);
    }

    function test_Repay_RejectsMissingLoanAndZeroAmount() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 4 ether, STREAM_ONE, 4 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.LoanMissing.selector);
        lending.repay(loanId + 1, 1 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.ZeroAmount.selector);
        lending.repay(loanId, 0);
    }

    /// `close` is permissionless once the stream's withdrawable covers the outstanding,
    /// reverts `NotCovered` below coverage, and `LoanClosed` on a second call.
    function test_Close_PermissionlessOnceCoveredAndRevertsOnSecondCall() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);
        assertEq(_loan(loanId).obligation, 5.1 ether);

        // Short of coverage is a temporal condition, not a size floor: it carries its
        // own `NotCovered` selector rather than sharing `BelowMinimum`.
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether - 1);
        vm.prank(STRANGER);
        vm.expectRevert(OVRFLOLending.NotCovered.selector);
        lending.close(loanId);

        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        vm.expectEmit(true, true, false, true, address(lending));
        emit StreamDisposed(loanId, BORROWER, STREAM_ONE, false);
        vm.expectEmit(true, false, false, true, address(lending));
        emit Closed(loanId, 5.1 ether);
        vm.prank(STRANGER);
        lending.close(loanId);

        assertTrue(_loan(loanId).closed);
        assertEq(_loan(loanId).drawn, 5.1 ether);
        assertEq(lending.proceeds(loanId), 5.1 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 5.1 ether);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
        assertEq(ovrfloToken.balanceOf(address(lending)), 5.1 ether);

        vm.prank(STRANGER);
        vm.expectRevert(OVRFLOLending.LoanClosed.selector);
        lending.close(loanId);

        vm.expectRevert(OVRFLOLending.LoanMissing.selector);
        lending.close(loanId + 1);
    }

    /// `outstanding == 0 && !closed` is a legal, reachable state: claims can harvest the
    /// entire obligation while the loan stays open, because nothing in the claim path
    /// closes a loan. `close` is then the only way to release the stream, and it must
    /// draw nothing at all.
    function test_Close_AfterClaimsFullyHarvestObligationDrawsNothing() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 10 ether, APR);
        // Deposited 10.2 prices to a gross of exactly 10 ether, so a 10 ether target
        // takes the full-borrow path and owes the stream's entire remaining 10.2.
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        assertEq(_loan(loanId).obligation, 10.2 ether);

        // Fully vested; the sole contributor's entitlement is the whole 10.2.
        vm.warp(expiry + 1);
        sablier.setWithdrawable(STREAM_ONE, 10.2 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionId, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(LENDER), 10.2 ether);
        assertEq(_loan(loanId).drawn, 10.2 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);

        // The pinned state: obligation - drawn - repaid == 0, yet the loan is open and
        // still holds the stream.
        LoanView memory harvested = _loan(loanId);
        assertEq(harvested.obligation - harvested.drawn - harvested.repaid, 0);
        assertFalse(harvested.closed);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));

        // Repay is reachable only in this state (after `close` it would be
        // `LoanClosed`), and any positive amount exceeds a zero outstanding.
        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.RepayExceedsOutstanding.selector);
        lending.repay(loanId, 1);

        // Permissionless close draws NOTHING and returns the NFT.
        assertEq(sablier.withdrawableAmountOf(STREAM_ONE), 0);
        vm.expectEmit(true, true, false, true, address(lending));
        emit StreamDisposed(loanId, BORROWER, STREAM_ONE, true);
        vm.expectEmit(true, false, false, true, address(lending));
        emit Closed(loanId, 10.2 ether);
        vm.prank(STRANGER);
        lending.close(loanId);

        assertTrue(_loan(loanId).closed);
        assertEq(_loan(loanId).drawn, 10.2 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);
        vm.expectRevert(bytes("ERC721: invalid token ID"));
        sablier.ownerOf(STREAM_ONE);
        assertEq(lending.proceeds(loanId), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);
    }

    /// KTD7: closing works after the series matures.
    function test_Close_WorksAfterMaturity() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);

        vm.warp(expiry + 1);
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        lending.close(loanId);

        assertTrue(_loan(loanId).closed);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
    }

    /// Completing `repay` after `claim` emptied the stream burns and emits
    /// `StreamDisposed` with `burned = true`. Claim can latch `isDepleted` while
    /// outstanding remains; the completing repay must not return that NFT.
    function test_Repay_AfterClaimEmptiedStreamBurnsAndEmitsDisposed() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);

        sablier.setWithdrawable(STREAM_ONE, 1 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionId, 1 ether);
        assertFalse(_loan(loanId).closed);
        sablier.setDepleted(STREAM_ONE, true);
        assertTrue(sablier.isDepleted(STREAM_ONE));

        uint128 outstanding = 10.2 ether - 1 ether;
        _fundOvrflo(BORROWER, outstanding);
        vm.expectEmit(true, true, false, true, address(lending));
        emit StreamDisposed(loanId, BORROWER, STREAM_ONE, true);
        vm.prank(BORROWER);
        lending.repay(loanId, outstanding);

        assertTrue(_loan(loanId).closed);
        vm.expectRevert(bytes("ERC721: invalid token ID"));
        sablier.ownerOf(STREAM_ONE);
    }

    /// Completing `repay` on a residual transfers the NFT back (`burned = false`).
    function test_Repay_CompletingOnResidualReturnsStream() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 4 ether, STREAM_ONE, 4 ether);
        _fundOvrflo(BORROWER, 4.08 ether);

        vm.expectEmit(true, true, false, true, address(lending));
        emit StreamDisposed(loanId, BORROWER, STREAM_ONE, false);
        vm.prank(BORROWER);
        lending.repay(loanId, 4.08 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
        assertFalse(sablier.isDepleted(STREAM_ONE));
    }

    /// Burn that reverts still completes money movement and returns the stream.
    function test_Close_BurnRevertStillReturnsStream() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);

        vm.warp(expiry + 1);
        sablier.setWithdrawable(STREAM_ONE, 10.2 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionId, type(uint128).max);
        sablier.setBurnReverts(true);

        uint256 proceedsBefore = lending.proceeds(loanId);
        vm.expectEmit(true, true, false, true, address(lending));
        emit StreamDisposed(loanId, BORROWER, STREAM_ONE, false);
        lending.close(loanId);

        assertTrue(_loan(loanId).closed);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
        assertEq(lending.proceeds(loanId), proceedsBefore);
    }

    /*//////////////////////////////////////////////////////////////
                          RE-PLEDGE AND LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// Covers R12 and the GL-70 seam at unit level: a stream returned by `close` can
    /// back a new loan, and the two loans' draw accounting stays isolated — the
    /// second loan's draws never inflate the first loan's recovered value, because
    /// `drawn` is per-loan and never read back from the stream's global `withdrawn`.
    function test_Claim_RePledgedStreamKeepsDrawAccountingIsolated() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        uint256 firstLoan = _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);
        assertEq(_loan(firstLoan).obligation, 5.1 ether);

        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        lending.close(firstLoan);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 5.1 ether);

        // Re-pledge: remaining is now 15.3 - 5.1 = 10.2, which prices to 10 gross.
        vm.prank(BORROWER);
        sablier.approve(address(lending), STREAM_ONE);
        uint256 secondLoan = _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);
        assertEq(_loan(secondLoan).obligation, 5.1 ether);
        assertEq(_loan(secondLoan).fillStart, 5_000_000);
        assertEq(_loan(secondLoan).fillEnd, 10_000_000);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));

        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        vm.prank(LENDER);
        lending.claim(secondLoan, positionId, type(uint128).max);

        // The second loan harvested 5.1; the first loan's ledger is untouched.
        assertEq(_loan(secondLoan).drawn, 5.1 ether);
        assertEq(_loan(firstLoan).drawn, 5.1 ether);
        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), 10.2 ether);
        assertEq(lending.received(secondLoan, positionId), 5.1 ether);
        assertEq(lending.received(firstLoan, positionId), 0);

        // The first loan still pays exactly its own recovered 5.1 — never 10.2.
        vm.prank(LENDER);
        lending.claim(firstLoan, positionId, type(uint128).max);
        assertEq(lending.received(firstLoan, positionId), 5.1 ether);
        assertEq(ovrfloToken.balanceOf(LENDER), 10.2 ether);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.NothingToClaim.selector);
        lending.claim(firstLoan, positionId, type(uint128).max);
    }

    /// Full lifecycle: supply, borrow, mid-term partial claim, close, final claims,
    /// stream returned, every party's balance accounted for.
    function test_Lifecycle_SupplyBorrowClaimCloseFinalClaims() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionA = _supply(LENDER, 6 ether, APR);
        uint256 positionB = _supply(SECOND_LENDER, 4 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 10 ether);
        assertEq(underlying.balanceOf(BORROWER), 10 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);

        // Partial claim of a bounded amount rather than the whole entitlement.
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        vm.prank(LENDER);
        lending.claim(loanId, positionA, 1 ether);
        assertEq(ovrfloToken.balanceOf(LENDER), 1 ether);
        assertEq(_loan(loanId).drawn, 1 ether);

        sablier.setWithdrawable(STREAM_ONE, 10.2 ether);
        lending.close(loanId);
        vm.expectRevert(bytes("ERC721: invalid token ID"));
        sablier.ownerOf(STREAM_ONE);
        assertEq(_loan(loanId).drawn, 10.2 ether);
        assertEq(lending.proceeds(loanId), 9.2 ether);

        _claim(LENDER, loanId, positionA);
        _claim(SECOND_LENDER, loanId, positionB);

        assertEq(ovrfloToken.balanceOf(LENDER), 6.12 ether);
        assertEq(ovrfloToken.balanceOf(SECOND_LENDER), 4.08 ether);
        assertEq(lending.proceeds(loanId), 0);
        assertEq(ovrfloToken.balanceOf(address(lending)), 0);
        assertEq(underlying.balanceOf(LENDER), 994 ether);
        assertEq(underlying.balanceOf(SECOND_LENDER), 996 ether);
    }

    /*//////////////////////////////////////////////////////////////
                    EPOCHS, CURSOR, AND DISCOVERY (U5)
    //////////////////////////////////////////////////////////////*/

    /// Covers AE6 (rollover half). At terminal capacity the next supply opens a new
    /// epoch, and every epoch-0 coordinate, contribution, and claimable is
    /// byte-identical afterward.
    function test_Supply_RollsEpochAtTerminalCapacityKeepingHistoryByteIdentical() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 posA = _supply(LENDER, 10 ether, APR); // leaf 0: [0, 10e6)
        uint256 posB = _supply(SECOND_LENDER, 6 ether, APR); // leaf 1: [10e6, 16e6)
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 12 ether, STREAM_ONE, 0); // [0, 12e6), obligation 12.24
        // Mid-loan accrual so claimable is nonzero on both sides of the rollover:
        // recovered = min(5.1, 12.24) = 5.1; A: 10/12 x 5.1 = 4.25; B: 2/12 x 5.1 = 0.85.
        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);

        assertEq(lending.contributionOf(loanId, posA), 10 ether);
        assertEq(lending.contributionOf(loanId, posB), 2 ether);
        (, uint64 preStart, uint64 preEnd,) = lending.positionState(posA);
        (OVRFLOLending.LoanShare[] memory preShares,) = lending.loansOf(posA, 0, 10);
        assertEq(preShares[0].claimable, 4.25 ether);

        lending.exposed_setCapacityOverride(2); // two leaves == simulated terminal capacity
        vm.expectEmit(true, false, false, true, address(lending));
        emit EpochOpened(MARKET, APR, 1);
        uint256 posC = _supply(LENDER, 5 ether, APR);

        (,,, uint32 epochC, uint32 leafC) = lending.positions(posC);
        assertEq(epochC, 1);
        assertEq(leafC, 0);

        // Epoch-0 history is untouched by the rollover.
        assertEq(lending.contributionOf(loanId, posA), 10 ether);
        assertEq(lending.contributionOf(loanId, posB), 2 ether);
        (, uint64 postStart, uint64 postEnd,) = lending.positionState(posA);
        assertEq(postStart, preStart);
        assertEq(postEnd, preEnd);
        (OVRFLOLending.LoanShare[] memory postSharesA,) = lending.loansOf(posA, 0, 10);
        assertEq(postSharesA[0].claimable, 4.25 ether);
        (OVRFLOLending.LoanShare[] memory postSharesB,) = lending.loansOf(posB, 0, 10);
        assertEq(postSharesB[0].claimable, 0.85 ether);

        // Ladder totals span both live epochs: (16 - 12) + 5 = 9 ether of depth.
        (uint32 oldest, uint32 current, uint128 availableUnits) = lending.tickState(MARKET, APR);
        assertEq(oldest, 0);
        assertEq(current, 1);
        assertEq(availableUnits, 9_000_000);
    }

    /// Covers AE6 (growth half). Filling height-4 capacity and appending once more
    /// grows the tree inside the library — no epoch opens — and every prior
    /// coordinate and contribution is unchanged.
    function test_Supply_TreeGrowthBelowCapKeepsCoordinatesAndOpensNoEpoch() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.startPrank(LENDER);
        for (uint256 i = 0; i < 4096; ++i) {
            lending.supply(MARKET, APR, 1e15);
        }
        vm.stopPrank();

        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        // Blind fill spanning the first 2000 minimum-sized leaves.
        uint256 loanId = _borrow(BORROWER, 2 ether, STREAM_ONE, 0);
        assertEq(lending.contributionOf(loanId, 1), 1e15); // leaf 0 sits fully inside [0, 2e6)
        (, uint64 preStart, uint64 preEnd,) = lending.positionState(4096);
        assertEq(preStart, 4_095_000);
        assertEq(preEnd, 4_096_000);

        // Leaf 4097 grows the tree to height 5 inside append.
        _supply(LENDER, 1e15, APR);

        (uint64 root,, uint32 leaves,, uint32 currentEpoch) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(root, 4_097_000);
        assertEq(leaves, 4097);
        assertEq(currentEpoch, 0); // grew; did not roll over

        (, uint64 postStart, uint64 postEnd,) = lending.positionState(4096);
        assertEq(postStart, 4_095_000);
        assertEq(postEnd, 4_096_000);
        (, uint64 newStart, uint64 newEnd,) = lending.positionState(4097);
        assertEq(newStart, 4_096_000);
        assertEq(newEnd, 4_097_000);
        assertEq(lending.contributionOf(loanId, 1), 1e15);
    }

    /// Covers AE8 (residual branch). A borrow returns only the oldest epoch's
    /// above-minimum residual; the next borrow advances the cursor past the
    /// drained epoch and fills from the newer one.
    function test_Borrow_AE8_FillsOldEpochResidualThenAdvancesCursor() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2e15, APR); // epoch 0 holds 2x the minimum
        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 50 ether, APR); // rolls to epoch 1
        lending.exposed_setCapacityOverride(0);

        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 first = _borrow(BORROWER, 10 ether, STREAM_ONE, 0);
        // Single-epoch rule: only the 0.002 ether residual fills, not 10.
        assertEq(_loan(first).epoch, 0);
        assertEq(underlying.balanceOf(BORROWER), 2e15);

        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);
        uint256 second = _borrow(SECOND_BORROWER, 10 ether, STREAM_TWO, 0);
        assertEq(_loan(second).epoch, 1);
        assertEq(underlying.balanceOf(SECOND_BORROWER), 10 ether);
        (uint32 oldest,,) = lending.tickState(MARKET, APR);
        assertEq(oldest, 1); // advancement persisted
    }

    /// Covers AE8 (dust branch). A sub-minimum residual is skipped inside the same
    /// borrow transaction and stays withdraw-only for its lender.
    function test_Borrow_AE8_SkipsDustEpochInOneTransaction() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 dustPos = _supply(LENDER, 2e15, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 1.5e15, STREAM_ONE, 0); // residual 0.5e15 < the 1e15 minimum

        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 50 ether, APR); // epoch 1
        lending.exposed_setCapacityOverride(0);

        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);
        uint256 loanId = _borrow(SECOND_BORROWER, 10 ether, STREAM_TWO, 0);
        // Dust skipped in one transaction: cursor 0 -> 1, full 10 ether fill.
        assertEq(_loan(loanId).epoch, 1);
        assertEq(underlying.balanceOf(SECOND_BORROWER), 10 ether);
        (uint32 oldest,,) = lending.tickState(MARKET, APR);
        assertEq(oldest, 1);

        // 1000 - 2e15 supplied + 0.5e15 dust refund = 1000 ether - 1.5e15.
        vm.prank(LENDER);
        lending.withdraw(dustPos);
        assertEq(underlying.balanceOf(LENDER), 1_000 ether - 1.5e15);
    }

    /// A borrow facing every epoch drained reverts the interpretable EmptyTick,
    /// never a low-level tree failure.
    function test_Borrow_AllEpochsDrainedRevertsEmptyTick() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2e15, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 2e15, STREAM_ONE, 0); // drains epoch 0

        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 1e15, APR); // epoch 1
        lending.exposed_setCapacityOverride(0);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);
        _borrow(SECOND_BORROWER, 1e15, STREAM_TWO, 0); // cursor -> 1, drains epoch 1

        _createStream(STREAM_THREE, BORROWER, 15.3 ether);
        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.EmptyTick.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_THREE, 0);
    }

    /// A backlog deeper than CURSOR_CAP blocks borrows until the permissionless,
    /// progress-persisting cursor walk durably restores borrowability.
    function test_AdvanceEpochCursor_RecoversBacklogDeeperThanCap() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        // 40 dead epochs below the live one; real liquidity lands in epoch 40.
        lending.exposed_setEpochs(MARKET, APR, 0, 40);
        _supply(LENDER, 10 ether, APR);

        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.EpochBacklog.selector);
        lending.borrow(MARKET, APR, 10 ether, STREAM_ONE, 0);

        vm.expectRevert(OVRFLOLending.ZeroSteps.selector);
        lending.advanceEpochCursor(MARKET, APR, 0);

        vm.expectEmit(true, false, false, true, address(lending));
        emit EpochCursorAdvanced(MARKET, APR, 0, 25);
        assertEq(lending.advanceEpochCursor(MARKET, APR, 25), 25);

        // Progress persisted; the walk finishes and stops exactly at currentEpoch.
        vm.expectEmit(true, false, false, true, address(lending));
        emit EpochCursorAdvanced(MARKET, APR, 25, 40);
        assertEq(lending.advanceEpochCursor(MARKET, APR, 25), 40);

        // No-op success returns the unchanged cursor.
        assertEq(lending.advanceEpochCursor(MARKET, APR, 25), 40);

        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 0);
        assertEq(_loan(loanId).epoch, 40);
        assertEq(underlying.balanceOf(BORROWER), 10 ether);
    }

    /// The cursor never passes an epoch holding at least one minimum fill.
    function test_AdvanceEpochCursor_NeverPassesLiveEpoch() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 5 ether, APR); // epoch 0 stays live
        lending.exposed_setEpochs(MARKET, APR, 0, 40);

        assertEq(lending.advanceEpochCursor(MARKET, APR, 100), 0);
        (uint32 oldest,,) = lending.tickState(MARKET, APR);
        assertEq(oldest, 0);
    }

    /// Covers R17: the whole ladder in one view call, depth summed across live
    /// epochs, zero rungs included, bundleable via multicall.
    function test_TickDepths_ReturnsWholeLadderInOneCall() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setAprBounds(950, 1050);

        _supply(LENDER, 10 ether, APR); // tick 1000, epoch 0
        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 5 ether, APR); // tick 1000, epoch 1
        lending.exposed_setCapacityOverride(0);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 4 ether, STREAM_ONE, 0); // epoch 0 drops to 6 ether
        _supply(LENDER, 3 ether, 1025);

        OVRFLOLending.TickDepth[] memory depths = lending.tickDepths(MARKET);
        assertEq(depths.length, 5); // 950, 975, 1000, 1025, 1050
        assertEq(depths[0].aprBps, 950);
        assertEq(depths[0].availableUnits, 0);
        assertEq(depths[1].aprBps, 975);
        assertEq(depths[1].availableUnits, 0);
        assertEq(depths[2].aprBps, 1000);
        assertEq(depths[2].availableUnits, 11_000_000); // 6 + 5 ether across two epochs
        assertEq(depths[3].aprBps, 1025);
        assertEq(depths[3].availableUnits, 3_000_000);
        assertEq(depths[4].aprBps, 1050);
        assertEq(depths[4].availableUnits, 0);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(lending.tickDepths, (MARKET));
        calls[1] = abi.encodeCall(lending.tickState, (MARKET, APR));
        bytes[] memory results = lending.multicall(calls);
        OVRFLOLending.TickDepth[] memory bundled = abi.decode(results[0], (OVRFLOLending.TickDepth[]));
        assertEq(bundled[2].availableUnits, 11_000_000);

        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        lending.tickDepths(BARE_MARKET);
    }

    /// Covers R18: binary-search entry, exact pagination continuation, sorted
    /// early stop, and claimable as executable ground truth.
    function test_LoansOf_BinarySearchPaginationAndClaimGroundTruth() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 posOne = _supply(LENDER, 10 ether, APR); // [0, 10e6)
        uint256 posTwo = _supply(SECOND_LENDER, 20 ether, APR); // [10e6, 30e6)

        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, BORROWER, 15.3 ether);
        _createStream(STREAM_THREE, BORROWER, 15.3 ether);
        uint256 loanOne = _borrow(BORROWER, 10 ether, STREAM_ONE, 0); // [0, 10e6)
        uint256 loanTwo = _borrow(BORROWER, 8 ether, STREAM_TWO, 0); // [10e6, 18e6)
        uint256 loanThree = _borrow(BORROWER, 12 ether, STREAM_THREE, 0); // [18e6, 30e6)

        // posTwo overlaps loans two and three; the binary search skips loan one.
        (OVRFLOLending.LoanShare[] memory entries, uint64 nextSeq) = lending.loansOf(posTwo, 0, 10);
        assertEq(entries.length, 2);
        assertEq(entries[0].loanId, loanTwo);
        assertEq(entries[0].contribution, 8 ether);
        assertEq(entries[1].loanId, loanThree);
        assertEq(entries[1].contribution, 12 ether);
        assertEq(nextSeq, 0);
        assertEq(lending.contributionOf(loanTwo, posTwo), 8 ether);
        assertEq(lending.contributionOf(loanThree, posTwo), 12 ether);

        // Exact continuation across the maxN boundary.
        (entries, nextSeq) = lending.loansOf(posTwo, 0, 1);
        assertEq(entries.length, 1);
        assertEq(entries[0].loanId, loanTwo);
        assertEq(nextSeq, 2);
        (entries, nextSeq) = lending.loansOf(posTwo, nextSeq, 1);
        assertEq(entries.length, 1);
        assertEq(entries[0].loanId, loanThree);
        assertEq(nextSeq, 0);

        // posOne stops at the sorted boundary: exactly one overlapping loan.
        (entries, nextSeq) = lending.loansOf(posOne, 0, 10);
        assertEq(entries.length, 1);
        assertEq(entries[0].loanId, loanOne);
        assertEq(entries[0].contribution, 10 ether);
        assertEq(nextSeq, 0);

        // Claimable is executable ground truth: loan two's obligation is 8.16
        // (8 x 1.02); with 4.08 vested, posTwo carries the whole interval, so the
        // view must equal exactly what a max-claim then pays.
        sablier.setWithdrawable(STREAM_TWO, 4.08 ether);
        (entries,) = lending.loansOf(posTwo, 0, 10);
        assertEq(entries[0].claimable, 4.08 ether);
        uint256 balanceBefore = ovrfloToken.balanceOf(SECOND_LENDER);
        _claim(SECOND_LENDER, loanTwo, posTwo);
        assertEq(ovrfloToken.balanceOf(SECOND_LENDER) - balanceBefore, 4.08 ether);
        (entries,) = lending.loansOf(posTwo, 0, 10);
        assertEq(entries[0].claimable, 0);

        vm.expectRevert(OVRFLOLending.ZeroSteps.selector);
        lending.loansOf(posTwo, 0, 0);
        vm.expectRevert(OVRFLOLending.PositionMissing.selector);
        lending.loansOf(999, 0, 1);
    }

    /// Covers KTD8: named state views derive interval/outstanding data and revert
    /// on nonexistent entities.
    function test_StateViews_DeriveFieldsAndRevertOnMissing() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 6 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 2 ether, STREAM_ONE, 0);

        (OVRFLOLending.Position memory position, uint64 intervalStart, uint64 intervalEnd, uint128 unfilled) =
            lending.positionState(positionId);
        assertEq(position.lender, LENDER);
        assertEq(intervalStart, 0);
        assertEq(intervalEnd, 6_000_000);
        assertEq(unfilled, 4 ether); // 6 supplied, 2 consumed by the fill

        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        assertEq(loan.borrower, BORROWER);
        assertEq(outstanding, 2.04 ether); // 2 x 1.02, nothing drawn or repaid

        vm.expectRevert(OVRFLOLending.PositionMissing.selector);
        lending.positionState(999);
        vm.expectRevert(OVRFLOLending.LoanMissing.selector);
        lending.loanState(999);
        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        lending.tickState(BARE_MARKET, APR);
    }

    /// Old-epoch positions and loans service unchanged after a rollover.
    function test_OldEpochServicingUnchangedAfterRollover() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 6 ether, STREAM_ONE, 0); // epoch 0, obligation 6.12

        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 5 ether, APR); // epoch 1 opens
        lending.exposed_setCapacityOverride(0);

        vm.prank(LENDER);
        lending.withdraw(positionId);
        assertEq(underlying.balanceOf(LENDER), 994 ether); // 1000 - 10 + 4 unfilled

        sablier.setWithdrawable(STREAM_ONE, 6.12 ether);
        _claim(LENDER, loanId, positionId);
        assertEq(ovrfloToken.balanceOf(LENDER), 6.12 ether);
    }

    /// Pins CURSOR_CAP at exactly 32: a backlog of precisely the cap succeeds.
    /// (U5 review: the 40-epoch test alone proves only "some cap below 40".)
    function test_Borrow_CursorCapBoundary_ExactCapSucceeds() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        lending.exposed_setEpochs(MARKET, APR, 0, 32); // exactly 32 dead epochs
        _supply(LENDER, 10 ether, APR); // lands in epoch 32

        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        uint256 loanId = _borrow(BORROWER, 10 ether, STREAM_ONE, 0);
        assertEq(_loan(loanId).epoch, 32);
        assertEq(underlying.balanceOf(BORROWER), 10 ether);
    }

    /// Pins CURSOR_CAP at exactly 32: one epoch past the cap reverts.
    function test_Borrow_CursorCapBoundary_CapPlusOneReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        lending.exposed_setEpochs(MARKET, APR, 0, 33); // 33 dead epochs
        _supply(LENDER, 10 ether, APR);

        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.EpochBacklog.selector);
        lending.borrow(MARKET, APR, 10 ether, STREAM_ONE, 0);
    }

    /// The recovery valve's own copy of the dust predicate skips a genuine dust
    /// residual (U5 review: previously only borrow's copy was exercised on dust).
    function test_AdvanceEpochCursor_SkipsGenuineDustEpoch() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2e15, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 1.5e15, STREAM_ONE, 0); // leaves 500 units of dust in epoch 0

        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 5 ether, APR); // epoch 1 opens
        lending.exposed_setCapacityOverride(0);

        // A skip-only-fully-drained mutant would refuse to pass the 500-unit dust.
        vm.expectEmit(true, false, false, true, address(lending));
        emit EpochCursorAdvanced(MARKET, APR, 0, 1);
        assertEq(lending.advanceEpochCursor(MARKET, APR, 10), 1);
    }

    /// The cursor stops exactly at currentEpoch even when currentEpoch itself is
    /// empty (U5 review: the bound previously never fired independently of the
    /// liquidity break).
    function test_AdvanceEpochCursor_StopsAtEmptyCurrentEpoch() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        lending.exposed_setEpochs(MARKET, APR, 0, 5); // every epoch empty, incl. 5

        vm.expectEmit(true, false, false, true, address(lending));
        emit EpochCursorAdvanced(MARKET, APR, 0, 5);
        assertEq(lending.advanceEpochCursor(MARKET, APR, 50), 5);
        (uint32 oldest,,) = lending.tickState(MARKET, APR);
        assertEq(oldest, 5);
    }

    /// EpochCursorAdvanced belongs to the recovery valve alone: a borrow that
    /// advances the cursor emits no cursor event (Borrowed.epoch is the
    /// checkpoint), and a no-op valve call emits nothing at all.
    function test_CursorEventEmittedOnlyByRecoveryValveMoves() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2e15, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 2e15, STREAM_ONE, 0); // drains epoch 0
        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 5 ether, APR); // epoch 1
        lending.exposed_setCapacityOverride(0);

        // This borrow advances the cursor 0 -> 1 silently.
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);
        vm.recordLogs();
        _borrow(SECOND_BORROWER, 1 ether, STREAM_TWO, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 cursorTopic = keccak256("EpochCursorAdvanced(address,uint16,uint32,uint32)");
        for (uint256 i = 0; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != cursorTopic, "borrow must not emit the cursor event");
        }

        // A no-op valve call (cursor already at a live epoch) emits nothing.
        vm.recordLogs();
        assertEq(lending.advanceEpochCursor(MARKET, APR, 10), 1);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    /// The trailing nextSeq guard returns 0 when the next un-scanned loan starts
    /// past the position's interval (U5 review: previously indistinguishable from
    /// a bare seq < count check).
    function test_LoansOf_NextSeqZeroWhenRemainingLoansAreAllPastInterval() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint256 posTwo;
        {
            _supply(LENDER, 10 ether, APR); // [0, 10e6)
            posTwo = _supply(SECOND_LENDER, 20 ether, APR); // [10e6, 30e6)
            _supply(LENDER, 5 ether, APR); // [30e6, 35e6)
        }
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, BORROWER, 15.3 ether);
        _createStream(STREAM_THREE, BORROWER, 15.3 ether);
        _createStream(STREAM_FOUR, BORROWER, 15.3 ether);
        _borrow(BORROWER, 10 ether, STREAM_ONE, 0); // seq 0: [0, 10e6)
        uint256 loanTwo = _borrow(BORROWER, 8 ether, STREAM_TWO, 0); // seq 1: [10e6, 18e6)
        uint256 loanThree = _borrow(BORROWER, 12 ether, STREAM_THREE, 0); // seq 2: [18e6, 30e6)
        _borrow(BORROWER, 5 ether, STREAM_FOUR, 0); // seq 3: [30e6, 35e6) — past posTwo

        // maxN cuts off exactly at posTwo's last overlapping loan; the remaining
        // seq 3 exists but starts at 30e6 == intervalEnd, so nextSeq must be 0.
        (OVRFLOLending.LoanShare[] memory entries, uint64 nextSeq) = lending.loansOf(posTwo, 0, 2);
        assertEq(entries.length, 2);
        assertEq(entries[0].loanId, loanTwo);
        assertEq(entries[1].loanId, loanThree);
        assertEq(nextSeq, 0);
    }

    /*//////////////////////////////////////////////////////////////
                             PREVIEW BORROW
    //////////////////////////////////////////////////////////////*/

    function test_PreviewBorrow_PartialTickFill_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 5 ether, STREAM_ONE, 5 ether);
        assertEq(actualBorrow, 5 ether);
        assertEq(feeAmount, 0);
        assertEq(obligation, 5.1 ether);
    }

    function test_PreviewBorrow_StreamPriceCappedFill_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        // Target 15 ether exceeds the 10 ether gross price; fill clamps to the cap.
        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 15 ether, STREAM_ONE, 10 ether);
        assertEq(actualBorrow, 10 ether);
        assertEq(feeAmount, 0);
        assertEq(obligation, 10.2 ether);
    }

    function test_PreviewBorrow_FullStreamSale_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, type(uint128).max, STREAM_ONE, 10 ether);
        assertEq(actualBorrow, 10 ether);
        assertEq(feeAmount, 0);
        assertEq(obligation, 10.2 ether);
    }

    function test_PreviewBorrow_UnitFlooring_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 5 ether + (1e12 - 1), STREAM_ONE, 0);
        assertEq(actualBorrow, 5 ether);
        assertEq(feeAmount, 0);
        assertEq(obligation, 5.1 ether);
    }

    function test_PreviewBorrow_ZeroFee_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        assertEq(lending.feeBps(), 0);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        (uint128 actualBorrow, uint128 feeAmount,) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 5 ether, STREAM_ONE, 5 ether);
        assertEq(actualBorrow, 5 ether);
        assertEq(feeAmount, 0);
    }

    function test_PreviewBorrow_NonZeroFee_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.prank(address(factory));
        lending.setFee(100);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 10 ether, STREAM_ONE, 9.9 ether);
        assertEq(actualBorrow, 10 ether);
        assertEq(feeAmount, 0.1 ether);
        assertEq(obligation, 10.2 ether);
    }

    function test_PreviewBorrow_DustBelowMinLiquidity_RevertsBelowMinimum() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.previewBorrow(MARKET, APR, 0.5e15, STREAM_ONE);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.borrow(MARKET, APR, 0.5e15, STREAM_ONE, 0);
    }

    function test_PreviewBorrow_DeadEpochSkip_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2e15, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _borrow(BORROWER, 1.5e15, STREAM_ONE, 0); // residual 0.5e15 < the 1e15 minimum

        lending.exposed_setCapacityOverride(1);
        _supply(SECOND_LENDER, 50 ether, APR); // epoch 1
        lending.exposed_setCapacityOverride(0);

        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);
        (uint32 oldestBefore,,) = lending.tickState(MARKET, APR);
        assertEq(oldestBefore, 0);

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            lending.previewBorrow(MARKET, APR, 10 ether, STREAM_TWO);
        (uint32 oldestAfterPreview,,) = lending.tickState(MARKET, APR);
        assertEq(oldestAfterPreview, oldestBefore, "preview must not advance the cursor");

        vm.recordLogs();
        uint256 loanId = _borrow(SECOND_BORROWER, 10 ether, STREAM_TWO, 0);
        (uint128 borrowedActual, uint128 borrowedFee, uint128 borrowedObligation) =
            _decodeBorrowed(vm.getRecordedLogs());
        assertEq(actualBorrow, borrowedActual);
        assertEq(feeAmount, borrowedFee);
        assertEq(obligation, borrowedObligation);
        assertEq(actualBorrow, 10 ether);
        assertEq(_loan(loanId).epoch, 1);
        (uint32 oldestAfterBorrow,,) = lending.tickState(MARKET, APR);
        assertEq(oldestAfterBorrow, 1);
    }

    function test_PreviewBorrow_CursorCapBoundary_MatchesBorrowedEvent() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        lending.exposed_setEpochs(MARKET, APR, 0, 32);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 10 ether, STREAM_ONE, 0);
        assertEq(actualBorrow, 10 ether);
        assertEq(feeAmount, 0);
        assertEq(obligation, 10.2 ether);
        assertEq(_loan(1).epoch, 32);
    }

    function test_PreviewBorrow_EpochBacklog_RevertsEpochBacklog() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        lending.exposed_setEpochs(MARKET, APR, 0, 33);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        vm.expectRevert(OVRFLOLending.EpochBacklog.selector);
        lending.previewBorrow(MARKET, APR, 10 ether, STREAM_ONE);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.EpochBacklog.selector);
        lending.borrow(MARKET, APR, 10 ether, STREAM_ONE, 0);
    }

    function test_PreviewBorrow_MaturityBoundary_MatchesThenReverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        _createStream(STREAM_TWO, SECOND_BORROWER, 15.3 ether);

        vm.warp(expiry - 1);
        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 1 ether, STREAM_ONE, 0);
        assertEq(actualBorrow, 1 ether);
        assertEq(feeAmount, 0);
        assertGt(obligation, actualBorrow);

        vm.warp(expiry);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.previewBorrow(MARKET, APR, 1 ether, STREAM_TWO);
        vm.prank(SECOND_BORROWER);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_TWO, 0);
    }

    function test_PreviewBorrow_PackedSlotUnchangedThenBorrowMutates() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);
        _assertPackedSlotPreviewThenBorrow(_epochPackedSlot(MARKET, APR, 0));
    }

    function test_PreviewBorrow_ThenBorrowSameBlock_Agree() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 blockBefore = block.number;
        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, 5 ether, STREAM_ONE, 5 ether);
        assertEq(block.number, blockBefore, "preview then borrow must share one block");
        assertEq(actualBorrow, 5 ether);
        assertEq(feeAmount, 0);
        assertEq(obligation, 5.1 ether);
    }

    function test_PreviewBorrow_ZeroTarget_Reverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.expectRevert(OVRFLOLending.ZeroTarget.selector);
        lending.previewBorrow(MARKET, APR, 0, STREAM_ONE);
    }

    function test_PreviewBorrow_InvalidTick_Reverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.previewBorrow(MARKET, 1025, 1 ether, STREAM_ONE);
    }

    function test_PreviewBorrow_EmptyTick_Reverts() public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);
        vm.expectRevert(OVRFLOLending.EmptyTick.selector);
        lending.previewBorrow(MARKET, APR, 1 ether, STREAM_ONE);
    }

    function testFuzz_PreviewBorrow_MatchesSubsequentBorrow(uint128 targetSeed, uint16 feeSeed) public {
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        uint16 fee = uint16(bound(feeSeed, 0, uint256(lending.MAX_FEE_BPS())));
        vm.prank(address(factory));
        lending.setFee(fee);

        uint128 depth = 20 ether;
        _supply(LENDER, depth, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        uint128 target = uint128(bound(uint256(targetSeed), uint256(lending.MIN_LIQUIDITY_AMOUNT()), uint256(depth)));
        _assertPreviewMatchesSubsequentBorrow(BORROWER, APR, target, STREAM_ONE, 0);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Mirror of the `Loan` struct so tests read the real public getter without
    ///      twelve-slot tuple destructuring. Field order must match `loans(...)`.
    struct LoanView {
        address borrower;
        uint16 aprBps;
        uint32 epoch;
        bool closed;
        address market;
        uint64 seq;
        uint256 streamId;
        uint64 fillStart;
        uint64 fillEnd;
        uint128 obligation;
        uint128 drawn;
        uint128 repaid;
    }

    function _loan(uint256 loanId) internal view returns (LoanView memory loan) {
        // Split across two reads of the same getter: assigning all twelve fields in
        // one destructuring exceeds the non-IR stack limit.
        (loan.borrower, loan.aprBps, loan.epoch, loan.closed, loan.market, loan.seq,,,,,,) = lending.loans(loanId);
        (,,,,,, loan.streamId, loan.fillStart, loan.fillEnd, loan.obligation, loan.drawn, loan.repaid) =
            lending.loans(loanId);
    }

    function _supply(address lender, uint128 amount, uint16 aprBps) internal returns (uint256 positionId) {
        vm.prank(lender);
        positionId = lending.supply(MARKET, aprBps, amount);
    }

    function _createStream(uint256 streamId, address owner, uint128 deposited) internal {
        sablier.setStream(
            streamId, owner, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, deposited, 0
        );
        vm.prank(owner);
        sablier.approve(address(lending), streamId);
    }

    function _borrow(address borrower, uint128 target, uint256 streamId, uint128 minAcceptable)
        internal
        returns (uint256 loanId)
    {
        vm.prank(borrower);
        loanId = lending.borrow(MARKET, APR, target, streamId, minAcceptable);
    }

    function _claim(address lender, uint256 loanId, uint256 positionId) internal {
        vm.prank(lender);
        lending.claim(loanId, positionId, type(uint128).max);
    }

    function _fundOvrflo(address payer, uint128 amount) internal {
        ovrfloToken.mint(payer, amount);
        vm.prank(payer);
        ovrfloToken.approve(address(lending), type(uint256).max);
    }

    /// @dev Packed Epoch slot: `_ticks[market][aprBps].epochs[epoch]` then +2 past
    ///      `TickTree.Tree` (`leaves`/`height` at +0, `nodes` mapping at +1).
    ///      `filled` and `loanCount` share that word.
    function _epochPackedSlot(address market, uint16 aprBps, uint32 epoch) internal pure returns (bytes32) {
        bytes32 tickSlot = keccak256(abi.encode(uint256(aprBps), keccak256(abi.encode(market, TICKS_SLOT))));
        bytes32 epochBase = keccak256(abi.encode(uint256(epoch), bytes32(uint256(tickSlot) + 1)));
        return bytes32(uint256(epochBase) + 2);
    }

    function _decodeBorrowed(Vm.Log[] memory logs)
        internal
        pure
        returns (uint128 actualBorrow, uint128 feeAmount, uint128 obligation)
    {
        bytes32 topic = keccak256(
            "Borrowed(uint256,address,address,uint16,uint32,uint64,uint64,uint64,uint128,uint128,uint128,uint256)"
        );
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == topic) {
                (,,,,, actualBorrow, feeAmount, obligation,) = abi.decode(
                    logs[i].data, (uint16, uint32, uint64, uint64, uint64, uint128, uint128, uint128, uint256)
                );
                return (actualBorrow, feeAmount, obligation);
            }
        }
        revert("Borrowed event missing");
    }

    function _assertPackedSlotPreviewThenBorrow(bytes32 packedSlot) internal {
        bytes32 packedBefore = vm.load(address(lending), packedSlot);
        uint64 filledBefore;
        uint32 oldestBefore;
        {
            uint64 rootBefore;
            (rootBefore, filledBefore,, oldestBefore,) = lending.exposed_epochState(MARKET, APR, 0);
            rootBefore;
        }
        uint64 loanCountBefore = lending.exposed_loanCount(MARKET, APR, 0);
        uint256 nextLoanBefore = lending.nextLoanId();

        (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) =
            lending.previewBorrow(MARKET, APR, 5 ether, STREAM_ONE);

        assertEq(vm.load(address(lending), packedSlot), packedBefore);
        {
            (uint64 rootAfter, uint64 filledAfter,, uint32 oldestAfter,) = lending.exposed_epochState(MARKET, APR, 0);
            assertEq(filledAfter, filledBefore);
            assertEq(oldestAfter, oldestBefore);
            assertEq(rootAfter, 20_000_000);
        }
        assertEq(lending.exposed_loanCount(MARKET, APR, 0), loanCountBefore);
        assertEq(lending.nextLoanId(), nextLoanBefore);
        assertEq(sablier.ownerOf(STREAM_ONE), BORROWER);

        vm.recordLogs();
        _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);
        (uint128 borrowedActual, uint128 borrowedFee, uint128 borrowedObligation) =
            _decodeBorrowed(vm.getRecordedLogs());
        assertEq(actualBorrow, borrowedActual);
        assertEq(feeAmount, borrowedFee);
        assertEq(obligation, borrowedObligation);

        bytes32 packedAfterBorrow = vm.load(address(lending), packedSlot);
        assertNotEq(packedAfterBorrow, packedBefore, "real borrow must mutate the packed epoch slot");
        uint256 packed = uint256(packedAfterBorrow);
        assertEq(uint64(packed), 5_000_000);
        assertEq(uint64(packed >> 64), 1);
        assertEq(packed >> 128, 0);
    }

    function _assertPreviewMatchesSubsequentBorrow(
        address borrower,
        uint16 aprBps,
        uint128 target,
        uint256 streamId,
        uint128 minAcceptable
    ) internal returns (uint128 actualBorrow, uint128 feeAmount, uint128 obligation) {
        (actualBorrow, feeAmount, obligation) = lending.previewBorrow(MARKET, aprBps, target, streamId);
        vm.recordLogs();
        vm.prank(borrower);
        lending.borrow(MARKET, aprBps, target, streamId, minAcceptable);
        (uint128 borrowedActual, uint128 borrowedFee, uint128 borrowedObligation) =
            _decodeBorrowed(vm.getRecordedLogs());
        assertEq(actualBorrow, borrowedActual, "preview actualBorrow != Borrowed");
        assertEq(feeAmount, borrowedFee, "preview feeAmount != Borrowed");
        assertEq(obligation, borrowedObligation, "preview obligation != Borrowed");
    }
}
