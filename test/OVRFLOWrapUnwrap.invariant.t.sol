// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

contract InvariantMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract InvariantOvrfloAdmin {
    address public treasury;
    address public underlying;
    address public ovrfloToken;

    function setInfo(address treasury_, address underlying_, address ovrfloToken_) external {
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
    }

    function approveSeries(
        OVRFLO ovrflo,
        address market,
        address pt,
        address oracle,
        uint32 twapDuration,
        uint256 expiry
    ) external {
        ovrflo.setSeriesApproved(market, pt, underlying, ovrfloToken, oracle, twapDuration, expiry, 0);
    }

    function sweepExcessUnderlying(OVRFLO ovrflo, address to) external {
        ovrflo.sweepExcessUnderlying(to);
    }

    function ovrfloInfo(address) external view returns (address, address, address) {
        return (treasury, underlying, ovrfloToken);
    }
}

contract OVRFLOWrapUnwrapHandler is Test {
    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    InvariantMockERC20 internal underlying;
    InvariantMockERC20 internal pt;
    InvariantOvrfloAdmin internal admin;

    address internal market;
    uint256 internal expiry;

    address[3] internal actors;

    uint256 public totalWrapped;
    uint256 public totalUnwrapped;

    constructor(
        OVRFLO ovrflo_,
        OVRFLOToken ovrfloToken_,
        InvariantMockERC20 underlying_,
        InvariantMockERC20 pt_,
        InvariantOvrfloAdmin admin_,
        address market_,
        uint256 expiry_
    ) {
        ovrflo = ovrflo_;
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
        underlying.approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        vm.stopPrank();

        totalWrapped += amount;
    }

    function unwrap(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        uint256 maxAmount = _min(ovrfloToken.balanceOf(actor), ovrflo.wrappedUnderlying());
        if (maxAmount == 0) return;

        amount = bound(amount, 1, maxAmount);

        vm.prank(actor);
        ovrflo.unwrap(amount);

        totalUnwrapped += amount;
    }

    function unwrapBeyondReserve(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        uint256 reserve = ovrflo.wrappedUnderlying();
        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance <= reserve) return;

        amount = bound(amount, reserve + 1, balance);
        uint256 underlyingBefore = underlying.balanceOf(address(ovrflo));

        vm.prank(actor);
        vm.expectRevert("OVRFLO: insufficient reserve");
        ovrflo.unwrap(amount);

        assertEq(ovrflo.wrappedUnderlying(), reserve);
        assertEq(underlying.balanceOf(address(ovrflo)), underlyingBefore);
    }

    function sweepExcessUnderlying(uint256 amount) public {
        amount = bound(amount, 1, 50 ether);
        underlying.mint(address(ovrflo), amount);
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
    OVRFLOToken internal ovrfloToken;
    InvariantMockERC20 internal underlying;
    InvariantMockERC20 internal pt;
    InvariantOvrfloAdmin internal admin;
    OVRFLOWrapUnwrapHandler internal handler;

    function setUp() public {
        underlying = new InvariantMockERC20("Underlying", "UND");
        pt = new InvariantMockERC20("PT", "PT");
        admin = new InvariantOvrfloAdmin();
        ovrflo = new OVRFLO(address(admin), TREASURY);
        ovrfloToken = new OVRFLOToken("OVRFLO Underlying", "ovrfloUND");
        ovrfloToken.transferOwnership(address(ovrflo));

        admin.setInfo(TREASURY, address(underlying), address(ovrfloToken));
        admin.approveSeries(ovrflo, MARKET, address(pt), ORACLE, TWAP_DURATION, EXPIRY);

        vm.mockCall(ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (MARKET, TWAP_DURATION)), abi.encode(RATE_E18));
        vm.mockCall(
            SABLIER_LL, abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector), abi.encode(1)
        );

        handler = new OVRFLOWrapUnwrapHandler(ovrflo, ovrfloToken, underlying, pt, admin, MARKET, EXPIRY);
        targetContract(address(handler));
    }

    function invariant_SupplyEqualsPtBackingPlusUnderlyingReserve() public view {
        assertEq(
            ovrfloToken.totalSupply(),
            ovrflo.marketTotalDeposited(MARKET) + ovrflo.wrappedUnderlying(),
            "supply backing mismatch"
        );
    }

    function invariant_WrappedReserveNeverExceedsUnderlyingBalance() public view {
        assertLe(ovrflo.wrappedUnderlying(), underlying.balanceOf(address(ovrflo)), "reserve exceeds balance");
    }

    function invariant_UnwrapsNeverExceedSuccessfulWraps() public view {
        assertLe(handler.totalUnwrapped(), handler.totalWrapped(), "unwrapped more than wrapped");
    }
}
