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

    constructor(address sy_, uint8 decimals_) MockERC20Metadata("Mock PT", "mPT", decimals_) {
        SY_TOKEN = sy_;
        PT_EXPIRY = block.timestamp + 30 days;
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

contract OVRFLOSafetyTest is Test {
    address internal constant MULTISIG = address(0x123);
    address internal constant TREASURY = address(0x456);
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    uint32 internal constant MIN_TWAP_DURATION = 15 minutes;

    function test_Deploy_SetsOvrfloTokenDecimalsToUnderlyingDecimals() public {
        (, , address token) = _deploySystem(6);
        assertEq(OVRFLOToken(token).decimals(), 6);
    }

    function test_AddMarket_RevertsWhenOracleIsNotReady() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deploySystem(18);
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAA2), 18);
        MockPendleMarket market = new MockPendleMarket(address(0xAAA2), address(pt), block.timestamp + 30 days);

        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, false);

        vm.prank(MULTISIG);
        vm.expectRevert("OVRFLOFactory: oracle not ready");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_RevertsWhenOracleNeedsPreparationWithinRefactoredFlow() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deploySystem(18);
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAA1), 18);
        MockPendleMarket market = new MockPendleMarket(address(0xAAA1), address(pt), block.timestamp + 30 days);

        _mockOracleState(address(market), MIN_TWAP_DURATION, true, 9, false);

        vm.prank(MULTISIG);
        vm.expectCall(address(market), abi.encodeWithSelector(IPendleMarket.increaseObservationsCardinalityNext.selector, uint16(9)));
        vm.expectRevert("OVRFLOFactory: oracle cardinality");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);

        assertEq(market.lastCardinality(), 0);
        assertFalse(factory.isMarketApproved(address(ovrflo), address(market)));
    }

    function test_AddMarket_RevertsWhenPtAlreadyMapped() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deploySystem(18);
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAA3), 18);
        MockPendleMarket market1 = new MockPendleMarket(address(0xAAA3), address(pt), block.timestamp + 30 days);
        MockPendleMarket market2 = new MockPendleMarket(address(0xAAA4), address(pt), block.timestamp + 60 days);

        _mockOracleState(address(market1), MIN_TWAP_DURATION, false, 0, true);
        _mockOracleState(address(market2), MIN_TWAP_DURATION, false, 0, true);

        vm.prank(MULTISIG);
        factory.addMarket(address(ovrflo), address(market1), MIN_TWAP_DURATION, 0);

        assertEq(ovrflo.ptToMarket(address(pt)), address(market1));

        vm.prank(MULTISIG);
        vm.expectRevert("OVRFLO: PT already mapped");
        factory.addMarket(address(ovrflo), address(market2), MIN_TWAP_DURATION, 0);
    }

    function test_AddMarket_RevertsWhenPtDecimalsMismatchOvrfloToken() public {
        (OVRFLOFactory factory, OVRFLO ovrflo, address token) = _deploySystem(6);
        MockPrincipalToken pt = new MockPrincipalToken(address(0xAAA5), 18);
        MockPendleMarket market = new MockPendleMarket(address(0xAAA5), address(pt), block.timestamp + 30 days);

        _mockOracleState(address(market), MIN_TWAP_DURATION, false, 0, true);

        assertEq(OVRFLOToken(token).decimals(), 6);

        vm.prank(MULTISIG);
        vm.expectRevert("OVRFLO: decimals mismatch");
        factory.addMarket(address(ovrflo), address(market), MIN_TWAP_DURATION, 0);
    }

    function _deploySystem(uint8 underlyingDecimals)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, address ovrfloToken)
    {
        MockERC20Metadata underlying = new MockERC20Metadata("Underlying", "UND", underlyingDecimals);

        vm.startPrank(MULTISIG);
        factory = new OVRFLOFactory(MULTISIG);
        factory.configureDeployment(TREASURY, address(underlying));
        (address ovrfloAddr, address token) = factory.deploy();
        vm.stopPrank();

        ovrflo = OVRFLO(ovrfloAddr);
        ovrfloToken = token;
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