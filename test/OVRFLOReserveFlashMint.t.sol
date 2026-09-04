// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOReserve} from "../src/OVRFLOReserve.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockOvrfloAdmin} from "./mocks/MockOvrfloAdmin.sol";
import {FactoryStreamBind} from "./helpers/FactoryStreamBind.sol";
import {VaultMockHelpers} from "./helpers/VaultMockHelpers.sol";

/// @dev Callback actor for ERC-3156 tests. Modes are encoded in `data`.
contract FlashMintReceiver is IERC3156FlashBorrower {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    enum Mode {
        Repay,
        NestedFlash,
        WrapThenUnwrap,
        UnwrapThenWrap,
        WrapOnly,
        UnwrapOnly,
        RecordMax,
        Deposit
    }

    OVRFLOReserve public immutable reserve;
    IERC20 public immutable underlying;
    OVRFLO public vault;
    IERC20 public pt;
    address public market;
    uint256 public ptAmount;
    bool public approveRepay = true;
    bytes32 public returnValue = CALLBACK_SUCCESS;
    uint256 public maxWhileEntered;
    uint256 public wrapAmount;

    constructor(OVRFLOReserve reserve_, IERC20 underlying_) {
        reserve = reserve_;
        underlying = underlying_;
    }

    function setApproveRepay(bool approveRepay_) external {
        approveRepay = approveRepay_;
    }

    function setReturnValue(bytes32 returnValue_) external {
        returnValue = returnValue_;
    }

    function setWrapAmount(uint256 wrapAmount_) external {
        wrapAmount = wrapAmount_;
    }

    function setDeposit(OVRFLO vault_, IERC20 pt_, address market_, uint256 ptAmount_) external {
        vault = vault_;
        pt = pt_;
        market = market_;
        ptAmount = ptAmount_;
    }

    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32)
    {
        Mode mode = abi.decode(data, (Mode));
        if (mode == Mode.NestedFlash) {
            IERC3156FlashLender(address(reserve)).flashLoan(this, token, amount, abi.encode(Mode.Repay));
        } else if (mode == Mode.WrapThenUnwrap) {
            uint256 x = wrapAmount;
            underlying.approve(address(reserve), x);
            reserve.wrap(x);
            reserve.unwrap(x);
        } else if (mode == Mode.UnwrapThenWrap) {
            uint256 x = wrapAmount;
            reserve.unwrap(x);
            underlying.approve(address(reserve), x);
            reserve.wrap(x);
        } else if (mode == Mode.WrapOnly) {
            uint256 x = wrapAmount;
            underlying.approve(address(reserve), x);
            reserve.wrap(x);
        } else if (mode == Mode.UnwrapOnly) {
            uint256 x = wrapAmount;
            reserve.unwrap(x);
        } else if (mode == Mode.Deposit) {
            reserve.unwrap(amount);
            pt.approve(address(vault), ptAmount);
            vault.deposit(market, ptAmount, 0);
        } else if (mode == Mode.RecordMax) {
            maxWhileEntered = reserve.maxFlashLoan(token);
        }

        if (approveRepay) {
            IERC20(token).approve(address(reserve), amount + fee);
        }
        return returnValue;
    }
}

