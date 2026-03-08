// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {IPendleMarket} from "../../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../../interfaces/IPendleOracle.sol";

abstract contract OVRFLOForkBase is Test {
    address internal constant OWNER = address(0x123);
    address internal constant TREASURY = address(0x456);
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

    function setUp() public virtual {
        vm.createSelectFork(vm.envString("MAINNET_RPC_URL"), MAINNET_FORK_BLOCK);
    }

    function _deployConfiguredSystem()
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        factory = new OVRFLOFactory(OWNER);

        vm.startPrank(OWNER);
        factory.configureDeployment(TREASURY, WSTETH);
        address tokenAddr;
        address ovrfloAddr;
        (ovrfloAddr, tokenAddr) = factory.deploy();
        vm.stopPrank();

        ovrflo = OVRFLO(ovrfloAddr);
        token = OVRFLOToken(tokenAddr);
    }

    function _prepareOracleOffchain(address market, uint32 twapDuration) internal {
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) = ORACLE.getOracleState(market, twapDuration);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }
    }
}