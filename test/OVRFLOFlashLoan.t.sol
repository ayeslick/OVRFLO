// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice A configurable flash loan borrower that can perform actions during the callback.
contract FlashBorrower is IFlashBorrower {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;
    bool public returnSuccess = true;

    // Configurable actions during callback
    bool public depositDuringCallback;
    bool public unwrapDuringCallback;
    bool public nestedFlashLoan;
    address public depositMarket;
    uint256 public depositAmount;
    uint256 public unwrapAmount;
    address public nestedPtToken;
    uint256 public nestedAmount;

    // Track results
    bool public depositSucceeded;
    bool public unwrapSucceeded;
    bool public nestedSucceeded;

    constructor(OVRFLO vault_) {
        vault = vault_;
    }

    function setReturnSuccess(bool success) external {
        returnSuccess = success;
    }

    function configureDeposit(address market, uint256 amount) external {
        depositDuringCallback = true;
        depositMarket = market;
        depositAmount = amount;
    }

    function configureUnwrap(uint256 amount) external {
        unwrapDuringCallback = true;
        unwrapAmount = amount;
    }

    function configureNestedFlashLoan(address ptToken, uint256 amount) external {
        nestedFlashLoan = true;
        nestedPtToken = ptToken;
        nestedAmount = amount;
    }

    function resetConfig() external {
        depositDuringCallback = false;
        unwrapDuringCallback = false;
        nestedFlashLoan = false;
    }

    /// @notice Entry point for tests to call. This contract is msg.sender for flashLoan.
    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external returns (bytes32) {
        require(msg.sender == address(vault), "FlashBorrower: not vault");

        if (depositDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.deposit, (depositMarket, depositAmount, 0)));
            depositSucceeded = ok;
        }

        if (unwrapDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.unwrap, (unwrapAmount)));
            unwrapSucceeded = ok;
        }

        if (nestedFlashLoan) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.flashLoan, (nestedPtToken, nestedAmount, "")));
            nestedSucceeded = ok;
        }

        return returnSuccess ? CALLBACK_SUCCESS : bytes32(0);
    }
}

