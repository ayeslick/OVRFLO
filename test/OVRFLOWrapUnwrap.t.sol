// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOReserve} from "../src/OVRFLOReserve.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockOvrfloAdmin} from "./mocks/MockOvrfloAdmin.sol";
import {FactoryStreamBind} from "./helpers/FactoryStreamBind.sol";

contract ReentrantUnderlying is TestERC20 {
    OVRFLOReserve public target;
    uint256 public reenterAmount;
    bool public attackOnTransfer;
    bool public reentered;
    bool public reenterSucceeded;

    constructor() TestERC20("Reentrant Underlying", "RUND") {}

    function configureAttack(OVRFLOReserve target_, uint256 reenterAmount_) external {
        target = target_;
        reenterAmount = reenterAmount_;
        attackOnTransfer = true;
        reentered = false;
        reenterSucceeded = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attackOnTransfer && msg.sender == address(target) && !reentered) {
            reentered = true;
            (reenterSucceeded,) = address(target).call(abi.encodeCall(OVRFLOReserve.unwrap, (reenterAmount)));
        }

        return super.transfer(to, amount);
    }
}

contract ShortTransferUnderlying is TestERC20 {
    constructor() TestERC20("Short Transfer Underlying", "SUND") {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount - 1);
    }
}

/// @dev Wrap/unwrap lives on the column's OVRFLOReserve. The vault constructs the
///      reserve; these tests reach it through `ovrflo.reserve()`.
contract OVRFLOWrapUnwrapTest is Test, FactoryStreamBind {
    event Wrapped(address indexed user, uint256 amount);
    event Unwrapped(address indexed user, uint256 amount);
    event ExcessUnderlyingSwept(address indexed underlying, address indexed to, uint256 amount);

    address internal constant TREASURY = address(0xBEEF);
    address internal constant OWNER = address(0xA11CE);
    address internal constant DUMMY_ORACLE = address(0x0AAC);

    OVRFLO internal ovrflo;
    OVRFLOReserve internal reserve;
    OVRFLOToken internal ovrfloToken;
    TestERC20 internal underlying;
    MockOvrfloAdmin internal admin;

    address internal user;
    address internal otherUser;
    address internal recipient;

    function setUp() public {
        user = makeAddr("user");
        otherUser = makeAddr("otherUser");
        recipient = makeAddr("recipient");

        underlying = new TestERC20("Underlying", "UND");
        admin = new MockOvrfloAdmin(TREASURY, address(underlying), address(0));
        ovrflo = new OVRFLO(
            address(admin),
            TREASURY,
            address(underlying),
            "OVRFLO Underlying",
            "ovrfloUND",
            DUMMY_ORACLE,
            address(admin)
        );
        reserve = OVRFLOReserve(ovrflo.reserve());
        ovrfloToken = OVRFLOToken(ovrflo.ovrfloToken());
        admin.setInfo(TREASURY, address(underlying), address(ovrfloToken));
    }

    function test_Reserve_ConstructorRevertsForZeroAddresses() public {
        vm.expectRevert(OVRFLOReserve.ZeroAddress.selector);
        new OVRFLOReserve(address(0), address(underlying), "n", "s", address(this));

        vm.expectRevert(OVRFLOReserve.ZeroAddress.selector);
        new OVRFLOReserve(address(admin), address(0), "n", "s", address(this));

        vm.expectRevert(OVRFLOReserve.ZeroAddress.selector);
        new OVRFLOReserve(address(admin), address(underlying), "n", "s", address(0));
    }

    function test_Wrap_MintsOneToOnePullsUnderlyingIncrementsReserveAndEmitsEvent() public {
        uint256 amount = 10 ether;
        underlying.mint(user, amount);

        vm.prank(user);
        underlying.approve(address(reserve), amount);

        vm.expectEmit(true, false, false, true, address(reserve));
        emit Wrapped(user, amount);

        vm.prank(user);
        reserve.wrap(amount);

        assertEq(underlying.balanceOf(user), 0);
        assertEq(underlying.balanceOf(address(reserve)), amount);
        assertEq(underlying.balanceOf(address(ovrflo)), 0, "vault holds no underlying");
        assertEq(ovrfloToken.balanceOf(user), amount);
        assertEq(reserve.wrappedUnderlying(), amount);
    }

    function test_Wrap_RevertsWhenUnderlyingTransfersLessThanRequestedAmount() public {
        ShortTransferUnderlying shortUnderlying = new ShortTransferUnderlying();
        OVRFLO shortOvrflo = new OVRFLO(
            address(admin),
            TREASURY,
            address(shortUnderlying),
            "OVRFLO Short",
            "ovrfloSUND",
            DUMMY_ORACLE,
            address(admin)
        );
        OVRFLOReserve shortReserve = OVRFLOReserve(shortOvrflo.reserve());
        OVRFLOToken shortToken = OVRFLOToken(shortOvrflo.ovrfloToken());

        uint256 amount = 10 ether;
        shortUnderlying.mint(user, amount);

        vm.startPrank(user);
        shortUnderlying.approve(address(shortReserve), amount);
        vm.expectRevert(OVRFLOReserve.TransferMismatch.selector);
        shortReserve.wrap(amount);
        vm.stopPrank();

        assertEq(shortUnderlying.balanceOf(user), amount);
        assertEq(shortUnderlying.balanceOf(address(shortReserve)), 0);
        assertEq(shortToken.balanceOf(user), 0);
        assertEq(shortReserve.wrappedUnderlying(), 0);
    }

    function test_Unwrap_BurnsOneToOneReturnsUnderlyingDecrementsReserveAndEmitsEvent() public {
        uint256 amount = 10 ether;
        _wrap(user, amount);

        vm.expectEmit(true, false, false, true, address(reserve));
        emit Unwrapped(user, amount);

        vm.prank(user);
        reserve.unwrap(amount);

        assertEq(underlying.balanceOf(user), amount);
        assertEq(underlying.balanceOf(address(reserve)), 0);
        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(reserve.wrappedUnderlying(), 0);
    }

    function test_WrapUnwrap_RoundTripRestoresBalancesAndReserve() public {
        uint256 amount = 7 ether;
        underlying.mint(user, amount);
        uint256 startingUnderlying = underlying.balanceOf(user);

        vm.startPrank(user);
        underlying.approve(address(reserve), amount);
        reserve.wrap(amount);
        reserve.unwrap(amount);
        vm.stopPrank();

        assertEq(underlying.balanceOf(user), startingUnderlying);
        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(underlying.balanceOf(address(reserve)), 0);
        assertEq(reserve.wrappedUnderlying(), 0);
        assertEq(ovrfloToken.totalSupply(), 0);
    }

    function test_Unwrap_RevertsWhenReserveIsInsufficientWithoutPartialFill() public {
        _wrap(user, 5 ether);
        vm.prank(address(ovrflo));
        ovrfloToken.mint(user, 1 ether);

        vm.prank(user);
        vm.expectRevert(OVRFLOReserve.InsufficientReserve.selector);
        reserve.unwrap(6 ether);

        assertEq(reserve.wrappedUnderlying(), 5 ether);
        assertEq(underlying.balanceOf(address(reserve)), 5 ether);
        assertEq(ovrfloToken.balanceOf(user), 6 ether);
    }

    function test_Unwrap_RevertsWhenCallerHasNoTokenBalanceEvenWithFundedReserve() public {
        _wrap(user, 5 ether);

        vm.prank(otherUser);
        vm.expectRevert();
        reserve.unwrap(1 ether);

        assertEq(reserve.wrappedUnderlying(), 5 ether);
        assertEq(underlying.balanceOf(address(reserve)), 5 ether);
        assertEq(ovrfloToken.balanceOf(otherUser), 0);
    }

    function test_WrapAndUnwrap_RevertForZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(OVRFLOReserve.ZeroAmount.selector);
        reserve.wrap(0);

        vm.prank(user);
        vm.expectRevert(OVRFLOReserve.ZeroAmount.selector);
        reserve.unwrap(0);
    }

    function test_Unwrap_AllowsDifferentHolderToConsumeSharedReserve() public {
        _wrap(user, 10 ether);

        vm.prank(user);
        assertTrue(ovrfloToken.transfer(otherUser, 4 ether));

        vm.prank(otherUser);
        reserve.unwrap(4 ether);

        assertEq(underlying.balanceOf(otherUser), 4 ether);
        assertEq(reserve.wrappedUnderlying(), 6 ether);
        assertEq(underlying.balanceOf(address(reserve)), 6 ether);
    }

    function test_DonatedUnderlyingDoesNotIncreaseUnwrapCapacity() public {
        _wrap(user, 5 ether);
        underlying.mint(address(reserve), 5 ether);
        vm.prank(address(ovrflo));
        ovrfloToken.mint(user, 1 ether);

        vm.prank(user);
        vm.expectRevert(OVRFLOReserve.InsufficientReserve.selector);
        reserve.unwrap(6 ether);

        assertEq(underlying.balanceOf(address(reserve)), 10 ether);
        assertEq(reserve.wrappedUnderlying(), 5 ether);
    }

    function test_ReentrantUnderlyingCannotDoubleSpendReserveDuringUnwrap() public {
        ReentrantUnderlying reentrantUnderlying = new ReentrantUnderlying();
        OVRFLO reentrantOvrflo = new OVRFLO(
            address(admin),
            TREASURY,
            address(reentrantUnderlying),
            "OVRFLO Reentrant",
            "ovrfloRUND",
            DUMMY_ORACLE,
            address(admin)
        );
        OVRFLOReserve reentrantReserve = OVRFLOReserve(reentrantOvrflo.reserve());
        OVRFLOToken reentrantToken = OVRFLOToken(reentrantOvrflo.ovrfloToken());

        uint256 amount = 10 ether;
        reentrantUnderlying.mint(user, amount);
        vm.startPrank(user);
        reentrantUnderlying.approve(address(reentrantReserve), amount);
        reentrantReserve.wrap(amount);
        vm.stopPrank();

        reentrantUnderlying.configureAttack(reentrantReserve, 1 ether);

        vm.prank(user);
        reentrantReserve.unwrap(amount);

        assertTrue(reentrantUnderlying.reentered());
        assertFalse(reentrantUnderlying.reenterSucceeded());
        assertEq(reentrantReserve.wrappedUnderlying(), 0);
        assertEq(reentrantUnderlying.balanceOf(user), amount);
        assertEq(reentrantUnderlying.balanceOf(address(reentrantReserve)), 0);
        assertEq(reentrantToken.balanceOf(user), 0);
    }

    function test_WrapAndUnwrap_CreateNoStreamAndChargeNoFee() public {
        uint256 amount = 3 ether;
        _wrap(user, amount);

        vm.prank(user);
        reserve.unwrap(amount);

        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(ovrfloToken.balanceOf(TREASURY), 0);
        assertEq(ovrfloToken.balanceOf(address(ovrflo.sablierLL())), 0);
    }

    function test_SweepExcessUnderlying_RevertsForNonAdminOrNoExcess() public {
        vm.prank(user);
        vm.expectRevert(OVRFLOReserve.NotAdmin.selector);
        reserve.sweepExcessUnderlying(recipient);

        vm.prank(address(ovrflo));
        vm.expectRevert(OVRFLOReserve.NotAdmin.selector);
        reserve.sweepExcessUnderlying(recipient);

        _wrap(user, 5 ether);

        vm.prank(address(admin));
        vm.expectRevert(OVRFLOReserve.NoExcess.selector);
        reserve.sweepExcessUnderlying(recipient);
    }

    function test_SweepExcessUnderlying_SweepsOnlyDonationAndPreservesReserve() public {
        _wrap(user, 5 ether);
        underlying.mint(address(reserve), 2 ether);

        vm.expectEmit(true, true, false, true, address(reserve));
        emit ExcessUnderlyingSwept(address(underlying), recipient, 2 ether);

        vm.prank(address(admin));
        reserve.sweepExcessUnderlying(recipient);

        assertEq(underlying.balanceOf(recipient), 2 ether);
        assertEq(underlying.balanceOf(address(reserve)), 5 ether);
        assertEq(reserve.wrappedUnderlying(), 5 ether);

        vm.prank(user);
        reserve.unwrap(5 ether);

        assertEq(underlying.balanceOf(user), 5 ether);
        assertEq(underlying.balanceOf(address(reserve)), 0);
    }

    function test_FactorySweepExcessUnderlying_RevertsForUnauthorizedOrUnknownOvrflo() public {
        OVRFLOFactory factory = new OVRFLOFactory(OWNER, DUMMY_ORACLE);

        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.sweepExcessUnderlying(address(ovrflo), recipient);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.sweepExcessUnderlying(address(ovrflo), recipient);
    }

    function test_FactorySweepExcessUnderlying_ForwardsOwnerSweepEndToEnd() public {
        OVRFLOFactory factory = new OVRFLOFactory(OWNER, DUMMY_ORACLE);
        vm.prank(OWNER);
        address stream = _bindCanonicalStream(factory);
        OVRFLO deployed = new OVRFLO(
            address(factory), TREASURY, address(underlying), "OVRFLO Underlying", "ovrfloUND", DUMMY_ORACLE, stream
        );
        vm.prank(OWNER);
        factory.registerOvrflo(address(deployed));

        address deployedOvrflo = address(deployed);
        OVRFLOReserve deployedReserve = OVRFLOReserve(deployed.reserve());
        OVRFLOToken token = OVRFLOToken(deployed.ovrfloToken());
        uint256 amount = 5 ether;
        underlying.mint(user, amount);

        vm.startPrank(user);
        underlying.approve(address(deployedReserve), amount);
        deployedReserve.wrap(amount);
        vm.stopPrank();

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOReserve.NoExcess.selector);
        factory.sweepExcessUnderlying(deployedOvrflo, recipient);

        underlying.mint(address(deployedReserve), 2 ether);

        vm.expectEmit(true, true, false, true, address(deployedReserve));
        emit ExcessUnderlyingSwept(address(underlying), recipient, 2 ether);

        vm.prank(OWNER);
        factory.sweepExcessUnderlying(deployedOvrflo, recipient);

        assertEq(underlying.balanceOf(recipient), 2 ether);
        assertEq(underlying.balanceOf(address(deployedReserve)), amount);
        assertEq(deployedReserve.wrappedUnderlying(), amount);
        assertEq(token.balanceOf(user), amount);
    }

    function _wrap(address account, uint256 amount) internal {
        underlying.mint(account, amount);
        vm.startPrank(account);
        underlying.approve(address(reserve), amount);
        reserve.wrap(amount);
        vm.stopPrank();
    }
}