/// @title ERC-3156 flash mint of ovrfloToken on OVRFLOReserve (CS2-U1)
contract OVRFLOReserveFlashMintTest is VaultMockHelpers {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x1001);
    uint16 internal constant SERIES_FEE_BPS = 100;

    uint256 internal constant CEILING = 100_000_000_000 * 10 ** 18;

    OVRFLO internal ovrflo;
    OVRFLOReserve internal reserve;
    OVRFLOToken internal ovrfloToken;
    TestERC20 internal underlying;
    MockOvrfloAdmin internal admin;
    FlashMintReceiver internal receiver;
    address internal user;

    function setUp() public {
        user = makeAddr("user");
        underlying = new TestERC20("Underlying", "UND");
        admin = new MockOvrfloAdmin(TREASURY, address(underlying), address(0));
        _stubLockup();
        ovrflo = new OVRFLO(
            address(admin), TREASURY, address(underlying), "OVRFLO Underlying", "ovrfloUND", PENDLE_ORACLE, SABLIER_LL
        );
        reserve = OVRFLOReserve(ovrflo.reserve());
        ovrfloToken = OVRFLOToken(ovrflo.ovrfloToken());
        admin.setInfo(TREASURY, address(underlying), address(ovrfloToken));
        receiver = new FlashMintReceiver(reserve, IERC20(address(underlying)));
    }

    function _enableMint(uint256 max) internal {
        vm.prank(address(admin));
        reserve.setFlashMintMax(max);
    }

    function _flash(FlashMintReceiver.Mode mode, uint256 amount) internal returns (bool) {
        return reserve.flashLoan(receiver, address(ovrfloToken), amount, abi.encode(mode));
    }

    /// @notice Covers *Flash mint conservation* at fee 0: supply after equals supply before.
    function test_FlashLoan_FeeZero_ConservesTotalSupplyAndReturnsTrue() public {
        uint256 amount = 10 ether;
        _enableMint(amount);
        uint256 supplyBefore = ovrfloToken.totalSupply();

        bool ok = _flash(FlashMintReceiver.Mode.Repay, amount);

        assertTrue(ok);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
        assertEq(ovrfloToken.balanceOf(address(receiver)), 0);
        assertEq(ovrfloToken.balanceOf(TREASURY), 0);
        assertEq(ovrfloToken.balanceOf(address(reserve)), 0);
    }

    /// @notice Covers *Flash mint conservation* at 9 bps: treasury gains fee from pulled tokens.
    function test_FlashLoan_NonzeroFee_PaysTreasuryFromPulledTokensAndConservesSupply() public {
        uint256 amount = 10_000 ether;
        uint256 fee = 9 ether;
        _enableMint(amount);
        vm.prank(address(admin));
        reserve.setFlashFeeBps(9);

        _wrap(address(receiver), fee);
        uint256 supplyBefore = ovrfloToken.totalSupply();
        assertEq(supplyBefore, fee);
        assertEq(ovrfloToken.balanceOf(TREASURY), 0);

        bool ok = _flash(FlashMintReceiver.Mode.Repay, amount);

        assertTrue(ok);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
        assertEq(ovrfloToken.balanceOf(TREASURY), fee);
        assertEq(ovrfloToken.balanceOf(address(receiver)), 0);
        assertEq(ovrfloToken.balanceOf(address(reserve)), 0);
    }

    function test_Launch_FlashMintMaxIsZero_MaxFlashLoanIsZeroAndFlashLoanReverts() public view {
        assertEq(reserve.flashMintMax(), 0);
        assertEq(reserve.flashFeeBps(), 0);
        assertEq(reserve.maxFlashLoan(address(ovrfloToken)), 0);
        assertEq(reserve.FLASH_MINT_MAX_CEILING(), CEILING);
        assertEq(reserve.FLASH_FEE_MAX_BPS(), 9);
    }

    function test_Launch_FlashLoanRevertsWhenMaxIsZero() public {
        uint256 supplyBefore = ovrfloToken.totalSupply();
        vm.expectRevert(OVRFLOReserve.FlashExceedsMax.selector);
        _flash(FlashMintReceiver.Mode.Repay, 1 ether);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
    }

    function test_MaxFlashLoan_IsZeroForWrongTokenAndEqualsMinOfMaxAndOverflowGuard() public {
        uint256 max = 100 ether;
        _enableMint(max);
        assertEq(reserve.maxFlashLoan(address(underlying)), 0);
        assertEq(reserve.maxFlashLoan(address(ovrfloToken)), max);

        uint256 headroom = 5;
        vm.prank(address(reserve));
        ovrfloToken.mint(user, type(uint256).max - headroom);
        assertEq(reserve.maxFlashLoan(address(ovrfloToken)), headroom);
    }

    function test_MaxFlashLoan_IsZeroWhileEntered() public {
        _enableMint(10 ether);
        _flash(FlashMintReceiver.Mode.RecordMax, 1 ether);
        assertEq(receiver.maxWhileEntered(), 0);
        assertEq(reserve.maxFlashLoan(address(ovrfloToken)), 10 ether);
    }

    function test_FlashLoan_NestedFlashReverts() public {
        _enableMint(10 ether);
        uint256 supplyBefore = ovrfloToken.totalSupply();
        vm.expectRevert(OVRFLOReserve.FlashExceedsMax.selector);
        _flash(FlashMintReceiver.Mode.NestedFlash, 1 ether);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
    }

    function test_FlashLoan_WrapThenUnwrapInCallbackSucceeds() public {
        uint256 amount = 10 ether;
        uint256 roundTrip = 3 ether;
        _enableMint(amount);
        underlying.mint(address(receiver), roundTrip);
        receiver.setWrapAmount(roundTrip);

        uint256 supplyBefore = ovrfloToken.totalSupply();
        bool ok = _flash(FlashMintReceiver.Mode.WrapThenUnwrap, amount);
        assertTrue(ok);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
        assertEq(reserve.wrappedUnderlying(), 0);
    }

    function test_FlashLoan_UnwrapThenWrapInCallbackSucceeds() public {
        uint256 amount = 10 ether;
        uint256 roundTrip = 4 ether;
        _enableMint(amount);
        _wrap(user, roundTrip);
        receiver.setWrapAmount(roundTrip);

        uint256 supplyBefore = ovrfloToken.totalSupply();
        bool ok = _flash(FlashMintReceiver.Mode.UnwrapThenWrap, amount);
        assertTrue(ok);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
        assertEq(reserve.wrappedUnderlying(), roundTrip);
        assertEq(underlying.balanceOf(address(reserve)), roundTrip);
    }

    function test_FlashFee_RevertsForWrongTokenAndComputesBps() public {
        vm.prank(address(admin));
        reserve.setFlashFeeBps(9);
        vm.expectRevert(OVRFLOReserve.UnsupportedFlashToken.selector);
        reserve.flashFee(address(underlying), 10_000 ether);
        assertEq(reserve.flashFee(address(ovrfloToken), 10_000 ether), 9 ether);
        assertEq(reserve.flashFee(address(ovrfloToken), 0), 0);
    }

    function test_FlashLoan_WrongTokenReverts() public {
        _enableMint(10 ether);
        vm.expectRevert(OVRFLOReserve.UnsupportedFlashToken.selector);
        reserve.flashLoan(receiver, address(underlying), 1 ether, abi.encode(FlashMintReceiver.Mode.Repay));
    }

    function test_FlashLoan_AmountZeroRevertsAndLeavesSupplyUnchanged() public {
        _enableMint(10 ether);
        uint256 supplyBefore = ovrfloToken.totalSupply();
        vm.expectRevert(OVRFLOReserve.ZeroAmount.selector);
        _flash(FlashMintReceiver.Mode.Repay, 0);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
    }

    function test_FlashLoan_FailedCallbackRevertsAndLeavesSupplyUnchanged() public {
        _enableMint(10 ether);
        receiver.setReturnValue(bytes32(0));
        uint256 supplyBefore = ovrfloToken.totalSupply();
        vm.expectRevert(OVRFLOReserve.FlashCallbackFailed.selector);
        _flash(FlashMintReceiver.Mode.Repay, 1 ether);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
    }

    function test_FlashLoan_FailedRepayRevertsAndLeavesSupplyUnchanged() public {
        _enableMint(10 ether);
        receiver.setApproveRepay(false);
        uint256 supplyBefore = ovrfloToken.totalSupply();
        vm.expectRevert("ERC20: insufficient allowance");
        _flash(FlashMintReceiver.Mode.Repay, 1 ether);
        assertEq(ovrfloToken.totalSupply(), supplyBefore);
    }

    function test_FlashLoan_WrapOnlyInCallbackGrowsSupplyByWrapped() public {
        uint256 amount = 10 ether;
        uint256 extra = 1 ether;
        _enableMint(amount);
        underlying.mint(address(receiver), extra);
        receiver.setWrapAmount(extra);
        uint256 supplyBefore = ovrfloToken.totalSupply();
        bool ok = _flash(FlashMintReceiver.Mode.WrapOnly, amount);
        assertTrue(ok);
        assertEq(ovrfloToken.totalSupply(), supplyBefore + extra);
        assertEq(reserve.wrappedUnderlying(), extra);
        assertEq(ovrfloToken.balanceOf(address(receiver)), extra);
    }

    function test_FlashLoan_UnwrapOnlyInCallbackShrinksSupplyByUnwrapped() public {
        uint256 amount = 10 ether;
        uint256 unwrapped = 1 ether;
        _enableMint(amount);
        uint256 fee = reserve.flashFee(address(ovrfloToken), amount);
        _wrap(address(receiver), unwrapped + fee + 1 ether);
        receiver.setWrapAmount(unwrapped);

        uint256 supplyBefore = ovrfloToken.totalSupply();
        uint256 reserveUnderlyingBefore = underlying.balanceOf(address(reserve));
        uint256 borrowerUnderlyingBefore = underlying.balanceOf(address(receiver));

        bool ok = _flash(FlashMintReceiver.Mode.UnwrapOnly, amount);

        assertTrue(ok);
        assertEq(ovrfloToken.totalSupply(), supplyBefore - unwrapped);
        assertEq(underlying.balanceOf(address(reserve)), reserveUnderlyingBefore - unwrapped);
        assertEq(underlying.balanceOf(address(receiver)), borrowerUnderlyingBefore + unwrapped);
        if (fee > 0) {
            assertEq(ovrfloToken.balanceOf(TREASURY), fee);
            assertEq(ovrfloToken.balanceOf(address(reserve)), 0);
        }
    }

    /// @notice Flash mint, unwrap the flashed tokens, deposit PT, repay from the deposit.
    ///         Wrap `amount` first so unwrap has reserve. Flash mint/burn and that wrap
    ///         cancel; only the deposit split stays in supply.
    function test_FlashLoan_DepositInCallbackMintsAgainstPt() public {
        uint256 amount = 5 ether;
        uint256 ptAmount = 10 ether;
        uint256 rateE18 = 0.8e18;
        uint256 expiry = block.timestamp + 30 days;
        // 10e18 * 0.8e18 / 1e18 = 8e18 immediate; 100 bps fee = 8e16; stream = 2e18.
        uint256 expectedToUser = 7.92 ether;
        uint256 expectedToStream = 2 ether;
        uint256 expectedFeeAmount = 0.08 ether;

        TestERC20 pt = new TestERC20("PT One", "PT1");
        vm.prank(address(admin));
        ovrflo.setSeriesApproved(MARKET, address(pt), TWAP_DURATION, expiry, SERIES_FEE_BPS);
        _mockRate(MARKET, rateE18);

        (uint256 toUser, uint256 toStream, uint256 feeAmount, uint256 rate) = ovrflo.previewDeposit(MARKET, ptAmount);
        assertEq(rate, rateE18);
        assertEq(toUser, expectedToUser);
        assertEq(toStream, expectedToStream);
        assertEq(feeAmount, expectedFeeAmount);

        _mockSablierCreate(
            address(ovrflo), address(ovrfloToken), address(receiver), uint128(toStream), expiry - block.timestamp, 77
        );

        pt.mint(address(receiver), ptAmount);
        receiver.setDeposit(ovrflo, IERC20(address(pt)), MARKET, ptAmount);
        _wrap(address(receiver), amount);
        _enableMint(amount);

        uint256 supplyBefore = ovrfloToken.totalSupply() - amount;
        uint256 depositedBefore = ovrflo.marketTotalDeposited(MARKET);

        bool ok = _flash(FlashMintReceiver.Mode.Deposit, amount);

        assertTrue(ok);
        assertEq(ovrfloToken.balanceOf(address(receiver)), toUser);
        assertEq(ovrfloToken.totalSupply(), supplyBefore + toUser + toStream + feeAmount);
        assertEq(ovrflo.marketTotalDeposited(MARKET), depositedBefore + ptAmount);
    }

    function test_SetFlashMintMax_CeilingAndNonAdmin() public {
        vm.prank(address(admin));
        reserve.setFlashMintMax(CEILING);
        assertEq(reserve.flashMintMax(), CEILING);

        vm.prank(address(admin));
        vm.expectRevert(OVRFLOReserve.FlashMintMaxTooHigh.selector);
        reserve.setFlashMintMax(CEILING + 1);

        vm.expectRevert(OVRFLOReserve.NotAdmin.selector);
        reserve.setFlashMintMax(1 ether);
    }

    function test_SetFlashFeeBps_CapAndNonAdmin() public {
        vm.prank(address(admin));
        reserve.setFlashFeeBps(9);
        assertEq(reserve.flashFeeBps(), 9);

        vm.prank(address(admin));
        vm.expectRevert(OVRFLOReserve.FlashFeeTooHigh.selector);
        reserve.setFlashFeeBps(10);

        vm.expectRevert(OVRFLOReserve.NotAdmin.selector);
        reserve.setFlashFeeBps(1);
    }

    function test_VaultHasNoFlashLoan() public {
        (bool ok,) = address(ovrflo)
            .call(
                abi.encodeWithSignature(
                    "flashLoan(address,address,uint256,bytes)", address(receiver), address(ovrfloToken), 1, ""
                )
            );
        assertFalse(ok);
    }

    function _wrap(address who, uint256 amount) internal {
        underlying.mint(who, amount);
        vm.prank(who);
        underlying.approve(address(reserve), amount);
        vm.prank(who);
        reserve.wrap(amount);
    }
}