contract OVRFLOFlashLoanTest is Test {
    event FlashLoaned(address indexed borrower, address indexed ptToken, uint256 amount, uint256 fee);
    event FlashFeeBpsSet(uint16 feeBps);
    event FlashLoanPausedSet(bool paused);

    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    address internal constant SABLIER_LL = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x1001);

    uint32 internal constant TWAP_DURATION = 30 minutes;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    MockERC20 internal underlying;
    MockERC20 internal pt;

    address internal user;
    FlashBorrower internal borrower;

    uint256 internal constant DEPOSIT_AMOUNT = 100 ether;
    uint256 internal constant RATE_95 = 0.95e18;

    function setUp() public {
        // Use a far-future expiry so we don't accidentally cross maturity
        uint256 expiry = block.timestamp + 365 days;

        underlying = new MockERC20("Underlying", "UND");
        pt = new MockERC20("PT Token", "PT");

        ovrfloToken = new OVRFLOToken("OVRFLO UND", "ovrfloUND");
        ovrflo = new OVRFLO(ADMIN, TREASURY, address(underlying), address(ovrfloToken), PENDLE_ORACLE);
        ovrfloToken.transferOwnership(address(ovrflo));

        user = makeAddr("user");

        // Approve series
        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(MARKET, address(pt), TWAP_DURATION, expiry, 0);

        // Deposit PT to populate marketTotalDeposited
        _mockRate(MARKET, RATE_95);
        _mockSablier(user, 5 ether, expiry - block.timestamp, 1);
        pt.mint(user, DEPOSIT_AMOUNT);
        vm.startPrank(user);
        pt.approve(address(ovrflo), DEPOSIT_AMOUNT);
        ovrflo.deposit(MARKET, DEPOSIT_AMOUNT, 0);
        vm.stopPrank();

        // Create borrower
        borrower = new FlashBorrower(ovrflo);

        // Fund borrower with underlying for fees
        underlying.mint(address(borrower), 100 ether);

        // Approvals from borrower
        vm.startPrank(address(borrower));
        pt.approve(address(ovrflo), type(uint256).max);
        underlying.approve(address(ovrflo), type(uint256).max);
        vm.stopPrank();

        // Fund the wrap reserve so unwrap works during callback tests
        underlying.mint(address(this), 200 ether);
        underlying.approve(address(ovrflo), 200 ether);
        ovrflo.wrap(200 ether);
    }

    /*//////////////////////////////////////////////////////////////
                        GATE TESTS
    //////////////////////////////////////////////////////////////*/

    function test_RevertUnknownPT() public {
        MockERC20 fakePt = new MockERC20("Fake", "FK");
        fakePt.mint(address(borrower), 10 ether);
        vm.prank(address(borrower));
        fakePt.approve(address(ovrflo), type(uint256).max);
        vm.expectRevert("OVRFLO: unknown PT");
        borrower.executeFlashLoan(address(fakePt), 10 ether, "");
    }

    function test_RevertZeroAmount() public {
        vm.expectRevert("OVRFLO: zero flash");
        borrower.executeFlashLoan(address(pt), 0, "");
    }

    function test_RevertExceedsDeposited() public {
        vm.expectRevert("OVRFLO: exceeds deposited");
        borrower.executeFlashLoan(address(pt), DEPOSIT_AMOUNT + 1, "");
    }

    function test_RevertPaused() public {
        vm.prank(ADMIN);
        ovrflo.setFlashLoanPaused(true);

        vm.expectRevert("OVRFLO: flash paused");
        borrower.executeFlashLoan(address(pt), 10 ether, "");
    }

    function test_RevertMatured() public {
        vm.warp(block.timestamp + 366 days);
        vm.expectRevert("OVRFLO: matured");
        borrower.executeFlashLoan(address(pt), 10 ether, "");
    }

    /*//////////////////////////////////////////////////////////////
                        HAPPY PATH TESTS
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoanHappyPath_WithFee() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(5);

        uint256 flashAmount = 50 ether;
        uint256 expectedFee = _computeFee(flashAmount, RATE_95, 5);

        uint256 ptBefore = pt.balanceOf(address(ovrflo));
        uint256 underlyingBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), flashAmount, "");

        assertEq(pt.balanceOf(address(ovrflo)), ptBefore, "PT not returned");
        assertEq(underlying.balanceOf(TREASURY) - underlyingBefore, expectedFee, "Fee not sent");
        assertEq(ovrflo.marketTotalDeposited(MARKET), DEPOSIT_AMOUNT, "marketTotalDeposited changed");
    }

    function test_FlashLoanHappyPath_ZeroFee() public {
        uint256 flashAmount = 50 ether;
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), flashAmount, "");

        assertEq(underlying.balanceOf(TREASURY), treasuryBefore, "Fee charged when bps=0");
    }

    function test_FlashLoanWithMaxFee() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(100);

        uint256 flashAmount = 50 ether;
        uint256 expectedFee = _computeFee(flashAmount, RATE_95, 100);
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), flashAmount, "");

        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "Max fee mismatch");
    }

    /*//////////////////////////////////////////////////////////////
                        CALLBACK TESTS
    //////////////////////////////////////////////////////////////*/

    function test_RevertWrongCallbackHash() public {
        borrower.setReturnSuccess(false);
        vm.expectRevert("OVRFLO: callback failed");
        borrower.executeFlashLoan(address(pt), 10 ether, "");
    }

    function test_RevertFailedRepayment() public {
        vm.prank(address(borrower));
        pt.approve(address(ovrflo), 0);
        vm.expectRevert();
        borrower.executeFlashLoan(address(pt), 10 ether, "");
    }

    function test_RevertFailedFeePull() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(5);
        vm.prank(address(borrower));
        underlying.approve(address(ovrflo), 0);
        vm.expectRevert();
        borrower.executeFlashLoan(address(pt), 10 ether, "");
    }

    /*//////////////////////////////////////////////////////////////
                        REENTRANCY TESTS
    //////////////////////////////////////////////////////////////*/

    function test_DepositDuringCallback_Succeeds() public {
        uint256 flashAmount = 50 ether;
        borrower.configureDeposit(MARKET, flashAmount);

        // Give borrower extra PT to repay the flash loan (simulates buying PT on AMM)
        pt.mint(address(borrower), flashAmount);

        // Mock Sablier for the deposit during callback (broad mock)
        vm.mockCall(
            SABLIER_LL,
            abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector),
            abi.encode(uint256(2))
        );

        uint256 depositedBefore = ovrflo.marketTotalDeposited(MARKET);

        borrower.executeFlashLoan(address(pt), flashAmount, "");

        assertTrue(borrower.depositSucceeded(), "Deposit during callback failed");
        // marketTotalDeposited increased by flashAmount (deposit added new PT)
        assertEq(
            ovrflo.marketTotalDeposited(MARKET), depositedBefore + flashAmount, "marketTotalDeposited not increased"
        );
    }

    function test_NestedFlashLoan_RevertsDueToNonReentrant() public {
        uint256 flashAmount = 50 ether;
        borrower.configureNestedFlashLoan(address(pt), 10 ether);

        borrower.executeFlashLoan(address(pt), flashAmount, "");

        assertFalse(borrower.nestedSucceeded(), "Nested flash loan should revert");
    }

    function test_UnwrapDuringCallback_Succeeds() public {
        // Give borrower ovrfloToken via wrap
        underlying.mint(address(borrower), 20 ether);
        vm.prank(address(borrower));
        ovrflo.wrap(20 ether);

        uint256 flashAmount = 50 ether;
        borrower.configureUnwrap(10 ether);

        uint256 reserveBefore = ovrflo.wrappedUnderlying();

        borrower.executeFlashLoan(address(pt), flashAmount, "");

        assertTrue(borrower.unwrapSucceeded(), "Unwrap during callback failed");
        assertEq(ovrflo.wrappedUnderlying(), reserveBefore - 10 ether, "Reserve not decremented");
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN TESTS
    //////////////////////////////////////////////////////////////*/

    function test_SetFlashFeeBps() public {
        vm.prank(ADMIN);
        vm.expectEmit(address(ovrflo));
        emit FlashFeeBpsSet(50);
        ovrflo.setFlashFeeBps(50);

        assertEq(ovrflo.flashFeeBps(), 50);
    }

    function test_SetFlashFeeBps_RevertExceedsMax() public {
        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: flash fee too high");
        ovrflo.setFlashFeeBps(101);
    }

    function test_SetFlashFeeBps_RevertNonAdmin() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.setFlashFeeBps(50);
    }

    function test_SetFlashFeeBps_MaxAllowed() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(100);
        assertEq(ovrflo.flashFeeBps(), 100);
    }

    function test_SetFlashFeeBps_ZeroAllowed() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(50);
        assertEq(ovrflo.flashFeeBps(), 50);

        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(0);
        assertEq(ovrflo.flashFeeBps(), 0);
    }

    function test_SetFlashLoanPaused() public {
        vm.prank(ADMIN);
        vm.expectEmit(address(ovrflo));
        emit FlashLoanPausedSet(true);
        ovrflo.setFlashLoanPaused(true);

        assertTrue(ovrflo.flashLoanPaused());

        vm.prank(ADMIN);
        ovrflo.setFlashLoanPaused(false);
        assertFalse(ovrflo.flashLoanPaused());
    }

    function test_SetFlashLoanPaused_RevertNonAdmin() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.setFlashLoanPaused(true);
    }

    function test_Defaults() public {
        // Fresh vault
        MockERC20 freshUnderlying = new MockERC20("Fresh", "FR");
        OVRFLOToken freshToken = new OVRFLOToken("OVRFLO Fresh", "ovrfloFR");
        OVRFLO freshOvrflo = new OVRFLO(ADMIN, TREASURY, address(freshUnderlying), address(freshToken), PENDLE_ORACLE);
        freshToken.transferOwnership(address(freshOvrflo));

        assertEq(freshOvrflo.flashFeeBps(), 0, "Default fee should be 0");
        assertFalse(freshOvrflo.flashLoanPaused(), "Default pause should be false");
        assertEq(freshOvrflo.FLASH_FEE_MAX_BPS(), 100, "Max fee should be 100");
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/

    function _mockRate(address market, uint256 rateE18) internal {
        vm.mockCall(
            PENDLE_ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (market, TWAP_DURATION)), abi.encode(rateE18)
        );
    }

    function _mockSablier(address recipient, uint128 amount, uint256 duration, uint256 streamId) internal {
        ISablierV2LockupLinear.CreateWithDurations memory params = ISablierV2LockupLinear.CreateWithDurations({
            sender: address(ovrflo),
            recipient: recipient,
            totalAmount: amount,
            asset: IERC20(address(ovrfloToken)),
            cancelable: false,
            transferable: true,
            durations: ISablierV2LockupLinear.Durations({cliff: 0, total: uint40(duration)}),
            broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
        });
        bytes memory callData = abi.encodeCall(ISablierV2LockupLinear.createWithDurations, (params));
        vm.mockCall(SABLIER_LL, callData, abi.encode(streamId));
    }

    function _computeFee(uint256 amount, uint256 rateE18, uint16 feeBps) internal pure returns (uint256) {
        uint256 ptValueInUnderlying = (amount * rateE18) / 1e18;
        return (ptValueInUnderlying * feeBps) / 10_000;
    }

    function _toUser(uint256 ptAmount) internal pure returns (uint256) {
        uint256 toUser = (ptAmount * RATE_95) / 1e18;
        if (toUser > ptAmount) toUser = ptAmount;
        return toUser;
    }
}
