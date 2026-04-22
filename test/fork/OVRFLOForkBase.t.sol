// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
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
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"), MAINNET_FORK_BLOCK);
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
}