/// @title Factory forwarders for reserve flash mint ceilings
contract OVRFLOFactoryFlashMintForwarderTest is Test, FactoryStreamBind {
    address internal constant OWNER = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    uint256 internal constant CEILING = 100_000_000_000 * 10 ** 18;

    OVRFLOFactory internal factory;
    OVRFLO internal ovrflo;
    OVRFLOReserve internal reserve;
    TestERC20 internal underlying;

    event ReserveFlashMintMaxSet(address indexed ovrflo, uint256 max);
    event ReserveFlashFeeBpsSet(address indexed ovrflo, uint16 bps);

    function setUp() public {
        factory = new OVRFLOFactory(OWNER, PENDLE_ORACLE);
        underlying = new TestERC20("Underlying", "UND");
        address stream = _bindCanonicalStream(factory);
        ovrflo = new OVRFLO(
            address(factory), TREASURY, address(underlying), "OVRFLO Underlying", "ovrfloUND", PENDLE_ORACLE, stream
        );
        vm.prank(OWNER);
        factory.registerOvrflo(address(ovrflo));
        reserve = OVRFLOReserve(ovrflo.reserve());
    }

    function test_SetReserveFlashMintMax_ForwardsAndEnforcesCeiling() public {
        vm.expectEmit(true, false, false, true, address(factory));
        emit ReserveFlashMintMaxSet(address(ovrflo), 1 ether);
        vm.prank(OWNER);
        factory.setReserveFlashMintMax(address(ovrflo), 1 ether);
        assertEq(reserve.flashMintMax(), 1 ether);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOReserve.FlashMintMaxTooHigh.selector);
        factory.setReserveFlashMintMax(address(ovrflo), CEILING + 1);
    }

    function test_SetReserveFlashFeeBps_ForwardsAndEnforcesCap() public {
        vm.expectEmit(true, false, false, true, address(factory));
        emit ReserveFlashFeeBpsSet(address(ovrflo), 9);
        vm.prank(OWNER);
        factory.setReserveFlashFeeBps(address(ovrflo), 9);
        assertEq(reserve.flashFeeBps(), 9);

        vm.prank(OWNER);
        vm.expectRevert(OVRFLOReserve.FlashFeeTooHigh.selector);
        factory.setReserveFlashFeeBps(address(ovrflo), 10);
    }

    function test_SetReserveFlashMintMax_UnknownOvrfloAndNonOwner() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.setReserveFlashMintMax(address(0xDEAD), 1 ether);

        vm.expectRevert("Ownable: caller is not the owner");
        factory.setReserveFlashMintMax(address(ovrflo), 1 ether);
    }

    function test_SetReserveFlashFeeBps_UnknownOvrfloAndNonOwner() public {
        vm.prank(OWNER);
        vm.expectRevert(OVRFLOFactory.UnknownOvrflo.selector);
        factory.setReserveFlashFeeBps(address(0xDEAD), 1);

        vm.expectRevert("Ownable: caller is not the owner");
        factory.setReserveFlashFeeBps(address(ovrflo), 1);
    }
}
