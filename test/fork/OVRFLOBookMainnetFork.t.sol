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
        vm.prank(USER);
        uint256 listingId = book.postSaleListing(PRIMARY_MARKET, streamId, book.LAUNCH_APR_BPS());

        (uint256 grossPrice,,,,) = book.quote(PRIMARY_MARKET, streamId, book.LAUNCH_APR_BPS(), 0);
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
        uint256 loanId = book.borrowAgainstOffer(offerId, streamId, borrowAmount, 0);

        uint256 claimTimestamp = block.timestamp + (PRIMARY_EXPIRY - block.timestamp) / 4;
        vm.warp(claimTimestamp);
        uint128 partialClaim = sablier.withdrawableAmountOf(streamId);
        (,,,,,, uint128 outstandingBeforeClaim,) = book.loanState(loanId);
        assertGt(partialClaim, 0);
        assertLt(partialClaim, outstandingBeforeClaim);

        vm.prank(LENDER);
        book.claimLoan(loanId);
        assertEq(token.balanceOf(LENDER), partialClaim);

        vm.warp(PRIMARY_EXPIRY);
        book.closeLoan(loanId);

        _assertLoanClosedAfterClaim(book, token, sablier, loanId, streamId);
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
        uint256 loanId = book.borrowAgainstOffer(offerId, streamId, borrowAmount, 0);

        (,,,,,, uint128 outstanding,) = book.loanState(loanId);
        _seedWstEth(USER, outstanding);
        vm.startPrank(USER);
        IERC20(WSTETH).approve(address(ovrflo), outstanding);
        ovrflo.wrap(outstanding);
        token.approve(address(book), outstanding);
        book.repayLoan(loanId, outstanding);
        vm.stopPrank();

        assertEq(sablier.ownerOf(streamId), USER);
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
        vm.prank(USER);
        vm.expectRevert();
        book.postSaleListing(PRIMARY_MARKET, foreignStreamId, book.LAUNCH_APR_BPS());
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
        book = new OVRFLOBook(address(factory), address(ovrflo), address(ovrflo.sablierLL()), 5000, 100);
    }

    function _assertLoanClosedAfterClaim(
        OVRFLOBook book,
        OVRFLOToken token,
        ISablierV2LockupLinear sablier,
        uint256 loanId,
        uint256 streamId
    ) internal view {
        (,,, uint128 obligation, uint128 drawn, uint128 repaid, uint128 outstanding, bool closed) =
            book.loanState(loanId);
        assertEq(drawn, obligation);
        assertEq(repaid, 0);
        assertEq(outstanding, 0);
        assertTrue(closed);
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
}
