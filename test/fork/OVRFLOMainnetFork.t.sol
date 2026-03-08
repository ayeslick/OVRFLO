// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

contract OVRFLOMainnetForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint16 internal constant FEE_BPS = 100;
    uint256 internal constant PT_AMOUNT = 10 ether;
    uint256 internal constant PRIMARY_RATE_30M = 808001605532275465;

    function test_PreviewDeposit_PrimaryMarketUsesLiveOracleRate() public {
        (, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(FEE_BPS);

        uint256 expectedToUser = PT_AMOUNT * PRIMARY_RATE_30M / 1e18;
        uint256 expectedToStream = PT_AMOUNT - expectedToUser;
        uint256 expectedFee = expectedToUser * FEE_BPS / 10_000;

        uint256 rate = ovrflo.previewRate(PRIMARY_MARKET);
        (uint256 previewToUser, uint256 previewToStream, uint256 previewRate) = ovrflo.previewStream(PRIMARY_MARKET, PT_AMOUNT);
        (uint256 depositToUser, uint256 depositToStream, uint256 feeAmount, uint256 depositRate) =
            ovrflo.previewDeposit(PRIMARY_MARKET, PT_AMOUNT);

        assertEq(rate, PRIMARY_RATE_30M);
        assertEq(previewRate, PRIMARY_RATE_30M);
        assertEq(depositRate, PRIMARY_RATE_30M);
        assertEq(previewToUser, expectedToUser);
        assertEq(previewToStream, expectedToStream);
        assertEq(depositToUser, expectedToUser);
        assertEq(depositToStream, expectedToStream);
        assertEq(feeAmount, expectedFee);
    }

    function test_Deposit_PrimaryMarketTransfersLivePtAndCreatesRealStream() public {
        (, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(FEE_BPS);
        (uint256 expectedToUser, uint256 expectedToStream, uint256 feeAmount,) = ovrflo.previewDeposit(PRIMARY_MARKET, PT_AMOUNT);

        _seedBalancesAndApprovals(ovrflo, PT_AMOUNT, feeAmount);

        vm.prank(USER);
        (uint256 toUser, uint256 toStream, uint256 streamId) = ovrflo.deposit(PRIMARY_MARKET, PT_AMOUNT, expectedToUser);

        assertEq(toUser, expectedToUser);
        assertEq(toStream, expectedToStream);
        assertGt(streamId, 0);
        assertEq(IERC20(PRIMARY_PT).balanceOf(address(ovrflo)), PT_AMOUNT);
        assertEq(IERC20(WSTETH).balanceOf(TREASURY), feeAmount);
        assertEq(token.balanceOf(USER), toUser);
        assertEq(token.balanceOf(address(ovrflo)), 0);
        assertEq(token.balanceOf(address(ovrflo.sablierLL())), toStream);
        assertEq(token.totalSupply(), PT_AMOUNT);
        assertEq(ovrflo.marketTotalDeposited(PRIMARY_MARKET), PT_AMOUNT);
    }

    function test_Claim_PrimaryMarketRedeemsLivePtAfterStreamWithdrawal() public {
        (, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));

        _seedBalancesAndApprovals(ovrflo, PT_AMOUNT, 0);

        vm.prank(USER);
        (uint256 toUser, uint256 toStream, uint256 streamId) = ovrflo.deposit(PRIMARY_MARKET, PT_AMOUNT, 0);

        vm.warp(PRIMARY_EXPIRY);

        assertEq(token.balanceOf(USER), toUser);
        assertEq(uint256(sablier.withdrawableAmountOf(streamId)), toStream);

        vm.prank(USER);
        (bool success,) = address(sablier).call(abi.encodeWithSignature("withdrawMax(uint256,address)", streamId, USER));
        assertTrue(success);

        assertEq(token.balanceOf(USER), PT_AMOUNT);

        vm.prank(USER);
        ovrflo.claim(PRIMARY_PT, PT_AMOUNT);

        assertEq(token.balanceOf(USER), 0);
        assertEq(IERC20(PRIMARY_PT).balanceOf(USER), PT_AMOUNT);
        assertEq(IERC20(PRIMARY_PT).balanceOf(address(ovrflo)), 0);
        assertEq(ovrflo.marketTotalDeposited(PRIMARY_MARKET), 0);
    }

    function _deployApprovedPrimarySeries(uint16 feeBps)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        (factory, ovrflo, token) = _deployConfiguredSystem();

        _prepareOracleOffchain(PRIMARY_MARKET, PROTOCOL_TWAP_DURATION);

        vm.startPrank(OWNER);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, PROTOCOL_TWAP_DURATION, feeBps);
        vm.stopPrank();
    }

    function _seedBalancesAndApprovals(OVRFLO ovrflo, uint256 ptAmount, uint256 feeAmount) internal {
        deal(PRIMARY_PT, USER, ptAmount);
        if (feeAmount > 0) {
            deal(WSTETH, USER, feeAmount);
        }

        vm.startPrank(USER);
        IERC20(PRIMARY_PT).approve(address(ovrflo), ptAmount);
        IERC20(WSTETH).approve(address(ovrflo), feeAmount);
        vm.stopPrank();
    }
}