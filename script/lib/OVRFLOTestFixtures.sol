// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {IPendleOracle} from "../../interfaces/IPendleOracle.sol";

/// @notice Shared mainnet-fork fixtures consumed by both Forge fork tests
///         (test/fork/*) and Forge seed scripts (script/Seed*.s.sol). Pure
///         data + cheatcode-free helpers so scripts can inherit without
///         pulling forge-std/Test.
abstract contract OVRFLOTestFixtures {
    address internal constant OWNER = address(0x123);
    address internal constant TREASURY = address(0x456);

    address internal constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address internal constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address internal constant WSTETH_SY = 0xcbC72d92b2dc8187414F6734718563898740C0BC;

    address internal constant PRIMARY_MARKET = 0xcFD848b9f6fEf552204014ac67901223AD6bf679;
    address internal constant PRIMARY_PT = 0x9cE6478EF45bB1BAAC69EFd8A3eA0ed110a43042;
    uint256 internal constant PRIMARY_EXPIRY = 1_782_345_600;

    address internal constant SECONDARY_MARKET = 0x34280882267ffa6383B363E278B027Be083bBe3b;
    address internal constant SECONDARY_PT = 0xb253Eff1104802b97aC7E3aC9FdD73AecE295a2c;
    uint256 internal constant SECONDARY_EXPIRY = 1_830_124_800;

    uint32 internal constant MIN_TWAP_DURATION = 15 minutes;
    uint256 internal constant MAINNET_FORK_BLOCK = 24_609_670;

    IPendleOracle internal constant ORACLE = IPendleOracle(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);

    /// @notice Deploy the factory + OVRFLO + token configured against stETH.
    ///         Caller must already hold the `owner` role on the calling
    ///         context (`vm.startPrank(owner)` in tests, broadcast-as-owner
    ///         in scripts) because `configureDeployment` is onlyOwner.
    function _deployConfiguredSystemAs(address owner)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        factory = new OVRFLOFactory(owner);
        factory.configureDeployment(TREASURY, STETH, "Lido Staked Ether", "STETH");
        (address ovrfloAddr, address tokenAddr) = factory.deploy();
        ovrflo = OVRFLO(ovrfloAddr);
        token = OVRFLOToken(tokenAddr);
    }

    /// @notice Clear the oracle cardinality requirement for a Pendle market.
    ///         Caller must already be acting as the factory owner (prank in
    ///         tests, broadcast in scripts) because `prepareOracle` is
    ///         onlyOwner.
    function _prepareOracleAs(OVRFLOFactory factory, address market) internal {
        factory.prepareOracle(market, address(ORACLE), MIN_TWAP_DURATION);
    }
}
