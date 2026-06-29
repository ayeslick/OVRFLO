// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOBook} from "../../src/OVRFLOBook.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

contract OVRFLOBookMainnetForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    address internal constant BUYER = address(0xA11CE);
    address internal constant LENDER = address(0xCAFE);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint256 internal constant PT_AMOUNT = 10 ether;

    function test_BookSale_RealStreamTransfersToBuyer() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        vm.prank(USER);
        _approveStream(address(sablier), address(book), streamId);

        // Cache LAUNCH_APR_BPS before prank to avoid argument-evaluation consuming the prank
        uint16 launchApr = book.LAUNCH_APR_BPS();
        vm.prank(USER);
        uint256 listingId = book.postSaleListing(PRIMARY_MARKET, streamId, launchApr);

        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, launchApr, 0);
        _seedWstEth(BUYER, grossPrice);
        vm.startPrank(BUYER);
        IERC20(WSTETH).approve(address(book), grossPrice);
        book.buyListing(listingId, grossPrice);
        vm.stopPrank();

        assertEq(sablier.ownerOf(streamId), BUYER);
    }

    function test_BookLoan_RealStreamClaimsAndCloses() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);
        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, book.LAUNCH_APR_BPS(), 0);
        uint128 borrowAmount = uint128(grossPrice / 2);

        _seedWstEth(LENDER, borrowAmount);
        vm.startPrank(LENDER);
        IERC20(WSTETH).approve(address(book), borrowAmount);
        uint256 offerId = book.postLendOffer(PRIMARY_MARKET, book.LAUNCH_APR_BPS(), borrowAmount);
        vm.stopPrank();

        vm.prank(USER);
        _approveStream(address(sablier), address(book), streamId);
        vm.prank(USER);
        uint256 poolId = book.createBorrowPool(_singletonArray(offerId), streamId, borrowAmount, 0);
        uint256 loanId = 1;

        uint256 claimTimestamp = block.timestamp + (PRIMARY_EXPIRY - block.timestamp) / 4;
        vm.warp(claimTimestamp);
        uint128 partialClaim = sablier.withdrawableAmountOf(streamId);
        (,,,,,, uint128 outstandingBeforeClaim,) = book.loanState(loanId);
        assertGt(partialClaim, 0);
        assertLt(partialClaim, outstandingBeforeClaim);

        vm.prank(LENDER);
        book.poolClaimLoan(poolId, loanId, partialClaim);
        assertEq(token.balanceOf(LENDER), partialClaim);

        vm.warp(PRIMARY_EXPIRY);
        book.closeLoan(loanId);

        _assertLoanClosedAfterClaim(book, token, sablier, loanId, streamId, poolId);
    }

    function test_BookLoan_RealEarlyRepayViaWrapAndUnwrap() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);
        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, book.LAUNCH_APR_BPS(), 0);
        uint128 borrowAmount = uint128(grossPrice / 2);

        _seedWstEth(LENDER, borrowAmount);
        vm.startPrank(LENDER);
        IERC20(WSTETH).approve(address(book), borrowAmount);
        uint256 offerId = book.postLendOffer(PRIMARY_MARKET, book.LAUNCH_APR_BPS(), borrowAmount);
        vm.stopPrank();

        vm.prank(USER);
        _approveStream(address(sablier), address(book), streamId);
        vm.prank(USER);
        uint256 poolId = book.createBorrowPool(_singletonArray(offerId), streamId, borrowAmount, 0);
        uint256 loanId = 1;

        (,,,,,, uint128 outstanding,) = book.loanState(loanId);
        _seedWstEth(USER, outstanding);
        vm.startPrank(USER);
        IERC20(WSTETH).approve(address(ovrflo), outstanding);
        ovrflo.wrap(outstanding);
        token.approve(address(book), outstanding);
        book.repayLoan(loanId, outstanding);
        vm.stopPrank();

        assertEq(sablier.ownerOf(streamId), USER);

        // Lender withdraws repaid amount from pool proceeds
        vm.prank(LENDER);
        book.claimPoolShare(poolId, outstanding);
        assertEq(token.balanceOf(LENDER), outstanding);

        uint256 lenderWstEthBefore = IERC20(WSTETH).balanceOf(LENDER);
        vm.prank(LENDER);
        ovrflo.unwrap(outstanding);
        assertEq(IERC20(WSTETH).balanceOf(LENDER), lenderWstEthBefore + outstanding);
    }

    function test_BookEligibility_RejectsForeignCoreStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        (, OVRFLO foreignOvrflo,) = _deployApprovedPrimarySeries(0);
        ISablierV2LockupLinear foreignSablier = ISablierV2LockupLinear(address(foreignOvrflo.sablierLL()));
        (,, uint256 foreignStreamId) = _depositPrimary(foreignOvrflo, PT_AMOUNT);

        vm.prank(USER);
        _approveStream(address(foreignSablier), address(book), foreignStreamId);

        // Cache LAUNCH_APR_BPS before expectRevert to avoid argument-evaluation gotcha
        uint16 launchApr = book.LAUNCH_APR_BPS();
        vm.prank(USER);
        vm.expectRevert();
        book.postSaleListing(PRIMARY_MARKET, foreignStreamId, launchApr);
    }

    function test_BookSellIntoOffer_RealStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        // Quote to determine required offer capacity
        uint16 launchApr = book.LAUNCH_APR_BPS();
        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, launchApr, 0);

        // Buyer posts a sale offer with enough capacity
        _seedWstEth(BUYER, grossPrice);
        vm.startPrank(BUYER);
        IERC20(WSTETH).approve(address(book), grossPrice);
        uint256 offerId = book.postSaleOffer(PRIMARY_MARKET, launchApr, uint128(grossPrice));
        vm.stopPrank();

        // User sells stream into the offer
        vm.prank(USER);
        _approveStream(address(sablier), address(book), streamId);
        vm.prank(USER);
        book.sellIntoOffer(offerId, streamId, 0);

        // Stream transferred to buyer (offer maker)
        assertEq(sablier.ownerOf(streamId), BUYER, "stream should transfer to offer maker");

        // User received wstETH (net of fee; feeBps=0 so net == gross)
        assertEq(IERC20(WSTETH).balanceOf(USER), grossPrice, "seller should receive full gross price");

        // Offer capacity consumed
        (,,, uint128 remainingCapacity, bool active) = book.saleOffers(offerId);
        assertFalse(active, "offer should be inactive after full consumption");
        assertEq(remainingCapacity, 0, "capacity should be 0 after full fill");
    }

    function test_BookLendAgainstListing_RealStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        // Quote to determine borrow amount
        uint16 launchApr = book.LAUNCH_APR_BPS();
        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, launchApr, 0);
        uint128 borrowAmount = uint128(grossPrice / 2);

        // User posts a borrow listing (pledges stream)
        vm.prank(USER);
        _approveStream(address(sablier), address(book), streamId);
        vm.prank(USER);
        uint256 listingId = book.postBorrowListing(PRIMARY_MARKET, streamId, launchApr, borrowAmount);

        // Lender fills the listing via pool
        _seedWstEth(LENDER, borrowAmount);
        vm.startPrank(LENDER);
        IERC20(WSTETH).approve(address(book), borrowAmount);
        uint256 poolId = book.createLenderPool(_singletonArray(listingId), borrowAmount, 0);
        vm.stopPrank();
        uint256 loanId = 1;

        // Loan created with correct obligation
        (,,, uint128 obligation,,,, bool closed) = book.loanState(loanId);
        assertFalse(closed, "loan should not be closed");
        assertGt(obligation, 0, "obligation should be > 0");

        // Stream escrowed by book
        assertEq(sablier.ownerOf(streamId), address(book), "stream should be escrowed by book");

        // User received wstETH (borrow amount; feeBps=0 so net == borrowAmount)
        assertEq(IERC20(WSTETH).balanceOf(USER), borrowAmount, "borrower should receive wstETH");

        // Listing is no longer active
        (,,,,,, bool listingActive) = book.borrowListings(listingId);
        assertFalse(listingActive, "listing should be inactive after fill");
    }

    function _deployApprovedPrimarySeries(uint16 feeBps)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        (factory, ovrflo, token) = _deployConfiguredSystem();

        vm.startPrank(OWNER);
        factory.prepareOracle(PRIMARY_MARKET, PROTOCOL_TWAP_DURATION);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, PROTOCOL_TWAP_DURATION, feeBps);
        vm.stopPrank();
    }

    function _deployBook(OVRFLOFactory factory, OVRFLO ovrflo) internal returns (OVRFLOBook book) {
        book = new OVRFLOBook(address(factory), address(ovrflo), address(ovrflo.sablierLL()));
    }

    function _assertLoanClosedAfterClaim(
        OVRFLOBook book,
        OVRFLOToken token,
        ISablierV2LockupLinear sablier,
        uint256 loanId,
        uint256 streamId,
        uint256 poolId
    ) internal {
        (,,, uint128 obligation, uint128 drawn, uint128 repaid, uint128 outstanding, bool closed) =
            book.loanState(loanId);
        assertEq(drawn, obligation);
        assertEq(repaid, 0);
        assertEq(outstanding, 0);
        assertTrue(closed);

        // Lender withdraws closeLoan proceeds from pool
        uint128 lenderReceived = uint128(token.balanceOf(LENDER));
        if (obligation > lenderReceived) {
            vm.prank(LENDER);
            book.claimPoolShare(poolId, obligation - lenderReceived);
        }

        assertEq(token.balanceOf(LENDER), obligation);
        assertEq(sablier.ownerOf(streamId), USER);
    }

    function _depositPrimary(OVRFLO ovrflo, uint256 ptAmount)
        internal
        returns (uint256 toUser, uint256 toStream, uint256 streamId)
    {
        (uint256 expectedToUser,,,) = ovrflo.previewDeposit(PRIMARY_MARKET, ptAmount);
        deal(PRIMARY_PT, USER, ptAmount);

        vm.startPrank(USER);
        IERC20(PRIMARY_PT).approve(address(ovrflo), ptAmount);
        (toUser, toStream, streamId) = ovrflo.deposit(PRIMARY_MARKET, ptAmount, expectedToUser);
        vm.stopPrank();
    }

    function _approveStream(address sablier, address spender, uint256 streamId) internal {
        (bool success,) = sablier.call(abi.encodeWithSignature("approve(address,uint256)", spender, streamId));
        assertTrue(success);
    }

    /*//////////////////////////////////////////////////////////////
        SABLIER V2 v1.1 WITHDRAW ACL DURING BOOK ESCROW (P2 GAP)
    //////////////////////////////////////////////////////////////*/

    function test_BookEscrow_StrangerCannotWithdrawFromEscrowedStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOBook book = _deployBook(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        // Escrow the stream via a borrow listing
        uint16 launchApr = book.LAUNCH_APR_BPS();
        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, launchApr, 0);
        uint128 borrowAmount = uint128(grossPrice / 2);

        vm.prank(USER);
        _approveStream(address(sablier), address(book), streamId);
        vm.prank(USER);
        book.postBorrowListing(PRIMARY_MARKET, streamId, launchApr, borrowAmount);

        assertEq(sablier.ownerOf(streamId), address(book), "book should hold the NFT");

        // Warp forward so the stream has withdrawable value
        uint256 claimTimestamp = block.timestamp + (PRIMARY_EXPIRY - block.timestamp) / 4;
        vm.warp(claimTimestamp);
        uint128 withdrawable = sablier.withdrawableAmountOf(streamId);
        assertGt(withdrawable, 0, "stream should have accrual");

        address stranger = makeAddr("stranger");

        // Stranger cannot withdraw
        vm.prank(stranger);
        (bool ok,) =
            address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, stranger, withdrawable)));
        assertFalse(ok, "stranger should not be able to withdraw");

        // Former borrower (USER) cannot withdraw — they no longer own the NFT
        vm.prank(USER);
        (ok,) = address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, USER, withdrawable)));
        assertFalse(ok, "former borrower should not be able to withdraw");

        // Lender (has not been assigned yet) cannot withdraw
        vm.prank(LENDER);
        (ok,) = address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, LENDER, withdrawable)));
        assertFalse(ok, "lender should not be able to withdraw");

        // Stream withdrawn amount unchanged
        assertEq(sablier.getWithdrawnAmount(streamId), 0, "no withdrawal should have succeeded");
    }

    function _singletonArray(uint256 id) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = id;
    }
}
