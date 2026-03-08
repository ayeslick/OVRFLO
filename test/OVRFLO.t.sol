// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

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

/// @dev Fast deterministic protocol unit coverage; real Pendle oracle/PT/Sablier integration lives in test/fork/OVRFLOMainnetFork.t.sol.
contract OVRFLOProtocolTest is Test {
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
        address indexed user,
        address indexed market,
        address indexed ptToken,
        address ovrfloToken,
        uint256 burnedAmount,
        uint256 ptOut
    );
    event AdminContractUpdated(address indexed adminContract);
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);
    event SeriesApproved(
        address indexed market, address ptToken, address ovrfloToken, address underlying, uint256 expiry, uint16 feeBps
    );
    event MarketDepositLimitSet(address indexed market, uint256 limit);

    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    address internal constant SABLIER_LL = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET_ONE = address(0x1001);
    address internal constant MARKET_TWO = address(0x1002);

    uint32 internal constant TWAP_DURATION = 30 minutes;
    uint16 internal constant FEE_BPS = 100;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    MockERC20Metadata internal underlying;
    MockERC20Metadata internal ptOne;
    MockERC20Metadata internal ptTwo;
    MockERC20Metadata internal ptMismatch;

    address internal user;
    address internal otherUser;

    function setUp() public {
        user = makeAddr("user");
        otherUser = makeAddr("otherUser");

        ovrflo = new OVRFLO(ADMIN, TREASURY);
        underlying = new MockERC20Metadata("Underlying", "UND", 18);
        ptOne = new MockERC20Metadata("PT One", "PT1", 18);
        ptTwo = new MockERC20Metadata("PT Two", "PT2", 18);
        ptMismatch = new MockERC20Metadata("PT Mismatch", "PTM", 6);

        ovrfloToken = new OVRFLOToken("OVRFLO Underlying", "ovrUND", 18);
        ovrfloToken.transferOwnership(address(ovrflo));
    }

    function test_Constructor_RevertsForZeroAddresses() public {
        vm.expectRevert("OVRFLO: admin is zero address");
        new OVRFLO(address(0), TREASURY);

        vm.expectRevert("OVRFLO: treasury is zero address");
        new OVRFLO(ADMIN, address(0));
    }

    function test_SetAdminContract_UpdatesAdminAndEmitsEvent() public {
        address newAdmin = makeAddr("newAdmin");

        vm.expectEmit(address(ovrflo));
        emit AdminContractUpdated(newAdmin);

        vm.prank(ADMIN);
        ovrflo.setAdminContract(newAdmin);

        assertEq(ovrflo.adminContract(), newAdmin);

        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.setMarketDepositLimit(MARKET_ONE, 1);
    }

    function test_SetAdminContract_RevertsForNonAdminAndZeroAddress() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.setAdminContract(user);

        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: admin contract is zero address");
        ovrflo.setAdminContract(address(0));
    }

    function test_SetSeriesApproved_SetsStateApprovesSablierAndEmitsEvent() public {
        uint256 expiry = block.timestamp + 30 days;

        vm.expectEmit(address(ovrflo));
        emit SeriesApproved(MARKET_ONE, address(ptOne), address(ovrfloToken), address(underlying), expiry, FEE_BPS);

        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);

        (bool approved, uint32 twapDuration, uint16 feeBps, uint256 expiryCached, address ptToken, address token, address feeToken)
        = ovrflo.series(MARKET_ONE);

        assertTrue(approved);
        assertEq(twapDuration, TWAP_DURATION);
        assertEq(feeBps, FEE_BPS);
        assertEq(expiryCached, expiry);
        assertEq(ptToken, address(ptOne));
        assertEq(token, address(ovrfloToken));
        assertEq(feeToken, address(underlying));
        assertEq(ovrflo.ptToMarket(address(ptOne)), MARKET_ONE);
        assertEq(ovrfloToken.allowance(address(ovrflo), SABLIER_LL), type(uint256).max);
    }

    function test_SetSeriesApproved_AllowsSharedTokenAcrossDistinctMaturities() public {
        uint256 firstExpiry = block.timestamp + 30 days;
        uint256 secondExpiry = block.timestamp + 60 days;

        _approveSeries(MARKET_ONE, ptOne, firstExpiry, FEE_BPS);
        _approveSeries(MARKET_TWO, ptTwo, secondExpiry, 0);

        (, , , uint256 storedFirstExpiry, , address firstToken,) = ovrflo.series(MARKET_ONE);
        (, , , uint256 storedSecondExpiry, , address secondToken,) = ovrflo.series(MARKET_TWO);

        assertEq(firstToken, address(ovrfloToken));
        assertEq(secondToken, address(ovrfloToken));
        assertEq(storedFirstExpiry, firstExpiry);
        assertEq(storedSecondExpiry, secondExpiry);
        assertEq(ovrflo.ptToMarket(address(ptOne)), MARKET_ONE);
        assertEq(ovrflo.ptToMarket(address(ptTwo)), MARKET_TWO);
    }

    function test_SetSeriesApproved_RevertsForNonAdmin() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.setSeriesApproved(MARKET_ONE, address(ptOne), address(underlying), address(ovrfloToken), TWAP_DURATION, 1, 0);
    }

    function test_SetSeriesApproved_RevertsForDuplicateMarketConfiguration() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);

        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: series already configured");
        ovrflo.setSeriesApproved(
            MARKET_ONE, address(ptTwo), address(underlying), address(ovrfloToken), TWAP_DURATION, block.timestamp + 60 days, 0
        );
    }

    function test_SetSeriesApproved_RevertsForDuplicatePtRegistration() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);

        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: PT already mapped");
        ovrflo.setSeriesApproved(
            MARKET_TWO, address(ptOne), address(underlying), address(ovrfloToken), TWAP_DURATION, block.timestamp + 60 days, 0
        );
    }

    function test_SetSeriesApproved_RevertsForDecimalMismatch() public {
        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: decimals mismatch");
        ovrflo.setSeriesApproved(
            MARKET_ONE,
            address(ptMismatch),
            address(underlying),
            address(ovrfloToken),
            TWAP_DURATION,
            block.timestamp + 30 days,
            0
        );
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
        vm.expectRevert("OVRFLO: not admin");
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
        vm.expectRevert("OVRFLO: not admin");
        ovrflo.sweepExcessPt(address(ptOne), otherUser);

        vm.prank(ADMIN);
        vm.expectRevert("OVRFLO: no excess");
        ovrflo.sweepExcessPt(address(ptOne), otherUser);
    }

    function test_Deposit_MintsTokensCreatesStreamChargesFeeAndEmitsEvents() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);

        (uint256 toUser, uint256 toStream, uint256 feeAmount,) = _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.9e18, FEE_BPS);
        _mockSablier(user, uint128(toStream), expiry - block.timestamp, 77);

        vm.startPrank(user);
        vm.expectEmit(address(ovrflo));
        emit FeeTaken(user, address(underlying), feeAmount);
        vm.expectEmit(address(ovrflo));
        emit Deposited(user, MARKET_ONE, 10 ether, toUser, toStream, 77);
        (uint256 actualToUser, uint256 actualToStream, uint256 streamId) = ovrflo.deposit(MARKET_ONE, 10 ether, toUser);
        vm.stopPrank();

        assertEq(actualToUser, toUser);
        assertEq(actualToStream, toStream);
        assertEq(streamId, 77);
        assertEq(ptOne.balanceOf(user), 0);
        assertEq(ptOne.balanceOf(address(ovrflo)), 10 ether);
        assertEq(underlying.balanceOf(TREASURY), feeAmount);
        assertEq(ovrfloToken.balanceOf(user), toUser);
        assertEq(ovrfloToken.balanceOf(address(ovrflo)), toStream);
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 10 ether);
    }

    function test_Deposit_RevertsForUnapprovedMarket() public {
        vm.prank(user);
        vm.expectRevert("OVRFLO: market not approved");
        ovrflo.deposit(MARKET_ONE, 1e6, 0);
    }

    function test_Deposit_RevertsBelowMinimumAmount() public {
        _approveSeries(MARKET_ONE, ptOne, block.timestamp + 30 days, 0);
        uint256 belowMin = ovrflo.MIN_PT_AMOUNT() - 1;

        vm.prank(user);
        vm.expectRevert("OVRFLO: amount < min PT");
        ovrflo.deposit(MARKET_ONE, belowMin, 0);
    }

    function test_Deposit_RevertsAfterMaturity() public {
        uint256 expiry = block.timestamp + 1;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);

        vm.warp(expiry);
        vm.prank(user);
        vm.expectRevert("OVRFLO: matured");
        ovrflo.deposit(MARKET_ONE, 1e6, 0);
    }

    function test_Deposit_RevertsOnSlippage() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (uint256 toUser,,,) = _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0);

        vm.prank(user);
        vm.expectRevert("OVRFLO: slippage");
        ovrflo.deposit(MARKET_ONE, 10 ether, toUser + 1);
    }

    function test_Deposit_RevertsWhenNothingWouldStream() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 1e18, 0);

        vm.prank(user);
        vm.expectRevert("OVRFLO: nothing to stream");
        ovrflo.deposit(MARKET_ONE, 10 ether, 0);
    }

    function test_Deposit_RevertsWhenDepositLimitExceeded() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);

        vm.prank(ADMIN);
        ovrflo.setMarketDepositLimit(MARKET_ONE, 9 ether);

        _seedPreviewAndBalances(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0);

        vm.prank(user);
        vm.expectRevert("OVRFLO: deposit limit exceeded");
        ovrflo.deposit(MARKET_ONE, 10 ether, 0);
    }

    function test_Claim_BurnsTokensTransfersPtAndUpdatesAccounting() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (uint256 toUser, uint256 toStream) = _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 11);

        vm.prank(address(ovrflo));
        ovrfloToken.transfer(user, toStream);

        vm.warp(expiry);

        vm.expectEmit(address(ovrflo));
        emit Claimed(user, MARKET_ONE, address(ptOne), address(ovrfloToken), toUser + toStream, 10 ether);

        vm.prank(user);
        ovrflo.claim(address(ptOne), 10 ether);

        assertEq(ovrfloToken.balanceOf(user), 0);
        assertEq(ptOne.balanceOf(user), 10 ether);
        assertEq(ptOne.balanceOf(address(ovrflo)), 0);
        assertEq(ovrflo.marketTotalDeposited(MARKET_ONE), 0);
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
        vm.expectRevert("OVRFLO: unknown PT");
        ovrflo.claim(address(ptOne), 1);
    }

    function test_Claim_RevertsBeforeMaturity() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        vm.prank(user);
        vm.expectRevert("OVRFLO: not matured");
        ovrflo.claim(address(ptOne), 1);
    }

    function test_Claim_RevertsForZeroAmount() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        vm.warp(expiry);
        vm.prank(user);
        vm.expectRevert("OVRFLO: amount is zero");
        ovrflo.claim(address(ptOne), 0);
    }

    function test_Claim_RevertsWhenPtReservesAreInsufficient() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        (, uint256 toStream) = _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        vm.prank(address(ovrflo));
        ovrfloToken.transfer(user, toStream);

        vm.prank(address(ovrflo));
        ptOne.transfer(otherUser, 1);

        vm.warp(expiry);
        vm.prank(user);
        vm.expectRevert("OVRFLO: insufficient PT reserves");
        ovrflo.claim(address(ptOne), 10 ether);
    }

    function test_ClaimablePt_ReturnsVaultBalanceAndRevertsForUnknownPt() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, 0);
        _deposit(MARKET_ONE, ptOne, 10 ether, 0.8e18, 0, expiry, 1);

        assertEq(ovrflo.claimablePt(address(ptOne)), 10 ether);

        vm.expectRevert("OVRFLO: unknown PT");
        ovrflo.claimablePt(address(ptTwo));
    }

    function test_PreviewFunctions_ReturnRateSplitAndFee() public {
        uint256 expiry = block.timestamp + 30 days;
        _approveSeries(MARKET_ONE, ptOne, expiry, FEE_BPS);
        _mockRate(MARKET_ONE, 1.2e18);

        uint256 rate = ovrflo.previewRate(MARKET_ONE);
        (uint256 toUser, uint256 toStream, uint256 previewRate_) = ovrflo.previewStream(MARKET_ONE, 10 ether);
        (uint256 depositToUser, uint256 depositToStream, uint256 feeAmount, uint256 depositRate) =
            ovrflo.previewDeposit(MARKET_ONE, 10 ether);

        assertEq(rate, 1.2e18);
        assertEq(previewRate_, 1.2e18);
        assertEq(depositRate, 1.2e18);
        assertEq(toUser, 10 ether);
        assertEq(toStream, 0);
        assertEq(depositToUser, 10 ether);
        assertEq(depositToStream, 0);
        assertEq(feeAmount, 0.1 ether);
    }

    function test_PreviewFunctions_RevertForUnapprovedMarket() public {
        vm.expectRevert("OVRFLO: market not approved");
        ovrflo.previewRate(MARKET_ONE);

        vm.expectRevert("OVRFLO: market not approved");
        ovrflo.previewStream(MARKET_ONE, 1 ether);

        vm.expectRevert("OVRFLO: market not approved");
        ovrflo.previewDeposit(MARKET_ONE, 1 ether);
    }

    function _approveSeries(address market, MockERC20Metadata pt, uint256 expiry, uint16 feeBps) internal {
        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(market, address(pt), address(underlying), address(ovrfloToken), TWAP_DURATION, expiry, feeBps);
    }

    function _seedPreviewAndBalances(address market, MockERC20Metadata pt, uint256 ptAmount, uint256 rateE18, uint16 feeBps)
        internal
        returns (uint256 toUser, uint256 toStream, uint256 feeAmount, uint256 rate)
    {
        _mockRate(market, rateE18);
        (toUser, toStream, feeAmount, rate) = ovrflo.previewDeposit(market, ptAmount);
        assertEq(rate, rateE18);

        pt.mint(user, ptAmount);
        underlying.mint(user, feeAmount);

        vm.startPrank(user);
        pt.approve(address(ovrflo), ptAmount);
        underlying.approve(address(ovrflo), feeAmount);
        vm.stopPrank();

        if (feeBps == 0) {
            assertEq(feeAmount, 0);
        }
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
        vm.expectCall(SABLIER_LL, callData);
        vm.mockCall(SABLIER_LL, callData, abi.encode(streamId));
    }
}
