// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPPrincipalToken} from "../interfaces/IPPrincipalToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";

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
    function SY() external view returns (address) { return SY_TOKEN; }
    function YT() external pure returns (address) { return address(0); }
    function factory() external pure returns (address) { return address(0); }
    function expiry() external view returns (uint256) { return PT_EXPIRY; }
    function isExpired() external view returns (bool) { return block.timestamp >= PT_EXPIRY; }
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

    function expiry() external view returns (uint256) { return MARKET_EXPIRY; }
    function increaseObservationsCardinalityNext(uint16 cardinalityNext) external { lastCardinality = cardinalityNext; }
    function readTokens() external view returns (address, address, address) { return (SY_TOKEN, PT_TOKEN, address(0)); }
}

contract OVRFLOFactoryTest is Test {
    address internal constant OWNER = address(0x123);
    address internal constant TREASURY = address(0x456);
    address internal constant STRANGER = address(0x789);
    address internal constant NEW_OWNER = address(0xABC);
    address internal constant NEW_ADMIN = address(0xDEF);
    address internal constant RECIPIENT = address(0xFED);
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    uint32 internal constant MIN_TWAP_DURATION = 15 minutes;

    event DeploymentConfigured(address indexed treasury, address indexed underlying);
    event DeploymentCancelled();
    event OvrfloDeployed(address indexed ovrflo, address indexed ovrfloToken, address treasury, address underlying);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OvrfloAdminTransferred(address indexed ovrflo, address indexed newAdmin);
    event SeriesApproved(
        address indexed market, address ptToken, address ovrfloToken, address underlying, uint256 expiry, uint16 feeBps
    );
    event MarketDepositLimitSet(address indexed market, uint256 limit);
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);

    OVRFLOFactory internal factory;
    MockERC20Metadata internal underlying;

    function setUp() public {
        factory = new OVRFLOFactory(OWNER);
        underlying = new MockERC20Metadata("Wrapped Ether", "WETH", 18);
    }

    function test_Constructor_SetsOwner() public view {
        assertEq(factory.owner(), OWNER);
    }

    function test_Constructor_RevertsForZeroOwner() public {
        vm.expectRevert("OVRFLOFactory: owner zero");
        new OVRFLOFactory(address(0));
    }

    function test_ConfigureDeployment_RevertsForUnauthorizedOrZeroInputs() public {
        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.configureDeployment(TREASURY, address(underlying));

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: treasury zero");
        factory.configureDeployment(address(0), address(underlying));

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: underlying zero");
        factory.configureDeployment(TREASURY, address(0));
    }

    function test_ConfigureDeployment_StoresPendingConfigAndEmitsEvent() public {
        vm.expectEmit(true, true, false, false, address(factory));
        emit DeploymentConfigured(TREASURY, address(underlying));

        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying));

        (address pendingTreasury, bool pending, address pendingUnderlying) = factory.pendingDeployment();
        assertEq(pendingTreasury, TREASURY);
        assertTrue(pending);
        assertEq(pendingUnderlying, address(underlying));
    }

    function test_CancelDeployment_RevertsWithoutPendingAndClearsPendingWhenConfigured() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: nothing pending");
        factory.cancelDeployment();

        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying));

        vm.expectEmit(false, false, false, false, address(factory));
        emit DeploymentCancelled();

        vm.prank(OWNER);
        factory.cancelDeployment();

        (address pendingTreasury, bool pending, address pendingUnderlying) = factory.pendingDeployment();
        assertEq(pendingTreasury, address(0));
        assertFalse(pending);
        assertEq(pendingUnderlying, address(0));
    }

    function test_Deploy_RevertsWithoutPendingDeployment() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: nothing pending");
        factory.deploy();
    }

    function test_Deploy_DeploysSystemStoresAccountingAndTransfersTokenOwnership() public {
        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying));

        vm.expectEmit(false, false, false, true, address(factory));
        emit OvrfloDeployed(address(0), address(0), TREASURY, address(underlying));

        vm.prank(OWNER);
        (address ovrfloAddr, address tokenAddr) = factory.deploy();

        OVRFLO ovrflo = OVRFLO(ovrfloAddr);
        OVRFLOToken token = OVRFLOToken(tokenAddr);

        assertEq(factory.ovrfloCount(), 1);
        assertEq(factory.ovrflos(0), ovrfloAddr);
        assertEq(ovrflo.adminContract(), address(factory));
        assertEq(ovrflo.TREASURY_ADDR(), TREASURY);
        assertEq(token.owner(), ovrfloAddr);
        assertEq(token.name(), "OVRFLO Wrapped Ether");
        assertEq(token.symbol(), "ovrfloWETH");
        assertEq(token.decimals(), 18);

        OVRFLOFactory.OvrfloInfo memory info = factory.getOvrfloInfo(ovrfloAddr);
        assertEq(info.treasury, TREASURY);
        assertEq(info.underlying, address(underlying));
        assertEq(info.ovrfloToken, tokenAddr);

        (, bool pending,) = factory.pendingDeployment();
        assertFalse(pending);
    }

    function test_Deploy_UsesFixed18DecimalsEvenWhenUnderlyingUsesSixDecimals() public {
        MockERC20Metadata sixDecimalUnderlying = new MockERC20Metadata("Mock USD", "mUSD", 6);

        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(sixDecimalUnderlying));

        vm.prank(OWNER);
        (address ovrfloAddr, address tokenAddr) = factory.deploy();

        OVRFLOToken token = OVRFLOToken(tokenAddr);

        assertEq(token.owner(), ovrfloAddr);
        assertEq(token.name(), "OVRFLO Mock USD");
        assertEq(token.symbol(), "ovrflomUSD");
        assertEq(token.decimals(), 18);
    }

    function test_OwnerOnlyFunctions_RevertForUnauthorizedCallers() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.configureDeployment(TREASURY, address(underlying));

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.cancelDeployment();

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.deploy();

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.prepareOracle(address(market), MIN_TWAP_DURATION);

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.setMarketDepositLimit(address(ovrflo), address(market), 1 ether);

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.sweepExcessPt(address(ovrflo), address(pt), RECIPIENT);

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.transferOvrfloAdmin(address(ovrflo), NEW_ADMIN);

        vm.prank(STRANGER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.transferOwnership(NEW_OWNER);
    }

    function test_PrepareOracle_RevertsForShortDurationAndIncreasesCardinalityWhenRequired() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: twap too short");
        factory.prepareOracle(address(0xBEEF), MIN_TWAP_DURATION - 1);

        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, true, 9, false);

        vm.prank(OWNER);
        factory.prepareOracle(address(market), MIN_TWAP_DURATION);

        assertEq(market.lastCardinality(), 9);
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

    function test_AddMarket_RevertsForUnknownOvrfloOrInvalidConfig() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown ovrflo");
        factory.addMarket(address(0xDEAD), address(0xBEEF), MIN_TWAP_DURATION, 0);

        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: twap too short");
        factory.addMarket(address(ovrflo), address(0xBEEF), MIN_TWAP_DURATION - 1, 0);

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: fee too high");
        factory.addMarket(address(ovrflo), address(0xBEEF), MIN_TWAP_DURATION, 101);
    }

    function test_AddMarket_RevertsWhenOracleNeedsPreparationOrIsNotReady() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);

        _mockOracleState(address(market), MIN_TWAP_DURATION, true, 5, true);
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: oracle cardinality");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, false);
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: oracle not ready");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_OnboardsMarketUpdatesRegistryAndEmitsSeriesEvent() public {
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);

        vm.expectEmit(true, false, false, true, address(ovrflo));
        emit SeriesApproved(address(market), address(pt), address(token), address(underlying), expiry, 25);

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 25);

        (bool approved, uint32 twapDuration, uint16 feeBps, uint256 storedExpiry, address storedPt, address storedToken, address storedUnderlying) =
            ovrflo.series(address(market));

        assertTrue(approved);
        assertEq(twapDuration, MIN_TWAP_DURATION);
        assertEq(feeBps, 25);
        assertEq(storedExpiry, expiry);
        assertEq(storedPt, address(pt));
        assertEq(storedToken, address(token));
        assertEq(storedUnderlying, address(underlying));
        assertEq(ovrflo.ptToMarket(address(pt)), address(market));
        assertTrue(factory.isMarketApproved(address(ovrflo), address(market)));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 1);
        assertEq(factory.getApprovedMarket(address(ovrflo), 0), address(market));
    }

    function test_AddMarket_AllowsSharedTokenAcrossMaturities() public {
        (OVRFLO ovrflo, OVRFLOToken token) = _deployConfiguredSystem();

        uint256 expiry1 = block.timestamp + 30 days;
        MockPrincipalToken pt1 = new MockPrincipalToken(address(0xAAAA), 18, expiry1);
        MockPendleMarket market1 = new MockPendleMarket(address(0xBBBB), address(pt1), expiry1);
        _mockOracleState(address(market1), MIN_TWAP_DURATION, false, 0, true);

        uint256 expiry2 = block.timestamp + 60 days;
        MockPrincipalToken pt2 = new MockPrincipalToken(address(0xCCCC), 18, expiry2);
        MockPendleMarket market2 = new MockPendleMarket(address(0xDDDD), address(pt2), expiry2);
        _mockOracleState(address(market2), MIN_TWAP_DURATION, false, 0, true);

        vm.startPrank(OWNER);
        factory.addMarket(address(ovrflo), address(market1), MIN_TWAP_DURATION, 5);
        factory.addMarket(address(ovrflo), address(market2), MIN_TWAP_DURATION, 10);
        vm.stopPrank();

        (, , , , , address tokenForFirst,) = ovrflo.series(address(market1));
        (, , , , , address tokenForSecond,) = ovrflo.series(address(market2));

        assertEq(tokenForFirst, address(token));
        assertEq(tokenForSecond, address(token));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 2);
        assertEq(ovrflo.ptToMarket(address(pt1)), address(market1));
        assertEq(ovrflo.ptToMarket(address(pt2)), address(market2));
    }

    function test_AddMarket_AllowsMarketSyToDifferFromConfiguredUnderlying() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        (, , , , , , address storedUnderlying) = ovrflo.series(address(market));
        assertEq(storedUnderlying, address(underlying));
        assertTrue(factory.isMarketApproved(address(ovrflo), address(market)));
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
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);
        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);

        vm.prank(OWNER);
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        vm.prank(OWNER);
        vm.expectRevert("OVRFLO: no excess");
        factory.sweepExcessPt(address(ovrflo), address(pt), RECIPIENT);

        pt.mint(address(ovrflo), 5 ether);

        vm.expectEmit(true, true, false, true, address(ovrflo));
        emit ExcessSwept(address(pt), RECIPIENT, 5 ether);

        vm.prank(OWNER);
        factory.sweepExcessPt(address(ovrflo), address(pt), RECIPIENT);

        assertEq(pt.balanceOf(RECIPIENT), 5 ether);
        assertEq(pt.balanceOf(address(ovrflo)), 0);
    }

    function test_TransferOvrfloAdmin_UpdatesAdminClearsFactoryInfoAndEmitsEvent() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: newAdmin zero");
        factory.transferOvrfloAdmin(address(ovrflo), address(0));

        vm.expectEmit(true, true, false, false, address(factory));
        emit OvrfloAdminTransferred(address(ovrflo), NEW_ADMIN);

        vm.prank(OWNER);
        factory.transferOvrfloAdmin(address(ovrflo), NEW_ADMIN);

        assertEq(ovrflo.adminContract(), NEW_ADMIN);

        OVRFLOFactory.OvrfloInfo memory info = factory.getOvrfloInfo(address(ovrflo));
        assertEq(info.treasury, address(0));
        assertEq(info.underlying, address(0));
        assertEq(info.ovrfloToken, address(0));

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown ovrflo");
        factory.setMarketDepositLimit(address(ovrflo), address(0xBEEF), 1);
    }

    function test_TransferOwnership_UpdatesOwnerAndAllowsNewOwnerActions() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: newOwner zero");
        factory.transferOwnership(address(0));

        vm.expectEmit(true, true, false, false, address(factory));
        emit OwnershipTransferred(OWNER, NEW_OWNER);

        vm.prank(OWNER);
        factory.transferOwnership(NEW_OWNER);

        assertEq(factory.owner(), NEW_OWNER);

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: not owner");
        factory.configureDeployment(TREASURY, address(underlying));

        vm.prank(NEW_OWNER);
        factory.configureDeployment(TREASURY, address(underlying));
    }

    function _deployConfiguredSystem() internal returns (OVRFLO ovrflo, OVRFLOToken token) {
        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying));

        vm.prank(OWNER);
        (address ovrfloAddr, address tokenAddr) = factory.deploy();

        ovrflo = OVRFLO(ovrfloAddr);
        token = OVRFLOToken(tokenAddr);
    }

    function _mockOracleState(address market, uint32 twapDuration, bool increaseRequired, uint16 cardinality, bool oldestSatisfied)
        internal
    {
        vm.mockCall(
            PENDLE_ORACLE,
            abi.encodeWithSignature("getOracleState(address,uint32)", market, twapDuration),
            abi.encode(increaseRequired, cardinality, oldestSatisfied)
        );
    }
}