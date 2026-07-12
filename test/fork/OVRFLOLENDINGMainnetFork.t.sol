// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOLENDING} from "../../src/OVRFLOLENDING.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

contract OVRFLOLENDINGMainnetForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    address internal constant BUYER = address(0xA11CE);
    address internal constant LENDER = address(0xCAFE);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint256 internal constant PT_AMOUNT = 10 ether;

    function test_LendingSale_RealStreamTransfersToBuyer() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOLENDING lending = _deployLending(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        vm.prank(USER);
        _approveStream(address(sablier), address(lending), streamId);

        // Cache LAUNCH_APR_BPS before prank to avoid argument-evaluation consuming the prank
        uint16 launchApr = lending.LAUNCH_APR_BPS();
        vm.prank(USER);
        uint256 listingId = lending.postSaleListing(PRIMARY_MARKET, streamId, launchApr);

        (uint256 grossPrice,,,,) = lending.quote(PRIMARY_MARKET, streamId, launchApr, 0);
        _seedWstEth(BUYER, grossPrice);
        vm.startPrank(BUYER);
        IERC20(WSTETH).approve(address(lending), grossPrice);
        lending.buyListing(listingId, grossPrice);
        vm.stopPrank();

        assertEq(sablier.ownerOf(streamId), BUYER);
    }

    function test_LendingLoan_RealStreamClaimsAndCloses() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        OVRFLOLENDING lending = _deployLending(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);
        (uint256 grossPrice,,,,) = lending.quote(PRIMARY_MARKET, streamId, lending.LAUNCH_APR_BPS(), 0);
        uint128 borrowAmount = uint128(grossPrice / 2);

        _seedWstEth(LENDER, borrowAmount);
        vm.startPrank(LENDER);
        IERC20(WSTETH).approve(address(lending), borrowAmount);
        uint256 liquidityId = lending.supplyLiquidity(PRIMARY_MARKET, lending.LAUNCH_APR_BPS(), borrowAmount);
        vm.stopPrank();

        vm.prank(USER);
        _approveStream(address(sablier), address(lending), streamId);
        vm.prank(USER);
        uint256 loanPoolId = lending.createBorrowerLoanPool(_singletonArray(liquidityId), streamId, borrowAmount, 0);
        uint256 loanId = 1;

        uint256 claimTimestamp = block.timestamp + (PRIMARY_EXPIRY - block.timestamp) / 4;
        vm.warp(claimTimestamp);
        uint128 partialClaim = sablier.withdrawableAmountOf(streamId);
        (,,,,,, uint128 outstandingBeforeClaim,) = lending.loanState(loanId);
        assertGt(partialClaim, 0);
        assertLt(partialClaim, outstandingBeforeClaim);

        vm.prank(LENDER);
        lending.claimLoanPoolShare(loanPoolId, partialClaim);
        assertEq(token.balanceOf(LENDER), partialClaim);

        vm.warp(PRIMARY_EXPIRY);
        lending.closeLoan(loanId);

        _assertLoanClosedAfterClaim(lending, token, sablier, loanId, streamId, loanPoolId);
    }

    function test_LendingLoan_RealEarlyRepayViaWrapAndUnwrap() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        OVRFLOLENDING lending = _deployLending(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);
        (uint256 grossPrice,,,,) = lending.quote(PRIMARY_MARKET, streamId, lending.LAUNCH_APR_BPS(), 0);
        uint128 borrowAmount = uint128(grossPrice / 2);

        _seedWstEth(LENDER, borrowAmount);
        vm.startPrank(LENDER);
        IERC20(WSTETH).approve(address(lending), borrowAmount);
        uint256 liquidityId = lending.supplyLiquidity(PRIMARY_MARKET, lending.LAUNCH_APR_BPS(), borrowAmount);
        vm.stopPrank();

        vm.prank(USER);
        _approveStream(address(sablier), address(lending), streamId);
        vm.prank(USER);
        uint256 loanPoolId = lending.createBorrowerLoanPool(_singletonArray(liquidityId), streamId, borrowAmount, 0);
        uint256 loanId = 1;

        (,,,,,, uint128 outstanding,) = lending.loanState(loanId);
        _seedWstEth(USER, outstanding);
        vm.startPrank(USER);
        IERC20(WSTETH).approve(address(ovrflo), outstanding);
        ovrflo.wrap(outstanding);
        token.approve(address(lending), outstanding);
        lending.repayLoan(loanId, outstanding);
        vm.stopPrank();

        assertEq(sablier.ownerOf(streamId), USER);

        // Lender withdraws repaid amount from pool proceeds
        vm.prank(LENDER);
        lending.claimLoanPoolShare(loanPoolId, outstanding);
        assertEq(token.balanceOf(LENDER), outstanding);

        uint256 lenderWstEthBefore = IERC20(WSTETH).balanceOf(LENDER);
        vm.prank(LENDER);
        ovrflo.unwrap(outstanding);
        assertEq(IERC20(WSTETH).balanceOf(LENDER), lenderWstEthBefore + outstanding);
    }

    function test_LendingEligibility_RejectsForeignCoreStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOLENDING lending = _deployLending(factory, ovrflo);
        (, OVRFLO foreignOvrflo,) = _deployApprovedPrimarySeries(0);
        ISablierV2LockupLinear foreignSablier = ISablierV2LockupLinear(address(foreignOvrflo.sablierLL()));
        (,, uint256 foreignStreamId) = _depositPrimary(foreignOvrflo, PT_AMOUNT);

        vm.prank(USER);
        _approveStream(address(foreignSablier), address(lending), foreignStreamId);

        // Cache LAUNCH_APR_BPS before expectRevert to avoid argument-evaluation gotcha
        uint16 launchApr = lending.LAUNCH_APR_BPS();
        vm.prank(USER);
        vm.expectRevert();
        lending.postSaleListing(PRIMARY_MARKET, foreignStreamId, launchApr);
    }

    function test_LendingSellStreamToLiquidity_RealStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOLENDING lending = _deployLending(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        // Quote to determine required liquidity availableLiquidity
        uint16 launchApr = lending.LAUNCH_APR_BPS();
        (uint256 grossPrice,,,,) = lending.quote(PRIMARY_MARKET, streamId, launchApr, 0);

        // Buyer posts a sale liquidity with enough availableLiquidity
        _seedWstEth(BUYER, grossPrice);
        vm.startPrank(BUYER);
        IERC20(WSTETH).approve(address(lending), grossPrice);
        uint256 liquidityId = lending.supplyLiquidity(PRIMARY_MARKET, launchApr, uint128(grossPrice));
        vm.stopPrank();

        // User sells stream into the liquidity
        vm.prank(USER);
        _approveStream(address(sablier), address(lending), streamId);
        vm.prank(USER);
        lending.sellStreamToLiquidity(liquidityId, streamId, 0);

        // Stream transferred to buyer (liquidity lender)
        assertEq(sablier.ownerOf(streamId), BUYER, "stream should transfer to liquidity lender");

        // User received wstETH (net of fee; feeBps=0 so net == gross)
        assertEq(IERC20(WSTETH).balanceOf(USER), grossPrice, "seller should receive full gross price");

        // LiquidityPosition availableLiquidity consumed
        (,,, uint128 remainingCapacity, bool active) = lending.liquidityPositions(liquidityId);
        assertFalse(active, "liquidity should be inactive after full consumption");
        assertEq(remainingCapacity, 0, "availableLiquidity should be 0 after full fill");
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

    function _deployLending(OVRFLOFactory factory, OVRFLO ovrflo) internal returns (OVRFLOLENDING lending) {
        lending = new OVRFLOLENDING(address(factory), address(ovrflo), address(ovrflo.sablierLL()));
    }

    function _assertLoanClosedAfterClaim(
        OVRFLOLENDING lending,
        OVRFLOToken token,
        ISablierV2LockupLinear sablier,
        uint256 loanId,
        uint256 streamId,
        uint256 loanPoolId
    ) internal {
        (,,, uint128 obligation, uint128 drawn, uint128 repaid, uint128 outstanding, bool closed) =
            lending.loanState(loanId);
        assertEq(drawn, obligation);
        assertEq(repaid, 0);
        assertEq(outstanding, 0);
        assertTrue(closed);

        // Lender withdraws closeLoan proceeds from pool
        uint128 lenderReceived = uint128(token.balanceOf(LENDER));
        if (obligation > lenderReceived) {
            vm.prank(LENDER);
            lending.claimLoanPoolShare(loanPoolId, obligation - lenderReceived);
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

    function test_LendingEscrow_StrangerCannotWithdrawFromEscrowedStream() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        OVRFLOLENDING lending = _deployLending(factory, ovrflo);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        // Escrow the stream via a sale listing
        uint16 launchApr = lending.LAUNCH_APR_BPS();

        vm.prank(USER);
        _approveStream(address(sablier), address(lending), streamId);
        vm.prank(USER);
        lending.postSaleListing(PRIMARY_MARKET, streamId, launchApr);

        assertEq(sablier.ownerOf(streamId), address(lending), "lending should hold the NFT");

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

        // Lender (not the NFT owner) cannot withdraw
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
