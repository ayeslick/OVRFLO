// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
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
        ticks[market][aprBps].epochs[epoch].filled = filled;
    }

    function exposed_epochState(address market, uint16 aprBps, uint32 epoch)
        external
        view
        returns (uint64 root, uint64 filled, uint32 leaves, uint32 oldestLiveEpoch, uint32 currentEpoch)
    {
        Tick storage tick = ticks[market][aprBps];
        Epoch storage epochState = tick.epochs[epoch];
        return
            (epochState.tree.root(), epochState.filled, epochState.tree.leaves, tick.oldestLiveEpoch, tick.currentEpoch);
    }

    function exposed_loanCount(address market, uint16 aprBps, uint32 epoch) external view returns (uint64) {
        return ticks[market][aprBps].epochs[epoch].loanCount;
    }
}

contract OVRFLOLendingTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant STRANGER = address(0x3333);
    address internal constant MARKET = address(0x5555);
    address internal constant BARE_MARKET = address(0x5556);
    address internal constant LENDER = address(0xA11CE);
    address internal constant SECOND_LENDER = address(0xB0B);
    address internal constant BORROWER = address(0xD0C);
    address internal constant SECOND_BORROWER = address(0xD0D);

    uint16 internal constant APR = 1000;
    uint16 internal constant SPACING = 25;
    uint256 internal constant STREAM_ONE = 401;
    uint256 internal constant STREAM_TWO = 402;
    uint256 internal constant STREAM_THREE = 403;
    /// @dev Storage slot of the `ticks` mapping (`forge inspect OVRFLOLending storage-layout`).
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
        uint128 obligation,
        uint256 streamId
    );

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
        vm.prank(LENDER);
        underlying.approve(address(lending), type(uint256).max);
        vm.prank(SECOND_LENDER);
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
        lending.setTickSpacing(MARKET, SPACING);

        assertEq(lending.tickSpacing(MARKET), SPACING);

        vm.expectRevert(OVRFLOLending.SpacingAlreadySet.selector);
        lending.setTickSpacing(MARKET, SPACING);
    }

    function test_SetTickSpacing_ZeroReverts() public {
        vm.expectRevert(OVRFLOLending.ZeroSpacing.selector);
        lending.setTickSpacing(MARKET, 0);
    }

    function test_Supply_RevertsBeforeSpacingIsSet() public {
        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        lending.supply(MARKET, APR, 1 ether);
    }

    function test_Supply_EscrowsAppendsIndexesAndEmits() public {
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
        lending.setTickSpacing(MARKET, SPACING);
        lending.setAprBounds(500, 1500);

        _supply(LENDER, 1 ether, 500);
        _supply(LENDER, 1 ether, 1500);

        lending.setAprBounds(750, 1250);

        vm.prank(LENDER);
        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.supply(MARKET, 500, 1 ether);

        _supply(LENDER, 1 ether, 750);
        _supply(LENDER, 1 ether, 1250);
    }

    function test_Supply_RejectsInvalidTicks() public {
        lending.setTickSpacing(MARKET, SPACING);
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
        lending.setTickSpacing(MARKET, SPACING);
        uint128 amount = uint128((uint256(type(uint64).max) + 1) * lending.UNIT());
        underlying.mint(LENDER, amount);

        vm.prank(LENDER);
        vm.expectRevert("SafeCast: value doesn't fit in 64 bits");
        lending.supply(MARKET, APR, amount);
    }

    function test_Supply_RevertsAtAndAfterMaturity() public {
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
        lending.setTickSpacing(MARKET, SPACING);
        uint256 positionId = _supply(LENDER, 1 ether, APR);

        vm.prank(STRANGER);
        vm.expectRevert(OVRFLOLending.NotLender.selector);
        lending.withdraw(positionId);
    }

    function test_Withdraw_RemainsAvailableAfterMaturity() public {
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
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        vm.expectEmit(true, true, true, true, address(lending));
        emit Borrowed(1, BORROWER, MARKET, APR, 0, 0, 0, 5_000_000, 5 ether, 5.1 ether, STREAM_ONE);

        uint256 loanId = _borrow(BORROWER, 5 ether, STREAM_ONE, 5 ether);

        assertEq(loanId, 1);
        assertEq(lending.nextLoanId(), 2);
        assertEq(underlying.balanceOf(BORROWER), 5 ether);
        assertEq(underlying.balanceOf(LENDER), 980 ether);
        assertEq(underlying.balanceOf(address(lending)), 15 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));

        (
            address borrower,
            uint16 aprBps,
            uint32 epoch,
            address market,
            uint64 seq,
            uint256 streamId,
            uint64 fillStart,
            uint64 fillEnd,
            uint128 obligation
        ) = lending.loans(loanId);
        assertEq(borrower, BORROWER);
        assertEq(aprBps, APR);
        assertEq(epoch, 0);
        assertEq(market, MARKET);
        assertEq(seq, 0);
        assertEq(streamId, STREAM_ONE);
        assertEq(fillStart, 0);
        assertEq(fillEnd, 5_000_000);
        assertEq(obligation, 5.1 ether);

        assertEq(lending.loanAt(MARKET, APR, 0, 0), loanId);
        assertEq(lending.borrowerLoanCount(BORROWER), 1);
        assertEq(lending.borrowerLoanAt(BORROWER, 0), loanId);

        // The blind fill advances `filled` without touching the tree: root unchanged.
        (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(root, 20_000_000);
        assertEq(filled, 5_000_000);
        assertEq(lending.exposed_loanCount(MARKET, APR, 0), 1);
    }

    /// Covers AE1. Two same-block borrowers targeting 12 each against 16 available:
    /// the first receives 12, the second receives the 4 residue — no "inactive
    /// position" failure mode exists anywhere.
    function test_Borrow_ConcurrentTargets_SecondFillsResidue() public {
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

        (,,,,,, uint64 firstStart, uint64 firstEnd, uint128 firstObligation) = lending.loans(firstLoan);
        (,,,, uint64 secondSeq,, uint64 secondStart, uint64 secondEnd, uint128 secondObligation) =
            lending.loans(secondLoan);
        assertEq(firstStart, 0);
        assertEq(firstEnd, 12_000_000);
        assertEq(firstObligation, 12.24 ether);
        assertEq(secondSeq, 1);
        assertEq(secondStart, 12_000_000);
        assertEq(secondEnd, 16_000_000);
        assertEq(secondObligation, 4.08 ether);
        assertEq(lending.loanAt(MARKET, APR, 0, 0), firstLoan);
        assertEq(lending.loanAt(MARKET, APR, 0, 1), secondLoan);

        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, 16_000_000);
        assertEq(lending.exposed_loanCount(MARKET, APR, 0), 2);
    }

    /// Covers AE1. The losing borrower's floor turns the residue fill into a clean
    /// slippage revert instead of any position-level failure.
    function test_Borrow_ConcurrentTargets_SecondRevertsBelowMinAcceptable() public {
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
        lending.setTickSpacing(MARKET, SPACING);
        lending.setFee(100);
        _supply(LENDER, 10 ether, APR);
        _createStream(STREAM_ONE, LENDER, 10.2 ether);

        uint256 loanId = _borrow(LENDER, 10 ether, STREAM_ONE, 9.9 ether);

        (address borrower,,,,,,,, uint128 obligation) = lending.loans(loanId);
        assertEq(borrower, LENDER);
        assertEq(obligation, 10.2 ether);
        (address positionLender,,,,) = lending.positions(1);
        assertEq(positionLender, LENDER);

        assertEq(underlying.balanceOf(LENDER), 999.9 ether);
        assertEq(underlying.balanceOf(TREASURY), 0.1 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
    }

    /// Max borrow = sale (R11): a target above the stream's discounted value fills
    /// exactly the gross price and owes the stream's entire remaining face.
    function test_Borrow_MaxBorrowObligationEqualsEntireRemaining() public {
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 10.2 ether);

        uint256 loanId = _borrow(BORROWER, type(uint128).max, STREAM_ONE, 10 ether);

        (,,,,,,,, uint128 obligation) = lending.loans(loanId);
        assertEq(obligation, 10.2 ether);
        assertEq(obligation, sablier.getDepositedAmount(STREAM_ONE) - sablier.getWithdrawnAmount(STREAM_ONE));

        assertEq(underlying.balanceOf(BORROWER), 10 ether);
        assertEq(underlying.balanceOf(address(lending)), 10 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, 10_000_000);
    }

    function test_Borrow_TargetFlooredToUnit() public {
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 20 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        _borrow(BORROWER, 5 ether + 999, STREAM_ONE, 0);

        assertEq(underlying.balanceOf(BORROWER), 5 ether);
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, APR, 0);
        assertEq(filled, 5_000_000);
    }

    function test_Borrow_ConsumesExactlyLastUnitThenEmptyTick() public {
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
        lending.setTickSpacing(MARKET, SPACING);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        lending.borrow(MARKET, 1025, 1 ether, STREAM_ONE, 0);
    }

    function test_Borrow_NeverSuppliedTickRevertsEmptyTick() public {
        lending.setTickSpacing(MARKET, SPACING);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.EmptyTick.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    function test_Borrow_TargetBelowFillFloorReverts() public {
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        _createStream(STREAM_ONE, BORROWER, 15.3 ether);

        vm.prank(BORROWER);
        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.borrow(MARKET, APR, 0.5e15, STREAM_ONE, 0);
    }

    function test_Borrow_ResidueBelowFillFloorReverts() public {
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
        lending.setTickSpacing(MARKET, SPACING);
        _supply(LENDER, 2 ether, APR);
        sablier.setStream(
            STREAM_ONE, BORROWER, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, true, 15.3 ether, 0
        );

        vm.prank(BORROWER);
        vm.expectRevert(StreamPricing.CancelableStream.selector);
        lending.borrow(MARKET, APR, 1 ether, STREAM_ONE, 0);
    }

    /// The MIN_STREAM_AMOUNT wrapper rejects dust streams before any fill math runs.
    function test_Borrow_StreamBelowMinimumRemainingReverts() public {
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
        lending.setTickSpacing(MARKET, SPACING);
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
                                HELPERS
    //////////////////////////////////////////////////////////////*/

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
}
