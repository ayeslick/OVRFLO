// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StreamPricing} from "../src/StreamPricing.sol";

contract StreamPricingMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
}

contract StreamPricingMockFactory {
    struct Info {
        address treasury;
        address underlying;
        address ovrfloToken;
    }

    mapping(address => Info) internal infos;
    mapping(address => mapping(address => bool)) public isMarketApproved;

    function setInfo(address core, address treasury, address underlying, address ovrfloToken) external {
        infos[core] = Info({treasury: treasury, underlying: underlying, ovrfloToken: ovrfloToken});
    }

    function setMarketApproved(address core, address market, bool approved) external {
        isMarketApproved[core][market] = approved;
    }

    function ovrfloInfo(address core)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken)
    {
        Info memory info = infos[core];
        return (info.treasury, info.underlying, info.ovrfloToken);
    }
}

contract StreamPricingMockCore {
    struct Series {
        bool approved;
        uint32 twapDurationFixed;
        uint16 feeBps;
        uint256 expiryCached;
        address ptToken;
        address ovrfloToken;
        address underlying;
        address oracle;
    }

    mapping(address => Series) internal seriesInfo;

    function setSeries(
        address market,
        bool approved,
        uint256 expiryCached,
        address ptToken,
        address ovrfloToken,
        address underlying,
        address oracle
    ) external {
        seriesInfo[market] = Series({
            approved: approved,
            twapDurationFixed: 30 minutes,
            feeBps: 0,
            expiryCached: expiryCached,
            ptToken: ptToken,
            ovrfloToken: ovrfloToken,
            underlying: underlying,
            oracle: oracle
        });
    }

    function series(address market)
        external
        view
        returns (
            bool approved,
            uint32 twapDurationFixed,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address ovrfloToken,
            address underlying,
            address oracle
        )
    {
        Series memory info = seriesInfo[market];
        return (
            info.approved,
            info.twapDurationFixed,
            info.feeBps,
            info.expiryCached,
            info.ptToken,
            info.ovrfloToken,
            info.underlying,
            info.oracle
        );
    }
}

contract StreamPricingMockSablier {
    struct Stream {
        address sender;
        IERC20 asset;
        uint40 endTime;
        uint40 cliffTime;
        bool cancelable;
        uint128 deposited;
        uint128 withdrawn;
    }

    mapping(uint256 => Stream) internal streams;

    function setStream(
        uint256 streamId,
        address sender,
        IERC20 asset,
        uint40 endTime,
        uint40 cliffTime,
        bool cancelable,
        uint128 deposited,
        uint128 withdrawn
    ) external {
        streams[streamId] = Stream({
            sender: sender,
            asset: asset,
            endTime: endTime,
            cliffTime: cliffTime,
            cancelable: cancelable,
            deposited: deposited,
            withdrawn: withdrawn
        });
    }

    function getSender(uint256 streamId) external view returns (address sender) {
        return streams[streamId].sender;
    }

    function getAsset(uint256 streamId) external view returns (IERC20 asset) {
        return streams[streamId].asset;
    }

    function getEndTime(uint256 streamId) external view returns (uint40 endTime) {
        return streams[streamId].endTime;
    }

    function getCliffTime(uint256 streamId) external view returns (uint40 cliffTime) {
        return streams[streamId].cliffTime;
    }

    function isCancelable(uint256 streamId) external view returns (bool result) {
        return streams[streamId].cancelable;
    }

    function getDepositedAmount(uint256 streamId) external view returns (uint128 depositedAmount) {
        return streams[streamId].deposited;
    }

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128 withdrawnAmount) {
        return streams[streamId].withdrawn;
    }
}

contract StreamPricingHarness {
    function requireEligible(address factory, address sablier, address core, address market, uint256 streamId)
        external
        view
        returns (StreamPricing.Eligibility memory)
    {
        return StreamPricing.requireEligible(factory, sablier, core, market, streamId);
    }
}

