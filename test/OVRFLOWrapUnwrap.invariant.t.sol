// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOReserve} from "../src/OVRFLOReserve.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockOvrfloAdmin} from "./mocks/MockOvrfloAdmin.sol";

contract OVRFLOWrapUnwrapHandler is Test {
    OVRFLO internal ovrflo;
    OVRFLOReserve internal reserve;
    OVRFLOToken internal ovrfloToken;
    TestERC20 internal underlying;
    TestERC20 internal pt;
    MockOvrfloAdmin internal admin;

    address internal market;
    uint256 internal expiry;

    address[3] internal actors;

    uint256 public totalWrapped;
    uint256 public totalUnwrapped;

    constructor(
        OVRFLO ovrflo_,
        OVRFLOToken ovrfloToken_,
        TestERC20 underlying_,
        TestERC20 pt_,
        MockOvrfloAdmin admin_,
        address market_,
        uint256 expiry_
    ) {
        ovrflo = ovrflo_;
        reserve = OVRFLOReserve(ovrflo_.reserve());
        ovrfloToken = ovrfloToken_;
        underlying = underlying_;
        pt = pt_;
        admin = admin_;
        market = market_;
        expiry = expiry_;

        actors = [makeAddr("handlerUserA"), makeAddr("handlerUserB"), makeAddr("handlerUserC")];
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        if (block.timestamp >= expiry) return;

        address actor = _actor(actorSeed);
        amount = bound(amount, ovrflo.MIN_PT_AMOUNT(), 50 ether);

        pt.mint(actor, amount);

        vm.startPrank(actor);
        pt.approve(address(ovrflo), amount);
        ovrflo.deposit(market, amount, 0);
        vm.stopPrank();
    }

    function claim(uint256 actorSeed, uint256 amount) public {
        uint256 deposited = ovrflo.marketTotalDeposited(market);
        if (deposited == 0) return;

        address actor = _actor(actorSeed);
        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance == 0) return;

        uint256 maxAmount = _min(balance, deposited);
        amount = bound(amount, 1, maxAmount);

        if (block.timestamp < expiry) {
            vm.warp(expiry);
        }

        vm.prank(actor);
        ovrflo.claim(address(pt), amount);
    }

    function wrap(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1, 50 ether);

        underlying.mint(actor, amount);

        vm.startPrank(actor);
        underlying.approve(address(reserve), amount);
        reserve.wrap(amount);
        vm.stopPrank();

        totalWrapped += amount;
    }

    function unwrap(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        uint256 maxAmount = _min(ovrfloToken.balanceOf(actor), reserve.wrappedUnderlying());
        if (maxAmount == 0) return;

        amount = bound(amount, 1, maxAmount);

        vm.prank(actor);
        reserve.unwrap(amount);

        totalUnwrapped += amount;
    }

    function unwrapBeyondReserve(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        uint256 tracked = reserve.wrappedUnderlying();
        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance <= tracked) return;

        amount = bound(amount, tracked + 1, balance);
        uint256 underlyingBefore = underlying.balanceOf(address(reserve));

        vm.prank(actor);
        vm.expectRevert(OVRFLOReserve.InsufficientReserve.selector);
        reserve.unwrap(amount);

        assertEq(reserve.wrappedUnderlying(), tracked);
        assertEq(underlying.balanceOf(address(reserve)), underlyingBefore);
    }

    function sweepExcessUnderlying(uint256 amount) public {
        amount = bound(amount, 1, 50 ether);
        underlying.mint(address(reserve), amount);
        admin.sweepExcessUnderlying(ovrflo, actors[0]);
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract OVRFLOWrapUnwrapInvariantTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x1001);
    address internal constant ORACLE = address(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);
    address internal constant SABLIER_LL = address(0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9);
    uint32 internal constant TWAP_DURATION = 30 minutes;
    uint256 internal constant EXPIRY = 30 days;
    uint256 internal constant RATE_E18 = 0.8e18;

    OVRFLO internal ovrflo;
    OVRFLOReserve internal reserve;
    OVRFLOToken internal ovrfloToken;
    TestERC20 internal underlying;
    TestERC20 internal pt;
    MockOvrfloAdmin internal admin;
    OVRFLOWrapUnwrapHandler internal handler;

    function setUp() public {
        underlying = new TestERC20("Underlying", "UND");
        pt = new TestERC20("PT", "PT");
        admin = new MockOvrfloAdmin(address(0), address(0), address(0));
        if (SABLIER_LL.code.length == 0) vm.etch(SABLIER_LL, hex"00");
        ovrflo = new OVRFLO(
            address(admin), TREASURY, address(underlying), "OVRFLO Underlying", "ovrfloUND", ORACLE, SABLIER_LL
        );
        reserve = OVRFLOReserve(ovrflo.reserve());
        ovrfloToken = OVRFLOToken(ovrflo.ovrfloToken());

        admin.setInfo(TREASURY, address(underlying), address(ovrfloToken));
        admin.approveSeries(ovrflo, MARKET, address(pt), TWAP_DURATION, EXPIRY);

        vm.mockCall(ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (MARKET, TWAP_DURATION)), abi.encode(RATE_E18));
        vm.mockCall(
            ORACLE, abi.encodeCall(IPendleOracle.getOracleState, (MARKET, TWAP_DURATION)), abi.encode(false, 0, true)
        );
        vm.mockCall(
            SABLIER_LL, abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector), abi.encode(1)
        );

        handler = new OVRFLOWrapUnwrapHandler(ovrflo, ovrfloToken, underlying, pt, admin, MARKET, EXPIRY);
        targetContract(address(handler));
    }

    function invariant_SupplyEqualsPtBackingPlusUnderlyingReserve() public view {
        assertEq(
            ovrfloToken.totalSupply(),
            ovrflo.marketTotalDeposited(MARKET) + reserve.wrappedUnderlying(),
            "supply backing mismatch"
        );
    }

    function invariant_WrappedReserveNeverExceedsUnderlyingBalance() public view {
        assertLe(reserve.wrappedUnderlying(), underlying.balanceOf(address(reserve)), "reserve exceeds balance");
    }

    function invariant_VaultHoldsNoUnderlying() public view {
        assertEq(underlying.balanceOf(address(ovrflo)), 0, "vault holds underlying");
    }

    function invariant_UnwrapsNeverExceedSuccessfulWraps() public view {
        assertLe(handler.totalUnwrapped(), handler.totalWrapped(), "unwrapped more than wrapped");
    }
}
