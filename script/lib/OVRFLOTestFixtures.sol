// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {StdCheats} from "forge-std/StdCheats.sol";

import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {IPendleOracle} from "../../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";

/// @dev Comptroller getters used only to verify a `vm.getCode` deploy (SC23).
interface ISeedComptroller {
    function admin() external view returns (address);
    function flashFee() external view returns (uint256);
    function protocolFees(address asset) external view returns (uint256);
}

/// @notice Shared mainnet-fork fixtures consumed by both Forge fork tests
///         (test/fork/*) and Forge seed scripts (script/Seed*.s.sol).
///         Stream-layer bytecode comes from committed artifacts via
///         `deployCode` / `vm.getCode` (KTD1). Never `vm.etch` that bytecode.
abstract contract OVRFLOTestFixtures is StdCheats {
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

    /// @dev Canonical Sablier v1.1. Seed and fork tests must not bind this address.
    address internal constant CANONICAL_SABLIER = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;

    string internal constant COMPTROLLER_ARTIFACT = "artifacts/SablierV2Comptroller.json";
    string internal constant DESCRIPTOR_ARTIFACT = "artifacts/OVRFLOStreamDescriptor.json";
    string internal constant LOCKUP_ARTIFACT = "artifacts/OVRFLOStream.json";

    /// @notice Deploy comptroller, descriptor, and lockup from committed artifacts.
    /// @dev `initialAdmin` is the factory. Never the Safe. Never the deployer.
    function _deployStreamLayer(address factory)
        internal
        returns (address comptroller, address descriptor, address stream)
    {
        comptroller = deployCode(COMPTROLLER_ARTIFACT, abi.encode(factory));
        require(ISeedComptroller(comptroller).admin() == factory, "OVRFLOTestFixtures: comptroller admin");
        require(ISeedComptroller(comptroller).flashFee() == 0, "OVRFLOTestFixtures: flash fee");
        require(ISeedComptroller(comptroller).protocolFees(WSTETH) == 0, "OVRFLOTestFixtures: protocol fee");

        descriptor = deployCode(DESCRIPTOR_ARTIFACT);
        require(descriptor.code.length > 0, "OVRFLOTestFixtures: descriptor code");

        stream = deployCode(LOCKUP_ARTIFACT, abi.encode(factory, comptroller, descriptor));
        ISablierV2LockupLinear lockup = ISablierV2LockupLinear(stream);
        require(lockup.admin() == factory, "OVRFLOTestFixtures: stream admin");
        require(lockup.factory() == factory, "OVRFLOTestFixtures: stream factory");
        require(lockup.comptroller() == comptroller, "OVRFLOTestFixtures: stream comptroller");
        require(stream != CANONICAL_SABLIER, "OVRFLOTestFixtures: canonical sablier");
    }

    /// @notice Deploy the factory + OVRFLO (which constructs its own token) against
    ///         wstETH, then register the vault. Caller must already hold the `owner`
    ///         role on the calling context (`vm.startPrank(owner)` in tests,
    ///         broadcast-as-owner in scripts) because `setOvrfloStream` and
    ///         `registerOvrflo` are onlyOwner. Deploys OVRFLOStream from committed
    ///         artifacts (KTD1).
    function _deployConfiguredSystemAs(address owner)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        factory = new OVRFLOFactory(owner, address(ORACLE));
        require(factory.owner() == owner, "OVRFLOTestFixtures: factory owner");
        require(factory.oracle() == address(ORACLE), "OVRFLOTestFixtures: factory oracle");

        (,, address stream) = _deployStreamLayer(address(factory));
        factory.setOvrfloStream(stream);
        require(factory.ovrfloStream() == stream, "OVRFLOTestFixtures: ovrfloStream");

        ovrflo = new OVRFLO(
            address(factory), TREASURY, WSTETH, "OVRFLO Wrapped Staked Ether", "ovrfloWSTETH", address(ORACLE), stream
        );
        require(ovrflo.factory() == address(factory), "OVRFLOTestFixtures: vault factory");
        require(address(ovrflo.sablierLL()) == stream, "OVRFLOTestFixtures: vault stream");

        factory.registerOvrflo(address(ovrflo));
        token = OVRFLOToken(ovrflo.ovrfloToken());
    }

    /// @notice Clear the oracle cardinality requirement for a Pendle market.
    ///         Caller must already be acting as the factory owner (prank in
    ///         tests, broadcast in scripts) because `prepareOracle` is
    ///         onlyOwner.
    function _prepareOracleAs(OVRFLOFactory factory, address market) internal {
        factory.prepareOracle(market, MIN_TWAP_DURATION);
    }
}