contract StreamPricingTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET_ONE = address(0x1001);
    address internal constant MARKET_TWO = address(0x1002);
    address internal constant PT_TOKEN = address(0x2001);
    address internal constant ORACLE = address(0x3001);

    StreamPricingMockFactory internal factory;
    StreamPricingMockCore internal core;
    StreamPricingMockSablier internal sablier;
    StreamPricingHarness internal harness;
    StreamPricingMockERC20 internal underlying;
    StreamPricingMockERC20 internal ovrfloToken;
    StreamPricingMockERC20 internal wrongToken;

    uint256 internal streamId = 42;
    uint256 internal expiry;

    function setUp() public {
        factory = new StreamPricingMockFactory();
        core = new StreamPricingMockCore();
        sablier = new StreamPricingMockSablier();
        harness = new StreamPricingHarness();
        underlying = new StreamPricingMockERC20("Underlying", "UND");
        ovrfloToken = new StreamPricingMockERC20("OVRFLO Underlying", "ovrfloUND");
        wrongToken = new StreamPricingMockERC20("Wrong", "WRONG");
        expiry = block.timestamp + 30 days;

        _configureEligible(MARKET_ONE, streamId, expiry, 100 ether, 30 ether);
    }

    function test_GrossPriceObligationAndFee_KnownInputs() public {
        uint128 remaining = 110 ether;
        uint16 aprBps = 1000;
        uint256 timeToMaturity = 365 days;

        uint256 grossPrice = StreamPricing.grossPrice(remaining, aprBps, timeToMaturity);
        assertEq(grossPrice, 100 ether);
        assertEq(StreamPricing.obligation(grossPrice, aprBps, timeToMaturity), remaining);
        assertEq(StreamPricing.fee(10 ether, 100), 0.1 ether);
    }

    function test_ZeroAprAndZeroTimeUseNoDiscountLimit() public {
        assertEq(StreamPricing.grossPrice(100 ether, 0, 365 days), 100 ether);
        assertEq(StreamPricing.obligation(25 ether, 0, 365 days), 25 ether);
        assertEq(StreamPricing.grossPrice(100 ether, 1000, 0), 100 ether);
        assertEq(StreamPricing.obligation(25 ether, 1000, 0), 25 ether);
    }

    function test_ObligationForFill_MaxBorrowConsumesRemainingEvenWithRoundingDust() public {
        uint128 remaining = 100 ether;
        uint16 aprBps = 1000;
        uint256 timeToMaturity = 365 days;
        uint256 grossPrice = StreamPricing.grossPrice(remaining, aprBps, timeToMaturity);

        assertEq(StreamPricing.obligation(grossPrice, aprBps, timeToMaturity), remaining - 1);
        assertEq(StreamPricing.obligationForFill(grossPrice, grossPrice, remaining, aprBps, timeToMaturity), remaining);
    }

    function test_DustCanFloorGrossPriceToZero() public {
        assertEq(StreamPricing.grossPrice(1, type(uint16).max, 10 * 365 days), 0);
    }

    function test_FeeFloors() public {
        assertEq(StreamPricing.fee(99, 100), 0);
        assertEq(StreamPricing.fee(100, 100), 1);
        assertEq(StreamPricing.fee(100 ether, 0), 0);
    }

    function test_Fuzz_ResidualNeverUnderflowsWhenBorrowAmountDoesNotExceedGrossPrice(
        uint128 remaining,
        uint16 aprBps,
        uint256 timeToMaturity,
        uint256 borrowSeed
    ) public {
        remaining = uint128(bound(uint256(remaining), 1, type(uint128).max));
        timeToMaturity = bound(timeToMaturity, 0, 100 * 365 days);

        uint256 grossPrice = StreamPricing.grossPrice(remaining, aprBps, timeToMaturity);
        uint256 borrowAmount = bound(borrowSeed, 0, grossPrice);

        uint128 obligation = StreamPricing.obligation(borrowAmount, aprBps, timeToMaturity);
        assertLe(obligation, remaining);
    }

    function test_EligibilityReturnsMaturityTokenAndUnwithdrawnRemaining() public view {
        StreamPricing.Eligibility memory eligibility =
            harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);

        assertEq(eligibility.seriesMaturity, expiry);
        assertEq(eligibility.ovrfloToken, address(ovrfloToken));
        assertEq(eligibility.remaining, 70 ether);
    }

    function test_EligibilityRejectsUnregisteredCore() public {
        StreamPricingMockCore unknownCore = new StreamPricingMockCore();

        vm.expectRevert(StreamPricing.CoreNotRegistered.selector);
        harness.requireEligible(address(factory), address(sablier), address(unknownCore), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsUnapprovedMarket() public {
        factory.setMarketApproved(address(core), MARKET_ONE, false);

        vm.expectRevert(StreamPricing.MarketNotApproved.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsSeriesNotApproved() public {
        core.setSeries(MARKET_ONE, false, expiry, PT_TOKEN, address(ovrfloToken), address(underlying), ORACLE);

        vm.expectRevert(StreamPricing.SeriesNotApproved.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsMaturedSeries() public {
        vm.warp(expiry);

        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsWrongSender() public {
        sablier.setStream(streamId, address(0xBAD), ovrfloToken, uint40(expiry), 0, false, 100 ether, 30 ether);

        vm.expectRevert(StreamPricing.WrongSender.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsWrongAsset() public {
        sablier.setStream(streamId, address(core), wrongToken, uint40(expiry), 0, false, 100 ether, 30 ether);

        vm.expectRevert(StreamPricing.WrongAsset.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsWrongEndTime() public {
        sablier.setStream(streamId, address(core), ovrfloToken, uint40(expiry + 1), 0, false, 100 ether, 30 ether);

        vm.expectRevert(StreamPricing.WrongEndTime.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsCliffedStream() public {
        sablier.setStream(streamId, address(core), ovrfloToken, uint40(expiry), 1, false, 100 ether, 30 ether);

        vm.expectRevert(StreamPricing.CliffPresent.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsCancelableStream() public {
        sablier.setStream(streamId, address(core), ovrfloToken, uint40(expiry), 0, true, 100 ether, 30 ether);

        vm.expectRevert(StreamPricing.CancelableStream.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsEmptyRemainingBalance() public {
        sablier.setStream(streamId, address(core), ovrfloToken, uint40(expiry), 0, false, 100 ether, 100 ether);

        vm.expectRevert(StreamPricing.RemainingZero.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
    }

    function test_EligibilityRejectsCrossMarketMaturityMismatch() public {
        uint256 otherExpiry = expiry + 30 days;
        core.setSeries(MARKET_TWO, true, otherExpiry, PT_TOKEN, address(ovrfloToken), address(underlying), ORACLE);
        factory.setMarketApproved(address(core), MARKET_TWO, true);

        vm.expectRevert(StreamPricing.WrongEndTime.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), MARKET_TWO, streamId);
    }

    function test_PoolSeam_CallsPricingAndEligibilityWithoutBookStorage() public view {
        StreamPricing.Eligibility memory eligibility =
            harness.requireEligible(address(factory), address(sablier), address(core), MARKET_ONE, streamId);
        uint256 grossPrice = StreamPricing.grossPrice(eligibility.remaining, 1000, 30 days);

        assertGt(grossPrice, 0);
        assertLt(grossPrice, eligibility.remaining);
    }

    function _configureEligible(address market, uint256 id, uint256 maturity, uint128 deposited, uint128 withdrawn)
        internal
    {
        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        factory.setMarketApproved(address(core), market, true);
        core.setSeries(market, true, maturity, PT_TOKEN, address(ovrfloToken), address(underlying), ORACLE);
        sablier.setStream(id, address(core), ovrfloToken, uint40(maturity), 0, false, deposited, withdrawn);
    }
}
