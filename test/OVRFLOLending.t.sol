// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {StreamPricing} from "../src/StreamPricing.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";

contract ShortTransferERC20 is TestERC20 {
    constructor() TestERC20("Short Transfer", "SHORT") {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount - 1);
    }
}

/// @dev Harness to cover the _toUint128 overflow guard, which is unreachable from
///      the external ABI (every call site is pre-bounded). Also documents the
///      `loan not in pool` branch as defensive — loanPoolContributions are only written
///      inside createBorrowerLoanPool, which always sets loanPoolLoanId, so a contributor
///      with no loan cannot exist.
contract LendingInternalHarness is OVRFLOLending {
    constructor(address factory, address core, address sablier) OVRFLOLending(factory, core, sablier) {}

    function exposed_toUint128(uint256 amount) external pure returns (uint128) {
        return _toUint128(amount);
    }
}

contract OVRFLOLendingTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant NEW_TREASURY = address(0xCAFE);
    address internal constant STRANGER = address(0x3333);
    address internal constant NEW_OWNER = address(0x4444);
    address internal constant MARKET = address(0x5555);
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);

    event LendingAprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    event LendingFeeSet(uint16 feeBps);
    event LendingTreasurySet(address indexed treasury);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event StreamSaleListingPosted(
        uint256 indexed listingId,
        address indexed lender,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps
    );

    MockLendingFactory internal factory;
    MockLendingCore internal core;
    MockLendingSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    OVRFLOLending internal lending;
    uint256 internal expiry;

    function setUp() public {
        factory = new MockLendingFactory();
        core = new MockLendingCore();
        sablier = new MockLendingSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO Underlying", "ovrfloUND");
        expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        factory.setMarketApproved(address(core), MARKET, true);
        core.setSeries(MARKET, true, expiry, address(ovrfloToken), address(underlying));

        lending = new OVRFLOLending(address(factory), address(core), address(sablier));
    }

    function test_Constructor_CachesRegistryInfoAndLaunchSettings() public view {
        assertEq(address(lending.factory()), address(factory));
        assertEq(lending.core(), address(core));
        assertEq(lending.ovrfloToken(), address(ovrfloToken));
        assertEq(lending.underlying(), address(underlying));
        assertEq(address(lending.sablier()), address(sablier));
        assertEq(lending.APR_MAX_CEILING(), 10_000);
        assertEq(lending.MAX_FEE_BPS(), 10_000);
        assertEq(lending.treasury(), TREASURY);
        assertEq(lending.aprMinBps(), lending.LAUNCH_APR_BPS());
        assertEq(lending.aprMaxBps(), lending.LAUNCH_APR_BPS());
        assertEq(lending.owner(), address(this));
    }

    function test_Constructor_RevertsForZeroAddressesOrUnregisteredCore() public {
        vm.expectRevert("OVRFLOLending: factory zero");
        new OVRFLOLending(address(0), address(core), address(sablier));

        vm.expectRevert("OVRFLOLending: core zero");
        new OVRFLOLending(address(factory), address(0), address(sablier));

        vm.expectRevert("OVRFLOLending: sablier zero");
        new OVRFLOLending(address(factory), address(core), address(0));

        vm.expectRevert("OVRFLOLending: unknown core");
        new OVRFLOLending(address(factory), address(0xDEAD), address(sablier));
    }

    function test_Admin_SetAprBounds() public {
        vm.expectEmit(address(lending));
        emit LendingAprBoundsSet(1000, 1000);
        lending.setAprBounds(1000, 1000);

        vm.expectEmit(address(lending));
        emit LendingAprBoundsSet(500, 2500);
        lending.setAprBounds(500, 2500);

        assertEq(lending.aprMinBps(), 500);
        assertEq(lending.aprMaxBps(), 2500);

        vm.expectRevert("OVRFLOLending: bad apr bounds");
        lending.setAprBounds(2501, 2500);

        vm.expectRevert("OVRFLOLending: apr too high");
        lending.setAprBounds(0, 10_001);
    }

    function test_Admin_SetAprBounds_StepAlignment() public {
        // Happy path: both multiples of 100
        lending.setAprBounds(1000, 5000);
        assertEq(lending.aprMinBps(), 1000);
        assertEq(lending.aprMaxBps(), 5000);

        // Min not aligned
        vm.expectRevert("OVRFLOLending: aprMin not step-aligned");
        lending.setAprBounds(50, 5000);

        // Max not aligned
        vm.expectRevert("OVRFLOLending: aprMax not step-aligned");
        lending.setAprBounds(1000, 5050);

        // Both not aligned — min check fires first
        vm.expectRevert("OVRFLOLending: aprMin not step-aligned");
        lending.setAprBounds(50, 99);
    }

    function test_Admin_SetFeeAndTreasury() public {
        vm.expectEmit(address(lending));
        emit LendingFeeSet(100);
        lending.setFee(100);
        assertEq(lending.feeBps(), 100);

        vm.expectRevert("OVRFLOLending: fee too high");
        lending.setFee(10_001);

        vm.expectEmit(true, false, false, true, address(lending));
        emit LendingTreasurySet(NEW_TREASURY);
        lending.setTreasury(NEW_TREASURY);
        assertEq(lending.treasury(), NEW_TREASURY);

        vm.expectRevert("OVRFLOLending: treasury zero");
        lending.setTreasury(address(0));
    }

    function test_Admin_RevertsForNonOwner() public {
        vm.startPrank(STRANGER);

        vm.expectRevert("Ownable: caller is not the owner");
        lending.setAprBounds(500, 2500);

        vm.expectRevert("Ownable: caller is not the owner");
        lending.setFee(1);

        vm.expectRevert("Ownable: caller is not the owner");
        lending.setTreasury(NEW_TREASURY);

        vm.stopPrank();
    }

    function test_Ownership_UsesTwoStepTransfer() public {
        vm.expectEmit(true, true, false, true, address(lending));
        emit OwnershipTransferStarted(address(this), NEW_OWNER);
        lending.transferOwnership(NEW_OWNER);

        assertEq(lending.pendingOwner(), NEW_OWNER);
        assertEq(lending.owner(), address(this));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable2Step: caller is not the new owner");
        lending.acceptOwnership();

        vm.prank(NEW_OWNER);
        lending.acceptOwnership();
        assertEq(lending.owner(), NEW_OWNER);
        assertEq(lending.pendingOwner(), address(0));
    }

    function test_Multicall_BatchesAdminCallsAndBubblesRevert() public {
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(OVRFLOLending.setFee, (50));
        data[1] = abi.encodeCall(OVRFLOLending.setTreasury, (NEW_TREASURY));

        lending.multicall(data);

        assertEq(lending.feeBps(), 50);
        assertEq(lending.treasury(), NEW_TREASURY);

        data[0] = abi.encodeCall(OVRFLOLending.setFee, (10_001));
        vm.expectRevert("OVRFLOLending: fee too high");
        lending.multicall(data);
    }

    function test_Multicall_IsNonPayable() public {
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeCall(OVRFLOLending.setFee, (1));

        vm.deal(address(this), 1 ether);
        (bool success,) = address(lending).call{value: 1}(abi.encodeWithSignature("multicall(bytes[])", data));
        assertFalse(success);
    }

    function test_SupplyLiquidity_RejectsOutOfBandAprAndEscrowsCapacity() public {
        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(lending), 100 ether);

        vm.expectRevert("OVRFLOLending: apr out of bounds");
        lending.supplyLiquidity(MARKET, 999, 100 ether);

        uint256 liquidityId = lending.supplyLiquidity(MARKET, 1000, 100 ether);
        vm.stopPrank();

        (address lender, address market, uint16 aprBps, uint128 availableLiquidity, bool active) =
            lending.liquidityPositions(liquidityId);
        assertEq(lender, BUYER);
        assertEq(market, MARKET);
        assertEq(aprBps, 1000);
        assertEq(availableLiquidity, 100 ether);
        assertTrue(active);
        assertEq(underlying.balanceOf(address(lending)), 100 ether);
        assertEq(underlying.balanceOf(BUYER), 0);
    }

    function test_HitLiquidity_SettlesSaleAndConsumesCapacity() public {
        lending.setFee(100);
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(1, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(lending), 1);

        vm.prank(SELLER);
        lending.sellStreamToLiquidity(liquidityId, 1, 99 ether);

        (,,,, bool active) = lending.liquidityPositions(liquidityId);
        assertFalse(active);
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(sablier.ownerOf(1), BUYER);
    }

    function test_HitLiquidity_PricesFromRemainingAfterPriorWithdrawals() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(28, SELLER, 150 ether, 40 ether);

        vm.prank(SELLER);
        sablier.approve(address(lending), 28);
        vm.prank(SELLER);
        lending.sellStreamToLiquidity(liquidityId, 28, 0);

        (,,, uint128 availableLiquidity,) = lending.liquidityPositions(liquidityId);
        assertEq(availableLiquidity, 0);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(sablier.ownerOf(28), BUYER);
    }

    function test_HitLiquidity_RespectsSlippageCapacityDeadIdsDustAndMaturity() public {
        lending.setFee(100);

        uint256 slippageLiquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(2, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(lending), 2);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: slippage");
        lending.sellStreamToLiquidity(slippageLiquidityId, 2, 100 ether);

        uint256 smallLiquidityId = _supplyLiquidity(BUYER, 50 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: insufficient availableLiquidity");
        lending.sellStreamToLiquidity(smallLiquidityId, 2, 0);

        vm.prank(BUYER);
        lending.withdrawLiquidity(slippageLiquidityId);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: liquidity inactive");
        lending.sellStreamToLiquidity(slippageLiquidityId, 2, 0);

        uint256 dustLiquidityId = _supplyLiquidity(BUYER, 1 ether);
        _mintEligibleStream(3, SELLER, 1, 0);
        vm.prank(SELLER);
        sablier.approve(address(lending), 3);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: price zero");
        lending.sellStreamToLiquidity(dustLiquidityId, 3, 0);

        uint256 maturedLiquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(4, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(lending), 4);
        vm.warp(expiry);
        vm.prank(SELLER);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.sellStreamToLiquidity(maturedLiquidityId, 4, 0);
    }

    function test_HitLiquidity_AllowsPartialFillsAndCancelRefundsRemainder() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 250 ether);
        _mintEligibleStream(5, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(lending), 5);
        vm.prank(SELLER);
        lending.sellStreamToLiquidity(liquidityId, 5, 0);

        (,,, uint128 availableLiquidity, bool active) = lending.liquidityPositions(liquidityId);
        assertEq(availableLiquidity, 150 ether);
        assertTrue(active);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(address(lending)), 150 ether);
        assertEq(sablier.ownerOf(5), BUYER);

        vm.prank(BUYER);
        lending.withdrawLiquidity(liquidityId);

        (,,, availableLiquidity, active) = lending.liquidityPositions(liquidityId);
        assertEq(availableLiquidity, 0);
        assertFalse(active);
        assertEq(underlying.balanceOf(BUYER), 150 ether);
    }

    function test_ListStream_RejectsInvalidAprAndEscrowsNft() public {
        _mintEligibleStream(6, SELLER, 110 ether, 0);

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 6);
        vm.expectRevert("OVRFLOLending: apr out of bounds");
        lending.postSaleListing(MARKET, 6, 999);
        vm.stopPrank();

        lending.setFee(42);

        vm.expectEmit(true, true, true, true, address(lending));
        emit StreamSaleListingPosted(1, SELLER, MARKET, 6, 1000, 42);
        vm.startPrank(SELLER);
        uint256 listingId = lending.postSaleListing(MARKET, 6, 1000);
        vm.stopPrank();

        (address lender, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active) =
            lending.saleListings(listingId);
        assertEq(lender, SELLER);
        assertEq(market, MARKET);
        assertEq(streamId, 6);
        assertEq(aprBps, 1000);
        assertEq(listingFeeBps, 42);
        assertTrue(active);
        assertEq(sablier.ownerOf(6), address(lending));
    }

    function test_CancelListing_ReturnsExactNftWithoutDrawing() public {
        _mintEligibleStream(7, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 7);

        vm.prank(SELLER);
        lending.cancelSaleListing(listingId);

        (,,,,, bool active) = lending.saleListings(listingId);
        assertFalse(active);
        assertEq(sablier.ownerOf(7), SELLER);
        assertEq(sablier.getWithdrawnAmount(7), 0);
    }

    function test_TakeListing_SettlesSale() public {
        lending.setFee(100);
        _mintEligibleStream(8, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 8);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(lending), 100 ether);
        lending.buyListing(listingId, 100 ether);
        vm.stopPrank();

        (,,,,, bool active) = lending.saleListings(listingId);
        assertFalse(active);
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(sablier.ownerOf(8), BUYER);
    }

    function test_TakeListing_UsesSnapshottedFeeWhenGlobalFeeChanges() public {
        lending.setFee(0);
        _mintEligibleStream(32, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 32);
        lending.setFee(100);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(lending), 100 ether);
        lending.buyListing(listingId, 100 ether);
        vm.stopPrank();

        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(sablier.ownerOf(32), BUYER);
    }

    function test_TakeListing_RespectsSlippageDustAndDeadIds() public {
        _mintEligibleStream(9, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 9);

        underlying.mint(BUYER, 200 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(lending), 200 ether);
        vm.expectRevert("OVRFLOLending: slippage");
        lending.buyListing(listingId, 99 ether);
        vm.stopPrank();

        vm.prank(SELLER);
        lending.cancelSaleListing(listingId);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: listing inactive");
        lending.buyListing(listingId, 100 ether);

        _mintEligibleStream(10, SELLER, 1, 0);
        uint256 dustListingId = _postSaleListing(SELLER, 10);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: price zero");
        lending.buyListing(dustListingId, 1);
    }

    function test_CloseLoan_RevertsUntilClosableThenPaysAndReturnsNft() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(20, 100 ether);

        sablier.setWithdrawable(20, 109 ether);
        vm.expectRevert("OVRFLOLending: loan not closable");
        lending.closeLoan(loanId);

        sablier.setWithdrawable(20, 110 ether);
        vm.prank(STRANGER);
        lending.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = lending.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 110 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(20), 110 ether);
        assertEq(sablier.ownerOf(20), SELLER);

        vm.expectRevert("OVRFLOLending: loan closed");
        lending.closeLoan(loanId);
    }

    function test_CloseLoan_AfterPartialClaimDrawsOnlyOutstanding() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(30, 100 ether);

        // Partial claim harvests 40 from the stream
        sablier.setWithdrawable(30, 40 ether);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 40 ether);

        // closeLoan draws remaining outstanding (110 - 40 = 70)
        sablier.setWithdrawable(30, 100 ether);
        lending.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = lending.loans(loanId);
        assertEq(drawn, 110 ether, "40 harvested + 70 drawn by closeLoan");
        assertTrue(closed);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 70 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether, "total claimed = obligation");
        assertEq(sablier.getWithdrawnAmount(30), 110 ether, "40 + 70 drawn from stream");
        assertEq(sablier.ownerOf(30), SELLER, "NFT returned to borrower");
    }

    function test_CloseLoan_ReturnsNftWhenAlreadySatisfiedByClaims() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(21, 100 ether);

        // Full claim harvests the entire obligation from the stream
        sablier.setWithdrawable(21, 110 ether);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 110 ether);

        (,,,, uint128 drawn, uint128 repaid, bool closed) = lending.loans(loanId);
        assertEq(drawn, 110 ether);
        assertEq(repaid, 0);
        assertFalse(closed, "loan not auto-closed by claim");
        assertEq(sablier.ownerOf(21), address(lending), "lending still holds NFT");

        // closeLoan reclaims the empty stream (outstanding == 0, no draw needed)
        lending.closeLoan(loanId);

        (,,,,,, bool closedAfter) = lending.loans(loanId);
        assertTrue(closedAfter);
        assertEq(sablier.ownerOf(21), SELLER, "NFT returned to borrower");
    }

    function test_RepayLoan_FullRepaymentAfterPartialClaimClosesAndReturnsNft() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(22, 100 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 110 ether);
        lending.repayLoan(loanId, 40 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 40 ether);

        vm.startPrank(SELLER);
        lending.repayLoan(loanId, 70 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, bool closed) = lending.loans(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 110 ether);
        assertTrue(closed);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 70 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(ovrfloToken.balanceOf(SELLER), 0);
        assertEq(sablier.getWithdrawnAmount(22), 0);
        assertEq(sablier.ownerOf(22), SELLER);
    }

    function test_RepayLoan_PartialRepaymentAdvancesClosableTime() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(23, 100 ether);

        ovrfloToken.mint(SELLER, 25 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 25 ether);
        lending.repayLoan(loanId, 25 ether);
        vm.stopPrank();

        (,,,,, uint128 repaid, bool closed) = lending.loans(loanId);
        assertEq(repaid, 25 ether);
        assertFalse(closed);
        assertEq(sablier.ownerOf(23), address(lending));
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 25 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 25 ether);

        sablier.setWithdrawable(23, 84 ether);
        vm.expectRevert("OVRFLOLending: loan not closable");
        lending.closeLoan(loanId);

        sablier.setWithdrawable(23, 85 ether);
        lending.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closedAfter) = lending.loans(loanId);
        assertEq(drawn, 85 ether);
        assertTrue(closedAfter);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 85 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(23), 85 ether);
        assertEq(sablier.ownerOf(23), SELLER);
    }

    function test_RepayLoan_RevertsForInvalidCallerAmountsAndClosedLoan() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(24, 100 ether);

        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: not borrower");
        lending.repayLoan(loanId, 1);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: repay zero");
        lending.repayLoan(loanId, 0);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: repay too much");
        lending.repayLoan(loanId, 111 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 110 ether);
        lending.repayLoan(loanId, 110 ether);
        vm.expectRevert("OVRFLOLending: loan closed");
        lending.repayLoan(loanId, 1);
        vm.stopPrank();

        vm.expectRevert("OVRFLOLending: loan closed");
        lending.closeLoan(loanId);
    }

    function test_Quote_EqualsLoanSettlementAndLoanStateReflectsRepayment() public {
        lending.setFee(100);
        _mintEligibleStream(25, SELLER, 110 ether, 0);

        (uint256 grossPrice, uint128 quotedObligation, uint256 quotedFee, uint256 quotedNet, uint128 quotedResidual) =
            lending.quote(MARKET, 25, 1000, 100 ether);
        assertEq(grossPrice, 100 ether);
        assertEq(quotedObligation, 110 ether);
        assertEq(quotedFee, 1 ether);
        assertEq(quotedNet, 99 ether);
        assertEq(quotedResidual, 0);

        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 25);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidityId;
        lending.createBorrowerLoanPool(liquidityIds, 25, 100 ether, 99 ether);
        vm.stopPrank();
        uint256 loanId = 1;

        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(lending)), 0);
        assertEq(sablier.ownerOf(25), address(lending));

        (,,, uint128 obligation,,,, bool closed) = lending.loanState(loanId);
        assertEq(obligation, quotedObligation);
        assertFalse(closed);

        ovrfloToken.mint(SELLER, 25 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 25 ether);
        lending.repayLoan(loanId, 25 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, uint128 outstanding,) = lending.loanState(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 25 ether);
        assertEq(outstanding, 85 ether);
    }

    function test_Quote_WithZeroBorrowAmountPreviewsSaleSettlement() public {
        lending.setFee(100);
        _mintEligibleStream(31, SELLER, 110 ether, 0);

        (uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual) =
            lending.quote(MARKET, 31, 1000, 0);

        assertEq(grossPrice, 100 ether);
        assertEq(obligation, 110 ether);
        assertEq(feeAmount, 1 ether);
        assertEq(netToBorrower, 99 ether);
        assertEq(residual, 0);
    }

    function test_Quote_RevertsForAprOutOfBounds() public {
        _mintEligibleStream(32, SELLER, 110 ether, 0);
        vm.expectRevert("OVRFLOLending: apr out of bounds");
        lending.quote(MARKET, 32, 500, 0);
    }

    function test_Quote_RevertsForNonWholeApr() public {
        // Widen bounds to include 50 bps
        lending.setAprBounds(0, 1000);
        _mintEligibleStream(33, SELLER, 110 ether, 0);
        vm.expectRevert("OVRFLOLending: apr not whole");
        lending.quote(MARKET, 33, 50, 0);
    }

    function test_Quote_RevertsForZeroPrice() public {
        // remaining = 1 wei, grossPrice = 1e18 / factor ≈ 0 (floors to 0)
        _mintEligibleStream(34, SELLER, 2, 1);
        vm.expectRevert("OVRFLOLending: price zero");
        lending.quote(MARKET, 34, 1000, 0);
    }

    function test_Quote_PartialBorrow() public {
        // deposited = 110, aprBps = 1000, ttm = 365 days -> grossPrice = 100 ether
        _mintEligibleStream(35, SELLER, 110 ether, 0);
        (uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual) =
            lending.quote(MARKET, 35, 1000, 50 ether);
        assertEq(grossPrice, 100 ether);
        // obligation = ceil(50 * factor / WAD) = ceil(55 ether) = 55 ether
        assertEq(obligation, 55 ether);
        assertEq(feeAmount, 0); // default fee is 0
        assertEq(netToBorrower, 50 ether);
        // residual = remaining - obligation = 110 - 55 = 55
        assertEq(residual, 55 ether);
    }

    function test_Quote_RevertsWhenBorrowAbovePrice() public {
        _mintEligibleStream(36, SELLER, 110 ether, 0);
        // grossPrice = 100 ether, borrowAmount = 101 ether -> reverts
        vm.expectRevert("OVRFLOLending: borrow above price");
        lending.quote(MARKET, 36, 1000, 101 ether);
    }

    function test_OrderStateViewsReflectCurrentState() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        (address lender, address market, uint16 aprBps, uint128 availableLiquidity, bool active) =
            lending.liquidityState(liquidityId);
        assertEq(lender, BUYER);
        assertEq(market, MARKET);
        assertEq(aprBps, 1000);
        assertEq(availableLiquidity, 100 ether);
        assertTrue(active);

        _mintEligibleStream(26, SELLER, 110 ether, 0);
        uint256 saleListingId = _postSaleListing(SELLER, 26);
        (
            address listingMaker,
            address listingMarket,
            uint256 listingStreamId,
            uint16 listingApr,
            uint16 listingFeeBps,
            bool listingActive
        ) = lending.saleListingState(saleListingId);
        assertEq(listingMaker, SELLER);
        assertEq(listingMarket, MARKET);
        assertEq(listingStreamId, 26);
        assertEq(listingApr, 1000);
        assertEq(listingFeeBps, 0);
        assertTrue(listingActive);
    }

    function _supplyLiquidity(address lender, uint128 availableLiquidity) internal returns (uint256 liquidityId) {
        underlying.mint(lender, availableLiquidity);
        vm.startPrank(lender);
        underlying.approve(address(lending), availableLiquidity);
        liquidityId = lending.supplyLiquidity(MARKET, 1000, availableLiquidity);
        vm.stopPrank();
    }

    function _originateLoanViaBorrowPool(uint256 streamId, uint128 borrowAmount)
        internal
        returns (uint256 loanPoolId, uint256 loanId)
    {
        uint256 liquidityId = _supplyLiquidity(BUYER, borrowAmount);
        _mintEligibleStream(streamId, SELLER, 110 ether, 0);
        loanId = lending.nextLoanId();
        vm.startPrank(SELLER);
        sablier.approve(address(lending), streamId);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidityId;
        loanPoolId = lending.createBorrowerLoanPool(liquidityIds, streamId, borrowAmount, 0);
        vm.stopPrank();
    }

    function _postSaleListing(address lender, uint256 streamId) internal returns (uint256 listingId) {
        vm.startPrank(lender);
        sablier.approve(address(lending), streamId);
        listingId = lending.postSaleListing(MARKET, streamId, 1000);
        vm.stopPrank();
    }

    function _mintEligibleStream(uint256 streamId, address owner, uint128 deposited, uint128 withdrawn) internal {
        sablier.setStream(streamId, owner, address(core), ovrfloToken, uint40(expiry), 0, false, deposited, withdrawn);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: UNCOVERED BRANCH TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Constructor_RevertForZeroUnderlying() public {
        MockLendingFactory badFactory = new MockLendingFactory();
        badFactory.setInfo(address(core), TREASURY, address(0), address(ovrfloToken));
        vm.expectRevert("OVRFLOLending: underlying zero");
        new OVRFLOLending(address(badFactory), address(core), address(sablier));
    }

    function test_Constructor_RevertForZeroToken() public {
        MockLendingFactory badFactory = new MockLendingFactory();
        badFactory.setInfo(address(core), TREASURY, address(underlying), address(0));
        vm.expectRevert("OVRFLOLending: token zero");
        new OVRFLOLending(address(badFactory), address(core), address(sablier));
    }

    function test_WithdrawLiquidity_RevertForWrongMaker() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: not lender");
        lending.withdrawLiquidity(liquidityId);
    }

    function test_CancelSaleListing_RevertForWrongMaker() public {
        _mintEligibleStream(40, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 40);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: not listing seller");
        lending.cancelSaleListing(listingId);
    }

    function test_SupplyLiquidity_RevertForZeroCapacity() public {
        vm.expectRevert("OVRFLOLending: availableLiquidity zero");
        lending.supplyLiquidity(MARKET, 1000, 0);
    }

    function test_SupplyLiquidity_RevertsOnTransferMismatch() public {
        ShortTransferERC20 shortToken = new ShortTransferERC20();
        TestERC20 shortOvrfloToken = new TestERC20("Short ovrfloToken", "ovrfloSHORT");

        MockLendingFactory shortFactory = new MockLendingFactory();
        MockLendingCore shortCore = new MockLendingCore();
        MockLendingSablier shortSablier = new MockLendingSablier();

        shortFactory.setInfo(address(shortCore), TREASURY, address(shortToken), address(shortOvrfloToken));
        shortFactory.setMarketApproved(address(shortCore), MARKET, true);
        shortCore.setSeries(MARKET, true, expiry, address(shortOvrfloToken), address(shortToken));

        OVRFLOLending shortLending = new OVRFLOLending(address(shortFactory), address(shortCore), address(shortSablier));

        shortToken.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        shortToken.approve(address(shortLending), 100 ether);
        vm.expectRevert("OVRFLOLending: transfer mismatch");
        shortLending.supplyLiquidity(MARKET, 1000, 100 ether);
        vm.stopPrank();
    }

    function test_CloseLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOLending: unknown loan");
        lending.closeLoan(999);
    }

    function test_RepayLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOLending: unknown loan");
        lending.repayLoan(999, 1);
    }

    function test_LiquidityState_RevertsForUnknownId() public {
        vm.expectRevert("OVRFLOLending: unknown liquidity");
        lending.liquidityState(999);
    }

    function test_SaleListingState_RevertsForUnknownId() public {
        vm.expectRevert("OVRFLOLending: unknown listing");
        lending.saleListingState(999);
    }

    function test_WithdrawLiquidity_RevertsWhenAlreadyCancelled() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        vm.prank(BUYER);
        lending.withdrawLiquidity(liquidityId);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: liquidity inactive");
        lending.withdrawLiquidity(liquidityId);
    }

    function test_CancelSaleListing_RevertsWhenAlreadyCancelled() public {
        _mintEligibleStream(41, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 41);
        vm.prank(SELLER);
        lending.cancelSaleListing(listingId);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: listing inactive");
        lending.cancelSaleListing(listingId);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: WHOLE-NUMBER RATE CONSTRAINT
    //////////////////////////////////////////////////////////////*/

    function test_Apr_RejectsNonWholeRateOnLiquidity() public {
        lending.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(lending), 100 ether);
        vm.expectRevert("OVRFLOLending: apr not whole");
        lending.supplyLiquidity(MARKET, 550, 100 ether);
        vm.stopPrank();
    }

    function test_Apr_AcceptsBoundaryWholeRates() public {
        lending.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 300 ether);
        underlying.approve(address(lending), 300 ether);
        uint256 id0 = lending.supplyLiquidity(MARKET, 0, 100 ether);
        uint256 id500 = lending.supplyLiquidity(MARKET, 500, 100 ether);
        uint256 id9900 = lending.supplyLiquidity(MARKET, 9900, 100 ether);
        vm.stopPrank();

        (,, uint16 apr0,,) = lending.liquidityPositions(id0);
        assertEq(apr0, 0);
        (,, uint16 apr500,,) = lending.liquidityPositions(id500);
        assertEq(apr500, 500);
        (,, uint16 apr9900,,) = lending.liquidityPositions(id9900);
        assertEq(apr9900, 9900);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: POOL DATA STRUCTURES
    //////////////////////////////////////////////////////////////*/

    function test_Pool_NextPoolIdStartsAtOne() public view {
        assertEq(lending.nextLoanPoolId(), 1);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: LOAN SERVICING INTEGRATION
    //////////////////////////////////////////////////////////////*/

    function test_CloseLoan_PoolCreditsPoolProceeds() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(72, 100 ether);
        sablier.setWithdrawable(72, 110 ether);

        uint256 lendingBefore = ovrfloToken.balanceOf(address(lending));
        lending.closeLoan(loanId);

        assertEq(lending.loanPoolProceeds(loanPoolId), 110 ether, "loanPoolProceeds credited");
        assertEq(ovrfloToken.balanceOf(address(lending)) - lendingBefore, 110 ether, "lending receives ovrfloToken");
        assertEq(ovrfloToken.balanceOf(BUYER), 0, "lender does not receive directly");
        assertEq(sablier.ownerOf(72), SELLER, "stream returned to borrower");

        (,,,, uint128 drawn,, bool closed) = lending.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
    }

    function test_RepayLoan_PoolCreditsPoolProceeds() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(74, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        assertEq(lending.loanPoolProceeds(loanPoolId), 50 ether, "loanPoolProceeds credited");
        assertEq(ovrfloToken.balanceOf(address(lending)), 50 ether, "lending holds ovrfloToken");
        assertEq(ovrfloToken.balanceOf(BUYER), 0, "lender does not receive directly");
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: GATHER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function test_GatherLiquidity_SufficientCapacity() public {
        lending.setAprBounds(0, 9900);
        _supplyLiquidityAtApr(BUYER, 50 ether, 500);
        _supplyLiquidityAtApr(SELLER, 60 ether, 500);

        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 500, 100 ether, 1);
        assertTrue(sufficient);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_GatherLiquidity_InsufficientCapacity() public {
        lending.setAprBounds(0, 9900);
        _supplyLiquidityAtApr(BUYER, 50 ether, 500);
        _supplyLiquidityAtApr(SELLER, 30 ether, 500);

        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 500, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 2);
    }

    function test_GatherLiquidity_NoMatchingLiquiditys() public {
        _supplyLiquidity(BUYER, 100 ether);

        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 500, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 0);
    }

    function test_GatherLiquidity_SkipsCancelledAndDepleted() public {
        _supplyLiquidity(BUYER, 50 ether);
        _supplyLiquidity(SELLER, 60 ether);

        // Cancel first liquidity
        vm.prank(BUYER);
        lending.withdrawLiquidity(1);

        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 1000, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 1);
        assertEq(ids[0], 2);
    }

    function test_GatherLiquidity_SkipsDifferentApr() public {
        lending.setAprBounds(0, 9900);
        _supplyLiquidityAtApr(BUYER, 50 ether, 500);
        _supplyLiquidityAtApr(SELLER, 60 ether, 1000);

        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 500, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);
    }

    function test_GatherLiquidity_StartIdBeyondRange() public {
        _supplyLiquidity(BUYER, 100 ether);

        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 1000, 100 ether, 99);
        assertFalse(sufficient);
        assertEq(ids.length, 0);
    }

    function test_GatherLiquidity_ExpiredSeriesReverts() public {
        _supplyLiquidity(BUYER, 100 ether);
        vm.warp(expiry);
        vm.expectRevert();
        lending.gatherLiquidity(MARKET, 1000, 100 ether, 1);
    }

    function test_GatherLiquidity_ExcludesCallerOwnPositions() public {
        _supplyLiquidity(BUYER, 50 ether);
        _supplyLiquidity(SELLER, 60 ether);

        // BUYER calls gatherLiquidity — their own position (id 1) must be excluded
        vm.prank(BUYER);
        (uint256[] memory ids, bool sufficient) = lending.gatherLiquidity(MARKET, 1000, 100 ether, 1);
        assertEq(ids.length, 1, "caller's own position should be excluded");
        assertEq(ids[0], 2, "only non-caller position should be returned");
        assertFalse(sufficient, "60 ether < 100 ether target");
    }

    function _supplyLiquidityAtApr(address lender, uint128 availableLiquidity, uint16 aprBps)
        internal
        returns (uint256 liquidityId)
    {
        underlying.mint(lender, availableLiquidity);
        vm.startPrank(lender);
        underlying.approve(address(lending), availableLiquidity);
        liquidityId = lending.supplyLiquidity(MARKET, aprBps, availableLiquidity);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: BORROWER POOL CREATION
    //////////////////////////////////////////////////////////////*/

    function test_CreateBorrowerLoanPool_SufficientCapacity() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 60 ether);
        _mintEligibleStream(100, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 100);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 100, 100 ether, 90 ether);
        vm.stopPrank();

        // LoanPool state
        (address borrower, uint16 aprBps, address market, uint128 totalContributed,) = lending.loanPools(loanPoolId);
        assertEq(borrower, SELLER);
        assertEq(aprBps, 1000);
        assertEq(market, MARKET);
        assertEq(totalContributed, 100 ether);

        // Contributions
        assertEq(lending.loanPoolContributions(loanPoolId, BUYER), 50 ether);
        assertEq(lending.loanPoolContributions(loanPoolId, STRANGER), 50 ether);

        // LiquidityPosition capacities
        (,,, uint128 cap1,) = lending.liquidityPositions(liquidity1);
        assertEq(cap1, 0);
        (,,, uint128 cap2,) = lending.liquidityPositions(liquidity2);
        assertEq(cap2, 10 ether);

        // Loan
        {
            (address loanBorrower, address lender, uint256 streamId, uint128 obligation,,, bool closed) =
                lending.loans(1);
            assertEq(loanBorrower, SELLER);
            assertEq(lender, address(lending));
            assertEq(streamId, 100);
            assertEq(obligation, 110 ether);
            assertFalse(closed);
        }
        assertEq(lending.loanToLoanPool(1), loanPoolId);
        assertEq(lending.loanPoolProceeds(loanPoolId), 0);
        assertEq(sablier.ownerOf(100), address(lending));

        // Balance assertions
        assertEq(underlying.balanceOf(SELLER), 100 ether, "borrower receives net");
        assertEq(underlying.balanceOf(TREASURY), 0, "no fees (default 0)");
        assertEq(underlying.balanceOf(address(lending)), 10 ether, "lending retains unused availableLiquidity");
    }

    function test_CreateBorrowerLoanPool_InsufficientCapacityReverts() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 40 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 40 ether);
        _mintEligibleStream(101, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 101);
        vm.expectRevert("OVRFLOLending: slippage");
        lending.createBorrowerLoanPool(liquidityIds, 101, 100 ether, 90 ether);
        vm.stopPrank();

        // No liquidityPositions consumed
        (,,, uint128 cap1,) = lending.liquidityPositions(liquidity1);
        assertEq(cap1, 40 ether, "liquidity1 untouched");
        (,,, uint128 cap2,) = lending.liquidityPositions(liquidity2);
        assertEq(cap2, 40 ether, "liquidity2 untouched");
        assertEq(sablier.ownerOf(101), SELLER, "stream not escrowed");
    }

    function test_CreateBorrowerLoanPool_PartialCoverageSucceeds() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 40 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 40 ether);
        _mintEligibleStream(102, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 102);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 102, 100 ether, 70 ether);
        vm.stopPrank();

        (, uint16 aprBps,, uint128 totalContributed,) = lending.loanPools(loanPoolId);
        assertEq(aprBps, 1000);
        assertEq(totalContributed, 80 ether, "actual borrow = available, not target");

        assertEq(lending.loanPoolContributions(loanPoolId, BUYER), 40 ether);
        assertEq(lending.loanPoolContributions(loanPoolId, STRANGER), 40 ether);
        assertEq(underlying.balanceOf(SELLER), 80 ether, "borrower receives actual");
    }

    function test_CreateBorrowerLoanPool_SelfMatchReverts() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liquidity2 = _supplyLiquidity(SELLER, 60 ether);
        _mintEligibleStream(103, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 103);
        vm.expectRevert("OVRFLOLending: self-match");
        lending.createBorrowerLoanPool(liquidityIds, 103, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_MarketMismatchReverts() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);

        address market2 = address(0x6666);
        factory.setMarketApproved(address(core), market2, true);
        core.setSeries(market2, true, expiry, address(ovrfloToken), address(underlying));
        underlying.mint(STRANGER, 60 ether);
        vm.startPrank(STRANGER);
        underlying.approve(address(lending), 60 ether);
        uint256 liquidity2 = lending.supplyLiquidity(market2, 1000, 60 ether);
        vm.stopPrank();

        _mintEligibleStream(104, SELLER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 104);
        vm.expectRevert("OVRFLOLending: market mismatch");
        lending.createBorrowerLoanPool(liquidityIds, 104, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_AprMismatchReverts() public {
        lending.setAprBounds(0, 9900);
        uint256 liquidity1 = _supplyLiquidityAtApr(BUYER, 50 ether, 500);
        uint256 liquidity2 = _supplyLiquidityAtApr(STRANGER, 60 ether, 1000);
        _mintEligibleStream(105, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 105);
        vm.expectRevert("OVRFLOLending: apr mismatch");
        lending.createBorrowerLoanPool(liquidityIds, 105, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_CancelledLiquidityReverts() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        _supplyLiquidity(STRANGER, 60 ether);

        vm.prank(BUYER);
        lending.withdrawLiquidity(liquidity1);

        _mintEligibleStream(106, SELLER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = 2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 106);
        vm.expectRevert("OVRFLOLending: liquidity inactive");
        lending.createBorrowerLoanPool(liquidityIds, 106, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_DuplicateLiquidityIdsReverts() public {
        _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(107, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = 1;
        liquidityIds[1] = 1;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 107);
        vm.expectRevert("OVRFLOLending: duplicate or unsorted ids");
        lending.createBorrowerLoanPool(liquidityIds, 107, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_NetSlippageWithFees() public {
        // Set fee to 1% (100 bps)
        lending.setFee(100);

        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 50 ether);
        _mintEligibleStream(108, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        // actualBorrow = 100, fee = 1, netToBorrower = 99
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 108);
        // minAcceptable = 99 (exactly net) — succeeds
        lending.createBorrowerLoanPool(liquidityIds, 108, 100 ether, 99 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_SlippageRevertsOnNetNotGross() public {
        // Set fee to 1% (100 bps)
        lending.setFee(100);

        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 50 ether);
        _mintEligibleStream(109, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        // actualBorrow = 100, fee = 1, netToBorrower = 99
        // minAcceptable = 100 — old code would pass (100 >= 100), new code reverts (99 < 100)
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 109);
        vm.expectRevert("OVRFLOLending: slippage");
        lending.createBorrowerLoanPool(liquidityIds, 109, 100 ether, 100 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_FeeAtMaxSlippageReverts() public {
        // Set fee to 100% (10000 bps)
        lending.setFee(10_000);

        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 50 ether);
        _mintEligibleStream(110, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;

        // actualBorrow = 100, fee = 100, netToBorrower = 0
        // minAcceptable = 1 — reverts because 0 < 1
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 110);
        vm.expectRevert("OVRFLOLending: slippage");
        lending.createBorrowerLoanPool(liquidityIds, 110, 100 ether, 1);
        vm.stopPrank();

        // Reset fee
        lending.setFee(0);
    }

    function test_CreateBorrowerLoanPool_RevertsWhenBorrowZero() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidity1;
        vm.expectRevert("OVRFLOLending: borrow zero");
        lending.createBorrowerLoanPool(liquidityIds, 200, 0, 0);
    }

    function test_CreateBorrowerLoanPool_RevertsWhenLiquiditysEmpty() public {
        uint256[] memory liquidityIds = new uint256[](0);
        vm.expectRevert("OVRFLOLending: empty liquidity");
        lending.createBorrowerLoanPool(liquidityIds, 201, 100 ether, 90 ether);
    }

    function test_CreateBorrowerLoanPool_RevertsWhenPriceZero() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 100 ether);
        // deposited = 1 wei -> remaining = 1, grossPrice floors to 0 at positive APR/ttm
        _mintEligibleStream(202, SELLER, 1, 0);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidity1;
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 202);
        vm.expectRevert("OVRFLOLending: price zero");
        lending.createBorrowerLoanPool(liquidityIds, 202, 50 ether, 0);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_RevertsWhenBorrowAbovePrice() public {
        // deposited = 110 ether, aprBps = 1000, ttm = 365 days -> grossPrice = 100 ether
        uint256 liquidity1 = _supplyLiquidity(BUYER, 200 ether);
        _mintEligibleStream(203, SELLER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidity1;
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 203);
        vm.expectRevert("OVRFLOLending: borrow above price");
        lending.createBorrowerLoanPool(liquidityIds, 203, 200 ether, 0);
        vm.stopPrank();
    }

    function test_CreateBorrowerLoanPool_RevertsWhenLaterLiquidityInactive() public {
        uint256 liquidity1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liquidity2 = _supplyLiquidity(STRANGER, 60 ether);
        // Cancel the second liquidity — pre-loop check passes (liquidity1 active),
        // _validateLiquiditys loop catches liquidity2 inactive
        vm.prank(STRANGER);
        lending.withdrawLiquidity(liquidity2);
        _mintEligibleStream(204, SELLER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liquidity1;
        liquidityIds[1] = liquidity2;
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 204);
        vm.expectRevert("OVRFLOLending: liquidity inactive");
        lending.createBorrowerLoanPool(liquidityIds, 204, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_Liquidity_SplitBetweenSaleAndLoan() public {
        // Post an liquidity with 200 availableLiquidity — consumable as either sale or loan
        uint256 liquidityId = _supplyLiquidity(BUYER, 200 ether);

        // Sale first: SELLER sells a stream worth 100 into the liquidity
        _mintEligibleStream(150, SELLER, 110 ether, 0);
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 150);
        lending.sellStreamToLiquidity(liquidityId, 150, 0);
        vm.stopPrank();

        // LiquidityPosition availableLiquidity reduced by 100 (grossPrice), still active
        (,,, uint128 capacityAfterSale, bool activeAfterSale) = lending.liquidityPositions(liquidityId);
        assertEq(capacityAfterSale, 100 ether, "availableLiquidity after sale");
        assertTrue(activeAfterSale, "liquidity still active");
        assertEq(sablier.ownerOf(150), BUYER, "stream transferred to lender");

        // Loan second: STRANGER borrows 100 via createBorrowerLoanPool using the same liquidity
        _mintEligibleStream(151, STRANGER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidityId;
        vm.startPrank(STRANGER);
        sablier.approve(address(lending), 151);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 151, 100 ether, 100 ether);
        vm.stopPrank();

        // LiquidityPosition exhausted and deactivated
        (,,, uint128 capacityAfterLoan, bool activeAfterLoan) = lending.liquidityPositions(liquidityId);
        assertEq(capacityAfterLoan, 0, "availableLiquidity after loan");
        assertFalse(activeAfterLoan, "liquidity deactivated");

        // Maker holds the sold stream (permanent transfer) and borrower's stream is in escrow
        assertEq(sablier.ownerOf(150), BUYER, "lender holds sold stream");
        assertEq(sablier.ownerOf(151), address(lending), "borrower stream in escrow");

        // Loan created with 110 obligation
        (,,, uint128 obligation,,, bool closed) = lending.loans(lending.loanPoolLoanId(loanPoolId));
        assertEq(obligation, 110 ether, "loan obligation");
        assertFalse(closed, "loan not closed");

        // Balance assertions (no fees — default feeBps is 0)
        assertEq(underlying.balanceOf(SELLER), 100 ether, "seller received net");
        assertEq(underlying.balanceOf(STRANGER), 100 ether, "borrower received net");
        assertEq(underlying.balanceOf(BUYER), 0, "lender funded all");
        assertEq(underlying.balanceOf(TREASURY), 0, "no fees");
        assertEq(underlying.balanceOf(address(lending)), 0, "lending holds no underlying");
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: POOL CLAIMS
    //////////////////////////////////////////////////////////////*/

    /// @dev Creates a borrower pool with two lenders and returns (loanPoolId, loanId).
    function _createBorrowerPool(
        uint256 streamId,
        uint128 lender1Cap,
        uint128 lender2Cap,
        uint128 targetBorrow,
        uint128 minAcceptable
    ) internal returns (uint256 loanPoolId, uint256 loanId) {
        _supplyLiquidity(BUYER, lender1Cap);
        _supplyLiquidity(STRANGER, lender2Cap);
        _mintEligibleStream(streamId, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = 1;
        liquidityIds[1] = 2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), streamId);
        loanPoolId = lending.createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, minAcceptable);
        vm.stopPrank();
        loanId = 1;
    }

    function test_ClaimLoanPoolShare_ClaimsFromProceeds() public {
        (uint256 loanPoolId,) = _createBorrowerPool(131, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(131, 110 ether);

        // Close loan to accumulate loanPoolProceeds
        lending.closeLoan(1);
        assertEq(lending.loanPoolProceeds(loanPoolId), 110 ether, "proceeds accumulated");

        // BUYER claims 66 (60% of 110)
        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 66 ether);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 66 ether, "caller receives");
        assertEq(lending.loanPoolReceived(loanPoolId, BUYER), 66 ether, "loanPoolReceived updated");
        assertEq(lending.loanPoolProceeds(loanPoolId), 44 ether, "loanPoolProceeds decremented");
    }

    function test_ClaimLoanPoolShare_AmountCappedAtClaimable() public {
        (uint256 loanPoolId,) = _createBorrowerPool(132, 30 ether, 70 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(132, 110 ether);
        lending.closeLoan(1);

        // BUYER's share = 30 * 110 / 100 = 33; requesting 50 gets capped to 33
        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 50 ether);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 33 ether, "capped at claimable");
        assertEq(lending.loanPoolReceived(loanPoolId, BUYER), 33 ether, "loanPoolReceived = 33");
    }

    function test_ClaimFair_ProRataCapPreventsPotDrain() public {
        // Alice (BUYER) 60%, Bob (STRANGER) 40%, obligation = 110
        (uint256 loanPoolId, uint256 loanId) = _createBorrowerPool(141, 60 ether, 40 ether, 100 ether, 100 ether);

        // Partial repayment: only 50 accumulates in loanPoolProceeds (not full 110)
        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();
        assertEq(lending.loanPoolProceeds(loanPoolId), 50 ether, "partial proceeds");

        // Alice's claimable = 60 * 50 / 100 = 30 (pro-rata cap prevents draining all 50)
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether, "Alice claims 60% of recovered");

        // Bob's claimable = 40 * 50 / 100 = 20 (can claim immediately, not stranded)
        vm.prank(STRANGER);
        lending.claimLoanPoolShare(loanPoolId, 20 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 20 ether, "Bob claims 40% of recovered");
        assertEq(lending.loanPoolProceeds(loanPoolId), 0 ether, "pot drained fairly");

        // More proceeds arrive via closeLoan (outstanding = 110 - 50 = 60)
        sablier.setWithdrawable(141, 110 ether);
        lending.closeLoan(loanId);
        assertEq(lending.loanPoolProceeds(loanPoolId), 60 ether, "remaining drawn to proceeds");

        // Alice claims remaining: claimable = 60 * 110 / 100 - 30 = 36
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 36 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 66 ether, "Alice total = 66");

        // Bob claims remaining: claimable = 40 * 110 / 100 - 20 = 24
        vm.prank(STRANGER);
        lending.claimLoanPoolShare(loanPoolId, 24 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 44 ether, "Bob total = 44");
    }

    function test_ClaimLoanPoolShare_MinorityContributorNotStranded() public {
        // A (BUYER) 99%, B (STRANGER) 1%, obligation = 110
        (uint256 loanPoolId,) = _createBorrowerPool(142, 99 ether, 1 ether, 100 ether, 100 ether);

        // Full proceeds via closeLoan
        sablier.setWithdrawable(142, 110 ether);
        lending.closeLoan(1);
        assertEq(lending.loanPoolProceeds(loanPoolId), 110 ether, "full proceeds");

        // A's entitlement = 99 * 110 / 100 = 108 (integer division)
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 108 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 108 ether, "A claims entitlement");
        assertEq(lending.loanPoolProceeds(loanPoolId), 2 ether, "2 remains");

        // B's entitlement = 1 * 110 / 100 = 1
        // With the old pro-rata cap, B's share = 2 * 1 / 100 = 0 → stranded
        // Without the cap, B's available = min(1, 2) = 1 → NOT stranded
        vm.prank(STRANGER);
        lending.claimLoanPoolShare(loanPoolId, 1 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 1 ether, "B claims entitlement");
    }

    function test_ClaimLoanPoolShare_NonContributorReverts() public {
        (uint256 loanPoolId,) = _createBorrowerPool(134, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(134, 110 ether);
        lending.closeLoan(1);

        address nonContributor = address(0x9999);
        vm.prank(nonContributor);
        vm.expectRevert("OVRFLOLending: not loan pool lender");
        lending.claimLoanPoolShare(loanPoolId, 10 ether);
    }

    function test_ClaimLoanPoolShare_SucceedsOnClosedLoan() public {
        (uint256 loanPoolId, uint256 loanId) = _createBorrowerPool(137, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(137, 110 ether);
        lending.closeLoan(loanId);

        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 66 ether);
        assertEq(ovrfloToken.balanceOf(BUYER) - before, 66 ether, "claim succeeds on closed loan");
    }

    function test_ClaimLoanPoolShare_RevertsWhenClaimZero() public {
        (uint256 loanPoolId,) = _originateLoanViaBorrowPool(211, 100 ether);
        // BUYER is a contributor with remaining entitlement
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: claim zero");
        lending.claimLoanPoolShare(loanPoolId, 0);
    }

    function test_ClaimLoanPoolShare_RevertsWhenNothingClaimable() public {
        (uint256 loanPoolId,) = _originateLoanViaBorrowPool(213, 100 ether);
        // withdrawable defaults to 0, no repay -> loanPoolProceeds == 0, claimable == 0
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: nothing claimable");
        lending.claimLoanPoolShare(loanPoolId, 50 ether);
    }

    function test_ClaimLoanPoolShare_RevertsWhenNothingClaimableAfterFullClaim() public {
        (uint256 loanPoolId,) = _originateLoanViaBorrowPool(214, 100 ether);
        sablier.setWithdrawable(214, 110 ether);
        lending.closeLoan(1);
        // Single contributor -> entitlement == 110 (100% of drawn)
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 110 ether);

        // Full entitlement claimed -> nothing left
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOLending: nothing claimable");
        lending.claimLoanPoolShare(loanPoolId, 1);
    }

    function test_RepayLoan_RevertsWhenNothingOutstanding() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(212, 100 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 110 ether);
        lending.repayLoan(loanId, 110 ether);
        vm.stopPrank();

        assertEq(sablier.ownerOf(212), SELLER);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOLending: loan closed");
        lending.repayLoan(loanId, 1);

        vm.expectRevert("OVRFLOLending: loan closed");
        lending.closeLoan(loanId);
    }

    function test_ClaimFair_BothContributorsCanClaim() public {
        (uint256 loanPoolId, uint256 loanId) = _createBorrowerPool(160, 60 ether, 40 ether, 100 ether, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether, "A claims 60% of 50");

        vm.prank(STRANGER);
        lending.claimLoanPoolShare(loanPoolId, 20 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 20 ether, "B claims 40% of 50");
    }

    function test_ClaimLoanPoolShare_ProRataFromProceedsNoHarvest() public {
        (uint256 loanPoolId, uint256 loanId) = _createBorrowerPool(161, 60 ether, 40 ether, 100 ether, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether, "A claims from proceeds");
        assertEq(sablier.getWithdrawnAmount(161), 0, "no stream draw needed");
    }

    function test_ClaimLoanPoolShare_HarvestsFromOpenLoanStream() public {
        (uint256 loanPoolId,) = _originateLoanViaBorrowPool(215, 100 ether);
        sablier.setWithdrawable(215, 50 ether);
        // drawn = 0, repaid = 0, loanPoolProceeds = 0, but stream has 50 withdrawable
        // recovered = 0 + 0 + min(50, 110) = 50, claimable = 100 * 50 / 100 = 50
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 50 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 50 ether, "harvested from stream");
        assertEq(sablier.getWithdrawnAmount(215), 50 ether, "stream drawn");
        assertEq(lending.loanPoolProceeds(loanPoolId), 0, "proceeds drained after payout");
    }

    function test_ClaimLoanPoolShare_HarvestsOnlyDeficit() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(216, 100 ether);
        // Partial repay creates some proceeds
        ovrfloToken.mint(SELLER, 30 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 30 ether);
        lending.repayLoan(loanId, 30 ether);
        vm.stopPrank();
        // loanPoolProceeds = 30, withdrawable = 50, outstanding = 80
        // recovered = 0 + 30 + min(50, 80) = 80, claimable = 100 * 80 / 100 = 80
        // requestAmount = min(50, 80) = 50, deficit = 50 - 30 = 20
        sablier.setWithdrawable(216, 50 ether);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 50 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 50 ether, "50 claimed");
        assertEq(sablier.getWithdrawnAmount(216), 20 ether, "only 20 deficit harvested");
        assertEq(lending.loanPoolProceeds(loanPoolId), 0, "proceeds drained");
    }

    function test_ClaimFair_NoHarvestWhenProceedsSufficient() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(162, 100 ether);
        sablier.setWithdrawable(162, 110 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 50 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 50 ether, "claimed from proceeds");
        assertEq(sablier.getWithdrawnAmount(162), 0, "stream not touched");
        assertEq(lending.loanPoolProceeds(loanPoolId), 0, "proceeds drained");
    }

    function test_ClaimLoanPoolShare_SucceedsOnClosedLoanAfterPartialRepay() public {
        (uint256 loanPoolId, uint256 loanId) = _createBorrowerPool(163, 60 ether, 40 ether, 100 ether, 100 ether);

        // Partial repay before closing
        ovrfloToken.mint(SELLER, 30 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 30 ether);
        lending.repayLoan(loanId, 30 ether);
        vm.stopPrank();

        sablier.setWithdrawable(163, 110 ether);
        lending.closeLoan(loanId);

        // Claim should include both stream draw and repaid amount
        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, type(uint128).max);
        uint256 claimed = ovrfloToken.balanceOf(BUYER) - before;
        assertGt(claimed, 0, "claim succeeds on closed loan after partial repay");
        assertGe(claimed, 30 ether, "claimable includes repaid amount");
    }

    function test_ClaimFair_AmountCappedAtClaimable() public {
        (uint256 loanPoolId, uint256 loanId) = _originateLoanViaBorrowPool(164, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 50 ether, "capped at claimable");
    }

    /// @dev Covers the _toUint128 overflow guard via harness. This branch is
    ///      unreachable from the external ABI — every call site is pre-bounded
    ///      (grossPrice <= liquidity.availableLiquidity, actualBorrow <= targetBorrow, etc.).
    ///      The `loan not in pool` branch is also defensive: loanPoolContributions
    ///      are only written inside createBorrowerLoanPool, which always sets loanPoolLoanId.
    function test_ToUint128_RevertsOnOverflow() public {
        LendingInternalHarness harness = new LendingInternalHarness(address(factory), address(core), address(sablier));
        vm.expectRevert("SafeCast: value doesn't fit in 128 bits");
        harness.exposed_toUint128(uint256(type(uint128).max) + 1);
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: ROLLBACK ON EXTERNAL-CALL FAILURES
    //////////////////////////////////////////////////////////////*/

    /// @dev postSaleListing reverts when seller hasn't approved the NFT; listing must not be created.
    function test_Rollback_PostListing_NoApproval() public {
        _mintEligibleStream(300, SELLER, 110 ether, 0);
        // Note: no sablier.approve call
        vm.prank(SELLER);
        vm.expectRevert("not approved");
        lending.postSaleListing(MARKET, 300, 1000);

        assertEq(lending.nextSaleListingId(), 1, "listing id not incremented");
        assertEq(sablier.ownerOf(300), SELLER, "stream still owned by seller");
    }

    /// @dev createBorrowerLoanPool reverts when borrower hasn't approved the NFT; pool/loan must not be created.
    function test_Rollback_CreatePool_NoApproval() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(301, SELLER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidityId;

        vm.prank(SELLER);
        vm.expectRevert("not approved");
        lending.createBorrowerLoanPool(liquidityIds, 301, 100 ether, 0);

        assertEq(lending.nextLoanPoolId(), 1, "pool id not incremented");
        assertEq(lending.nextLoanId(), 1, "loan id not incremented");
        (,,, uint128 cap,) = lending.liquidityPositions(liquidityId);
        assertEq(cap, 100 ether, "liquidity capacity not consumed");
        assertEq(sablier.ownerOf(301), SELLER, "stream still owned by borrower");
    }

    /// @dev buyListing reverts when buyer has insufficient underlying; listing must remain active.
    function test_Rollback_BuyListing_InsufficientFunds() public {
        _mintEligibleStream(302, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 302);

        // Buyer has no underlying
        vm.prank(BUYER);
        vm.expectRevert();
        lending.buyListing(listingId, 100 ether);

        (,,,,, bool active) = lending.saleListings(listingId);
        assertTrue(active, "listing still active");
        assertEq(sablier.ownerOf(302), address(lending), "stream still escrowed");
    }

    /// @dev repayLoan reverts when borrower has insufficient ovrfloToken approval; loan unchanged.
    function test_Rollback_RepayLoan_InsufficientApproval() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(303, 100 ether);

        // Borrower has ovrfloToken but hasn't approved lending
        ovrfloToken.mint(SELLER, 50 ether);
        vm.prank(SELLER);
        vm.expectRevert();
        lending.repayLoan(loanId, 50 ether);

        (,,,, uint128 drawn, uint128 repaid, bool closed) = lending.loans(loanId);
        assertEq(drawn, 0, "drawn unchanged");
        assertEq(repaid, 0, "repaid unchanged");
        assertFalse(closed, "loan not closed");
        assertEq(lending.loanPoolProceeds(lending.loanToLoanPool(loanId)), 0, "proceeds unchanged");
    }

    /// @dev closeLoan reverts when withdrawable < outstanding; loan unchanged.
    function test_Rollback_CloseLoan_InsufficientWithdrawable() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(304, 100 ether);
        sablier.setWithdrawable(304, 50 ether);

        vm.expectRevert("OVRFLOLending: loan not closable");
        lending.closeLoan(loanId);

        (,,,,,, bool closed) = lending.loans(loanId);
        assertFalse(closed, "loan not closed");
        assertEq(sablier.ownerOf(304), address(lending), "stream still escrowed");
    }

    /// @dev sellStreamToLiquidity reverts on slippage; liquidity capacity unchanged.
    function test_Rollback_SellStream_Slippage() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(305, SELLER, 110 ether, 0);

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 305);
        vm.expectRevert("OVRFLOLending: slippage");
        lending.sellStreamToLiquidity(liquidityId, 305, 200 ether);
        vm.stopPrank();

        (,,, uint128 cap, bool active) = lending.liquidityPositions(liquidityId);
        assertEq(cap, 100 ether, "capacity unchanged");
        assertTrue(active, "liquidity still active");
        assertEq(sablier.ownerOf(305), SELLER, "stream still owned by seller");
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: WEI-SCALE CLAIM-ORDER ROUNDING
    //////////////////////////////////////////////////////////////*/

    /// @dev Two lenders with 3/7 wei contributions; obligation = 11; after close,
    ///      each can claim their floored pro-rata share and 1 wei dust remains.
    function test_WeiRounding_FlooredProRata() public {
        // remaining = 11 wei, grossPrice = 11 * 1e18 / 1.1e18 = 10 wei
        // obligation = 11 (full-borrow fast path)
        _mintEligibleStream(310, SELLER, 11, 0);

        // Lender 1 contributes 3 wei, Lender 2 contributes 7 wei (total = 10 = grossPrice)
        uint256 liq1 = _supplyLiquidity(BUYER, 3);
        uint256 liq2 = _supplyLiquidity(STRANGER, 7);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liq1;
        liquidityIds[1] = liq2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 310);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 310, 10, 0);
        vm.stopPrank();
        uint256 loanId = lending.loanPoolLoanId(loanPoolId);

        // Close loan: draws 11 wei from stream
        sablier.setWithdrawable(310, 11);
        lending.closeLoan(loanId);

        // Lender 1 claimable = 3 * 11 / 10 = 3 (floored from 3.3)
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 3);
        assertEq(ovrfloToken.balanceOf(BUYER), 3, "lender 1 claims 3");

        // Lender 2 claimable = 7 * 11 / 10 = 7 (floored from 7.7)
        vm.prank(STRANGER);
        lending.claimLoanPoolShare(loanPoolId, 7);
        assertEq(ovrfloToken.balanceOf(STRANGER), 7, "lender 2 claims 7");

        // 1 wei dust remains in proceeds (11 - 3 - 7 = 1)
        assertEq(lending.loanPoolProceeds(loanPoolId), 1, "1 wei dust remains");
    }

    /// @dev Same setup but claims in reverse order; result is identical (order-independent).
    function test_WeiRounding_ClaimOrderIndependent() public {
        _mintEligibleStream(311, SELLER, 11, 0);
        uint256 liq1 = _supplyLiquidity(BUYER, 3);
        uint256 liq2 = _supplyLiquidity(STRANGER, 7);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liq1;
        liquidityIds[1] = liq2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 311);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 311, 10, 0);
        vm.stopPrank();
        uint256 loanId = lending.loanPoolLoanId(loanPoolId);

        sablier.setWithdrawable(311, 11);
        lending.closeLoan(loanId);

        // Claim in reverse order: Lender 2 first, then Lender 1
        vm.prank(STRANGER);
        lending.claimLoanPoolShare(loanPoolId, 7);
        assertEq(ovrfloToken.balanceOf(STRANGER), 7, "lender 2 claims 7 first");

        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 3);
        assertEq(ovrfloToken.balanceOf(BUYER), 3, "lender 1 claims 3 second");

        assertEq(lending.loanPoolProceeds(loanPoolId), 1, "same 1 wei dust regardless of order");
    }

    /// @dev Nobody can claim more than their floored pro-rata entitlement.
    function test_WeiRounding_CannotExceedEntitlement() public {
        _mintEligibleStream(312, SELLER, 11, 0);
        uint256 liq1 = _supplyLiquidity(BUYER, 3);
        uint256 liq2 = _supplyLiquidity(STRANGER, 7);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = liq1;
        liquidityIds[1] = liq2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 312);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 312, 10, 0);
        vm.stopPrank();
        uint256 loanId = lending.loanPoolLoanId(loanPoolId);

        sablier.setWithdrawable(312, 11);
        lending.closeLoan(loanId);

        // Lender 1 tries to claim 4 (entitlement is 3)
        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 4);
        assertEq(ovrfloToken.balanceOf(BUYER) - before, 3, "capped at 3 entitlement");
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: MULTI-POOL ISOLATION
    //////////////////////////////////////////////////////////////*/

    /// @dev Two pools with shared lenders but distinct borrowers and streams.
    ///      Operating on pool A (repay + claim) must not affect pool B.
    function test_MultiPool_Isolation() public {
        // Pool A: BUYER lends 50, STRANGER lends 50; SELLER borrows
        _mintEligibleStream(320, SELLER, 110 ether, 0);
        uint256 liqA1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liqA2 = _supplyLiquidity(STRANGER, 50 ether);

        uint256[] memory idsA = new uint256[](2);
        idsA[0] = liqA1;
        idsA[1] = liqA2;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 320);
        uint256 poolA = lending.createBorrowerLoanPool(idsA, 320, 100 ether, 0);
        vm.stopPrank();
        uint256 loanA = lending.loanPoolLoanId(poolA);

        // Pool B: BUYER lends 50, STRANGER lends 50; a different borrower
        address borrowerB = address(0xB0B0);
        _mintEligibleStream(321, borrowerB, 110 ether, 0);
        uint256 liqB1 = _supplyLiquidity(BUYER, 50 ether);
        uint256 liqB2 = _supplyLiquidity(STRANGER, 50 ether);

        uint256[] memory idsB = new uint256[](2);
        idsB[0] = liqB1;
        idsB[1] = liqB2;

        vm.startPrank(borrowerB);
        sablier.approve(address(lending), 321);
        uint256 poolB = lending.createBorrowerLoanPool(idsB, 321, 100 ether, 0);
        vm.stopPrank();

        // Operate on pool A: repay 30, claim 30
        ovrfloToken.mint(SELLER, 30 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 30 ether);
        lending.repayLoan(loanA, 30 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        lending.claimLoanPoolShare(poolA, 15 ether);

        // Pool B must be completely unchanged (it was just created with known state)
        (,,, uint128 poolBContributed, uint128 poolBObligation) = lending.loanPools(poolB);
        assertEq(poolBContributed, 100 ether, "pool B contributed unchanged");
        assertEq(poolBObligation, 110 ether, "pool B obligation unchanged");
        assertEq(lending.loanPoolProceeds(poolB), 0, "pool B proceeds unchanged");
        assertEq(lending.loanPoolReceived(poolB, BUYER), 0, "pool B buyer received unchanged");
        assertEq(lending.loanPoolReceived(poolB, STRANGER), 0, "pool B stranger received unchanged");
        (,,,, uint128 loanBDrawn, uint128 loanBRepaid, bool loanBClosed) =
            lending.loans(lending.loanPoolLoanId(poolB));
        assertEq(loanBDrawn, 0, "loan B drawn unchanged");
        assertEq(loanBRepaid, 0, "loan B repaid unchanged");
        assertFalse(loanBClosed, "loan B not closed");
        assertEq(sablier.ownerOf(321), address(lending), "pool B stream still escrowed");
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: MATURITY BOUNDARY AND LIVENESS
    //////////////////////////////////////////////////////////////*/

    /// @dev New positions are blocked at/after maturity, but exits remain live.
    function test_Maturity_NewPositionsBlocked_ExitsLive() public {
        // Setup: supply liquidity and create a loan before maturity
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        _mintEligibleStream(330, SELLER, 110 ether, 0);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidityId;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 330);
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, 330, 100 ether, 0);
        vm.stopPrank();
        uint256 loanId = lending.loanPoolLoanId(loanPoolId);

        // Also post a listing before maturity
        _mintEligibleStream(331, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 331);

        // Supply extra liquidity before maturity for the post-maturity pool creation test
        // (the original liquidity was consumed by the loan above)
        uint256 freshLiquidityId = _supplyLiquidity(STRANGER, 100 ether);
        uint256[] memory freshLiquidityIds = new uint256[](1);
        freshLiquidityIds[0] = freshLiquidityId;

        // Warp to expiry
        vm.warp(expiry);

        // New supply reverts (market matured) — inline setup so expectRevert targets supplyLiquidity
        underlying.mint(STRANGER, 50 ether);
        vm.startPrank(STRANGER);
        underlying.approve(address(lending), 50 ether);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.supplyLiquidity(MARKET, 1000, 50 ether);
        vm.stopPrank();

        // New listing reverts
        _mintEligibleStream(332, SELLER, 110 ether, 0);
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 332);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.postSaleListing(MARKET, 332, 1000);
        vm.stopPrank();

        // New pool creation reverts (SeriesMatured from marketActive)
        // Uses fresh liquidity supplied pre-maturity (the original was consumed by the loan)
        _mintEligibleStream(333, SELLER, 110 ether, 0);
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 333);
        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        lending.createBorrowerLoanPool(freshLiquidityIds, 333, 50 ether, 0);
        vm.stopPrank();

        // Cancel listing still works (returns escrowed stream)
        vm.prank(SELLER);
        lending.cancelSaleListing(listingId);
        assertEq(sablier.ownerOf(331), SELLER, "stream returned after cancel post-maturity");

        // Withdraw liquidity still works
        // Supply a new liquidity at a fresh market that hasn't matured yet for this check
        // (the existing liquidity was consumed by the loan, so we test with a new unfunded one)
        // Instead, test repay + close + claim liveness on the existing loan

        // Repay still works
        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 50 ether);
        lending.repayLoan(loanId, 50 ether);
        vm.stopPrank();
        (,,,,, uint128 repaid,) = lending.loans(loanId);
        assertEq(repaid, 50 ether, "repay works post-maturity");

        // Close still works
        sablier.setWithdrawable(330, 60 ether);
        lending.closeLoan(loanId);
        (,,,,,, bool closed) = lending.loans(loanId);
        assertTrue(closed, "close works post-maturity");
        assertEq(sablier.ownerOf(330), SELLER, "NFT returned after close post-maturity");

        // Claim still works — BUYER is sole lender, entitlement = 110 (60 drawn + 50 repaid)
        vm.prank(BUYER);
        lending.claimLoanPoolShare(loanPoolId, 110 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether, "claim works post-maturity");
    }

    /// @dev At expiry - 1, all entry operations still succeed.
    function test_Maturity_PreExpiry_AllEntriesSucceed() public {
        vm.warp(expiry - 1);

        // Supply succeeds
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        assertTrue(liquidityId > 0, "supply succeeds pre-expiry");

        // Listing succeeds
        _mintEligibleStream(334, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 334);
        assertTrue(listingId > 0, "listing succeeds pre-expiry");

        // Quote succeeds
        (uint256 grossPrice,,,,) = lending.quote(MARKET, 334, 1000, 0);
        assertGt(grossPrice, 0, "quote succeeds pre-expiry");
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: STREAM COLLATERAL EXCLUSIVITY AND REUSE
    //////////////////////////////////////////////////////////////*/

    /// @dev Cannot list and loan the same stream simultaneously.
    function test_Exclusivity_CannotListAndLoanSameStream() public {
        _mintEligibleStream(340, SELLER, 110 ether, 0);
        // List the stream
        uint256 listingId = _postSaleListing(SELLER, 340);
        assertEq(sablier.ownerOf(340), address(lending), "stream escrowed by listing");

        // Now try to create a loan pool with the same stream
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        uint256[] memory liquidityIds = new uint256[](1);
        liquidityIds[0] = liquidityId;

        vm.startPrank(SELLER);
        // transferFrom will fail because SELLER no longer owns the stream
        vm.expectRevert("wrong from");
        lending.createBorrowerLoanPool(liquidityIds, 340, 100 ether, 0);
        vm.stopPrank();

        // Pool/loan not created
        assertEq(lending.nextLoanPoolId(), 1, "pool not created");
        assertEq(lending.nextLoanId(), 1, "loan not created");
    }

    /// @dev Cannot pledge the same stream to two loan pools.
    function test_Exclusivity_CannotPledgeToTwoPools() public {
        _mintEligibleStream(341, SELLER, 110 ether, 0);
        uint256 liq1 = _supplyLiquidity(BUYER, 100 ether);
        uint256[] memory ids1 = new uint256[](1);
        ids1[0] = liq1;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 341);
        lending.createBorrowerLoanPool(ids1, 341, 100 ether, 0);
        vm.stopPrank();
        assertEq(sablier.ownerOf(341), address(lending), "stream escrowed by first pool");

        // Try to create a second pool with the same stream
        uint256 liq2 = _supplyLiquidity(STRANGER, 100 ether);
        uint256[] memory ids2 = new uint256[](1);
        ids2[0] = liq2;

        vm.startPrank(SELLER);
        vm.expectRevert("wrong from");
        lending.createBorrowerLoanPool(ids2, 341, 100 ether, 0);
        vm.stopPrank();

        assertEq(lending.nextLoanPoolId(), 2, "second pool not created");
    }

    /// @dev After cancelling a listing, the stream can be reused for a new listing or loan.
    function test_Reuse_AfterCancelListing() public {
        _mintEligibleStream(342, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 342);

        // Cancel and get stream back
        vm.prank(SELLER);
        lending.cancelSaleListing(listingId);
        assertEq(sablier.ownerOf(342), SELLER, "stream returned after cancel");

        // Re-list successfully
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 342);
        uint256 newListingId = lending.postSaleListing(MARKET, 342, 1000);
        vm.stopPrank();
        assertGt(newListingId, listingId, "new listing created after cancel");
        assertEq(sablier.ownerOf(342), address(lending), "stream re-escrowed");
    }

    /// @dev After full repayment, the stream can be reused.
    function test_Reuse_AfterFullRepay() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(343, 100 ether);
        assertEq(sablier.ownerOf(343), address(lending), "stream escrowed by loan");

        // Full repayment closes loan and returns stream
        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(lending), 110 ether);
        lending.repayLoan(loanId, 110 ether);
        vm.stopPrank();
        assertEq(sablier.ownerOf(343), SELLER, "stream returned after full repay");

        // Re-list successfully
        vm.startPrank(SELLER);
        sablier.approve(address(lending), 343);
        lending.postSaleListing(MARKET, 343, 1000);
        vm.stopPrank();
        assertEq(sablier.ownerOf(343), address(lending), "stream re-escrowed in new listing");
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: DONATION RESISTANCE
    //////////////////////////////////////////////////////////////*/

    /// @dev Direct underlying transfer to lending does not inflate liquidity capacity.
    function test_Donation_UnderlyingDoesNotInflateCapacity() public {
        uint256 liquidityId = _supplyLiquidity(BUYER, 100 ether);
        (,,, uint128 capBefore,) = lending.liquidityPositions(liquidityId);

        // Direct transfer of underlying to lending
        underlying.mint(address(this), 50 ether);
        underlying.transfer(address(lending), 50 ether);

        (,,, uint128 capAfter,) = lending.liquidityPositions(liquidityId);
        assertEq(capAfter, capBefore, "capacity unchanged after donation");

        // Lending balance increases but this doesn't affect capacity accounting
        assertGt(underlying.balanceOf(address(lending)), uint256(capBefore), "balance exceeds capacity (donation sits idle)");
    }

    /// @dev Direct ovrfloToken transfer to lending does not inflate loan pool proceeds.
    function test_Donation_OvrfloTokenDoesNotInflateProceeds() public {
        (uint256 loanPoolId,) = _originateLoanViaBorrowPool(350, 100 ether);
        uint128 proceedsBefore = lending.loanPoolProceeds(loanPoolId);

        // Direct transfer of ovrfloToken to lending
        ovrfloToken.mint(address(this), 50 ether);
        ovrfloToken.transfer(address(lending), 50 ether);

        assertEq(lending.loanPoolProceeds(loanPoolId), proceedsBefore, "proceeds unchanged after donation");
    }

    /*//////////////////////////////////////////////////////////////
                EDGE: DESCENDING LIQUIDITY IDs
    //////////////////////////////////////////////////////////////*/

    /// @dev Descending liquidity IDs must revert (only strictly increasing is accepted).
    function test_CreatePool_DescendingIdsRevert() public {
        _supplyLiquidity(BUYER, 50 ether);
        _supplyLiquidity(STRANGER, 60 ether);
        _mintEligibleStream(360, SELLER, 110 ether, 0);

        uint256[] memory liquidityIds = new uint256[](2);
        liquidityIds[0] = 2; // descending: 2 before 1
        liquidityIds[1] = 1;

        vm.startPrank(SELLER);
        sablier.approve(address(lending), 360);
        vm.expectRevert("OVRFLOLending: duplicate or unsorted ids");
        lending.createBorrowerLoanPool(liquidityIds, 360, 100 ether, 90 ether);
        vm.stopPrank();
    }
}
