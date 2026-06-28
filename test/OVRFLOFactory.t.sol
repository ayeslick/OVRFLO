// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";
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

contract OVRFLOFactoryTest is Test {
    address internal constant OWNER = address(0x123);
    address internal constant TREASURY = address(0x456);
    address internal constant STRANGER = address(0x789);
    address internal constant NEW_OWNER = address(0xABC);
    address internal constant RECIPIENT = address(0xFED);
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    uint32 internal constant MIN_TWAP_DURATION = 15 minutes;

    event DeploymentConfigured(address indexed treasury, address indexed underlying);
    event DeploymentCancelled();
    event OvrfloDeployed(address indexed ovrflo, address indexed ovrfloToken, address treasury, address underlying);
    event BookDeployed(address indexed ovrflo, address indexed book);
    event BookAprBoundsSet(address indexed book, uint16 aprMinBps, uint16 aprMaxBps);
    event BookFeeSet(address indexed book, uint16 feeBps);
    event BookTreasurySet(address indexed book, address treasury);
    event AprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    event FeeSet(uint16 feeBps);
    event TreasurySet(address indexed treasury);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event SeriesApproved(
        address indexed market,
        address ptToken,
        address ovrfloToken,
        address underlying,
        address oracle,
        uint32 twapDuration,
        uint256 expiry,
        uint16 feeBps
    );
    event MarketDepositLimitSet(address indexed market, uint256 limit);
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);

    OVRFLOFactory internal factory;
    MockERC20Metadata internal underlying;

    function setUp() public {
        factory = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        underlying = new MockERC20Metadata("Wrapped Ether", "WETH", 18);
    }

    function test_Constructor_SetsOwner() public view {
        assertEq(factory.owner(), OWNER);
        assertEq(factory.oracle(), PENDLE_ORACLE);
    }

    function test_Constructor_RevertsForZeroOwner() public {
        vm.expectRevert("OVRFLOFactory: owner zero");
        new OVRFLOFactory(address(0), PENDLE_ORACLE);
    }

    function test_Constructor_RevertsForZeroOracle() public {
        vm.expectRevert("OVRFLOFactory: oracle zero");
        new OVRFLOFactory(OWNER, address(0));
    }

    function test_ConfigureDeployment_RevertsForUnauthorizedOrZeroInputs() public {
        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: treasury zero");
        factory.configureDeployment(address(0), address(underlying), "Wrapped Ether", "WETH");

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: underlying zero");
        factory.configureDeployment(TREASURY, address(0), "Wrapped Ether", "WETH");
    }

    function test_ConfigureDeployment_RevertsForInvalidNameOrSymbol() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: bad name");
        factory.configureDeployment(TREASURY, address(underlying), "", "WETH");

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: bad symbol");
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "");

        string memory tooLongName = "This name is intentionally way too long for the factory to accept it OK";
        assertGt(bytes(tooLongName).length, 64);
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: bad name");
        factory.configureDeployment(TREASURY, address(underlying), tooLongName, "WETH");

        string memory tooLongSymbol = "THIS_SYMBOL_IS_DEFINITELY_TOO_LONG";
        assertGt(bytes(tooLongSymbol).length, 32);
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: bad symbol");
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", tooLongSymbol);
    }

    function test_ConfigureDeployment_StoresPendingConfigAndEmitsEvent() public {
        vm.expectEmit(true, true, false, false, address(factory));
        emit DeploymentConfigured(TREASURY, address(underlying));

        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        (
            address pendingTreasury,
            bool pending,
            address pendingUnderlying,
            string memory nameSuffix,
            string memory symbolSuffix
        ) = factory.pendingDeployment();
        assertEq(pendingTreasury, TREASURY);
        assertTrue(pending);
        assertEq(pendingUnderlying, address(underlying));
        assertEq(nameSuffix, "Wrapped Ether");
        assertEq(symbolSuffix, "WETH");
    }

    function test_CancelDeployment_RevertsWithoutPendingAndClearsPendingWhenConfigured() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: nothing pending");
        factory.cancelDeployment();

        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.expectEmit(false, false, false, false, address(factory));
        emit DeploymentCancelled();

        vm.prank(OWNER);
        factory.cancelDeployment();

        (
            address pendingTreasury,
            bool pending,
            address pendingUnderlying,
            string memory nameSuffix,
            string memory symbolSuffix
        ) = factory.pendingDeployment();
        assertEq(pendingTreasury, address(0));
        assertFalse(pending);
        assertEq(pendingUnderlying, address(0));
        assertEq(nameSuffix, "");
        assertEq(symbolSuffix, "");
    }

    function test_Deploy_RevertsWithoutPendingDeployment() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: nothing pending");
        factory.deploy();
    }

    function test_Deploy_DeploysSystemStoresAccountingAndTransfersTokenOwnership() public {
        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.expectEmit(false, false, false, true, address(factory));
        emit OvrfloDeployed(address(0), address(0), TREASURY, address(underlying));

        vm.prank(OWNER);
        (address ovrfloAddr, address tokenAddr) = factory.deploy();

        OVRFLO ovrflo = OVRFLO(ovrfloAddr);
        OVRFLOToken token = OVRFLOToken(tokenAddr);

        assertEq(factory.ovrfloCount(), 1);
        assertEq(factory.ovrflos(0), ovrfloAddr);
        assertEq(ovrflo.factory(), address(factory));
        assertEq(ovrflo.TREASURY_ADDR(), TREASURY);
        assertEq(token.owner(), ovrfloAddr);
        assertEq(token.name(), "OVRFLO Wrapped Ether");
        assertEq(token.symbol(), "ovrfloWETH");
        assertEq(token.decimals(), 18);

        OVRFLOFactory.OvrfloInfo memory info = factory.getOvrfloInfo(ovrfloAddr);
        assertEq(info.treasury, TREASURY);
        assertEq(info.underlying, address(underlying));
        assertEq(info.ovrfloToken, tokenAddr);

        (, bool pending,,,) = factory.pendingDeployment();
        assertFalse(pending);
    }

    function test_OwnerOnlyFunctions_RevertForUnauthorizedCallers() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        uint256 expiry = block.timestamp + 30 days;
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAAA), 18, expiry);
        MockPendleMarket market = new MockPendleMarket(address(0xBBBB), address(pt), expiry);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.cancelDeployment();

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.deploy();

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
        factory.deployBook(address(ovrflo));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setBookAprBounds(address(ovrflo), 500, 2000);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setBookFee(address(ovrflo), 50);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setBookTreasury(address(ovrflo), NEW_OWNER);
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
        vm.expectRevert("OVRFLOFactory: oracle not ready");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
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

    function test_AddMarket_RevertsWhenTwapTooLong() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        uint32 tooLong = 30 minutes + 1;
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: twap too long");
        factory.addMarket(address(ovrflo), address(0xBEEF), tooLong, 0);
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
                bool approved,
                uint32 twapDuration,
                uint16 feeBps,
                uint256 storedExpiry,
                address storedPt,
                address storedToken,
                address storedUnderlying,
                address storedOracle
            ) = ovrflo.series(address(market));

            assertTrue(approved);
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
        assertEq(factory.getApprovedMarket(address(ovrflo), 0), address(market));
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
        vm.expectRevert("OVRFLO: PT already mapped");
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
        vm.expectRevert("OVRFLOFactory: underlying mismatch");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        assertFalse(factory.isMarketApproved(address(ovrflo), address(market)));
        assertEq(factory.approvedMarketCount(address(ovrflo)), 0);
    }

    function test_SetMarketDepositLimit_RevertsForUnknownOvrflo() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown ovrflo");
        factory.setMarketDepositLimit(address(0xDEAD), address(0xBEEF), 1 ether);
    }

    function test_SweepExcessPt_RevertsForUnknownOvrflo() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown ovrflo");
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

    function test_TransferOwnership_TwoStepHandoffUpdatesOwnerAndAllowsNewOwnerActions() public {
        vm.expectEmit(true, true, false, false, address(factory));
        emit OwnershipTransferStarted(OWNER, NEW_OWNER);

        vm.prank(OWNER);
        factory.transferOwnership(NEW_OWNER);

        assertEq(factory.owner(), OWNER);
        assertEq(factory.pendingOwner(), NEW_OWNER);

        vm.prank(NEW_OWNER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.expectEmit(true, true, false, false, address(factory));
        emit OwnershipTransferred(OWNER, NEW_OWNER);

        vm.prank(NEW_OWNER);
        factory.acceptOwnership();

        assertEq(factory.owner(), NEW_OWNER);
        assertEq(factory.pendingOwner(), address(0));

        vm.prank(OWNER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.prank(NEW_OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");
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

    function test_DeployBook_DeploysBookRegistersAndKeepsFactoryAsOwner() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.expectEmit(true, false, false, false, address(factory));
        emit BookDeployed(address(ovrflo), address(0));

        vm.prank(OWNER);
        address book = factory.deployBook(address(ovrflo));

        assertTrue(book != address(0));
        assertEq(factory.ovrfloToBook(address(ovrflo)), book);
        assertEq(factory.bookToOvrflo(book), address(ovrflo));
        assertEq(factory.bookCount(), 1);
        assertEq(factory.books(0), book);

        OVRFLOBook b = OVRFLOBook(book);
        assertEq(address(b.factory()), address(factory));
        assertEq(address(b.core()), address(ovrflo));
        assertEq(address(b.sablier()), address(OVRFLO(address(ovrflo)).sablierLL()));
        assertEq(b.owner(), address(factory));
        assertEq(b.pendingOwner(), address(0));
    }

    function test_DeployBook_RevertsForDuplicate() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        factory.deployBook(address(ovrflo));

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: book exists");
        factory.deployBook(address(ovrflo));
    }

    function test_DeployBook_RevertsForUnknownVault() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown ovrflo");
        factory.deployBook(address(0xDEAD));
    }

    /* ---------- Duplicate underlying prevention ---------- */

    function test_ConfigureDeployment_RevertsForAlreadyDeployedUnderlying() public {
        _deployConfiguredSystem();

        // Same underlying — should revert even with a different treasury
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: underlying already deployed");
        factory.configureDeployment(NEW_OWNER, address(underlying), "Wrapped Ether 2", "WETH2");
    }

    function test_ConfigureDeployment_AllowsReconfigureIfFirstWasNotDeployed() public {
        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        // Not yet deployed — reconfiguring with a different treasury should succeed
        vm.prank(OWNER);
        factory.configureDeployment(NEW_OWNER, address(underlying), "Wrapped Ether", "WETH");

        (address pendingTreasury,,,,) = factory.pendingDeployment();
        assertEq(pendingTreasury, NEW_OWNER);
    }

    function test_Deploy_SetsUnderlyingToOvrfloMapping() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();
        assertEq(factory.underlyingToOvrflo(address(underlying)), address(ovrflo));
    }

    function test_ConfigureDeployment_AllowsDifferentUnderlyings() public {
        _deployConfiguredSystem();

        MockERC20Metadata dai = new MockERC20Metadata("Dai", "DAI", 18);

        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(dai), "Dai Stablecoin", "DAI");
        // Should not revert
        vm.prank(OWNER);
        (address ovrflo2,) = factory.deploy();
        assertEq(factory.underlyingToOvrflo(address(dai)), ovrflo2);
        assertEq(factory.ovrfloCount(), 2);
    }

    /* ---------- Book admin forwarding ---------- */

    function test_BookAdmin_RevertForUnauthorizedCallers() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        address book = factory.deployBook(address(ovrflo));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setBookAprBounds(book, 500, 2000);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setBookFee(book, 50);

        vm.prank(STRANGER);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.setBookTreasury(book, NEW_OWNER);
    }

    function test_BookAdmin_RevertsForUnknownBook() public {
        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown book");
        factory.setBookAprBounds(address(0xDEAD), 500, 2000);

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown book");
        factory.setBookFee(address(0xDEAD), 50);

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown book");
        factory.setBookTreasury(address(0xDEAD), NEW_OWNER);
    }

    function test_BookAdmin_ForwardsToBookAndEmitsEvents() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        address book = factory.deployBook(address(ovrflo));
        OVRFLOBook b = OVRFLOBook(book);

        // setAprBounds — book event fires first (inside the call), then factory event
        vm.expectEmit(address(book));
        emit AprBoundsSet(500, 2000);
        vm.expectEmit(true, false, false, false, address(factory));
        emit BookAprBoundsSet(book, 500, 2000);

        vm.prank(OWNER);
        factory.setBookAprBounds(book, 500, 2000);

        assertEq(b.aprMinBps(), 500);
        assertEq(b.aprMaxBps(), 2000);

        // setFee
        vm.expectEmit(address(book));
        emit FeeSet(50);
        vm.expectEmit(true, false, false, false, address(factory));
        emit BookFeeSet(book, 50);

        vm.prank(OWNER);
        factory.setBookFee(book, 50);

        assertEq(b.feeBps(), 50);

        // setTreasury
        vm.expectEmit(true, false, false, false, address(book));
        emit TreasurySet(NEW_OWNER);
        vm.expectEmit(true, true, false, false, address(factory));
        emit BookTreasurySet(book, NEW_OWNER);

        vm.prank(OWNER);
        factory.setBookTreasury(book, NEW_OWNER);

        assertEq(b.treasury(), NEW_OWNER);
    }

    function test_BookAdmin_BookOnlyOwnerRevertsForNonFactory() public {
        (OVRFLO ovrflo,) = _deployConfiguredSystem();

        vm.prank(OWNER);
        address book = factory.deployBook(address(ovrflo));
        OVRFLOBook b = OVRFLOBook(book);

        // The multisig (OWNER) is NOT the book's owner — factory is
        vm.prank(OWNER);
        vm.expectRevert("Ownable: caller is not the owner");
        b.setAprBounds(500, 2000);
    }

    /* ---------- Book enumeration ---------- */

    function test_DeployBook_EnumeratesMultipleBooks() public {
        // Deploy two vaults with different underlyings
        (OVRFLO ovrflo1,) = _deployConfiguredSystem();

        MockERC20Metadata dai = new MockERC20Metadata("Dai", "DAI", 18);
        vm.startPrank(OWNER);
        factory.configureDeployment(TREASURY, address(dai), "Dai Stablecoin", "DAI");
        (address ovrflo2Addr,) = factory.deploy();
        vm.stopPrank();

        vm.startPrank(OWNER);
        address book1 = factory.deployBook(address(ovrflo1));
        address book2 = factory.deployBook(ovrflo2Addr);
        vm.stopPrank();

        assertEq(factory.bookCount(), 2);
        assertEq(factory.books(0), book1);
        assertEq(factory.books(1), book2);
        assertEq(factory.bookToOvrflo(book1), address(ovrflo1));
        assertEq(factory.bookToOvrflo(book2), ovrflo2Addr);
    }

    function _deployConfiguredSystem() internal returns (OVRFLO ovrflo, OVRFLOToken token) {
        vm.prank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Wrapped Ether", "WETH");

        vm.prank(OWNER);
        (address ovrfloAddr, address tokenAddr) = factory.deploy();

        ovrflo = OVRFLO(ovrfloAddr);
        token = OVRFLOToken(tokenAddr);
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
        (,,,,, address storedToken, address storedUnderlying,) = ovrflo.series(market);
        assertEq(storedToken, expectedToken);
        assertEq(storedUnderlying, expectedUnderlying);
    }
}
