// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOReserve} from "../src/OVRFLOReserve.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {VaultMockHelpers} from "./helpers/VaultMockHelpers.sol";

contract MockERC20Metadata is ERC20 {
    uint8 private immutable CUSTOM_DECIMALS;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        CUSTOM_DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return CUSTOM_DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev A PT that reports success but delivers one wei less than requested.
contract ShortTransferPt is MockERC20Metadata {
    constructor() MockERC20Metadata("Short PT", "SPT", 18) {}

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount - 1);
    }
}

/// @dev Fast deterministic protocol unit coverage; real Pendle oracle/PT/Sablier integration lives in test/fork/OVRFLOMainnetFork.t.sol.
contract OVRFLOProtocolTest is VaultMockHelpers {
    event Deposited(
        address indexed user,
        address indexed market,
        uint256 ptAmount,
        uint256 toUser,
        uint256 toStream,
        uint256 streamId
    );
    event FeeTaken(address indexed payer, address indexed token, uint256 amount);
    event Claimed(
        address indexed user, address indexed market, address indexed ptToken, address ovrfloToken, uint256 amount
    );
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);
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

    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET_ONE = address(0x1001);
    address internal constant MARKET_TWO = address(0x1002);

    uint16 internal constant FEE_BPS = 100;
    uint256 internal constant RATE_95 = 0.95e18;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    MockERC20Metadata internal underlying;
    MockERC20Metadata internal ptOne;
    MockERC20Metadata internal ptTwo;

    address internal user;
    address internal otherUser;

    function setUp() public {
        user = makeAddr("user");
        otherUser = makeAddr("otherUser");

        underlying = new MockERC20Metadata("Underlying", "UND", 18);
        ptOne = new MockERC20Metadata("PT One", "PT1", 18);
        ptTwo = new MockERC20Metadata("PT Two", "PT2", 18);

        _stubLockup();
        ovrflo =
            new OVRFLO(ADMIN, TREASURY, address(underlying), "OVRFLO Underlying", "ovrUND", PENDLE_ORACLE, SABLIER_LL);
        ovrfloToken = OVRFLOToken(ovrflo.ovrfloToken());
    }

    function test_Constructor_RevertsForZeroAddresses() public {
        vm.expectRevert(OVRFLO.ZeroAddress.selector);
        new OVRFLO(address(0), TREASURY, address(underlying), "OVRFLO Underlying", "ovrUND", PENDLE_ORACLE, SABLIER_LL);

        vm.expectRevert(OVRFLO.ZeroAddress.selector);
        new OVRFLO(ADMIN, address(0), address(underlying), "OVRFLO Underlying", "ovrUND", PENDLE_ORACLE, SABLIER_LL);

        vm.expectRevert(OVRFLO.ZeroAddress.selector);
        new OVRFLO(ADMIN, TREASURY, address(0), "OVRFLO Underlying", "ovrUND", PENDLE_ORACLE, SABLIER_LL);

        vm.expectRevert(OVRFLO.ZeroAddress.selector);
        new OVRFLO(ADMIN, TREASURY, address(underlying), "OVRFLO Underlying", "ovrUND", address(0), SABLIER_LL);

        vm.expectRevert(OVRFLO.ZeroAddress.selector);
        new OVRFLO(ADMIN, TREASURY, address(underlying), "OVRFLO Underlying", "ovrUND", PENDLE_ORACLE, address(0));

        vm.expectRevert(OVRFLO.NoCode.selector);
        new OVRFLO(ADMIN, TREASURY, address(underlying), "OVRFLO Underlying", "ovrUND", PENDLE_ORACLE, address(0xBEEF));
    }

    function test_Constructor_BindsStreamLastAndKeepsSablierLLGetter() public view {
        assertEq(address(ovrflo.sablierLL()), SABLIER_LL);
    }

    function test_VaultAbi_HasNoOvrfloStreamGetter() public {
        (bool ok, bytes memory data) = address(ovrflo).staticcall(abi.encodeWithSignature("ovrfloStream()"));
        assertFalse(ok);
        assertEq(data, "");
    }

    function test_Constructor_NestsReserveAndTokenWithBothMintersBound() public view {
        OVRFLOReserve reserve = OVRFLOReserve(ovrflo.reserve());

        assertEq(reserve.vault(), address(ovrflo), "reserve.vault");
        assertEq(reserve.factory(), ADMIN, "reserve.factory");
        assertEq(reserve.underlying(), address(underlying), "reserve.underlying");
        assertEq(reserve.ovrfloToken(), address(ovrfloToken), "reserve.ovrfloToken == vault.ovrfloToken");

        assertEq(ovrfloToken.vault(), address(ovrflo), "token.vault");
        assertEq(ovrfloToken.reserve(), address(reserve), "token.reserve");
        assertEq(ovrfloToken.name(), "OVRFLO Underlying");
        assertEq(ovrfloToken.symbol(), "ovrUND");
        assertEq(ovrfloToken.allowance(address(ovrflo), SABLIER_LL), type(uint256).max, "stream approval");
    }

    function test_VaultAbi_HasNoWrapUnwrapOrUnderlyingSweep() public {
        bytes[4] memory calls = [
            abi.encodeWithSignature("wrap(uint256)", 1),
            abi.encodeWithSignature("unwrap(uint256)", 1),
            abi.encodeWithSignature("wrappedUnderlying()"),
            abi.encodeWithSignature("sweepExcessUnderlying(address)", TREASURY)
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory data) = address(ovrflo).call(calls[i]);
            assertFalse(ok);
            assertEq(data, "");
        }
    }

    function test_SetSeriesApproved_SetsStateApprovesSablierAndEmitsEvent() public {
        uint256 expiry = block.timestamp + 30 days;

        vm.expectEmit(address(ovrflo));
        emit SeriesApproved(
            MARKET_ONE,
            address(ptOne),
            address(ovrfloToken),
            address(underlying),
            PENDLE_ORACLE,
            TWAP_DURATION,
            expiry,
            FEE_BPS
        );

        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);

        (
            uint32 twapDuration,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address token,
            address feeToken,
            address oracle
        ) = ovrflo.series(MARKET_ONE);

        assertTrue(ptToken != address(0));
        assertEq(twapDuration, TWAP_DURATION);
        assertEq(feeBps, FEE_BPS);
        assertEq(expiryCached, expiry);
        assertEq(ptToken, address(ptOne));
        assertEq(token, address(ovrfloToken));
        assertEq(feeToken, address(underlying));
        assertEq(oracle, PENDLE_ORACLE);
        assertEq(ovrflo.ptToMarket(address(ptOne)), MARKET_ONE);
        assertEq(ovrfloToken.allowance(address(ovrflo), SABLIER_LL), type(uint256).max);
    }

    function test_SetSeriesApproved_AllowsSharedTokenAcrossDistinctMaturities() public {
        uint256 firstExpiry = block.timestamp + 30 days;
        uint256 secondExpiry = block.timestamp + 60 days;

        _approveSeries(MARKET_ONE, ptOne, firstExpiry, FEE_BPS);
        _approveSeries(MARKET_TWO, ptTwo, secondExpiry, 0);

        (,, uint256 storedFirstExpiry,, address firstToken,,) = ovrflo.series(MARKET_ONE);
        (,, uint256 storedSecondExpiry,, address secondToken,,) = ovrflo.series(MARKET_TWO);

        assertEq(firstToken, address(ovrfloToken));
        assertEq(secondToken, address(ovrfloToken));
        assertEq(storedFirstExpiry, firstExpiry);
        assertEq(storedSecondExpiry, secondExpiry);
        assertEq(ovrflo.ptToMarket(address(ptOne)), MARKET_ONE);
        assertEq(ovrflo.ptToMarket(address(ptTwo)), MARKET_TWO);
    }

    function test_SetSeriesApproved_RevertsForNonAdmin() public {
        vm.prank(user);
        vm.expectRevert(OVRFLO.NotAdmin.selector);
        ovrflo.setSeriesApproved(MARKET_ONE, address(ptOne), TWAP_DURATION, 1, 0);
    }

    function test_SetSeriesApproved_RevertsForDuplicateMarketConfiguration() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);

        vm.prank(ADMIN);
        vm.expectRevert(OVRFLO.SeriesAlreadyConfigured.selector);
        ovrflo.setSeriesApproved(MARKET_ONE, address(ptTwo), TWAP_DURATION, block.timestamp + 60 days, 0);
    }

    function test_SetSeriesApproved_RevertsForDuplicatePtRegistration() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);

        vm.prank(ADMIN);
        vm.expectRevert(OVRFLO.PtAlreadyMapped.selector);
        ovrflo.setSeriesApproved(MARKET_TWO, address(ptOne), TWAP_DURATION, block.timestamp + 60 days, 0);
    }

    function test_SetMarketDepositLimit_SetsLimitAndEmitsEvent() public {
        uint256 limit = 50 ether;

        vm.expectEmit(address(ovrflo));
        emit MarketDepositLimitSet(MARKET_ONE, limit);

        vm.prank(ADMIN);
        ovrflo.setMarketDepositLimit(MARKET_ONE, limit);

        assertEq(ovrflo.marketDepositLimits(MARKET_ONE), limit);
    }

    function test_SetMarketDepositLimit_RevertsForNonAdmin() public {
        vm.prank(user);
        vm.expectRevert(OVRFLO.NotAdmin.selector);
        ovrflo.setMarketDepositLimit(MARKET_ONE, 1);
    }

    function test_SweepExcessPt_SweepsOnlyExcessAndEmitsEvent() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, block.timestamp + 30 days, 1);
        ptOne.mint(address(ovrflo), 2 ether);

        vm.expectEmit(address(ovrflo));
        emit ExcessSwept(address(ptOne), otherUser, 2 ether);

        vm.prank(ADMIN);
        ovrflo.sweepExcessPt(address(ptOne), otherUser);

        assertEq(ptOne.balanceOf(otherUser), 2 ether);
        assertEq(ptOne.balanceOf(address(ovrflo)), 10 ether);
    }

    function test_SweepExcessPt_RevertsForNonAdminOrNoExcess() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);

        vm.prank(user);
        vm.expectRevert(OVRFLO.NotAdmin.selector);
        ovrflo.sweepExcessPt(address(ptOne), otherUser);

        vm.prank(ADMIN);
        vm.expectRevert(OVRFLO.NoExcess.selector);
        ovrflo.sweepExcessPt(address(ptOne), otherUser);
    }

    function test_SweepExcessPt_RevertsForUnknownPt() public {
        // Underlying sent to the vault by mistake is not a PT; the guard must not sweep it
        underlying.mint(address(ovrflo), 50 ether);
        uint256 balBefore = underlying.balanceOf(address(ovrflo));

        vm.prank(ADMIN);
        vm.expectRevert(OVRFLO.UnknownPT.selector);
        ovrflo.sweepExcessPt(address(underlying), TREASURY);

        // Balance unchanged — the drain this guard prevents
        assertEq(underlying.balanceOf(address(ovrflo)), balBefore);

        // Unapproved PT-like token also reverts
        MockERC20Metadata fakePt = new MockERC20Metadata("Fake PT", "FPT", 18);
        fakePt.mint(address(ovrflo), 5 ether);

        vm.prank(ADMIN);
        vm.expectRevert(OVRFLO.UnknownPT.selector);
        ovrflo.sweepExcessPt(address(fakePt), TREASURY);
    }

    function test_Deposit_MintsTokensCreatesStreamChargesFeeAndEmitsEvents() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);

        (uint256 toUser, uint256 toStream, uint256 feeAmount,) =
            _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.9e18, FEE_BPS);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 77);

        assertGt(feeAmount, 0, "fee-bearing series");

        vm.startPrank(user);
        vm.expectEmit(address(ovrflo));
        emit FeeTaken(user, address(ovrfloToken), feeAmount);
        vm.expectEmit(address(ovrflo));
        emit Deposited(user, MARKET_ONE, 10 ether, toUser, toStream, 77);
        (uint256 actualToUser, uint256 actualToStream, uint256 streamId) = ovrflo.deposit(MARKET_ONE, 10 ether, toUser);
        vm.stopPrank();

        assertEq(actualToUser, toUser, "returned toUser is the net amount");
        assertEq(actualToStream, toStream);
        assertEq(streamId, 77);
        assertEq(ptOne.balanceOf(user), 0);
        assertEq(ptOne.balanceOf(address(ovrflo)), 10 ether);
        // Fee-from-mint: the treasury gains ovrfloToken, no underlying moves
        assertEq(underlying.balanceOf(TREASURY), 0, "treasury underlying");
        assertEq(underlying.balanceOf(user), 0, "user underlying");
        assertEq(underlying.balanceOf(address(ovrflo)), 0, "vault underlying");
        assertEq(ovrfloToken.balanceOf(TREASURY), feeAmount, "treasury fee in ovrfloToken");
        assertEq(ovrfloToken.balanceOf(user), toUser, "user net mint");
        assertEq(ovrfloToken.balanceOf(address(ovrflo)), toStream);
        assertEq(toUser + feeAmount + toStream, 10 ether, "net + fee + stream == ptAmount");
        assertEq(ovrfloToken.totalSupply(), 10 ether, "no ovrfloToken outside the mint split");
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 10 ether);
    }

    function test_Deposit_ZeroFeeSkipsTreasuryMintAndFeeEvent() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (uint256 toUser, uint256 toStream, uint256 feeAmount,) =
            _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.9e18, 0);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 77);
        assertEq(feeAmount, 0);

        vm.recordLogs();
        vm.prank(user);
        ovrflo.deposit(MARKET_ONE, 10 ether, toUser);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferSig = keccak256("Transfer(address,address,uint256)");
        bytes32 feeTakenSig = keccak256("FeeTaken(address,address,uint256)");
        uint256 mints;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(ovrfloToken) && logs[i].topics[0] == transferSig) {
                assertEq(logs[i].topics[1], bytes32(0), "only mints");
                assertTrue(logs[i].topics[2] != bytes32(uint256(uint160(TREASURY))), "no treasury mint at zero fee");
                ++mints;
            }
            assertTrue(logs[i].topics[0] != feeTakenSig, "no FeeTaken at zero fee");
        }
        assertEq(mints, 2, "one mint to user, one to the vault for the stream");
        assertEq(ovrfloToken.balanceOf(TREASURY), 0);
        assertEq(ovrfloToken.totalSupply(), toUser + toStream);
    }

    function test_Deposit_SlippageGuardBoundsNetAmountAfterFee() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);
        (uint256 netToUser, uint256 toStream, uint256 feeAmount,) =
            _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.9e18, FEE_BPS);
        (uint256 grossToUser,,) = ovrflo.previewStream(MARKET_ONE, 10 ether);
        assertEq(grossToUser, netToUser + feeAmount);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 77);

        vm.prank(user);
        vm.expectRevert(OVRFLO.SlippageExceeded.selector);
        ovrflo.deposit(MARKET_ONE, 10 ether, netToUser + 1);

        vm.prank(user);
        (uint256 actualToUser,,) = ovrflo.deposit(MARKET_ONE, 10 ether, netToUser);
        assertEq(actualToUser, netToUser);
    }

    function test_Deposit_RevertsWhenPtDeliversLessThanAccounted() public {
        ShortTransferPt shortPt = new ShortTransferPt();
        uint256 expiry = block.timestamp + 30 days;
        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(MARKET_TWO, address(shortPt), TWAP_DURATION, expiry, 0);
        _mockRate(MARKET_TWO, 0.9e18);
        (, uint256 toStream,) = ovrflo.previewStream(MARKET_TWO, 10 ether);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 78);

        shortPt.mint(user, 10 ether);
        vm.startPrank(user);
        shortPt.approve(address(ovrflo), 10 ether);
        vm.expectRevert(OVRFLO.DepositedExceedsBalance.selector);
        ovrflo.deposit(MARKET_TWO, 10 ether, 0);
        vm.stopPrank();

        assertEq(ovrflo.marketTotalDeposited(MARKET_TWO), 0);
        assertEq(ovrfloToken.totalSupply(), 0);
    }

    function test_Deposit_RevertsForUnapprovedMarket() public {
        vm.prank(user);
        vm.expectRevert(OVRFLO.MarketNotApproved.selector);
        ovrflo.deposit(MARKET_ONE, 1e6, 0);
    }

    function test_Deposit_RevertsBelowMinimumAmount() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);
        _mockRate(MARKET_ONE, 0.9e18);
        uint256 belowMin = ovrflo.MIN_PT_AMOUNT() - 1;

        vm.prank(user);
        vm.expectRevert(OVRFLO.BelowMinPT.selector);
        ovrflo.deposit(MARKET_ONE, belowMin, 0);
    }

    function test_Deposit_RevertsAfterMaturity() public {
        uint256 expiry = block.timestamp + 1;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _mockRate(MARKET_ONE, 0.9e18);

        vm.warp(expiry);
        vm.prank(user);
        vm.expectRevert(OVRFLO.Matured.selector);
        ovrflo.deposit(MARKET_ONE, 1e6, 0);
    }

    function test_Deposit_RevertsWhenOracleStale() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.9e18, 0);

        // Override oracle state mock to return stale
        vm.mockCall(
            PENDLE_ORACLE,
            abi.encodeCall(IPendleOracle.getOracleState, (MARKET_ONE, TWAP_DURATION)),
            abi.encode(false, 0, false)
        );

        vm.prank(user);
        vm.expectRevert(OVRFLO.OracleNotReady.selector);
        ovrflo.deposit(MARKET_ONE, 10 ether, 0);
    }

    /// @dev The vault checks only oldestObservationSatisfied, not increaseCardinalityRequired.
    ///      Cardinality is an onboarding concern handled by addMarket. This test locks that
    ///      asymmetry so a future change to reject cardinality-required is a conscious decision.
    function test_Deposit_SucceedsWithCardinalityRequiredButOldestSatisfied() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (, uint256 toStream,,) = _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.9e18, 0);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 77);
        // Override: cardinality required but oldest observation satisfied
        vm.mockCall(
            PENDLE_ORACLE,
            abi.encodeCall(IPendleOracle.getOracleState, (MARKET_ONE, TWAP_DURATION)),
            abi.encode(true, 42, true)
        );
        vm.startPrank(user);
        ptOne.approve(address(ovrflo), 10 ether);
        (uint256 depositedToUser,,) = ovrflo.deposit(MARKET_ONE, 10 ether, 0);
        vm.stopPrank();
        assertEq(ovrfloToken.balanceOf(user), depositedToUser, "user balance equals toUser from deposit");
    }

    /// @dev Depositing exactly MIN_PT_AMOUNT (1e6) is the lower-bound success case
    ///      complementing test_Deposit_RevertsBelowMinimumAmount. At RATE_95 the split is
    ///      toUser = 950000, toStream = 50000 (both > 0), so the deposit must succeed.
    function test_Deposit_SucceedsAtExactMinPtAmount() public {
        uint256 minAmount = ovrflo.MIN_PT_AMOUNT();
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _mockRate(MARKET_ONE, RATE_95);
        (, uint256 toStream,) = ovrflo.previewStream(MARKET_ONE, minAmount);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 77);

        ptOne.mint(user, minAmount);

        vm.startPrank(user);
        ptOne.approve(address(ovrflo), minAmount);
        ovrflo.deposit(MARKET_ONE, minAmount, 0);
        vm.stopPrank();

        assertGt(ovrfloToken.balanceOf(user), 0, "user received ovrfloTokens");
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), minAmount, "total deposited matches");
    }

    function test_Deposit_RevertsOnSlippage() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (uint256 toUser,,,) = _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0);

        vm.prank(user);
        vm.expectRevert(OVRFLO.SlippageExceeded.selector);
        ovrflo.deposit(MARKET_ONE, 10 ether, toUser + 1);
    }

    function test_Deposit_RevertsWhenNothingWouldStream() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _mockRate(MARKET_ONE, 1e18);

        ptOne.mint(user, 10 ether);
        vm.prank(user);
        ptOne.approve(address(ovrflo), 10 ether);

        vm.prank(user);
        vm.expectRevert(OVRFLO.NothingToStream.selector);
        ovrflo.deposit(MARKET_ONE, 10 ether, 0);
    }

    function test_Deposit_SucceedsAtExactDepositLimitBoundary() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);

        vm.prank(ADMIN);
        ovrflo.setMarketDepositLimit(MARKET_ONE, 15 ether);

        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 11);

        (uint256 toUser, uint256 toStream,,) = _seedPreviewAndBalances(MARKET_ONE, ptOne, 5 ether, 0.8e18, 0);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 12);

        vm.prank(user);
        (uint256 actualToUser, uint256 actualToStream, uint256 streamId) = ovrflo.deposit(MARKET_ONE, 5 ether, toUser);

        assertEq(actualToUser, toUser);
        assertEq(actualToStream, toStream);
        assertEq(streamId, 12);
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 15 ether);
        assertEq(ptOne.balanceOf(address(ovrflo)), 15 ether);
    }

    function test_Deposit_RevertsWhenDepositLimitExceeded() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);

        vm.prank(ADMIN);
        ovrflo.setMarketDepositLimit(MARKET_ONE, 9 ether);

        _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0);

        vm.prank(user);
        vm.expectRevert(OVRFLO.DepositLimitExceeded.selector);
        ovrflo.deposit(MARKET_ONE, 10 ether, 0);
    }

    function test_Claim_BurnsTokensTransfersPtAndUpdatesAccounting() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (, uint256 toStream) = _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 11);

        vm.prank(address(ovrflo));
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        ovrfloToken.transfer(user, toStream);

        vm.warp(expiry);

        vm.expectEmit(address(ovrflo));
        emit Claimed(user, MARKET_ONE, address(ptOne), address(ovrfloToken), 10 ether);

        vm.prank(user);
        ovrflo.claim(address(ptOne), 10 ether);

        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(ptOne.balanceOf(user), 10 ether);
        assertEq(ptOne.balanceOf(address(ovrflo)), 0);
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 0);
    }

    function test_Claim_AllowsPartialRedemptionAndPreservesAccounting() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (uint256 toUser, uint256 toStream) = _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 12);
        uint256 claimAmount = 4 ether;

        vm.prank(address(ovrflo));
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        ovrfloToken.transfer(user, toStream);

        vm.warp(expiry);

        vm.expectEmit(address(ovrflo));
        emit Claimed(user, MARKET_ONE, address(ptOne), address(ovrfloToken), claimAmount);

        vm.prank(user);
        ovrflo.claim(address(ptOne), claimAmount);

        assertEq(ovrfloToken.balanceOf(user), toUser + toStream - claimAmount);
        assertEq(ptOne.balanceOf(user), claimAmount);
        assertEq(ptOne.balanceOf(address(ovrflo)), 10 ether - claimAmount);
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 10 ether - claimAmount);
    }

    function test_Claim_PreservesSharedTokenBehaviorAcrossMaturities() public {
        uint256 firstExpiry = block.timestamp + 30 days;
        uint256 secondExpiry = block.timestamp + 60 days;

        _approveSeries(MARKET_ONE, ptOne, firstExpiry, 0);
        _approveSeries(MARKET_TWO, ptTwo, secondExpiry, 0);

        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, firstExpiry, 1);
        _deposit(MARKET_TWO, ptTwo, 5 ether, 0.6e18, 0, secondExpiry, 2);

        uint256 streamedBalance = ovrfloToken.balanceOf(address(ovrflo));
        vm.prank(address(ovrflo));
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        ovrfloToken.transfer(user, streamedBalance);

        vm.warp(secondExpiry);

        vm.startPrank(user);
        ovrflo.claim(address(ptOne), 10 ether);
        ovrflo.claim(address(ptTwo), 5 ether);
        vm.stopPrank();

        assertEq(ptOne.balanceOf(user), 10 ether);
        assertEq(ptTwo.balanceOf(user), 5 ether);
        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 0);
        assertEq(ovrflo.marketTotalDeposited(MARKET_TWO), 0);
    }

    function test_Claim_RevertsForUnknownPt() public {
        vm.prank(user);
        vm.expectRevert(OVRFLO.UnknownPT.selector);
        ovrflo.claim(address(ptOne), 1);
    }

    function test_Claim_RevertsBeforeMaturity() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        vm.prank(user);
        vm.expectRevert(OVRFLO.NotMatured.selector);
        ovrflo.claim(address(ptOne), 1);
    }

    function test_Claim_RevertsForZeroAmount() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        vm.warp(expiry);
        vm.prank(user);
        vm.expectRevert(OVRFLO.ZeroAmount.selector);
        ovrflo.claim(address(ptOne), 0);
    }

    function test_ClaimablePt_ReturnsVaultBalanceAndRevertsForUnknownPt() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        assertEq(ovrflo.claimablePt(address(ptOne)), 10 ether);

        vm.expectRevert(OVRFLO.UnknownPT.selector);
        ovrflo.claimablePt(address(ptTwo));
    }

    function test_PreviewFunctions_SplitRateAndFee_SubUnitRate() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);
        _mockRate(MARKET_ONE, 0.9e18);

        uint256 rate = ovrflo.previewRate(MARKET_ONE);
        (uint256 toUser, uint256 toStream, uint256 previewRate_) = ovrflo.previewStream(MARKET_ONE, 10 ether);
        (uint256 depositToUser, uint256 depositToStream, uint256 feeAmount, uint256 depositRate) =
            ovrflo.previewDeposit(MARKET_ONE, 10 ether);

        assertEq(rate, 0.9e18);
        assertEq(previewRate_, 0.9e18);
        assertEq(depositRate, 0.9e18);
        assertEq(toUser, 9 ether, "previewStream is the gross split");
        assertEq(toStream, 1 ether);
        assertEq(feeAmount, 0.09 ether, "fee is 1% of the gross immediate mint, in ovrfloToken");
        assertEq(depositToUser, 8.91 ether, "previewDeposit toUser is net of fee");
        assertEq(depositToStream, 1 ether);
        assertEq(depositToUser + feeAmount, toUser);
    }

    function test_PreviewFunctions_RevertsWhenRateExceedsUnit() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);
        _mockRate(MARKET_ONE, 1.2e18);

        assertEq(ovrflo.previewRate(MARKET_ONE), 1.2e18);

        vm.expectRevert(OVRFLO.NothingToStream.selector);
        ovrflo.previewStream(MARKET_ONE, 10 ether);

        vm.expectRevert(OVRFLO.NothingToStream.selector);
        ovrflo.previewDeposit(MARKET_ONE, 10 ether);
    }

    function test_PreviewFunctions_RevertForUnapprovedMarket() public {
        vm.expectRevert(OVRFLO.MarketNotApproved.selector);
        ovrflo.previewRate(MARKET_ONE);

        vm.expectRevert(OVRFLO.MarketNotApproved.selector);
        ovrflo.previewStream(MARKET_ONE, 1 ether);

        vm.expectRevert(OVRFLO.MarketNotApproved.selector);
        ovrflo.previewDeposit(MARKET_ONE, 1 ether);
    }

    function _approveSeries(address market, MockERC20Metadata pt, uint256 expiry, uint16 feeBps) internal {
        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(market, address(pt), TWAP_DURATION, expiry, feeBps);
    }

    function _seedPreviewAndBalances(
        address market,
        MockERC20Metadata pt,
        uint256 ptAmount,
        uint256 rateE18,
        uint16 feeBps
    ) internal returns (uint256 toUser, uint256 toStream, uint256 feeAmount, uint256 rate) {
        _mockRate(market, rateE18);
        (toUser, toStream, feeAmount, rate) = ovrflo.previewDeposit(market, ptAmount);
        assertEq(rate, rateE18);

        pt.mint(user, ptAmount);

        vm.prank(user);
        pt.approve(address(ovrflo), ptAmount);

        if (feeBps == 0) {
            assertEq(feeAmount, 0);
        }
    }

    function test_Claim_RevertsWhenExceedsDepositedAccounting() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 11);
        // marketTotalDeposited = 10, user has 8 ovrfloToken

        // Wrap extra underlying on the reserve to get more ovrfloToken beyond deposited PT
        OVRFLOReserve reserve = OVRFLOReserve(ovrflo.reserve());
        underlying.mint(user, 5 ether);
        vm.startPrank(user);
        underlying.approve(address(reserve), 5 ether);
        reserve.wrap(5 ether);
        vm.stopPrank();
        // user now has 8 + 5 = 13 ovrfloToken, but marketTotalDeposited = 10

        vm.warp(expiry);

        vm.prank(user);
        vm.expectRevert(OVRFLO.InsufficientDeposited.selector);
        ovrflo.claim(address(ptOne), 13 ether);
    }

    function _deposit(
        address market,
        MockERC20Metadata pt,
        uint256 ptAmount,
        uint256 rateE18,
        uint16 feeBps,
        uint256 expiry,
        uint256 streamId
    ) internal returns (uint256 toUser, uint256 toStream) {
        (toUser, toStream,,) = _seedPreviewAndBalances(market, pt, ptAmount, rateE18, feeBps);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, streamId);

        vm.prank(user);
        ovrflo.deposit(market, ptAmount, 0);
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
        vm.expectCall(SABLIER_LL, callData);
        vm.mockCall(SABLIER_LL, callData, abi.encode(streamId));
    }
}
