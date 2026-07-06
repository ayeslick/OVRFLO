// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockBookFactory, MockBookCore, MockBookSablier} from "./mocks/BookMocks.sol";

contract ShortTransferERC20 is TestERC20 {
    constructor() TestERC20("Short Transfer", "SHORT") {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount - 1);
    }
}

/// @dev Harness to cover the _toUint128 overflow guard, which is unreachable from
///      the external ABI (every call site is pre-bounded). Also documents the
///      `loan not in pool` branch as defensive — poolContributions are only written
///      inside createBorrowPool, which always sets poolLoanId, so a contributor
///      with no loan cannot exist.
contract BookInternalHarness is OVRFLOBook {
    constructor(address factory, address core, address sablier) OVRFLOBook(factory, core, sablier) {}

    function exposed_toUint128(uint256 amount) external pure returns (uint128) {
        return _toUint128(amount);
    }
}

contract OVRFLOBookTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant NEW_TREASURY = address(0xCAFE);
    address internal constant STRANGER = address(0x3333);
    address internal constant NEW_OWNER = address(0x4444);
    address internal constant MARKET = address(0x5555);
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);

    event AprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    event FeeSet(uint16 feeBps);
    event TreasurySet(address indexed treasury);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event SaleListingPosted(
        uint256 indexed listingId,
        address indexed maker,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps
    );

    MockBookFactory internal factory;
    MockBookCore internal core;
    MockBookSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    OVRFLOBook internal book;
    uint256 internal expiry;

    function setUp() public {
        factory = new MockBookFactory();
        core = new MockBookCore();
        sablier = new MockBookSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO Underlying", "ovrfloUND");
        expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        factory.setMarketApproved(address(core), MARKET, true);
        core.setSeries(MARKET, true, expiry, address(ovrfloToken), address(underlying));

        book = new OVRFLOBook(address(factory), address(core), address(sablier));
    }

    function test_Constructor_CachesRegistryInfoAndLaunchSettings() public view {
        assertEq(address(book.factory()), address(factory));
        assertEq(book.core(), address(core));
        assertEq(book.ovrfloToken(), address(ovrfloToken));
        assertEq(book.underlying(), address(underlying));
        assertEq(address(book.sablier()), address(sablier));
        assertEq(book.APR_MAX_CEILING(), 10_000);
        assertEq(book.MAX_FEE_BPS(), 10_000);
        assertEq(book.treasury(), TREASURY);
        assertEq(book.aprMinBps(), book.LAUNCH_APR_BPS());
        assertEq(book.aprMaxBps(), book.LAUNCH_APR_BPS());
        assertEq(book.owner(), address(this));
    }

    function test_Constructor_RevertsForZeroAddressesOrUnregisteredCore() public {
        vm.expectRevert("OVRFLOBook: factory zero");
        new OVRFLOBook(address(0), address(core), address(sablier));

        vm.expectRevert("OVRFLOBook: core zero");
        new OVRFLOBook(address(factory), address(0), address(sablier));

        vm.expectRevert("OVRFLOBook: sablier zero");
        new OVRFLOBook(address(factory), address(core), address(0));

        vm.expectRevert("OVRFLOBook: unknown core");
        new OVRFLOBook(address(factory), address(0xDEAD), address(sablier));
    }

    function test_Admin_SetAprBounds() public {
        vm.expectEmit(address(book));
        emit AprBoundsSet(1000, 1000);
        book.setAprBounds(1000, 1000);

        vm.expectEmit(address(book));
        emit AprBoundsSet(500, 2500);
        book.setAprBounds(500, 2500);

        assertEq(book.aprMinBps(), 500);
        assertEq(book.aprMaxBps(), 2500);

        vm.expectRevert("OVRFLOBook: bad apr bounds");
        book.setAprBounds(2501, 2500);

        vm.expectRevert("OVRFLOBook: apr too high");
        book.setAprBounds(0, 10_001);
    }

    function test_Admin_SetAprBounds_StepAlignment() public {
        // Happy path: both multiples of 100
        book.setAprBounds(1000, 5000);
        assertEq(book.aprMinBps(), 1000);
        assertEq(book.aprMaxBps(), 5000);

        // Min not aligned
        vm.expectRevert("OVRFLOBook: aprMin not step-aligned");
        book.setAprBounds(50, 5000);

        // Max not aligned
        vm.expectRevert("OVRFLOBook: aprMax not step-aligned");
        book.setAprBounds(1000, 5050);

        // Both not aligned — min check fires first
        vm.expectRevert("OVRFLOBook: aprMin not step-aligned");
        book.setAprBounds(50, 99);
    }

    function test_Admin_SetFeeAndTreasury() public {
        vm.expectEmit(address(book));
        emit FeeSet(100);
        book.setFee(100);
        assertEq(book.feeBps(), 100);

        vm.expectRevert("OVRFLOBook: fee too high");
        book.setFee(10_001);

        vm.expectEmit(true, false, false, true, address(book));
        emit TreasurySet(NEW_TREASURY);
        book.setTreasury(NEW_TREASURY);
        assertEq(book.treasury(), NEW_TREASURY);

        vm.expectRevert("OVRFLOBook: treasury zero");
        book.setTreasury(address(0));
    }

    function test_Admin_RevertsForNonOwner() public {
        vm.startPrank(STRANGER);

        vm.expectRevert("Ownable: caller is not the owner");
        book.setAprBounds(500, 2500);

        vm.expectRevert("Ownable: caller is not the owner");
        book.setFee(1);

        vm.expectRevert("Ownable: caller is not the owner");
        book.setTreasury(NEW_TREASURY);

        vm.stopPrank();
    }

    function test_Ownership_UsesTwoStepTransfer() public {
        vm.expectEmit(true, true, false, true, address(book));
        emit OwnershipTransferStarted(address(this), NEW_OWNER);
        book.transferOwnership(NEW_OWNER);

        assertEq(book.pendingOwner(), NEW_OWNER);
        assertEq(book.owner(), address(this));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable2Step: caller is not the new owner");
        book.acceptOwnership();

        vm.prank(NEW_OWNER);
        book.acceptOwnership();
        assertEq(book.owner(), NEW_OWNER);
        assertEq(book.pendingOwner(), address(0));
    }

    function test_Multicall_BatchesAdminCallsAndBubblesRevert() public {
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(OVRFLOBook.setFee, (50));
        data[1] = abi.encodeCall(OVRFLOBook.setTreasury, (NEW_TREASURY));

        book.multicall(data);

        assertEq(book.feeBps(), 50);
        assertEq(book.treasury(), NEW_TREASURY);

        data[0] = abi.encodeCall(OVRFLOBook.setFee, (10_001));
        vm.expectRevert("OVRFLOBook: fee too high");
        book.multicall(data);
    }

    function test_Multicall_IsNonPayable() public {
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeCall(OVRFLOBook.setFee, (1));

        vm.deal(address(this), 1 ether);
        (bool success,) = address(book).call{value: 1}(abi.encodeWithSignature("multicall(bytes[])", data));
        assertFalse(success);
    }

    function test_PostOffer_RejectsOutOfBandAprAndEscrowsCapacity() public {
        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(book), 100 ether);

        vm.expectRevert("OVRFLOBook: apr out of bounds");
        book.postOffer(MARKET, 999, 100 ether);

        uint256 offerId = book.postOffer(MARKET, 1000, 100 ether);
        vm.stopPrank();

        (address maker, address market, uint16 aprBps, uint128 capacity, bool active) = book.offers(offerId);
        assertEq(maker, BUYER);
        assertEq(market, MARKET);
        assertEq(aprBps, 1000);
        assertEq(capacity, 100 ether);
        assertTrue(active);
        assertEq(underlying.balanceOf(address(book)), 100 ether);
        assertEq(underlying.balanceOf(BUYER), 0);
    }

    function test_HitOffer_SettlesSaleAndConsumesCapacity() public {
        book.setFee(100);
        uint256 offerId = _postOffer(BUYER, 100 ether);
        _mintEligibleStream(1, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(book), 1);

        vm.prank(SELLER);
        book.sellIntoOffer(offerId, 1, 99 ether);

        (,,,, bool active) = book.offers(offerId);
        assertFalse(active);
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(1), BUYER);
    }

    function test_HitOffer_PricesFromRemainingAfterPriorWithdrawals() public {
        uint256 offerId = _postOffer(BUYER, 100 ether);
        _mintEligibleStream(28, SELLER, 150 ether, 40 ether);

        vm.prank(SELLER);
        sablier.approve(address(book), 28);
        vm.prank(SELLER);
        book.sellIntoOffer(offerId, 28, 0);

        (,,, uint128 capacity,) = book.offers(offerId);
        assertEq(capacity, 0);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(sablier.ownerOf(28), BUYER);
    }

    function test_HitOffer_RespectsSlippageCapacityDeadIdsDustAndMaturity() public {
        book.setFee(100);

        uint256 slippageOfferId = _postOffer(BUYER, 100 ether);
        _mintEligibleStream(2, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 2);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: slippage");
        book.sellIntoOffer(slippageOfferId, 2, 100 ether);

        uint256 smallOfferId = _postOffer(BUYER, 50 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: insufficient capacity");
        book.sellIntoOffer(smallOfferId, 2, 0);

        vm.prank(BUYER);
        book.cancelOffer(slippageOfferId);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: offer inactive");
        book.sellIntoOffer(slippageOfferId, 2, 0);

        uint256 dustOfferId = _postOffer(BUYER, 1 ether);
        _mintEligibleStream(3, SELLER, 1, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 3);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: price zero");
        book.sellIntoOffer(dustOfferId, 3, 0);

        uint256 maturedOfferId = _postOffer(BUYER, 100 ether);
        _mintEligibleStream(4, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 4);
        vm.warp(expiry);
        vm.prank(SELLER);
        vm.expectRevert();
        book.sellIntoOffer(maturedOfferId, 4, 0);
    }

    function test_HitOffer_AllowsPartialFillsAndCancelRefundsRemainder() public {
        uint256 offerId = _postOffer(BUYER, 250 ether);
        _mintEligibleStream(5, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(book), 5);
        vm.prank(SELLER);
        book.sellIntoOffer(offerId, 5, 0);

        (,,, uint128 capacity, bool active) = book.offers(offerId);
        assertEq(capacity, 150 ether);
        assertTrue(active);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(address(book)), 150 ether);
        assertEq(sablier.ownerOf(5), BUYER);

        vm.prank(BUYER);
        book.cancelOffer(offerId);

        (,,, capacity, active) = book.offers(offerId);
        assertEq(capacity, 0);
        assertFalse(active);
        assertEq(underlying.balanceOf(BUYER), 150 ether);
    }

    function test_ListStream_RejectsInvalidAprAndEscrowsNft() public {
        _mintEligibleStream(6, SELLER, 110 ether, 0);

        vm.startPrank(SELLER);
        sablier.approve(address(book), 6);
        vm.expectRevert("OVRFLOBook: apr out of bounds");
        book.postSaleListing(MARKET, 6, 999);
        vm.stopPrank();

        book.setFee(42);

        vm.expectEmit(true, true, true, true, address(book));
        emit SaleListingPosted(1, SELLER, MARKET, 6, 1000, 42);
        vm.startPrank(SELLER);
        uint256 listingId = book.postSaleListing(MARKET, 6, 1000);
        vm.stopPrank();

        (address maker, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active) =
            book.saleListings(listingId);
        assertEq(maker, SELLER);
        assertEq(market, MARKET);
        assertEq(streamId, 6);
        assertEq(aprBps, 1000);
        assertEq(listingFeeBps, 42);
        assertTrue(active);
        assertEq(sablier.ownerOf(6), address(book));
    }

    function test_CancelListing_ReturnsExactNftWithoutDrawing() public {
        _mintEligibleStream(7, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 7);

        vm.prank(SELLER);
        book.cancelSaleListing(listingId);

        (,,,,, bool active) = book.saleListings(listingId);
        assertFalse(active);
        assertEq(sablier.ownerOf(7), SELLER);
        assertEq(sablier.getWithdrawnAmount(7), 0);
    }

    function test_TakeListing_SettlesSale() public {
        book.setFee(100);
        _mintEligibleStream(8, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 8);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        book.buyListing(listingId, 100 ether);
        vm.stopPrank();

        (,,,,, bool active) = book.saleListings(listingId);
        assertFalse(active);
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(8), BUYER);
    }

    function test_TakeListing_UsesSnapshottedFeeWhenGlobalFeeChanges() public {
        book.setFee(0);
        _mintEligibleStream(32, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 32);
        book.setFee(100);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        book.buyListing(listingId, 100 ether);
        vm.stopPrank();

        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(32), BUYER);
    }

    function test_TakeListing_RespectsSlippageDustAndDeadIds() public {
        _mintEligibleStream(9, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 9);

        underlying.mint(BUYER, 200 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 200 ether);
        vm.expectRevert("OVRFLOBook: slippage");
        book.buyListing(listingId, 99 ether);
        vm.stopPrank();

        vm.prank(SELLER);
        book.cancelSaleListing(listingId);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: listing inactive");
        book.buyListing(listingId, 100 ether);

        _mintEligibleStream(10, SELLER, 1, 0);
        uint256 dustListingId = _postSaleListing(SELLER, 10);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: price zero");
        book.buyListing(dustListingId, 1);
    }

    function test_PoolClaimLoan_CapsAtOutstandingAndRequiresContributor() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(18, 100 ether);
        sablier.setWithdrawable(18, 200 ether);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: not contributor");
        book.poolClaimLoan(poolId, 200 ether);

        book.closeLoan(loanId);

        (,,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(obligation, 110 ether);
        assertEq(drawn, 110 ether);
        assertEq(repaid, 0);
        assertTrue(closed);
        assertEq(book.poolProceeds(poolId), 110 ether);
        assertEq(sablier.getWithdrawnAmount(18), 110 ether);
        assertEq(sablier.ownerOf(18), SELLER);

        vm.prank(BUYER);
        book.claimPoolShare(poolId, 110 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(book.poolReceived(poolId, BUYER), 110 ether);
    }

    function test_PoolClaimLoan_AllowsMultiplePartials() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(19, 100 ether);

        ovrfloToken.mint(SELLER, 70 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 70 ether);
        book.repayLoan(loanId, 40 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 40 ether);

        vm.startPrank(SELLER);
        book.repayLoan(loanId, 30 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 30 ether);

        (,,,, uint128 drawn, uint128 repaid, uint128 outstanding,) = book.loanState(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 70 ether);
        assertEq(outstanding, 40 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 70 ether);
        assertEq(book.poolReceived(poolId, BUYER), 70 ether);
        assertEq(sablier.getWithdrawnAmount(19), 0);
        assertEq(sablier.ownerOf(19), address(book));
    }

    function test_CloseLoan_RevertsUntilClosableThenPaysAndReturnsNft() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(20, 100 ether);

        sablier.setWithdrawable(20, 109 ether);
        vm.expectRevert("OVRFLOBook: loan not closable");
        book.closeLoan(loanId);

        sablier.setWithdrawable(20, 110 ether);
        vm.prank(STRANGER);
        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 110 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(20), 110 ether);
        assertEq(sablier.ownerOf(20), SELLER);

        vm.expectRevert("OVRFLOBook: loan closed");
        book.closeLoan(loanId);
    }

    function test_CloseLoan_AfterPartialClaimDrawsOnlyOutstanding() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(30, 100 ether);

        ovrfloToken.mint(SELLER, 40 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 40 ether);
        book.repayLoan(loanId, 40 ether);
        vm.stopPrank();

        sablier.setWithdrawable(30, 100 ether);
        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
        assertEq(drawn, 70 ether);
        assertTrue(closed);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 110 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(30), 70 ether);
        assertEq(sablier.ownerOf(30), SELLER);
    }

    function test_CloseLoan_ReturnsNftWhenAlreadySatisfiedByClaims() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(21, 100 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 110 ether);
        book.repayLoan(loanId, 110 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 110 ether);
        assertTrue(closed);
        assertEq(sablier.ownerOf(21), SELLER);

        vm.expectRevert("OVRFLOBook: loan closed");
        book.closeLoan(loanId);

        vm.prank(BUYER);
        book.claimPoolShare(poolId, 110 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
    }

    function test_RepayLoan_FullRepaymentAfterPartialClaimClosesAndReturnsNft() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(22, 100 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 110 ether);
        book.repayLoan(loanId, 40 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 40 ether);

        vm.startPrank(SELLER);
        book.repayLoan(loanId, 70 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 110 ether);
        assertTrue(closed);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 70 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(ovrfloToken.balanceOf(SELLER), 0);
        assertEq(sablier.getWithdrawnAmount(22), 0);
        assertEq(sablier.ownerOf(22), SELLER);
    }

    function test_RepayLoan_PartialRepaymentAdvancesClosableTime() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(23, 100 ether);

        ovrfloToken.mint(SELLER, 25 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 25 ether);
        book.repayLoan(loanId, 25 ether);
        vm.stopPrank();

        (,,,,, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(repaid, 25 ether);
        assertFalse(closed);
        assertEq(sablier.ownerOf(23), address(book));
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 25 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 25 ether);

        sablier.setWithdrawable(23, 84 ether);
        vm.expectRevert("OVRFLOBook: loan not closable");
        book.closeLoan(loanId);

        sablier.setWithdrawable(23, 85 ether);
        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closedAfter) = book.loans(loanId);
        assertEq(drawn, 85 ether);
        assertTrue(closedAfter);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 85 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(23), 85 ether);
        assertEq(sablier.ownerOf(23), SELLER);
    }

    function test_RepayLoan_RevertsForInvalidCallerAmountsAndClosedLoan() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(24, 100 ether);

        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: not borrower");
        book.repayLoan(loanId, 1);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: repay zero");
        book.repayLoan(loanId, 0);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: repay too much");
        book.repayLoan(loanId, 111 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 110 ether);
        book.repayLoan(loanId, 110 ether);
        vm.expectRevert("OVRFLOBook: loan closed");
        book.repayLoan(loanId, 1);
        vm.stopPrank();

        vm.expectRevert("OVRFLOBook: loan closed");
        book.closeLoan(loanId);
    }

    function test_Quote_EqualsLoanSettlementAndLoanStateReflectsRepayment() public {
        book.setFee(100);
        _mintEligibleStream(25, SELLER, 110 ether, 0);

        (uint256 grossPrice, uint128 quotedObligation, uint256 quotedFee, uint256 quotedNet, uint128 quotedResidual) =
            book.quote(MARKET, 25, 1000, 100 ether);
        assertEq(grossPrice, 100 ether);
        assertEq(quotedObligation, 110 ether);
        assertEq(quotedFee, 1 ether);
        assertEq(quotedNet, 99 ether);
        assertEq(quotedResidual, 0);

        uint256 offerId = _postOffer(BUYER, 100 ether);
        vm.startPrank(SELLER);
        sablier.approve(address(book), 25);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offerId;
        book.createBorrowPool(offerIds, 25, 100 ether, 99 ether);
        vm.stopPrank();
        uint256 loanId = 1;

        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(25), address(book));

        (,,, uint128 obligation,,,, bool closed) = book.loanState(loanId);
        assertEq(obligation, quotedObligation);
        assertFalse(closed);

        ovrfloToken.mint(SELLER, 25 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 25 ether);
        book.repayLoan(loanId, 25 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, uint128 outstanding,) = book.loanState(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 25 ether);
        assertEq(outstanding, 85 ether);
    }

    function test_Quote_WithZeroBorrowAmountPreviewsSaleSettlement() public {
        book.setFee(100);
        _mintEligibleStream(31, SELLER, 110 ether, 0);

        (uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual) =
            book.quote(MARKET, 31, 1000, 0);

        assertEq(grossPrice, 100 ether);
        assertEq(obligation, 110 ether);
        assertEq(feeAmount, 1 ether);
        assertEq(netToBorrower, 99 ether);
        assertEq(residual, 0);
    }

    function test_Quote_RevertsForAprOutOfBounds() public {
        _mintEligibleStream(32, SELLER, 110 ether, 0);
        vm.expectRevert("OVRFLOBook: apr out of bounds");
        book.quote(MARKET, 32, 500, 0);
    }

    function test_Quote_RevertsForNonWholeApr() public {
        // Widen bounds to include 50 bps
        book.setAprBounds(0, 1000);
        _mintEligibleStream(33, SELLER, 110 ether, 0);
        vm.expectRevert("OVRFLOBook: apr not whole");
        book.quote(MARKET, 33, 50, 0);
    }

    function test_Quote_RevertsForZeroPrice() public {
        // remaining = 1 wei, grossPrice = 1e18 / factor ≈ 0 (floors to 0)
        _mintEligibleStream(34, SELLER, 2, 1);
        vm.expectRevert("OVRFLOBook: price zero");
        book.quote(MARKET, 34, 1000, 0);
    }

    function test_Quote_PartialBorrow() public {
        // deposited = 110, aprBps = 1000, ttm = 365 days -> grossPrice = 100 ether
        _mintEligibleStream(35, SELLER, 110 ether, 0);
        (uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual) =
            book.quote(MARKET, 35, 1000, 50 ether);
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
        vm.expectRevert("OVRFLOBook: borrow above price");
        book.quote(MARKET, 36, 1000, 101 ether);
    }

    function test_OrderStateViewsReflectCurrentState() public {
        uint256 offerId = _postOffer(BUYER, 100 ether);
        (address maker, address market, uint16 aprBps, uint128 capacity, bool active) = book.offerState(offerId);
        assertEq(maker, BUYER);
        assertEq(market, MARKET);
        assertEq(aprBps, 1000);
        assertEq(capacity, 100 ether);
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
        ) = book.saleListingState(saleListingId);
        assertEq(listingMaker, SELLER);
        assertEq(listingMarket, MARKET);
        assertEq(listingStreamId, 26);
        assertEq(listingApr, 1000);
        assertEq(listingFeeBps, 0);
        assertTrue(listingActive);
    }

    function _postOffer(address maker, uint128 capacity) internal returns (uint256 offerId) {
        underlying.mint(maker, capacity);
        vm.startPrank(maker);
        underlying.approve(address(book), capacity);
        offerId = book.postOffer(MARKET, 1000, capacity);
        vm.stopPrank();
    }

    function _originateLoanViaBorrowPool(uint256 streamId, uint128 borrowAmount)
        internal
        returns (uint256 poolId, uint256 loanId)
    {
        uint256 offerId = _postOffer(BUYER, borrowAmount);
        _mintEligibleStream(streamId, SELLER, 110 ether, 0);
        loanId = book.nextLoanId();
        vm.startPrank(SELLER);
        sablier.approve(address(book), streamId);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offerId;
        poolId = book.createBorrowPool(offerIds, streamId, borrowAmount, 0);
        vm.stopPrank();
    }

    function _postSaleListing(address maker, uint256 streamId) internal returns (uint256 listingId) {
        vm.startPrank(maker);
        sablier.approve(address(book), streamId);
        listingId = book.postSaleListing(MARKET, streamId, 1000);
        vm.stopPrank();
    }

    function _mintEligibleStream(uint256 streamId, address owner, uint128 deposited, uint128 withdrawn) internal {
        sablier.setStream(streamId, owner, address(core), ovrfloToken, uint40(expiry), 0, false, deposited, withdrawn);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: UNCOVERED BRANCH TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Constructor_RevertForZeroUnderlying() public {
        MockBookFactory badFactory = new MockBookFactory();
        badFactory.setInfo(address(core), TREASURY, address(0), address(ovrfloToken));
        vm.expectRevert("OVRFLOBook: underlying zero");
        new OVRFLOBook(address(badFactory), address(core), address(sablier));
    }

    function test_Constructor_RevertForZeroToken() public {
        MockBookFactory badFactory = new MockBookFactory();
        badFactory.setInfo(address(core), TREASURY, address(underlying), address(0));
        vm.expectRevert("OVRFLOBook: token zero");
        new OVRFLOBook(address(badFactory), address(core), address(sablier));
    }

    function test_CancelOffer_RevertForWrongMaker() public {
        uint256 offerId = _postOffer(BUYER, 100 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: not offer maker");
        book.cancelOffer(offerId);
    }

    function test_CancelSaleListing_RevertForWrongMaker() public {
        _mintEligibleStream(40, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 40);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: not listing maker");
        book.cancelSaleListing(listingId);
    }

    function test_PostOffer_RevertForZeroCapacity() public {
        vm.expectRevert("OVRFLOBook: capacity zero");
        book.postOffer(MARKET, 1000, 0);
    }

    function test_PostOffer_RevertsOnTransferMismatch() public {
        ShortTransferERC20 shortToken = new ShortTransferERC20();
        TestERC20 shortOvrfloToken = new TestERC20("Short ovrfloToken", "ovrfloSHORT");

        MockBookFactory shortFactory = new MockBookFactory();
        MockBookCore shortCore = new MockBookCore();
        MockBookSablier shortSablier = new MockBookSablier();

        shortFactory.setInfo(address(shortCore), TREASURY, address(shortToken), address(shortOvrfloToken));
        shortFactory.setMarketApproved(address(shortCore), MARKET, true);
        shortCore.setSeries(MARKET, true, expiry, address(shortOvrfloToken), address(shortToken));

        OVRFLOBook shortBook = new OVRFLOBook(address(shortFactory), address(shortCore), address(shortSablier));

        shortToken.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        shortToken.approve(address(shortBook), 100 ether);
        vm.expectRevert("OVRFLOBook: transfer mismatch");
        shortBook.postOffer(MARKET, 1000, 100 ether);
        vm.stopPrank();
    }

    function test_CloseLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOBook: unknown loan");
        book.closeLoan(999);
    }

    function test_RepayLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOBook: unknown loan");
        book.repayLoan(999, 1);
    }

    function test_OfferState_RevertsForUnknownId() public {
        vm.expectRevert("OVRFLOBook: unknown offer");
        book.offerState(999);
    }

    function test_SaleListingState_RevertsForUnknownId() public {
        vm.expectRevert("OVRFLOBook: unknown listing");
        book.saleListingState(999);
    }

    function test_CancelOffer_RevertsWhenAlreadyCancelled() public {
        uint256 offerId = _postOffer(BUYER, 100 ether);
        vm.prank(BUYER);
        book.cancelOffer(offerId);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: offer inactive");
        book.cancelOffer(offerId);
    }

    function test_CancelSaleListing_RevertsWhenAlreadyCancelled() public {
        _mintEligibleStream(41, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 41);
        vm.prank(SELLER);
        book.cancelSaleListing(listingId);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: listing inactive");
        book.cancelSaleListing(listingId);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: WHOLE-NUMBER RATE CONSTRAINT
    //////////////////////////////////////////////////////////////*/

    function test_Apr_RejectsNonWholeRateOnOffer() public {
        book.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(book), 100 ether);
        vm.expectRevert("OVRFLOBook: apr not whole");
        book.postOffer(MARKET, 550, 100 ether);
        vm.stopPrank();
    }

    function test_Apr_AcceptsBoundaryWholeRates() public {
        book.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 300 ether);
        underlying.approve(address(book), 300 ether);
        uint256 id0 = book.postOffer(MARKET, 0, 100 ether);
        uint256 id500 = book.postOffer(MARKET, 500, 100 ether);
        uint256 id9900 = book.postOffer(MARKET, 9900, 100 ether);
        vm.stopPrank();

        (,, uint16 apr0,,) = book.offers(id0);
        assertEq(apr0, 0);
        (,, uint16 apr500,,) = book.offers(id500);
        assertEq(apr500, 500);
        (,, uint16 apr9900,,) = book.offers(id9900);
        assertEq(apr9900, 9900);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: POOL DATA STRUCTURES
    //////////////////////////////////////////////////////////////*/

    function test_Pool_NextPoolIdStartsAtOne() public view {
        assertEq(book.nextPoolId(), 1);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: LOAN SERVICING INTEGRATION
    //////////////////////////////////////////////////////////////*/

    function test_CloseLoan_PoolCreditsPoolProceeds() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(72, 100 ether);
        sablier.setWithdrawable(72, 110 ether);

        uint256 bookBefore = ovrfloToken.balanceOf(address(book));
        book.closeLoan(loanId);

        assertEq(book.poolProceeds(poolId), 110 ether, "poolProceeds credited");
        assertEq(ovrfloToken.balanceOf(address(book)) - bookBefore, 110 ether, "book receives ovrfloToken");
        assertEq(ovrfloToken.balanceOf(BUYER), 0, "lender does not receive directly");
        assertEq(sablier.ownerOf(72), SELLER, "stream returned to borrower");

        (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
    }

    function test_RepayLoan_PoolCreditsPoolProceeds() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(74, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        assertEq(book.poolProceeds(poolId), 50 ether, "poolProceeds credited");
        assertEq(ovrfloToken.balanceOf(address(book)), 50 ether, "book holds ovrfloToken");
        assertEq(ovrfloToken.balanceOf(BUYER), 0, "lender does not receive directly");
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: GATHER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function test_GatherOfferCapacities_SufficientCapacity() public {
        book.setAprBounds(0, 9900);
        _postOfferAtApr(BUYER, 50 ether, 500);
        _postOfferAtApr(SELLER, 60 ether, 500);

        (uint256[] memory ids, bool sufficient) = book.gatherOfferCapacities(MARKET, 500, 100 ether, 1);
        assertTrue(sufficient);
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_GatherOfferCapacities_InsufficientCapacity() public {
        book.setAprBounds(0, 9900);
        _postOfferAtApr(BUYER, 50 ether, 500);
        _postOfferAtApr(SELLER, 30 ether, 500);

        (uint256[] memory ids, bool sufficient) = book.gatherOfferCapacities(MARKET, 500, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 2);
    }

    function test_GatherOfferCapacities_NoMatchingOffers() public {
        _postOffer(BUYER, 100 ether);

        (uint256[] memory ids, bool sufficient) = book.gatherOfferCapacities(MARKET, 500, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 0);
    }

    function test_GatherOfferCapacities_SkipsCancelledAndDepleted() public {
        _postOffer(BUYER, 50 ether);
        _postOffer(SELLER, 60 ether);

        // Cancel first offer
        vm.prank(BUYER);
        book.cancelOffer(1);

        (uint256[] memory ids, bool sufficient) = book.gatherOfferCapacities(MARKET, 1000, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 1);
        assertEq(ids[0], 2);
    }

    function test_GatherOfferCapacities_SkipsDifferentApr() public {
        book.setAprBounds(0, 9900);
        _postOfferAtApr(BUYER, 50 ether, 500);
        _postOfferAtApr(SELLER, 60 ether, 1000);

        (uint256[] memory ids, bool sufficient) = book.gatherOfferCapacities(MARKET, 500, 100 ether, 1);
        assertFalse(sufficient);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);
    }

    function test_GatherOfferCapacities_StartIdBeyondRange() public {
        _postOffer(BUYER, 100 ether);

        (uint256[] memory ids, bool sufficient) = book.gatherOfferCapacities(MARKET, 1000, 100 ether, 99);
        assertFalse(sufficient);
        assertEq(ids.length, 0);
    }

    function test_GatherOfferCapacities_ExpiredSeriesReverts() public {
        _postOffer(BUYER, 100 ether);
        vm.warp(expiry);
        vm.expectRevert();
        book.gatherOfferCapacities(MARKET, 1000, 100 ether, 1);
    }

    function _postOfferAtApr(address maker, uint128 capacity, uint16 aprBps) internal returns (uint256 offerId) {
        underlying.mint(maker, capacity);
        vm.startPrank(maker);
        underlying.approve(address(book), capacity);
        offerId = book.postOffer(MARKET, aprBps, capacity);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: BORROWER POOL CREATION
    //////////////////////////////////////////////////////////////*/

    function test_CreateBorrowPool_SufficientCapacity() public {
        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256 offer2 = _postOffer(STRANGER, 60 ether);
        _mintEligibleStream(100, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 100);
        uint256 poolId = book.createBorrowPool(offerIds, 100, 100 ether, 90 ether);
        vm.stopPrank();

        // Pool state
        (address creator, uint16 aprBps, bool active, address market, uint128 totalContributed,) = book.pools(poolId);
        assertEq(creator, SELLER);
        assertEq(aprBps, 1000);
        assertTrue(active);
        assertEq(market, MARKET);
        assertEq(totalContributed, 100 ether);

        // Contributions
        assertEq(book.poolContributions(poolId, BUYER), 50 ether);
        assertEq(book.poolContributions(poolId, STRANGER), 50 ether);

        // Offer capacities
        (,,, uint128 cap1,) = book.offers(offer1);
        assertEq(cap1, 0);
        (,,, uint128 cap2,) = book.offers(offer2);
        assertEq(cap2, 10 ether);

        // Loan
        {
            (address borrower, address lender, uint256 streamId, uint128 obligation,,, bool closed) = book.loans(1);
            assertEq(borrower, SELLER);
            assertEq(lender, address(book));
            assertEq(streamId, 100);
            assertEq(obligation, 110 ether);
            assertFalse(closed);
        }
        assertEq(book.loanPoolId(1), poolId);
        assertEq(book.poolProceeds(poolId), 0);
        assertEq(sablier.ownerOf(100), address(book));

        // Balance assertions
        assertEq(underlying.balanceOf(SELLER), 100 ether, "borrower receives net");
        assertEq(underlying.balanceOf(TREASURY), 0, "no fees (default 0)");
        assertEq(underlying.balanceOf(address(book)), 10 ether, "book retains unused capacity");
    }

    function test_CreateBorrowPool_InsufficientCapacityReverts() public {
        uint256 offer1 = _postOffer(BUYER, 40 ether);
        uint256 offer2 = _postOffer(STRANGER, 40 ether);
        _mintEligibleStream(101, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 101);
        vm.expectRevert("OVRFLOBook: slippage");
        book.createBorrowPool(offerIds, 101, 100 ether, 90 ether);
        vm.stopPrank();

        // No offers consumed
        (,,, uint128 cap1,) = book.offers(offer1);
        assertEq(cap1, 40 ether, "offer1 untouched");
        (,,, uint128 cap2,) = book.offers(offer2);
        assertEq(cap2, 40 ether, "offer2 untouched");
        assertEq(sablier.ownerOf(101), SELLER, "stream not escrowed");
    }

    function test_CreateBorrowPool_PartialCoverageSucceeds() public {
        uint256 offer1 = _postOffer(BUYER, 40 ether);
        uint256 offer2 = _postOffer(STRANGER, 40 ether);
        _mintEligibleStream(102, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 102);
        uint256 poolId = book.createBorrowPool(offerIds, 102, 100 ether, 70 ether);
        vm.stopPrank();

        (, uint16 aprBps,,, uint128 totalContributed,) = book.pools(poolId);
        assertEq(aprBps, 1000);
        assertEq(totalContributed, 80 ether, "actual borrow = available, not target");

        assertEq(book.poolContributions(poolId, BUYER), 40 ether);
        assertEq(book.poolContributions(poolId, STRANGER), 40 ether);
        assertEq(underlying.balanceOf(SELLER), 80 ether, "borrower receives actual");
    }

    function test_CreateBorrowPool_SelfMatchReverts() public {
        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256 offer2 = _postOffer(SELLER, 60 ether);
        _mintEligibleStream(103, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 103);
        vm.expectRevert("OVRFLOBook: self-match");
        book.createBorrowPool(offerIds, 103, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_MarketMismatchReverts() public {
        uint256 offer1 = _postOffer(BUYER, 50 ether);

        address market2 = address(0x6666);
        factory.setMarketApproved(address(core), market2, true);
        core.setSeries(market2, true, expiry, address(ovrfloToken), address(underlying));
        underlying.mint(STRANGER, 60 ether);
        vm.startPrank(STRANGER);
        underlying.approve(address(book), 60 ether);
        uint256 offer2 = book.postOffer(market2, 1000, 60 ether);
        vm.stopPrank();

        _mintEligibleStream(104, SELLER, 110 ether, 0);
        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 104);
        vm.expectRevert("OVRFLOBook: market mismatch");
        book.createBorrowPool(offerIds, 104, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_AprMismatchReverts() public {
        book.setAprBounds(0, 9900);
        uint256 offer1 = _postOfferAtApr(BUYER, 50 ether, 500);
        uint256 offer2 = _postOfferAtApr(STRANGER, 60 ether, 1000);
        _mintEligibleStream(105, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 105);
        vm.expectRevert("OVRFLOBook: apr mismatch");
        book.createBorrowPool(offerIds, 105, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_CancelledOfferReverts() public {
        uint256 offer1 = _postOffer(BUYER, 50 ether);
        _postOffer(STRANGER, 60 ether);

        vm.prank(BUYER);
        book.cancelOffer(offer1);

        _mintEligibleStream(106, SELLER, 110 ether, 0);
        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = 2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 106);
        vm.expectRevert("OVRFLOBook: offer inactive");
        book.createBorrowPool(offerIds, 106, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_DuplicateOfferIdsReverts() public {
        _postOffer(BUYER, 100 ether);
        _mintEligibleStream(107, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = 1;
        offerIds[1] = 1;

        vm.startPrank(SELLER);
        sablier.approve(address(book), 107);
        vm.expectRevert("OVRFLOBook: duplicate or unsorted ids");
        book.createBorrowPool(offerIds, 107, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_NetSlippageWithFees() public {
        // Set fee to 1% (100 bps)
        book.setFee(100);

        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256 offer2 = _postOffer(STRANGER, 50 ether);
        _mintEligibleStream(108, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        // actualBorrow = 100, fee = 1, netToBorrower = 99
        vm.startPrank(SELLER);
        sablier.approve(address(book), 108);
        // minAcceptable = 99 (exactly net) — succeeds
        book.createBorrowPool(offerIds, 108, 100 ether, 99 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_SlippageRevertsOnNetNotGross() public {
        // Set fee to 1% (100 bps)
        book.setFee(100);

        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256 offer2 = _postOffer(STRANGER, 50 ether);
        _mintEligibleStream(109, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        // actualBorrow = 100, fee = 1, netToBorrower = 99
        // minAcceptable = 100 — old code would pass (100 >= 100), new code reverts (99 < 100)
        vm.startPrank(SELLER);
        sablier.approve(address(book), 109);
        vm.expectRevert("OVRFLOBook: slippage");
        book.createBorrowPool(offerIds, 109, 100 ether, 100 ether);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_FeeAtMaxSlippageReverts() public {
        // Set fee to 100% (10000 bps)
        book.setFee(10_000);

        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256 offer2 = _postOffer(STRANGER, 50 ether);
        _mintEligibleStream(110, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;

        // actualBorrow = 100, fee = 100, netToBorrower = 0
        // minAcceptable = 1 — reverts because 0 < 1
        vm.startPrank(SELLER);
        sablier.approve(address(book), 110);
        vm.expectRevert("OVRFLOBook: slippage");
        book.createBorrowPool(offerIds, 110, 100 ether, 1);
        vm.stopPrank();

        // Reset fee
        book.setFee(0);
    }

    function test_CreateBorrowPool_RevertsWhenBorrowZero() public {
        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offer1;
        vm.expectRevert("OVRFLOBook: borrow zero");
        book.createBorrowPool(offerIds, 200, 0, 0);
    }

    function test_CreateBorrowPool_RevertsWhenOffersEmpty() public {
        uint256[] memory offerIds = new uint256[](0);
        vm.expectRevert("OVRFLOBook: empty offers");
        book.createBorrowPool(offerIds, 201, 100 ether, 90 ether);
    }

    function test_CreateBorrowPool_RevertsWhenPriceZero() public {
        uint256 offer1 = _postOffer(BUYER, 100 ether);
        // deposited = 1 wei -> remaining = 1, grossPrice floors to 0 at positive APR/ttm
        _mintEligibleStream(202, SELLER, 1, 0);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offer1;
        vm.startPrank(SELLER);
        sablier.approve(address(book), 202);
        vm.expectRevert("OVRFLOBook: price zero");
        book.createBorrowPool(offerIds, 202, 50 ether, 0);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_RevertsWhenBorrowAbovePrice() public {
        // deposited = 110 ether, aprBps = 1000, ttm = 365 days -> grossPrice = 100 ether
        uint256 offer1 = _postOffer(BUYER, 200 ether);
        _mintEligibleStream(203, SELLER, 110 ether, 0);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offer1;
        vm.startPrank(SELLER);
        sablier.approve(address(book), 203);
        vm.expectRevert("OVRFLOBook: borrow above price");
        book.createBorrowPool(offerIds, 203, 200 ether, 0);
        vm.stopPrank();
    }

    function test_CreateBorrowPool_RevertsWhenLaterOfferInactive() public {
        uint256 offer1 = _postOffer(BUYER, 50 ether);
        uint256 offer2 = _postOffer(STRANGER, 60 ether);
        // Cancel the second offer — pre-loop check passes (offer1 active),
        // _validateOffers loop catches offer2 inactive
        vm.prank(STRANGER);
        book.cancelOffer(offer2);
        _mintEligibleStream(204, SELLER, 110 ether, 0);
        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = offer1;
        offerIds[1] = offer2;
        vm.startPrank(SELLER);
        sablier.approve(address(book), 204);
        vm.expectRevert("OVRFLOBook: offer inactive");
        book.createBorrowPool(offerIds, 204, 100 ether, 90 ether);
        vm.stopPrank();
    }

    function test_Offer_SplitBetweenSaleAndLoan() public {
        // Post an offer with 200 capacity — consumable as either sale or loan
        uint256 offerId = _postOffer(BUYER, 200 ether);

        // Sale first: SELLER sells a stream worth 100 into the offer
        _mintEligibleStream(150, SELLER, 110 ether, 0);
        vm.startPrank(SELLER);
        sablier.approve(address(book), 150);
        book.sellIntoOffer(offerId, 150, 0);
        vm.stopPrank();

        // Offer capacity reduced by 100 (grossPrice), still active
        (,,, uint128 capacityAfterSale, bool activeAfterSale) = book.offers(offerId);
        assertEq(capacityAfterSale, 100 ether, "capacity after sale");
        assertTrue(activeAfterSale, "offer still active");
        assertEq(sablier.ownerOf(150), BUYER, "stream transferred to maker");

        // Loan second: STRANGER borrows 100 via createBorrowPool using the same offer
        _mintEligibleStream(151, STRANGER, 110 ether, 0);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offerId;
        vm.startPrank(STRANGER);
        sablier.approve(address(book), 151);
        uint256 poolId = book.createBorrowPool(offerIds, 151, 100 ether, 100 ether);
        vm.stopPrank();

        // Offer exhausted and deactivated
        (,,, uint128 capacityAfterLoan, bool activeAfterLoan) = book.offers(offerId);
        assertEq(capacityAfterLoan, 0, "capacity after loan");
        assertFalse(activeAfterLoan, "offer deactivated");

        // Maker holds the sold stream (permanent transfer) and borrower's stream is in escrow
        assertEq(sablier.ownerOf(150), BUYER, "maker holds sold stream");
        assertEq(sablier.ownerOf(151), address(book), "borrower stream in escrow");

        // Loan created with 110 obligation
        (,,, uint128 obligation,,, bool closed) = book.loans(book.poolLoanId(poolId));
        assertEq(obligation, 110 ether, "loan obligation");
        assertFalse(closed, "loan not closed");

        // Balance assertions (no fees — default feeBps is 0)
        assertEq(underlying.balanceOf(SELLER), 100 ether, "seller received net");
        assertEq(underlying.balanceOf(STRANGER), 100 ether, "borrower received net");
        assertEq(underlying.balanceOf(BUYER), 0, "maker funded all");
        assertEq(underlying.balanceOf(TREASURY), 0, "no fees");
        assertEq(underlying.balanceOf(address(book)), 0, "book holds no underlying");
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: POOL CLAIMS
    //////////////////////////////////////////////////////////////*/

    /// @dev Creates a borrower pool with two lenders and returns (poolId, loanId).
    function _createBorrowerPool(
        uint256 streamId,
        uint128 lender1Cap,
        uint128 lender2Cap,
        uint128 targetBorrow,
        uint128 minAcceptable
    ) internal returns (uint256 poolId, uint256 loanId) {
        _postOffer(BUYER, lender1Cap);
        _postOffer(STRANGER, lender2Cap);
        _mintEligibleStream(streamId, SELLER, 110 ether, 0);

        uint256[] memory offerIds = new uint256[](2);
        offerIds[0] = 1;
        offerIds[1] = 2;

        vm.startPrank(SELLER);
        sablier.approve(address(book), streamId);
        poolId = book.createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable);
        vm.stopPrank();
        loanId = 1;
    }

    function test_PoolClaimLoan_PaysFromProceeds() public {
        (uint256 poolId, uint256 loanId) = _createBorrowerPool(130, 60 ether, 40 ether, 100 ether, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 30 ether);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 30 ether, "caller receives from proceeds");
        assertEq(book.poolReceived(poolId, BUYER), 30 ether, "poolReceived updated");

        (,,,, uint128 drawn,,) = book.loans(loanId);
        assertEq(drawn, 0, "no stream draw when proceeds sufficient");
    }

    function test_ClaimPoolShare_ClaimsFromProceeds() public {
        (uint256 poolId,) = _createBorrowerPool(131, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(131, 110 ether);

        // Close loan to accumulate poolProceeds
        book.closeLoan(1);
        assertEq(book.poolProceeds(poolId), 110 ether, "proceeds accumulated");

        // BUYER claims 66 (60% of 110)
        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 66 ether);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 66 ether, "caller receives");
        assertEq(book.poolReceived(poolId, BUYER), 66 ether, "poolReceived updated");
        assertEq(book.poolProceeds(poolId), 44 ether, "poolProceeds decremented");
    }

    function test_ClaimPoolShare_AmountCappedAtClaimable() public {
        (uint256 poolId,) = _createBorrowerPool(132, 30 ether, 70 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(132, 110 ether);
        book.closeLoan(1);

        // BUYER's share = 30 * 110 / 100 = 33; requesting 50 gets capped to 33
        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 50 ether);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 33 ether, "capped at claimable");
        assertEq(book.poolReceived(poolId, BUYER), 33 ether, "poolReceived = 33");
    }

    function test_ClaimFair_ProRataCapPreventsPotDrain() public {
        // Alice (BUYER) 60%, Bob (STRANGER) 40%, obligation = 110
        (uint256 poolId, uint256 loanId) = _createBorrowerPool(141, 60 ether, 40 ether, 100 ether, 100 ether);

        // Partial repayment: only 50 accumulates in poolProceeds (not full 110)
        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();
        assertEq(book.poolProceeds(poolId), 50 ether, "partial proceeds");

        // Alice's claimable = 60 * 50 / 100 = 30 (pro-rata cap prevents draining all 50)
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether, "Alice claims 60% of recovered");

        // Bob's claimable = 40 * 50 / 100 = 20 (can claim immediately, not stranded)
        vm.prank(STRANGER);
        book.claimPoolShare(poolId, 20 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 20 ether, "Bob claims 40% of recovered");
        assertEq(book.poolProceeds(poolId), 0 ether, "pot drained fairly");

        // More proceeds arrive via closeLoan (outstanding = 110 - 50 = 60)
        sablier.setWithdrawable(141, 110 ether);
        book.closeLoan(loanId);
        assertEq(book.poolProceeds(poolId), 60 ether, "remaining drawn to proceeds");

        // Alice claims remaining: claimable = 60 * 110 / 100 - 30 = 36
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 36 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 66 ether, "Alice total = 66");

        // Bob claims remaining: claimable = 40 * 110 / 100 - 20 = 24
        vm.prank(STRANGER);
        book.claimPoolShare(poolId, 24 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 44 ether, "Bob total = 44");
    }

    function test_ClaimPoolShare_MinorityContributorNotStranded() public {
        // A (BUYER) 99%, B (STRANGER) 1%, obligation = 110
        (uint256 poolId,) = _createBorrowerPool(142, 99 ether, 1 ether, 100 ether, 100 ether);

        // Full proceeds via closeLoan
        sablier.setWithdrawable(142, 110 ether);
        book.closeLoan(1);
        assertEq(book.poolProceeds(poolId), 110 ether, "full proceeds");

        // A's entitlement = 99 * 110 / 100 = 108 (integer division)
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 108 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 108 ether, "A claims entitlement");
        assertEq(book.poolProceeds(poolId), 2 ether, "2 remains");

        // B's entitlement = 1 * 110 / 100 = 1
        // With the old pro-rata cap, B's share = 2 * 1 / 100 = 0 → stranded
        // Without the cap, B's available = min(1, 2) = 1 → NOT stranded
        vm.prank(STRANGER);
        book.claimPoolShare(poolId, 1 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 1 ether, "B claims entitlement");
    }

    function test_PoolClaimLoan_NonContributorReverts() public {
        (uint256 poolId,) = _createBorrowerPool(133, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(133, 50 ether);

        address nonContributor = address(0x9999);
        vm.prank(nonContributor);
        vm.expectRevert("OVRFLOBook: not contributor");
        book.poolClaimLoan(poolId, 10 ether);
    }

    function test_ClaimPoolShare_NonContributorReverts() public {
        (uint256 poolId,) = _createBorrowerPool(134, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(134, 110 ether);
        book.closeLoan(1);

        address nonContributor = address(0x9999);
        vm.prank(nonContributor);
        vm.expectRevert("OVRFLOBook: not contributor");
        book.claimPoolShare(poolId, 10 ether);
    }

    function test_PoolClaimLoan_ClosedLoanReverts() public {
        (uint256 poolId, uint256 loanId) = _createBorrowerPool(137, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(137, 110 ether);
        book.closeLoan(loanId);

        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: loan closed");
        book.poolClaimLoan(poolId, 10 ether);
    }

    function test_PoolClaimLoan_ProRataShares() public {
        (uint256 poolId, uint256 loanId) = _createBorrowerPool(138, 60 ether, 40 ether, 100 ether, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        // BUYER (60%) claims 30 = 60 * 50 / 100
        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether);

        // STRANGER (40%) claims 20 = 40 * 50 / 100
        vm.prank(STRANGER);
        book.poolClaimLoan(poolId, 20 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 20 ether);

        // closeLoan draws remaining 60 into poolProceeds
        sablier.setWithdrawable(138, 110 ether);
        book.closeLoan(loanId);

        // BUYER claims remaining: claimable = 60 * 110 / 100 - 30 = 36
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 36 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 66 ether);

        // STRANGER claims remaining: claimable = 40 * 110 / 100 - 20 = 24
        vm.prank(STRANGER);
        book.claimPoolShare(poolId, 24 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 44 ether);
    }

    function test_PoolClaimLoan_DoubleDipCappedAtEntitlement() public {
        // Single-offer borrower pool: BUYER contributes 100%
        uint256 offerId = _postOffer(BUYER, 100 ether);
        _mintEligibleStream(139, SELLER, 110 ether, 0);
        uint256[] memory offerIds = new uint256[](1);
        offerIds[0] = offerId;
        vm.startPrank(SELLER);
        sablier.approve(address(book), 139);
        uint256 poolId = book.createBorrowPool(offerIds, 139, 100 ether, 100 ether);
        vm.stopPrank();
        uint256 loanId = 1;

        // BUYER's entitlement = 100 * 110 / 100 = 110
        ovrfloToken.mint(SELLER, 55 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 55 ether);
        book.repayLoan(loanId, 55 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 55 ether);
        assertEq(book.poolReceived(poolId, BUYER), 55 ether);

        // Close loan to accumulate remaining in poolProceeds
        sablier.setWithdrawable(139, 110 ether);
        book.closeLoan(loanId);
        assertEq(book.poolProceeds(poolId), 55 ether, "remaining drawn to proceeds");

        // BUYER claims from poolProceeds
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 55 ether);
        assertEq(book.poolReceived(poolId, BUYER), 110 ether, "total = entitlement");

        // Double-dip prevented
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: nothing claimable");
        book.claimPoolShare(poolId, 1);
    }

    function test_PoolClaimLoan_BookBalanceInvariant() public {
        (uint256 poolId,) = _createBorrowerPool(140, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(140, 110 ether);
        book.closeLoan(1);

        // Invariant: book ovrfloToken balance >= poolProceeds
        assertGe(ovrfloToken.balanceOf(address(book)), book.poolProceeds(poolId), "book balance >= poolProceeds");

        // After partial claim, invariant still holds
        vm.prank(BUYER);
        book.claimPoolShare(poolId, 33 ether);

        assertGe(
            ovrfloToken.balanceOf(address(book)), book.poolProceeds(poolId), "book balance >= poolProceeds after claim"
        );
    }

    function test_PoolClaimLoan_RevertsWhenNothingClaimable() public {
        (uint256 poolId,) = _originateLoanViaBorrowPool(210, 100 ether);
        // withdrawable defaults to 0 -> streamClaimable = 0 -> drawAmount = 0
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: nothing claimable");
        book.poolClaimLoan(poolId, 50 ether);
    }

    function test_ClaimPoolShare_RevertsWhenClaimZero() public {
        (uint256 poolId,) = _originateLoanViaBorrowPool(211, 100 ether);
        // BUYER is a contributor with remaining entitlement
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: claim zero");
        book.claimPoolShare(poolId, 0);
    }

    function test_RepayLoan_RevertsWhenNothingOutstanding() public {
        (, uint256 loanId) = _originateLoanViaBorrowPool(212, 100 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 110 ether);
        book.repayLoan(loanId, 110 ether);
        vm.stopPrank();

        assertEq(sablier.ownerOf(212), SELLER);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: loan closed");
        book.repayLoan(loanId, 1);

        vm.expectRevert("OVRFLOBook: loan closed");
        book.closeLoan(loanId);
    }

    function test_ClaimFair_BothContributorsCanClaim() public {
        (uint256 poolId, uint256 loanId) = _createBorrowerPool(160, 60 ether, 40 ether, 100 ether, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.claimPoolShare(poolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether, "A claims 60% of 50");

        vm.prank(STRANGER);
        book.claimPoolShare(poolId, 20 ether);
        assertEq(ovrfloToken.balanceOf(STRANGER), 20 ether, "B claims 40% of 50");
    }

    function test_ClaimFair_HarvestDeficit() public {
        (uint256 poolId, uint256 loanId) = _createBorrowerPool(161, 60 ether, 40 ether, 100 ether, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.poolClaimLoan(poolId, 30 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 30 ether, "A claims from proceeds");
        assertEq(sablier.getWithdrawnAmount(161), 0, "no stream draw needed");
    }

    function test_ClaimFair_NoHarvestWhenProceedsSufficient() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(162, 100 ether);
        sablier.setWithdrawable(162, 110 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        vm.prank(BUYER);
        book.claimPoolShare(poolId, 50 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 50 ether, "claimed from proceeds");
        assertEq(sablier.getWithdrawnAmount(162), 0, "stream not touched");
        assertEq(book.poolProceeds(poolId), 0, "proceeds drained");
    }

    function test_ClaimFair_LoanClosedPoolClaimReverts() public {
        (uint256 poolId,) = _createBorrowerPool(163, 60 ether, 40 ether, 100 ether, 100 ether);
        sablier.setWithdrawable(163, 110 ether);
        book.closeLoan(1);

        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: loan closed");
        book.poolClaimLoan(poolId, 10 ether);

        vm.prank(BUYER);
        book.claimPoolShare(poolId, 66 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 66 ether, "claimPoolShare works after close");
    }

    function test_ClaimFair_AmountCappedAtClaimable() public {
        (uint256 poolId, uint256 loanId) = _originateLoanViaBorrowPool(164, 100 ether);

        ovrfloToken.mint(SELLER, 50 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 50 ether);
        book.repayLoan(loanId, 50 ether);
        vm.stopPrank();

        uint256 before = ovrfloToken.balanceOf(BUYER);
        vm.prank(BUYER);
        book.claimPoolShare(poolId, type(uint128).max);

        assertEq(ovrfloToken.balanceOf(BUYER) - before, 50 ether, "capped at claimable");
    }

    /// @dev Covers the _toUint128 overflow guard via harness. This branch is
    ///      unreachable from the external ABI — every call site is pre-bounded
    ///      (grossPrice <= offer.capacity, actualBorrow <= targetBorrow, etc.).
    ///      The `loan not in pool` branch is also defensive: poolContributions
    ///      are only written inside createBorrowPool, which always sets poolLoanId.
    function test_ToUint128_RevertsOnOverflow() public {
        BookInternalHarness harness = new BookInternalHarness(address(factory), address(core), address(sablier));
        vm.expectRevert("OVRFLOBook: uint128 overflow");
        harness.exposed_toUint128(uint256(type(uint128).max) + 1);
    }
}
