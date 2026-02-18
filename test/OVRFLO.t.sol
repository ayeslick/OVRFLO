// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";

contract OVRFLOTest is Test {
    OVRFLOFactory public factory;
    OVRFLO public ovrflo;

    address public constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    address public constant PENDLE_MARKET = 0xC374f7eC85F8C7DE3207a10bB1978bA104bdA3B2;
    address public constant PENDLE_SY = 0xcbC72d92b2dc8187414F6734718563898740C0BC;
    address public constant PENDLE_PT = 0xf99985822fb361117FCf3768D34a6353E6022F5F;

    address public constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;

    address public constant MULTISIG = address(0x123);
    address public constant TREASURY = address(0x456);

    uint32 public constant TWAP_DURATION = 30 minutes;

    address public ovrfloToken;

    function setUp() public {
        vm.startPrank(MULTISIG);

        factory = new OVRFLOFactory(MULTISIG);

        factory.configureDeployment(TREASURY, WSTETH);
        (address vault, address token) = factory.deploy();

        ovrflo = OVRFLO(vault);
        ovrfloToken = token;

        factory.prepareOracle(PENDLE_MARKET, TWAP_DURATION);

        uint256 expiry = IPendleMarket(PENDLE_MARKET).expiry();

        factory.setSeriesApproved(
            vault,
            PENDLE_MARKET,
            PENDLE_PT,
            WSTETH,
            ovrfloToken,
            TWAP_DURATION,
            expiry,
            100 // 1% fee
        );

        vm.stopPrank();
    }

    function test_Deposit_Success() public {
        address user = makeAddr("user");
        uint256 ptAmount = 10 ether;
        uint256 feeAmount = 0.3 ether;

        deal(PENDLE_PT, user, ptAmount);
        deal(WSTETH, user, feeAmount);

        vm.startPrank(user);

        IERC20(PENDLE_PT).approve(address(ovrflo), ptAmount);
        IERC20(WSTETH).approve(address(ovrflo), feeAmount);

        uint256 userPtBalanceBefore = IERC20(PENDLE_PT).balanceOf(user);

        (uint256 expectedToUser, uint256 expectedToStream,) = ovrflo.previewStream(PENDLE_MARKET, ptAmount);

        (uint256 actualToUser, uint256 actualToStream, uint256 streamId) = ovrflo.deposit(PENDLE_MARKET, ptAmount, 0);

        vm.stopPrank();

        assertEq(actualToUser, expectedToUser, "toUser should match preview");
        assertEq(actualToStream, expectedToStream, "toStream should match preview");

        assertEq(IERC20(PENDLE_PT).balanceOf(user), userPtBalanceBefore - ptAmount, "User PT balance should decrease");
        assertEq(IERC20(PENDLE_PT).balanceOf(address(ovrflo)), ptAmount, "Vault should receive PT tokens");

        assertGt(streamId, 0, "Stream ID should be created");
    }
}
