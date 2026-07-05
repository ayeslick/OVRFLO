// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StreamPricing} from "../src/StreamPricing.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockBookFactory, MockBookCore, MockBookSablier} from "./mocks/BookMocks.sol";

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

    MockBookFactory internal factory;
    MockBookCore internal core;
    MockBookSablier internal sablier;
    StreamPricingHarness internal harness;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    TestERC20 internal wrongToken;

    uint256 internal streamId = 42;
    uint256 internal expiry;

    function setUp() public {
        factory = new MockBookFactory();
        core = new MockBookCore();
        sablier = new MockBookSablier();
        harness = new StreamPricingHarness();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO Underlying", "ovrfloUND");
        wrongToken = new TestERC20("Wrong", "WRONG");
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
        MockBookCore unknownCore = new MockBookCore();

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

    function test_EligibilityRevertsWhenExpiryOverflowsUint40() public {
        // Set expiryCached above uint40 max — passes the maturity check (far future)
        // but triggers the overflow guard in requireEligible before getEndTime comparison
        address overflowMarket = address(0x9999);
        factory.setMarketApproved(address(core), overflowMarket, true);
        core.setSeries(
            overflowMarket,
            true,
            uint256(type(uint40).max) + 1,
            PT_TOKEN,
            address(ovrfloToken),
            address(underlying),
            ORACLE
        );
        sablier.setStream(99, address(core), ovrfloToken, uint40(expiry), 0, false, 100 ether, 30 ether);
        vm.expectRevert(StreamPricing.WrongEndTime.selector);
        harness.requireEligible(address(factory), address(sablier), address(core), overflowMarket, 99);
    }

    function test_EligibilityRejectsCliffedStream() public {
        // Cliff time must differ from start time to trigger rejection
        sablier.setStreamWithStartTime(
            streamId,
            address(core),
            ovrfloToken,
            uint40(block.timestamp),
            uint40(expiry),
            uint40(block.timestamp) + 1,
            false,
            100 ether,
            30 ether
        );

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
