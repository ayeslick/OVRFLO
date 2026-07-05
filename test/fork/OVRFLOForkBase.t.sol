// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {OVRFLOTestFixtures} from "../../script/lib/OVRFLOTestFixtures.sol";

/// @notice Test-facing shim around {OVRFLOTestFixtures}. Inherits all
///         mainnet constants and pure deploy helpers from the fixtures
///         module, then wraps them with test-only prank semantics so the
///         existing fork test call sites (`_deployConfiguredSystem()`,
///         `_prepareOracle(factory, market)`) continue to work unchanged.
abstract contract OVRFLOForkBase is OVRFLOTestFixtures, Test {
    function setUp() public virtual {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc, MAINNET_FORK_BLOCK);
    }

    function _deployConfiguredSystem() internal returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) {
        vm.startPrank(OWNER);
        (factory, ovrflo, token) = _deployConfiguredSystemAs(OWNER);
        vm.stopPrank();
    }

    function _prepareOracle(OVRFLOFactory factory, address market) internal {
        vm.prank(OWNER);
        _prepareOracleAs(factory, market);
    }

    function _seedWstEth(address account, uint256 minAmount) internal {
        uint256 ethAmount = minAmount * 2;
        vm.deal(account, ethAmount);

        vm.startPrank(account);
        (bool submitted,) =
            payable(STETH).call{value: ethAmount}(abi.encodeWithSignature("submit(address)", address(0)));
        assertTrue(submitted);

        uint256 stEthBalance = IERC20(STETH).balanceOf(account);
        IERC20(STETH).approve(WSTETH, stEthBalance);

        (bool wrapped,) = WSTETH.call(abi.encodeWithSignature("wrap(uint256)", stEthBalance));
        assertTrue(wrapped);
        vm.stopPrank();

        assertGe(IERC20(WSTETH).balanceOf(account), minAmount);
    }
}
