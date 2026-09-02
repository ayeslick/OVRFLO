// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {IPPrincipalToken} from "../interfaces/IPPrincipalToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {FactoryStreamBind} from "./helpers/FactoryStreamBind.sol";
import {MockSablier, MockSablierComptroller} from "./fizz/mocks/MockSablier.sol";
import {IOVRFLOFactoryRegistry} from "../src/StreamPricing.sol";

/// @notice Hand-written copy of the fork's `IOVRFLOFactoryRegistry.ovrfloInfo`
///         (`OVRFLO-Streams-u4/src/interfaces/IOVRFLOFactoryRegistry.sol`).
///         Field order must stay `treasury`, `underlying`, `ovrfloToken`.
interface IForkOvrfloInfoCopy {
    function ovrfloInfo(address ovrflo)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken);
}

contract MockERC20Metadata is ERC20 {
    uint8 private immutable CUSTOM_DECIMALS;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        CUSTOM_DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return CUSTOM_DECIMALS;
    }
}

contract MockPrincipalToken is MockERC20Metadata, IPPrincipalToken {
    address public immutable SY_TOKEN;
    uint256 public immutable PT_EXPIRY;

    constructor(address sy_, uint8 decimals_, uint256 expiry_) MockERC20Metadata("Mock PT", "mPT", decimals_) {
        SY_TOKEN = sy_;
        PT_EXPIRY = expiry_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnByYT(address user, uint256 amount) external {
        _burn(user, amount);
    }

    function mintByYT(address user, uint256 amount) external {
        _mint(user, amount);
    }

    function initialize(address) external {}

    function SY() external view returns (address) {
        return SY_TOKEN;
    }

    function YT() external pure returns (address) {
        return address(0);
    }

    function factory() external pure returns (address) {
        return address(0);
    }

    function expiry() external view returns (uint256) {
        return PT_EXPIRY;
    }

    function isExpired() external view returns (bool) {
        return block.timestamp >= PT_EXPIRY;
    }
}

contract MockPendleMarket is IPendleMarket {
    address private immutable SY_TOKEN;
    address private immutable PT_TOKEN;
    uint256 private immutable MARKET_EXPIRY;
    uint16 public lastCardinality;

    constructor(address sy_, address pt_, uint256 expiry_) {
        SY_TOKEN = sy_;
        PT_TOKEN = pt_;
        MARKET_EXPIRY = expiry_;
    }

    function expiry() external view returns (uint256) {
        return MARKET_EXPIRY;
    }

    function increaseObservationsCardinalityNext(uint16 cardinalityNext) external {
        lastCardinality = cardinalityNext;
    }

    function readTokens() external view returns (address, address, address) {
        return (SY_TOKEN, PT_TOKEN, address(0));
    }
}

/// @notice Hostile stub registry: reports every core as registered so genuine
///         `OVRFLOLending` bytecode can be constructed against it — the realistic
///         adversarial candidate `registerLending`'s `FactoryMismatch` check guards.
contract MockRegistryStub {
    address internal immutable TREASURY_VAL;
    address internal immutable UNDERLYING_VAL;
    address internal immutable TOKEN_VAL;

    constructor(address treasury_, address underlying_, address token_) {
        TREASURY_VAL = treasury_;
        UNDERLYING_VAL = underlying_;
        TOKEN_VAL = token_;
    }

    function ovrfloInfo(address) external view returns (address, address, address) {
        return (TREASURY_VAL, UNDERLYING_VAL, TOKEN_VAL);
    }
}

/// @notice Minimal lookalike exposing the getters `registerLending` interrogates,
///         for the check rows unreachable through honestly constructed bytecode.
contract MockLendingLookalike {
    address public core;
    address public factory;
    address public owner;
    address public sablier;

    constructor(address core_, address factory_, address owner_, address sablier_) {
        core = core_;
        factory = factory_;
        owner = owner_;
        sablier = sablier_;
    }
}

contract OVRFLOFactoryTest is Test, FactoryStreamBind {
    address internal constant OWNER = address(0x123);
    address internal constant TREASURY = address(0x456);
    address internal constant STRANGER = address(0x789);
    address internal constant NEW_OWNER = address(0xABC);
    address internal constant RECIPIENT = address(0xFED);
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    uint32 internal constant MIN_TWAP_DURATION = 15 minutes;

    event OvrfloRegistered(
        address indexed ovrflo, address indexed ovrfloToken, address treasury, address indexed underlying
    );
    event LendingRegistered(address indexed ovrflo, address indexed lending);
    event LendingAprBoundsSet(address indexed lending, uint16 aprMinBps, uint16 aprMaxBps);
    event LendingFeeSet(address indexed lending, uint16 feeBps);
    event LendingTreasurySet(address indexed lending, address indexed treasury);
    event LendingTickSpacingSet(address indexed lending, address indexed market, uint16 spacing);
    event LendingAprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    event LendingFeeSet(uint16 feeBps);
    event LendingTreasurySet(address indexed treasury);
    event TickSpacingSet(address indexed market, uint16 spacing);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event SeriesApproved(
        address indexed market,
        address indexed ptToken,
        address ovrfloToken,
        address underlying,
        address oracle,
        uint32 twapDuration,
        uint256 expiry,
        uint16 feeBps
    );
    event MarketDepositLimitSet(address indexed market, uint256 limit);
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);
    event OvrfloStreamSet(address indexed stream);
    event StreamNFTDescriptorSet(address indexed descriptor);

    OVRFLOFactory internal factory;
    MockERC20Metadata internal underlying;
    address internal stream;

    function setUp() public {
        factory = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        underlying = new MockERC20Metadata("Wrapped Ether", "WETH", 18);
        stream = _bindCanonicalStream(factory);
    }

    /* ---------- Constructor ---------- */

    function test_Constructor_SetsOwner() public view {
        assertEq(factory.owner(), OWNER);
        assertEq(factory.oracle(), PENDLE_ORACLE);
    }

    function test_Constructor_RevertsForZeroOwner() public {
        vm.expectRevert(OVRFLOFactory.ZeroAddress.selector);
        new OVRFLOFactory(address(0), PENDLE_ORACLE);
    }

    function test_Constructor_RevertsForZeroOracle() public {
        vm.expectRevert(OVRFLOFactory.ZeroAddress.selector);
        new OVRFLOFactory(OWNER, address(0));
    }

    /* ---------- Vault construction (Decision 7(a)) ---------- */

    function test_VaultConstruction_CreatesAndOwnsToken() public {
        OVRFLO ovrflo = _newVault(TREASURY, address(underlying));
        OVRFLOToken token = OVRFLOToken(ovrflo.ovrfloToken());

        assertTrue(address(token).code.length > 0);
        assertEq(token.vault(), address(ovrflo));
        assertEq(token.reserve(), ovrflo.reserve());
        assertEq(token.name(), "OVRFLO Wrapped Ether");
        assertEq(token.symbol(), "ovrfloWETH");
        assertEq(token.decimals(), 18);
    }

    /* ---------- registerOvrflo ---------- */

    function test_RegisterOvrflo_RevertsForUnauthorizedCaller() public {
        OVRFLO ovrflo = _newVault(TREASURY, address(underlying));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.registerOvrflo(address(ovrflo));
    }

    function test_RegisterOvrflo_RevertsForZeroAddress() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.ZeroAddress.selector);
        factory.registerOvrflo(address(0));
    }

    function test_RegisterOvrflo_RevertsWhenAlreadyRegistered() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.AlreadyRegistered.selector);
        factory.registerOvrflo(address(ovrflo));
    }

    function test_RegisterOvrflo_RevertsForFactoryMismatch() public {
        OVRFLO rogue = new OVRFLO(
            STRANGER, TREASURY, address(underlying), "OVRFLO Wrapped Ether", "ovrfloWETH", PENDLE_ORACLE, stream
        );

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.FactoryMismatch.selector);
        factory.registerOvrflo(address(rogue));
    }

    function test_RegisterOvrflo_RevertsForOracleMismatch() public {
        OVRFLO wrongOracle = new OVRFLO(
            address(factory),
            TREASURY,
            address(underlying),
            "OVRFLO Wrapped Ether",
            "ovrfloWETH",
            address(0xBAD),
            stream
        );

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OracleMismatch.selector);
        factory.registerOvrflo(address(wrongOracle));
    }

    function test_RegisterOvrflo_RevertsForDuplicateUnderlying() public {
        _deployConfiguredSystem();

        // A second, fully valid candidate on the same underlying — even with a
        // different treasury — must be rejected at registration (pattern #9).
        OVRFLO second = _newVault(NEW_OWNER, address(underlying));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnderlyingAlreadyDeployed.selector);
        factory.registerOvrflo(address(second));
    }

    function test_RegisterOvrflo_StoresAccountingAndEmits() public {
        OVRFLO ovrflo = _newVault(TREASURY, address(underlying));
        address tokenAddr = ovrflo.ovrfloToken();

        vm.expectEmit(true, true, true, true, address(factory));
        emit OvrfloRegistered(address(ovrflo), tokenAddr, TREASURY, address(underlying));

        vm.prank(OWNER);
        factory.registerOvrflo(address(ovrflo));

        assertEq(factory.ovrfloCount(), 1);
        assertEq(factory.ovrflos(0), address(ovrflo));
        assertEq(factory.underlyingToOvrflo(address(underlying)), address(ovrflo));

        OVRFLOFactory.OvrfloInfo memory info;
        (info.treasury, info.underlying, info.ovrfloToken) = factory.ovrfloInfo(address(ovrflo));
        assertEq(info.treasury, TREASURY);
        assertEq(info.underlying, address(underlying));
        assertEq(info.ovrfloToken, tokenAddr);
    }

    function test_RegisterOvrflo_AllowsDifferentUnderlyings() public {
        (OVRFLO ovrflo1,) = _deployConfiguredSystem();

        MockERC20Metadata dai = new MockERC20Metadata("Dai", "DAI", 18);
        OVRFLO ovrflo2 = new OVRFLO(
            address(factory), TREASURY, address(dai), "OVRFLO Dai Stablecoin", "ovrfloDAI", PENDLE_ORACLE, stream
        );

        vm.prank(OWNER);
        factory.registerOvrflo(address(ovrflo2));

        assertEq(factory.underlyingToOvrflo(address(underlying)), address(ovrflo1));
        assertEq(factory.underlyingToOvrflo(address(dai)), address(ovrflo2));
        assertEq(factory.ovrfloCount(), 2);
    }

    /* ---------- registerLending ---------- */

    function test_RegisterLending_RevertsForUnauthorizedCaller() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending lending = _newLending(ovrflo);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.registerLending(address(lending));
    }

    function test_RegisterLending_RevertsForZeroAddress() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.ZeroAddress.selector);
        factory.registerLending(address(0));
    }

    function test_RegisterLending_RevertsForUnknownCore() public {
        // A candidate whose core was never registered here: only reachable via a
        // lookalike, since real bytecode cannot even construct against an
        // unregistered core (see test_RegisterLending_ConstructionRevertsForUnregisteredCore).
        MockLendingLookalike lookalike =
            new MockLendingLookalike(address(0xDEAD), address(factory), address(factory), address(0xCAFE));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.registerLending(address(lookalike));
    }

    function test_RegisterLending_RevertsWhenLendingExists() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        _deployRegisteredLending(ovrflo);

        OVRFLOLending second = _newLending(ovrflo);
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.LendingExists.selector);
        factory.registerLending(address(second));
    }

    function test_RegisterLending_RevertsForFactoryMismatch() public {
        // The realistic adversarial candidate: GENUINE OVRFLOLending bytecode
        // constructed against a hostile stub registry that reports the real vault
        // as registered. It passes the core check (the vault IS registered here);
        // FactoryMismatch is the sole on-chain guard for this class.
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        MockRegistryStub stub = new MockRegistryStub(TREASURY, address(underlying), address(token));
        OVRFLOLending hostile = new OVRFLOLending(address(stub), address(ovrflo), address(ovrflo.sablierLL()), 1000);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.FactoryMismatch.selector);
        factory.registerLending(address(hostile));
    }

    function test_RegisterLending_RevertsForOwnerMismatch() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        MockLendingLookalike lookalike =
            new MockLendingLookalike(address(ovrflo), address(factory), STRANGER, address(ovrflo.sablierLL()));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OwnerMismatch.selector);
        factory.registerLending(address(lookalike));
    }

    function test_RegisterLending_RevertsForSablierMismatch() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        MockLendingLookalike lookalike =
            new MockLendingLookalike(address(ovrflo), address(factory), address(factory), address(0xCAFE));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.SablierMismatch.selector);
        factory.registerLending(address(lookalike));
    }

    function test_RegisterLending_StoresAccountingAndEmits() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending lending = _newLending(ovrflo);

        vm.expectEmit(true, true, true, true, address(factory));
        emit LendingRegistered(address(ovrflo), address(lending));

        vm.prank(OWNER);
        factory.registerLending(address(lending));

        assertEq(factory.ovrfloToLending(address(ovrflo)), address(lending));
        assertEq(factory.lendingToOvrflo(address(lending)), address(ovrflo));
        assertEq(factory.lendingCount(), 1);
        assertEq(factory.lendings(0), address(lending));
    }

    function test_RegisterLending_SucceedsFromEoaDeployedLending() public {
        // End-to-end happy path with the lending deployed by a plain EOA, no
        // pranks-as-factory anywhere: the shape that exposes ownership-model
        // regressions which owner-pranked fixtures mask.
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(STRANGER);
        OVRFLOLending lending = new OVRFLOLending(address(factory), address(ovrflo), address(ovrflo.sablierLL()), 1000);

        assertEq(lending.owner(), address(factory));
        assertEq(lending.pendingOwner(), address(0));

        vm.prank(OWNER);
        factory.registerLending(address(lending));

        assertEq(factory.ovrfloToLending(address(ovrflo)), address(lending));
        assertEq(address(lending.factory()), address(factory));
        assertEq(lending.core(), address(ovrflo));
        assertEq(address(lending.sablier()), address(ovrflo.sablierLL()));
    }

    function test_RegisterLending_UnregisteredLendingStaysInert() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending rogue = _newLending(ovrflo);

        // Factory-owned from birth, but unregistered: no forwarder will touch it...
        assertEq(rogue.owner(), address(factory));
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownLending.selector);
        factory.setLendingTickSpacing(address(rogue), address(0xCA11), 25);

        // ...so its tick spacing is permanently unset and the book can never open.
        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        rogue.supply(address(0xCA11), 1000, 1e15);
    }

    function test_RegisterLending_ConstructionRevertsForUnregisteredCore() public {
        // Pins the runbook ordering: the lending cannot even be constructed until
        // its core vault is registered with the factory it points at.
        vm.expectRevert(OVRFLOLending.UnknownCore.selector);
        new OVRFLOLending(address(factory), address(0xDEAD), address(0xCAFE), 1000);
    }

    function test_LendingConstruction_EmitsOwnershipHandoffToFactory() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        // Construction emits two OwnershipTransferred events: OZ Ownable's
        // zero->deployer, then the constructor's deployer->factory handoff.
        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(address(0), address(this));
        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(address(this), address(factory));

        _newLending(ovrflo);
    }

    /* ---------- Owner gating and two-step ownership ---------- */

    function test_OwnerOnlyFunctions_RevertForUnauthorizedCallers() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.registerOvrflo(address(ovrflo));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.registerLending(address(0xB00B));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.prepareOracle(address(market), MIN_TWAP_DURATION);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setMarketDepositLimit(address(ovrflo), address(market), 1 ether);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.sweepExcessPt(address(ovrflo), address(pt), RECIPIENT);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.transferOwnership(NEW_OWNER);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingAprBounds(address(ovrflo), 500, 2000);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingFee(address(ovrflo), 50);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingTreasury(address(ovrflo), NEW_OWNER);
    }

    function test_TransferOwnership_TwoStepHandoffUpdatesOwnerAndAllowsNewOwnerActions() public {
        MockERC20Metadata dai = new MockERC20Metadata("Dai", "DAI", 18);
        OVRFLO candidate = new OVRFLO(
            address(factory), TREASURY, address(dai), "OVRFLO Dai Stablecoin", "ovrfloDAI", PENDLE_ORACLE, stream
        );

        vm.expectEmit(true, true, false, false, address(factory));
        emit OwnershipTransferStarted(OWNER, NEW_OWNER);

        vm.prank(OWNER);
        factory.transferOwnership(NEW_OWNER);

        assertEq(factory.owner(), OWNER);
        assertEq(factory.pendingOwner(), NEW_OWNER);

        vm.prank(NEW_OWNER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.registerOvrflo(address(candidate));

        vm.expectEmit(true, true, false, false, address(factory));
        emit OwnershipTransferred(OWNER, NEW_OWNER);

        vm.prank(NEW_OWNER);
        factory.acceptOwnership();

        assertEq(factory.owner(), NEW_OWNER);
        assertEq(factory.pendingOwner(), address(0));

        vm.prank(OWNER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.registerOvrflo(address(candidate));

        vm.prank(NEW_OWNER);
        factory.registerOvrflo(address(candidate));
        assertEq(factory.underlyingToOvrflo(address(dai)), address(candidate));
    }

    function test_AcceptOwnership_RevertsForNonPendingOwner() public {
        vm.prank(OWNER);
        factory.transferOwnership(NEW_OWNER);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable2Step: caller is not the new owner");
        factory.acceptOwnership();

        vm.prank(OWNER);
        vm.expectRevert("Ownable2Step: caller is not the new owner");
        factory.acceptOwnership();

        assertEq(factory.owner(), OWNER);
        assertEq(factory.pendingOwner(), NEW_OWNER);
    }

    /* ---------- Oracle preparation and market onboarding ---------- */

    function test_PrepareOracle_RevertsForShortDurationAndIncreasesCardinalityWhenRequired() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.TwapTooShort.selector);
        factory.prepareOracle(address(0xBEEF), MIN_TWAP_DURATION - 1);

        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, true, 9, false);

        vm.prank(OWNER);
        factory.prepareOracle(address(market), MIN_TWAP_DURATION);

        assertEq(market.lastCardinality(), 9);
    }

    function test_PrepareOracle_RevertsWhenTwapTooLong() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.TwapTooLong.selector);
        factory.prepareOracle(address(0xBEEF), 30 minutes + 1);
    }

    function test_PrepareOracle_DoesNothingWhenCardinalityAlreadySufficient() public {
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);

        vm.prank(OWNER);
        factory.prepareOracle(address(market), MIN_TWAP_DURATION);

        assertEq(market.lastCardinality(), 0);
    }

    function test_PrepareOracle_SucceedsBeforeAddMarketStillRevertsWhenOldestObservationIsNotReady() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        address sy = address(0xBBBB);
        MockPrincipalToken pt = new MockPrincipalToken(sy, 18, expiry);
        MockPendleMarket market = new MockPendleMarket(sy, address(pt), expiry);

        _mockOracleState(address(market), MIN_TWAP_DURATION, true, 9, false);

        vm.prank(OWNER);
        factory.prepareOracle(address(market), MIN_TWAP_DURATION);

        assertEq(market.lastCardinality(), 9);

        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, false);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OracleNotReady.selector);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_RevertsForUnknownOvrfloOrInvalidConfig() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.addMarket(address(0xDEAD), address(0xBEEF), MIN_TWAP_DURATION, 0);

        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.TwapTooShort.selector);
        factory.addMarket(address(ovrflo), address(0xBEEF), MIN_TWAP_DURATION - 1, 0);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.FeeTooHigh.selector);
        factory.addMarket(address(ovrflo), address(0xBEEF), MIN_TWAP_DURATION, 101);
    }

    function test_AddMarket_RevertsWhenTwapTooLong() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        uint32 tooLong = 30 minutes + 1;
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.TwapTooLong.selector);
        factory.addMarket(address(ovrflo), address(0xBEEF), tooLong, 0);
    }

    function test_AddMarket_RevertsWhenMarketAlreadyExpired() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 pastExpiry = block.timestamp - 1;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, pastExpiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), pastExpiry);

        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 5, true);
        _mockSyYieldToken(address(0xBBBB), address(underlying));
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.MarketExpired.selector);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_RevertsWhenOracleNeedsPreparationOrIsNotReady() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);

        _mockOracleState(address(market), MIN_TWAP_DURATION, true, 5, true);
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OracleCardinalityRequired.selector);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, false);
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OracleNotReady.selector);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_OnboardsMarketUpdatesRegistryAndEmitsSeriesEvent() public {
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        address sy = address(0xBBBB);
        MockPrincipalToken pt = new MockPrincipalToken(sy, 18, expiry);
        MockPendleMarket market = new MockPendleMarket(sy, address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);
        _mockSyYieldToken(sy, address(underlying));

        vm.expectEmit(true, false, false, true, address(ovrflo));
        emit SeriesApproved(
            address(market),
            address(pt),
            address(token),
            address(underlying),
            PENDLE_ORACLE,
            MIN_TWAP_DURATION,
            expiry,
            25
        );

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 25);

        {
            (
                uint32 twapDuration,
                uint16 feeBps,
                uint256 storedExpiry,
                address storedPt,
                address storedToken,
                address storedUnderlying,
                address storedOracle
            ) = ovrflo.series(address(market));

            assertTrue(storedPt != address(0));
            assertEq(twapDuration, MIN_TWAP_DURATION);
            assertEq(feeBps, 25);
            assertEq(storedExpiry, expiry);
            assertEq(storedPt, address(pt));
            assertEq(storedToken, address(token));
            assertEq(storedUnderlying, address(underlying));
            assertEq(storedOracle, PENDLE_ORACLE);
        }

        assertEq(ovrflo.ptToMarket(address(pt)), address(market));
        assertTrue(factory.isMarketApproved(address(ovrflo), address(market)));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 1);
        assertEq(factory.approvedMarketAt(address(ovrflo), 0), address(market));
    }

    function test_AddMarket_AllowsSharedTokenAcrossMaturities() public {
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();

        uint256 expiry1 = block.timestamp + 30 days;
        address sy1 = address(0xBBBB);
        MockPrincipalToken pt1 = new MockPrincipalToken(sy1, 18, expiry1);
        MockPendleMarket market1 = new MockPendleMarket(sy1, address(pt1), expiry1);
        _mockOracleState(address(market1), MIN_TWAP_DURATION, false, 0, true);
        _mockSyYieldToken(sy1, address(underlying));

        uint256 expiry2 = block.timestamp + 60 days;
        address sy2 = address(0xDDDD);
        MockPrincipalToken pt2 = new MockPrincipalToken(sy2, 18, expiry2);
        MockPendleMarket market2 = new MockPendleMarket(sy2, address(pt2), expiry2);
        _mockOracleState(address(market2), MIN_TWAP_DURATION, false, 0, true);
        _mockSyYieldToken(sy2, address(underlying));

        vm.startPrank(OWNER);
        factory.addMarket(address(ovrflo), address(market1), MIN_TWAP_DURATION, 5);
        factory.addMarket(address(ovrflo), address(market2), MIN_TWAP_DURATION, 10);
        vm.stopPrank();

        _assertSeriesTokenAndUnderlying(ovrflo, address(market1), address(token), address(underlying));
        _assertSeriesTokenAndUnderlying(ovrflo, address(market2), address(token), address(underlying));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 2);
        assertEq(ovrflo.ptToMarket(address(pt1)), address(market1));
        assertEq(ovrflo.ptToMarket(address(pt2)), address(market2));
    }

    function test_AddMarket_RevertsWhenSamePtIsMappedAcrossTwoMarkets() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 firstExpiry = block.timestamp + 30 days;
        uint256 secondExpiry = block.timestamp + 60 days;
        address sy1 = address(0xAAA3);
        address sy2 = address(0xAAA4);
        MockPrincipalToken pt = new MockPrincipalToken(sy1, 18, firstExpiry);
        MockPendleMarket market1 = new MockPendleMarket(sy1, address(pt), firstExpiry);
        MockPendleMarket market2 = new MockPendleMarket(sy2, address(pt), secondExpiry);

        _mockOracleState(address(market1), MIN_TWAP_DURATION, false, 0, true);
        _mockOracleState(address(market2), MIN_TWAP_DURATION, false, 0, true);
        _mockSyYieldToken(sy1, address(underlying));
        _mockSyYieldToken(sy2, address(underlying));

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), address(market1), MIN_TWAP_DURATION, 0);

        assertEq(ovrflo.ptToMarket(address(pt)), address(market1));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLO.PtAlreadyMapped.selector);
        factory.addMarket(address(ovrflo), address(market2), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_RevertsWhenMarketUnderlyingDiffersFromConfiguredUnderlying() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        address sy = address(0xBBBB);
        MockPrincipalToken pt = new MockPrincipalToken(sy, 18, expiry);
        MockPendleMarket market = new MockPendleMarket(sy, address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);
        _mockSyYieldToken(sy, address(0xCAFE));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnderlyingMismatch.selector);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        assertFalse(factory.isMarketApproved(address(ovrflo), address(market)));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 0);
    }

    /* ---------- Vault admin forwarding ---------- */

    function test_SetMarketDepositLimit_RevertsForUnknownOvrflo() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.setMarketDepositLimit(address(0xDEAD), address(0xBEEF), 1 ether);
    }

    function test_SweepExcessPt_RevertsForUnknownOvrflo() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.sweepExcessPt(address(0xDEAD), address(0xBEEF), RECIPIENT);
    }

    function test_SetMarketDepositLimit_ForwardsToOvrfloAndEmitsEvent() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        address market = address(0xBEEF);

        vm.expectEmit(true, false, false, true, address(ovrflo));
        emit MarketDepositLimitSet(market, 123 ether);

        vm.prank(OWNER);
        factory.setMarketDepositLimit(address(ovrflo), market, 123 ether);

        assertEq(ovrflo.marketDepositLimits(market), 123 ether);
    }

    function test_SweepExcessPt_RevertsWithoutExcessAndTransfersExcessWhenPresent() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        address sy = address(0xBBBB);
        MockPrincipalToken pt = new MockPrincipalToken(sy, 18, expiry);
        MockPendleMarket market = new MockPendleMarket(sy, address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);
        _mockSyYieldToken(sy, address(underlying));

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLO.NoExcess.selector);
        factory.sweepExcessPt(address(ovrflo), address(pt), RECIPIENT);

        pt.mint(address(ovrflo), 5 ether);

        vm.expectEmit(true, true, false, true, address(ovrflo));
        emit ExcessSwept(address(pt), RECIPIENT, 5 ether);

        vm.prank(OWNER);
        factory.sweepExcessPt(address(ovrflo), address(pt), RECIPIENT);

        assertEq(pt.balanceOf(RECIPIENT), 5 ether);
        assertEq(pt.balanceOf(address(ovrflo)), 0);
    }

    /* ---------- Lending admin forwarding ---------- */

    function test_LendingAdmin_RevertForUnauthorizedCallers() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending lending = _deployRegisteredLending(ovrflo);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingAprBounds(address(lending), 500, 2000);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingFee(address(lending), 50);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingTreasury(address(lending), NEW_OWNER);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setLendingTickSpacing(address(lending), address(0xCA11), 25);
    }

    function test_LendingAdmin_RevertsForUnknownLending() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownLending.selector);
        factory.setLendingAprBounds(address(0xDEAD), 500, 2000);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownLending.selector);
        factory.setLendingFee(address(0xDEAD), 50);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownLending.selector);
        factory.setLendingTreasury(address(0xDEAD), NEW_OWNER);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownLending.selector);
        factory.setLendingTickSpacing(address(0xDEAD), address(0xCA11), 25);
    }

    function test_LendingAdmin_ForwardsToLendingAndEmitsEvents() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending b = _deployRegisteredLending(ovrflo);
        address lending = address(b);

        // setAprBounds — lending event fires first (inside the call), then factory event
        vm.expectEmit(lending);
        emit LendingAprBoundsSet(500, 2000);
        vm.expectEmit(true, false, false, false, address(factory));
        emit LendingAprBoundsSet(lending, 500, 2000);

        vm.prank(OWNER);
        factory.setLendingAprBounds(lending, 500, 2000);

        assertEq(b.aprMinBps(), 500);
        assertEq(b.aprMaxBps(), 2000);

        // setFee
        vm.expectEmit(lending);
        emit LendingFeeSet(50);
        vm.expectEmit(true, false, false, false, address(factory));
        emit LendingFeeSet(lending, 50);

        vm.prank(OWNER);
        factory.setLendingFee(lending, 50);

        assertEq(b.feeBps(), 50);

        // setTreasury
        vm.expectEmit(true, false, false, false, lending);
        emit LendingTreasurySet(NEW_OWNER);
        vm.expectEmit(true, true, false, false, address(factory));
        emit LendingTreasurySet(lending, NEW_OWNER);

        vm.prank(OWNER);
        factory.setLendingTreasury(lending, NEW_OWNER);

        assertEq(b.treasury(), NEW_OWNER);

        // setTickSpacing — immutable-once-set on the lending, re-emitted by the factory
        address market = address(0xCA11);
        vm.expectEmit(true, false, false, true, lending);
        emit TickSpacingSet(market, 25);
        vm.expectEmit(true, true, false, true, address(factory));
        emit LendingTickSpacingSet(lending, market, 25);

        vm.prank(OWNER);
        factory.setLendingTickSpacing(lending, market, 25);

        assertEq(b.tickSpacing(market), 25);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOLending.SpacingAlreadySet.selector);
        factory.setLendingTickSpacing(lending, market, 50);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOLending.ZeroSpacing.selector);
        factory.setLendingTickSpacing(lending, address(0xCA12), 0);
    }

    function test_LendingAdmin_LendingOnlyOwnerRevertsForNonFactory() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending b = _deployRegisteredLending(ovrflo);

        // The multisig (OWNER) is NOT the lending's owner — factory is
        vm.prank(OWNER);
        vm.expectRevert("Ownable: caller is not the owner");
        b.setAprBounds(500, 2000);
    }

    /* ---------- Lending enumeration ---------- */

    function test_RegisterLending_EnumeratesMultipleLendings() public {
        (OVRFLO ovrflo1,) = _deployConfiguredSystem();

        MockERC20Metadata dai = new MockERC20Metadata("Dai", "DAI", 18);
        OVRFLO ovrflo2 = new OVRFLO(
            address(factory), TREASURY, address(dai), "OVRFLO Dai Stablecoin", "ovrfloDAI", PENDLE_ORACLE, stream
        );
        vm.prank(OWNER);
        factory.registerOvrflo(address(ovrflo2));

        OVRFLOLending lending1 = _deployRegisteredLending(ovrflo1);
        OVRFLOLending lending2 = _deployRegisteredLending(ovrflo2);

        assertEq(factory.lendingCount(), 2);
        assertEq(factory.lendings(0), address(lending1));
        assertEq(factory.lendings(1), address(lending2));
        assertEq(factory.lendingToOvrflo(address(lending1)), address(ovrflo1));
        assertEq(factory.lendingToOvrflo(address(lending2)), address(ovrflo2));
    }

    /* ---------- OVRFLO Stream admission ---------- */

    function test_SetOvrfloStream_RevertsOnSecondCall() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OvrfloStreamAlreadySet.selector);
        factory.setOvrfloStream(stream);
    }

    function test_SetOvrfloStream_RevertsForZeroAddress() public {
        OVRFLOFactory fresh = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.ZeroAddress.selector);
        fresh.setOvrfloStream(address(0));
    }

    function test_SetOvrfloStream_RevertsForNoCode() public {
        OVRFLOFactory fresh = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.NoCode.selector);
        fresh.setOvrfloStream(address(0xBEEF));
    }

    function test_SetOvrfloStream_RevertsForFactoryMismatch() public {
        OVRFLOFactory fresh = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        MockSablierComptroller c = new MockSablierComptroller(address(fresh));
        MockSablier s = new MockSablier(STRANGER, address(fresh), address(c));
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.StreamFactoryMismatch.selector);
        fresh.setOvrfloStream(address(s));
    }

    function test_SetOvrfloStream_RevertsForAdminMismatch() public {
        OVRFLOFactory fresh = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        MockSablierComptroller c = new MockSablierComptroller(address(fresh));
        MockSablier s = new MockSablier(address(fresh), STRANGER, address(c));
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.StreamAdminMismatch.selector);
        fresh.setOvrfloStream(address(s));
    }

    function test_SetOvrfloStream_RevertsForComptrollerAdminMismatch() public {
        OVRFLOFactory fresh = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        MockSablierComptroller c = new MockSablierComptroller(STRANGER);
        MockSablier s = new MockSablier(address(fresh), address(fresh), address(c));
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.ComptrollerAdminMismatch.selector);
        fresh.setOvrfloStream(address(s));
    }

    function test_RegisterOvrflo_RevertsWhenStreamUnset() public {
        OVRFLOFactory fresh = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        OVRFLO vault = new OVRFLO(
            address(fresh), TREASURY, address(underlying), "OVRFLO Wrapped Ether", "ovrfloWETH", PENDLE_ORACLE, stream
        );
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.OvrfloStreamUnset.selector);
        fresh.registerOvrflo(address(vault));
    }

    function test_RegisterOvrflo_RevertsWhenStreamNotCanonical() public {
        MockSablierComptroller c = new MockSablierComptroller(address(factory));
        MockSablier other = new MockSablier(address(factory), address(factory), address(c));
        OVRFLO vault = new OVRFLO(
            address(factory),
            TREASURY,
            address(underlying),
            "OVRFLO Wrapped Ether",
            "ovrfloWETH",
            PENDLE_ORACLE,
            address(other)
        );
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.StreamNotCanonical.selector);
        factory.registerOvrflo(address(vault));
    }

    function test_RegisterLending_RevertsWhenStreamNotCanonical() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        vm.mockCall(address(ovrflo), abi.encodeWithSignature("sablierLL()"), abi.encode(address(0xCAFE)));
        MockLendingLookalike lookalike =
            new MockLendingLookalike(address(ovrflo), address(factory), address(factory), address(0xCAFE));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.StreamNotCanonical.selector);
        factory.registerLending(address(lookalike));
    }

    function test_RegisterLending_DoesNotRecheckStreamFactoryAdmin() public {
        canonicalComptroller.setAdmin(STRANGER);
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        OVRFLOLending lending = _newLending(ovrflo);
        vm.prank(OWNER);
        factory.registerLending(address(lending));
        assertEq(factory.ovrfloToLending(address(ovrflo)), address(lending));
    }

    function test_OvrfloInfo_SelectorAndTreasuryFirstAcrossThreeCopies() public {
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        bytes4 expected = IOVRFLOFactoryRegistry.ovrfloInfo.selector;
        assertEq(expected, bytes4(keccak256("ovrfloInfo(address)")));
        assertEq(factory.ovrfloInfo.selector, expected);
        assertEq(IForkOvrfloInfoCopy.ovrfloInfo.selector, expected);

        (address treasury, address und, address tok) = factory.ovrfloInfo(address(ovrflo));
        assertEq(treasury, TREASURY);
        assertEq(und, address(underlying));
        assertEq(tok, address(token));

        (bool ok, bytes memory data) = address(factory).staticcall(abi.encodeWithSelector(expected, address(ovrflo)));
        assertTrue(ok);
        (address decodedTreasury, address decodedUnd, address decodedTok) =
            abi.decode(data, (address, address, address));
        assertEq(decodedTreasury, TREASURY);
        assertEq(decodedUnd, address(underlying));
        assertEq(decodedTok, address(token));
    }

    function test_FactoryAbi_HasNoTransferAdminOrFeeForwarders() public {
        bytes memory empty;
        _assertEmptyRevert(address(factory), abi.encodeWithSignature("transferAdmin(address)", OWNER), empty);
        _assertEmptyRevert(address(factory), abi.encodeWithSignature("setComptroller(address)", OWNER), empty);
        _assertEmptyRevert(address(factory), abi.encodeWithSignature("claimProtocolRevenues(address)", OWNER), empty);
        _assertEmptyRevert(
            address(factory), abi.encodeWithSignature("setProtocolFee(address,uint256)", OWNER, uint256(0)), empty
        );
        _assertEmptyRevert(address(factory), abi.encodeWithSignature("setFlashFee(uint256)", uint256(0)), empty);
        _assertEmptyRevert(address(factory), abi.encodeWithSignature("toggleFlashAsset(address)", OWNER), empty);
        _assertEmptyRevert(address(factory), abi.encodeWithSignature("execute(address,bytes)", OWNER, bytes("")), empty);
    }

    function test_SetStreamNFTDescriptor_OwnerUpdatesAndDirectOwnerCallReverts() public {
        vm.expectEmit(true, false, false, true, address(factory));
        emit StreamNFTDescriptorSet(address(underlying));
        vm.prank(OWNER);
        factory.setStreamNFTDescriptor(address(underlying));
        assertEq(canonicalStream.nftDescriptor(), address(underlying));

        vm.prank(OWNER);
        vm.expectRevert(bytes("not admin"));
        canonicalStream.setNFTDescriptor(address(underlying));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.ZeroAddress.selector);
        factory.setStreamNFTDescriptor(address(0));

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.NoCode.selector);
        factory.setStreamNFTDescriptor(address(0xBEEF));
    }

    function test_CreateWithDurations_RegisteredVaultMintsUnregisteredReverts() public {
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        ISablierV2LockupLinear.CreateWithDurations memory params = ISablierV2LockupLinear.CreateWithDurations({
            sender: address(ovrflo),
            recipient: STRANGER,
            totalAmount: 1 ether,
            asset: IERC20(address(token)),
            cancelable: false,
            transferable: true,
            durations: ISablierV2LockupLinear.Durations({cliff: 0, total: 30 days}),
            broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
        });

        vm.prank(STRANGER);
        vm.expectRevert(bytes("not registered vault"));
        canonicalStream.createWithDurations(params);

        vm.prank(address(ovrflo));
        token.mint(address(ovrflo), 1 ether);
        vm.prank(address(ovrflo));
        uint256 streamId = canonicalStream.createWithDurations(params);
        assertEq(streamId, 1);
        assertEq(canonicalStream.ownerOf(streamId), STRANGER);
    }

    function _assertEmptyRevert(address target, bytes memory callData, bytes memory empty) internal {
        (bool ok, bytes memory data) = target.call(callData);
        assertFalse(ok);
        assertEq(data, empty);
    }

    /* ---------- Helpers ---------- */

    function _newVault(address treasuryAddr, address underlyingAddr) internal returns (OVRFLO) {
        return new OVRFLO(
            address(factory), treasuryAddr, underlyingAddr, "OVRFLO Wrapped Ether", "ovrfloWETH", PENDLE_ORACLE, stream
        );
    }

    function _newLending(OVRFLO ovrflo) internal returns (OVRFLOLending) {
        return new OVRFLOLending(address(factory), address(ovrflo), address(ovrflo.sablierLL()), 1000);
    }

    function _deployConfiguredSystem() internal returns (OVRFLO ovrflo, OVRFLOToken token) {
        ovrflo = _newVault(TREASURY, address(underlying));
        vm.prank(OWNER);
        factory.registerOvrflo(address(ovrflo));
        token = OVRFLOToken(ovrflo.ovrfloToken());
    }

    function _deployRegisteredLending(OVRFLO ovrflo) internal returns (OVRFLOLending lending) {
        lending = _newLending(ovrflo);
        vm.prank(OWNER);
        factory.registerLending(address(lending));
    }

    function _mockOracleState(
        address market,
        uint32 twapDuration,
        bool increaseRequired,
        uint16 cardinality,
        bool oldestSatisfied
    ) internal {
        vm.mockCall(
            PENDLE_ORACLE,
            abi.encodeWithSignature("getOracleState(address,uint32)", market, twapDuration),
            abi.encode(increaseRequired, cardinality, oldestSatisfied)
        );
    }

    function _mockSyYieldToken(address sy, address yieldToken) internal {
        vm.mockCall(sy, abi.encodeWithSignature("yieldToken()"), abi.encode(yieldToken));
    }

    function _assertSeriesTokenAndUnderlying(
        OVRFLO ovrflo,
        address market,
        address expectedToken,
        address expectedUnderlying
    ) internal view {
        (,,,, address storedToken, address storedUnderlying,) = ovrflo.series(market);
        assertEq(storedToken, expectedToken);
        assertEq(storedUnderlying, expectedUnderlying);
    }
}
