// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

contract OVRFLOWrapUnwrapForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    address internal constant WRAPPER = address(0xA11CE);
    address internal constant DONOR = address(0xD0A0);
    address internal constant RECIPIENT = address(0xCAFE);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint256 internal constant WRAP_AMOUNT = 0.5 ether;
    uint256 internal constant PT_AMOUNT = 10 ether;

    function test_WrapUnwrap_RealWstEthRoundTripIsOneToOne() public {
        (, OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        _seedWstEth(USER, WRAP_AMOUNT);
        uint256 startingBalance = IERC20(WSTETH).balanceOf(USER);

        vm.startPrank(USER);
        IERC20(WSTETH).approve(address(ovrflo), WRAP_AMOUNT);
        ovrflo.wrap(WRAP_AMOUNT);
        vm.stopPrank();

        assertEq(token.balanceOf(USER), WRAP_AMOUNT);
        assertEq(IERC20(WSTETH).balanceOf(address(ovrflo)), WRAP_AMOUNT);
        assertEq(ovrflo.wrappedUnderlying(), WRAP_AMOUNT);

        vm.prank(USER);
        ovrflo.unwrap(WRAP_AMOUNT);

        assertEq(IERC20(WSTETH).balanceOf(USER), startingBalance);
        assertEq(token.balanceOf(USER), 0);
        assertEq(IERC20(WSTETH).balanceOf(address(ovrflo)), 0);
        assertEq(ovrflo.wrappedUnderlying(), 0);
    }

    function test_UnwrapBeyondFundedReserve_RevertsOnRealToken() public {
        (, OVRFLO ovrflo,) = _deployConfiguredSystem();
        _wrapWstEth(ovrflo, USER, WRAP_AMOUNT);

        vm.prank(USER);
        vm.expectRevert("OVRFLO: insufficient reserve");
        ovrflo.unwrap(WRAP_AMOUNT + 1);
    }

    function test_DepositOriginHolderCanUnwrapAgainstIndependentWrapperReserve() public {
        (, OVRFLO ovrflo, OVRFLOToken token) = _deployApprovedPrimarySeries(0);
        _wrapWstEth(ovrflo, WRAPPER, WRAP_AMOUNT);

        deal(PRIMARY_PT, USER, PT_AMOUNT);
        (uint256 expectedToUser,,,) = ovrflo.previewDeposit(PRIMARY_MARKET, PT_AMOUNT);

        vm.startPrank(USER);
        IERC20(PRIMARY_PT).approve(address(ovrflo), PT_AMOUNT);
        (uint256 toUser,,) = ovrflo.deposit(PRIMARY_MARKET, PT_AMOUNT, expectedToUser);
        vm.stopPrank();

        uint256 unwrapAmount = toUser < WRAP_AMOUNT ? toUser : WRAP_AMOUNT;
        uint256 startingWstEth = IERC20(WSTETH).balanceOf(USER);

        vm.prank(USER);
        ovrflo.unwrap(unwrapAmount);

        assertEq(IERC20(WSTETH).balanceOf(USER), startingWstEth + unwrapAmount);
        assertEq(token.balanceOf(USER), toUser - unwrapAmount);
        assertEq(ovrflo.wrappedUnderlying(), WRAP_AMOUNT - unwrapAmount);
        assertEq(ovrflo.marketTotalDeposited(PRIMARY_MARKET), PT_AMOUNT);
    }

    function test_FactorySweepExcessUnderlying_RecoversDonationAndLeavesReserveUnwrappable() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployConfiguredSystem();
        _wrapWstEth(ovrflo, WRAPPER, WRAP_AMOUNT);

        uint256 donation = 0.25 ether;
        _seedWstEth(DONOR, donation);

        vm.prank(DONOR);
        assertTrue(IERC20(WSTETH).transfer(address(ovrflo), donation));

        uint256 recipientBefore = IERC20(WSTETH).balanceOf(RECIPIENT);

        vm.prank(OWNER);
        factory.sweepExcessUnderlying(address(ovrflo), RECIPIENT);

        assertEq(IERC20(WSTETH).balanceOf(RECIPIENT), recipientBefore + donation);
        assertEq(IERC20(WSTETH).balanceOf(address(ovrflo)), WRAP_AMOUNT);
        assertEq(ovrflo.wrappedUnderlying(), WRAP_AMOUNT);

        vm.prank(WRAPPER);
        ovrflo.unwrap(WRAP_AMOUNT);

        assertEq(IERC20(WSTETH).balanceOf(address(ovrflo)), 0);
        assertEq(ovrflo.wrappedUnderlying(), 0);
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

    function _wrapWstEth(OVRFLO ovrflo, address account, uint256 amount) internal {
        _seedWstEth(account, amount);

        vm.startPrank(account);
        IERC20(WSTETH).approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        vm.stopPrank();
    }
}
