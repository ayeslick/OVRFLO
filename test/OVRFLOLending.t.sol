// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
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
}

contract OVRFLOLendingTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant STRANGER = address(0x3333);
    address internal constant MARKET = address(0x5555);
    address internal constant LENDER = address(0xA11CE);
    address internal constant SECOND_LENDER = address(0xB0B);

    uint16 internal constant APR = 1000;
    uint16 internal constant SPACING = 25;

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

        expiry = block.timestamp + 180 days;
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

    function _supply(address lender, uint128 amount, uint16 aprBps) internal returns (uint256 positionId) {
        vm.prank(lender);
        positionId = lending.supply(MARKET, aprBps, amount);
    }
}
