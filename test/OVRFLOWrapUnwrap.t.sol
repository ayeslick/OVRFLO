// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";

contract WrapMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOvrfloAdmin {
    address public treasury;
    address public underlying;
    address public ovrfloToken;

    constructor(address treasury_, address underlying_, address ovrfloToken_) {
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
    }

    function setInfo(address treasury_, address underlying_, address ovrfloToken_) external {
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
    }

    function ovrfloInfo(address) external view returns (address, address, address) {
        return (treasury, underlying, ovrfloToken);
    }
}

contract ReentrantUnderlying is WrapMockERC20 {
    OVRFLO public target;
    uint256 public reenterAmount;
    bool public attackOnTransfer;
    bool public reentered;
    bool public reenterSucceeded;

    constructor() WrapMockERC20("Reentrant Underlying", "RUND") {}

    function configureAttack(OVRFLO target_, uint256 reenterAmount_) external {
        target = target_;
        reenterAmount = reenterAmount_;
        attackOnTransfer = true;
        reentered = false;
        reenterSucceeded = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attackOnTransfer && msg.sender == address(target) && !reentered) {
            reentered = true;
            (reenterSucceeded,) = address(target).call(abi.encodeCall(OVRFLO.unwrap, (reenterAmount)));
        }

        return super.transfer(to, amount);
    }
}

contract ShortTransferUnderlying is WrapMockERC20 {
    constructor() WrapMockERC20("Short Transfer Underlying", "SUND") {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount - 1);
    }
}

