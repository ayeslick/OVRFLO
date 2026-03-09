// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {IPendleMarket} from "../../interfaces/IPendleMarket.sol";
import {IStandardizedYield} from "../../interfaces/IStandardizedYield.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

contract OVRFLOFactoryMainnetForkTest is OVRFLOForkBase {
    function test_PrepareOracle_PrimaryMarketClearsCardinalityRequirement() public {
        (bool increaseRequiredBefore, uint16 cardinalityRequiredBefore, bool oldestObservationSatisfiedBefore) =
            ORACLE.getOracleState(PRIMARY_MARKET, MIN_TWAP_DURATION);

        assertTrue(increaseRequiredBefore);
        assertTrue(oldestObservationSatisfiedBefore);

        (OVRFLOFactory factory,,) = _deployConfiguredSystem();
        _prepareOracle(factory, PRIMARY_MARKET);

        (bool increaseRequiredAfter, uint16 cardinalityRequiredAfter, bool oldestObservationSatisfiedAfter) =
            ORACLE.getOracleState(PRIMARY_MARKET, MIN_TWAP_DURATION);

        assertFalse(increaseRequiredAfter);
        assertEq(cardinalityRequiredAfter, cardinalityRequiredBefore);
        assertTrue(oldestObservationSatisfiedAfter);
    }

    function test_AddMarket_RevertsUntilPrimaryOracleIsPrepared() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: oracle cardinality");
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_OnboardsPrimaryMarketUsingLiveMetadata() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        (address sy, address pt,) = IPendleMarket(PRIMARY_MARKET).readTokens();
        (, address assetAddress,) = IStandardizedYield(sy).assetInfo();
        uint256 expiry = IPendleMarket(PRIMARY_MARKET).expiry();

        assertEq(sy, WSTETH_SY);
        assertEq(pt, PRIMARY_PT);
        assertEq(assetAddress, STETH);
        assertEq(expiry, PRIMARY_EXPIRY);

        _prepareOracle(factory, PRIMARY_MARKET);

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, MIN_TWAP_DURATION, 25);

        (
            bool approved,
            uint32 twapDuration,
            uint16 feeBps,
            uint256 storedExpiry,
            address storedPt,
            address storedToken,
            address storedUnderlying
        ) = ovrflo.series(PRIMARY_MARKET);

        assertTrue(approved);
        assertEq(twapDuration, MIN_TWAP_DURATION);
        assertEq(feeBps, 25);
        assertEq(storedExpiry, expiry);
        assertEq(storedPt, pt);
        assertEq(storedToken, address(token));
        assertEq(storedUnderlying, STETH);
        assertEq(ovrflo.ptToMarket(pt), PRIMARY_MARKET);
        assertTrue(factory.isMarketApproved(address(ovrflo), PRIMARY_MARKET));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 1);
        assertEq(factory.getApprovedMarket(address(ovrflo), 0), PRIMARY_MARKET);
    }

    function test_AddMarket_AllowsSharedTokenAcrossLiveWstEthMaturities() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        (address primarySy,,) = IPendleMarket(PRIMARY_MARKET).readTokens();
        (address secondarySy,,) = IPendleMarket(SECONDARY_MARKET).readTokens();
        (, address primaryAsset,) = IStandardizedYield(primarySy).assetInfo();
        (, address secondaryAsset,) = IStandardizedYield(secondarySy).assetInfo();

        assertEq(primaryAsset, STETH);
        assertEq(secondaryAsset, STETH);

        _prepareOracle(factory, PRIMARY_MARKET);
        _prepareOracle(factory, SECONDARY_MARKET);

        vm.startPrank(OWNER);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, MIN_TWAP_DURATION, 5);
        factory.addMarket(address(ovrflo), SECONDARY_MARKET, MIN_TWAP_DURATION, 10);
        vm.stopPrank();

        (, , , uint256 primaryExpiry, address primaryPt, address primaryToken,) = ovrflo.series(PRIMARY_MARKET);
        (, , , uint256 secondaryExpiry, address secondaryPt, address secondaryToken,) = ovrflo.series(SECONDARY_MARKET);

        assertEq(primaryExpiry, PRIMARY_EXPIRY);
        assertEq(primaryPt, PRIMARY_PT);
        assertEq(primaryToken, address(token));
        assertEq(secondaryExpiry, SECONDARY_EXPIRY);
        assertEq(secondaryPt, SECONDARY_PT);
        assertEq(secondaryToken, address(token));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 2);
        assertEq(factory.getApprovedMarket(address(ovrflo), 0), PRIMARY_MARKET);
        assertEq(factory.getApprovedMarket(address(ovrflo), 1), SECONDARY_MARKET);
        assertEq(ovrflo.ptToMarket(PRIMARY_PT), PRIMARY_MARKET);
        assertEq(ovrflo.ptToMarket(SECONDARY_PT), SECONDARY_MARKET);
    }
}