contract OVRFLOWrapUnwrapTest is Test {
    event Wrapped(address indexed user, uint256 amount);
    event Unwrapped(address indexed user, uint256 amount);
    event ExcessUnderlyingSwept(address indexed underlying, address indexed to, uint256 amount);

    address internal constant TREASURY = address(0xBEEF);
    address internal constant OWNER = address(0xA11CE);

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    WrapMockERC20 internal underlying;
    MockOvrfloAdmin internal admin;

    address internal user;
    address internal otherUser;
    address internal recipient;

    function setUp() public {
        user = makeAddr("user");
        otherUser = makeAddr("otherUser");
        recipient = makeAddr("recipient");

        underlying = new WrapMockERC20("Underlying", "UND");
        ovrfloToken = new OVRFLOToken("OVRFLO Underlying", "ovrfloUND");
        admin = new MockOvrfloAdmin(TREASURY, address(underlying), address(ovrfloToken));
        ovrflo = new OVRFLO(address(admin), TREASURY, address(underlying), address(ovrfloToken));
        ovrfloToken.transferOwnership(address(ovrflo));
    }

    function test_Wrap_MintsOneToOnePullsUnderlyingIncrementsReserveAndEmitsEvent() public {
        uint256 amount = 10 ether;
        underlying.mint(user, amount);

        vm.prank(user);
        underlying.approve(address(ovrflo), amount);

        vm.expectEmit(true, false, false, true, address(ovrflo));
        emit Wrapped(user, amount);

        vm.prank(user);
        ovrflo.wrap(amount);

        assertEq(underlying.balanceOf(user), 0);
        assertEq(underlying.balanceOf(address(ovrflo)), amount);
        assertEq(ovrfloToken.balanceOf(user), amount);
        assertEq(ovrflo.wrappedUnderlying(), amount);
    }

    function test_Wrap_RevertsWhenUnderlyingTransfersLessThanRequestedAmount() public {
        ShortTransferUnderlying shortUnderlying = new ShortTransferUnderlying();
        OVRFLOToken shortToken = new OVRFLOToken("OVRFLO Short", "ovrfloSUND");
        OVRFLO shortOvrflo = new OVRFLO(address(admin), TREASURY, address(shortUnderlying), address(shortToken));
        shortToken.transferOwnership(address(shortOvrflo));

        uint256 amount = 10 ether;
        shortUnderlying.mint(user, amount);

        vm.startPrank(user);
        shortUnderlying.approve(address(shortOvrflo), amount);
        vm.expectRevert("OVRFLO: transfer amount mismatch");
        shortOvrflo.wrap(amount);
        vm.stopPrank();

        assertEq(shortUnderlying.balanceOf(user), amount);
        assertEq(shortUnderlying.balanceOf(address(shortOvrflo)), 0);
        assertEq(shortToken.balanceOf(user), 0);
        assertEq(shortOvrflo.wrappedUnderlying(), 0);
    }

    function test_Unwrap_BurnsOneToOneReturnsUnderlyingDecrementsReserveAndEmitsEvent() public {
        uint256 amount = 10 ether;
        _wrap(user, amount);

        vm.expectEmit(true, false, false, true, address(ovrflo));
        emit Unwrapped(user, amount);

        vm.prank(user);
        ovrflo.unwrap(amount);

        assertEq(underlying.balanceOf(user), amount);
        assertEq(underlying.balanceOf(address(ovrflo)), 0);
        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(ovrflo.wrappedUnderlying(), 0);
    }

    function test_WrapUnwrap_RoundTripRestoresBalancesAndReserve() public {
        uint256 amount = 7 ether;
        underlying.mint(user, amount);
        uint256 startingUnderlying = underlying.balanceOf(user);

        vm.startPrank(user);
        underlying.approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        ovrflo.unwrap(amount);
        vm.stopPrank();

        assertEq(underlying.balanceOf(user), startingUnderlying);
        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(underlying.balanceOf(address(ovrflo)), 0);
        assertEq(ovrflo.wrappedUnderlying(), 0);
    }

    function test_Unwrap_RevertsWhenReserveIsInsufficientWithoutPartialFill() public {
        _wrap(user, 5 ether);
        vm.prank(address(ovrflo));
        ovrfloToken.mint(user, 1 ether);

        vm.prank(user);
        vm.expectRevert("OVRFLO: insufficient reserve");
        ovrflo.unwrap(6 ether);

        assertEq(ovrflo.wrappedUnderlying(), 5 ether);
        assertEq(underlying.balanceOf(address(ovrflo)), 5 ether);
        assertEq(ovrfloToken.balanceOf(user), 6 ether);
    }

    function test_Unwrap_RevertsWhenCallerHasNoTokenBalanceEvenWithFundedReserve() public {
        _wrap(user, 5 ether);

        vm.prank(otherUser);
        vm.expectRevert();
        ovrflo.unwrap(1 ether);

        assertEq(ovrflo.wrappedUnderlying(), 5 ether);
        assertEq(underlying.balanceOf(address(ovrflo)), 5 ether);
        assertEq(ovrfloToken.balanceOf(otherUser), 0);
    }

    function test_WrapAndUnwrap_RevertForZeroAmount() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: amount is zero");
        ovrflo.wrap(0);

        vm.prank(user);
        vm.expectRevert("OVRFLO: amount is zero");
        ovrflo.unwrap(0);
    }

    function test_Unwrap_AllowsDifferentHolderToConsumeSharedReserve() public {
        _wrap(user, 10 ether);

        vm.prank(user);
        assertTrue(ovrfloToken.transfer(otherUser, 4 ether));

        vm.prank(otherUser);
        ovrflo.unwrap(4 ether);

        assertEq(underlying.balanceOf(otherUser), 4 ether);
        assertEq(ovrflo.wrappedUnderlying(), 6 ether);
        assertEq(underlying.balanceOf(address(ovrflo)), 6 ether);
    }

    function test_DonatedUnderlyingDoesNotIncreaseUnwrapCapacity() public {
        _wrap(user, 5 ether);
        underlying.mint(address(ovrflo), 5 ether);
        vm.prank(address(ovrflo));
        ovrfloToken.mint(user, 1 ether);

        vm.prank(user);
        vm.expectRevert("OVRFLO: insufficient reserve");
        ovrflo.unwrap(6 ether);

        assertEq(underlying.balanceOf(address(ovrflo)), 10 ether);
        assertEq(ovrflo.wrappedUnderlying(), 5 ether);
    }

    function test_ReentrantUnderlyingCannotDoubleSpendReserveDuringUnwrap() public {
        ReentrantUnderlying reentrantUnderlying = new ReentrantUnderlying();
        OVRFLOToken reentrantToken = new OVRFLOToken("OVRFLO Reentrant", "ovrfloRUND");
        OVRFLO reentrantOvrflo =
            new OVRFLO(address(admin), TREASURY, address(reentrantUnderlying), address(reentrantToken));
        reentrantToken.transferOwnership(address(reentrantOvrflo));

        uint256 amount = 10 ether;
        reentrantUnderlying.mint(user, amount);
        vm.startPrank(user);
        reentrantUnderlying.approve(address(reentrantOvrflo), amount);
        reentrantOvrflo.wrap(amount);
        vm.stopPrank();

        reentrantUnderlying.configureAttack(reentrantOvrflo, 1 ether);

        vm.prank(user);
        reentrantOvrflo.unwrap(amount);

        assertTrue(reentrantUnderlying.reentered());
        assertFalse(reentrantUnderlying.reenterSucceeded());
        assertEq(reentrantOvrflo.wrappedUnderlying(), 0);
        assertEq(reentrantUnderlying.balanceOf(user), amount);
        assertEq(reentrantUnderlying.balanceOf(address(reentrantOvrflo)), 0);
        assertEq(reentrantToken.balanceOf(user), 0);
    }

    function test_WrapAndUnwrap_CreateNoStreamAndChargeNoFee() public {
        uint256 amount = 3 ether;
        _wrap(user, amount);

        vm.prank(user);
        ovrflo.unwrap(amount);

        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(ovrfloToken.balanceOf(address(ovrflo.sablierLL())), 0);
    }

    function test_SweepExcessUnderlying_RevertsForNonAdminOrNoExcess() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.sweepExcessUnderlying(recipient);

        _wrap(user, 5 ether);

        vm.prank(address(admin));
        vm.expectRevert("OVRFLO: no excess");
        ovrflo.sweepExcessUnderlying(recipient);
    }

    function test_SweepExcessUnderlying_SweepsOnlyDonationAndPreservesReserve() public {
        _wrap(user, 5 ether);
        underlying.mint(address(ovrflo), 2 ether);

        vm.expectEmit(true, true, false, true, address(ovrflo));
        emit ExcessUnderlyingSwept(address(underlying), recipient, 2 ether);

        vm.prank(address(admin));
        ovrflo.sweepExcessUnderlying(recipient);

        assertEq(underlying.balanceOf(recipient), 2 ether);
        assertEq(underlying.balanceOf(address(ovrflo)), 5 ether);
        assertEq(ovrflo.wrappedUnderlying(), 5 ether);

        vm.prank(user);
        ovrflo.unwrap(5 ether);

        assertEq(underlying.balanceOf(user), 5 ether);
        assertEq(underlying.balanceOf(address(ovrflo)), 0);
    }

    function test_FactorySweepExcessUnderlying_RevertsForUnauthorizedOrUnknownOvrflo() public {
        OVRFLOFactory factory = new OVRFLOFactory(OWNER);

        vm.prank(user);
        vm.expectRevert("Ownable: caller is not the owner");
        factory.sweepExcessUnderlying(address(ovrflo), recipient);

        vm.prank(OWNER);
        vm.expectRevert("OVRFLOFactory: unknown ovrflo");
        factory.sweepExcessUnderlying(address(ovrflo), recipient);
    }

    function test_FactorySweepExcessUnderlying_ForwardsOwnerSweepEndToEnd() public {
        OVRFLOFactory factory = new OVRFLOFactory(OWNER);
        vm.startPrank(OWNER);
        factory.configureDeployment(TREASURY, address(underlying), "Underlying", "UND");
        (address deployedOvrflo, address deployedToken) = factory.deploy();
        vm.stopPrank();

        OVRFLO deployed = OVRFLO(deployedOvrflo);
        OVRFLOToken token = OVRFLOToken(deployedToken);
        uint256 amount = 5 ether;
        underlying.mint(user, amount);

        vm.startPrank(user);
        underlying.approve(address(deployed), amount);
        deployed.wrap(amount);
        vm.stopPrank();

        vm.prank(OWNER);
        vm.expectRevert("OVRFLO: no excess");
        factory.sweepExcessUnderlying(deployedOvrflo, recipient);

        underlying.mint(address(deployed), 2 ether);

        vm.expectEmit(true, true, false, true, address(deployed));
        emit ExcessUnderlyingSwept(address(underlying), recipient, 2 ether);

        vm.prank(OWNER);
        factory.sweepExcessUnderlying(deployedOvrflo, recipient);

        assertEq(underlying.balanceOf(recipient), 2 ether);
        assertEq(underlying.balanceOf(address(deployed)), amount);
        assertEq(deployed.wrappedUnderlying(), amount);
        assertEq(token.balanceOf(user), amount);
    }

    function _wrap(address account, uint256 amount) internal {
        underlying.mint(account, amount);
        vm.startPrank(account);
        underlying.approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        vm.stopPrank();
    }
}
