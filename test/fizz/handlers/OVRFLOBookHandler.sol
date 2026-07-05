// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {MockSablier} from "../mocks/MockSablier.sol";
import {ISablierV2LockupLinear} from "../../../interfaces/ISablierV2LockupLinear.sol";

/// @notice Handles the interaction with OVRFLOBook
abstract contract OVRFLOBookHandler is Properties {

    uint16 constant APR_STEP = 100;

    // ――――――――――――――――――――― Stream picker ―――――――――――――――――――――

    function _pickStream(uint256 seed) internal view returns (uint256) {
        uint256 maxId = MockSablier(SABLIER_ADDR).nextStreamId();
        if (maxId <= 1) return 0;
        for (uint256 i = 0; i < 5; i++) {
            uint256 streamId = (seed + i) % (maxId - 1) + 1;
            try ISablierV2LockupLinear(SABLIER_ADDR).ownerOf(streamId) returns (address owner) {
                if (owner == actor) return streamId;
            } catch {}
        }
        return 0;
    }

    function _clampApr(uint16 apr) internal view returns (uint16) {
        // forge-lint: disable-next-line(divide-before-multiply) — intentional round-to-step
        apr = (apr / APR_STEP) * APR_STEP; // round to step
        if (apr < book.aprMinBps()) apr = book.aprMinBps();
        if (apr > book.aprMaxBps()) apr = book.aprMaxBps();
        return apr;
    }

    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function oVRFLOBook_postOffer_clamped(address, uint16 aprBps, uint128 capacity) public {
        capacity = uint128(clampBetween(uint256(capacity), 1, underlying.balanceOf(actor)));
        if (capacity == 0) return;
        aprBps = _clampApr(aprBps);
        oVRFLOBook_postOffer(market, aprBps, capacity);
    }

    function oVRFLOBook_sellIntoOffer_clamped(uint256 offerId, uint256 streamSeed, uint256) public {
        uint256 maxOffer = book.nextOfferId();
        if (maxOffer <= 1) return;
        offerId = clampBetween(offerId, 1, maxOffer - 1);
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;
        oVRFLOBook_sellIntoOffer(offerId, streamId, 0);
    }

    function oVRFLOBook_postSaleListing_clamped(address, uint256 streamSeed, uint16 aprBps) public {
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;
        aprBps = _clampApr(aprBps);
        oVRFLOBook_postSaleListing(market, streamId, aprBps);
    }

    function oVRFLOBook_buyListing_clamped(uint256 listingId, uint256 maxPriceIn) public {
        uint256 maxListing = book.nextSaleListingId();
        if (maxListing <= 1) return;
        listingId = clampBetween(listingId, 1, maxListing - 1);
        maxPriceIn = clampBetween(maxPriceIn, 1, underlying.balanceOf(actor));
        if (maxPriceIn == 0) return;
        oVRFLOBook_buyListing(listingId, maxPriceIn);
    }

    function oVRFLOBook_createBorrowPool_clamped(uint256[] memory, uint256 streamSeed, uint128 targetBorrow, uint128 poolSizeSeed) public {
        uint256 maxOffer = book.nextOfferId();
        if (maxOffer <= 1) return;
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;

        // Determine pool size: 1-3 offers
        uint256 poolSize = uint256(poolSizeSeed) % 3 + 1;
        if (poolSize > maxOffer - 1) poolSize = maxOffer - 1;

        // Find a first valid offer (active, not owned by actor)
        uint256 firstOfferId = 0;
        for (uint256 i = 1; i < maxOffer; i++) {
            (address maker, , , uint128 cap, bool active) = book.offers(i);
            if (active && cap > 0 && maker != actor) {
                firstOfferId = i;
                break;
            }
        }
        if (firstOfferId == 0) return;

        // Get first offer's market and aprBps for matching
        (, address offerMarket, uint16 offerApr, , ) = book.offers(firstOfferId);

        // Build offer array with matching offers (ascending order by construction)
        uint256[] memory offerIds = new uint256[](poolSize);
        offerIds[0] = firstOfferId;
        uint256 count = 1;
        for (uint256 i = firstOfferId + 1; i < maxOffer && count < poolSize; i++) {
            (address maker, address m, uint16 apr, uint128 cap, bool active) = book.offers(i);
            if (active && cap > 0 && maker != actor && m == offerMarket && apr == offerApr) {
                offerIds[count] = i;
                count++;
            }
        }

        // Trim if fewer matching offers found
        if (count < poolSize) {
            uint256[] memory trimmed = new uint256[](count);
            for (uint256 i = 0; i < count; i++) trimmed[i] = offerIds[i];
            offerIds = trimmed;
        }

        targetBorrow = uint128(clampBetween(uint256(targetBorrow), 1, type(uint128).max));
        oVRFLOBook_createBorrowPool(offerIds, streamId, targetBorrow, 0);
    }

    function oVRFLOBook_closeLoan_clamped(uint256 loanId) public {
        uint256 maxLoan = book.nextLoanId();
        if (maxLoan <= 1) return;
        loanId = clampBetween(loanId, 1, maxLoan - 1);
        oVRFLOBook_closeLoan(loanId);
    }

    function oVRFLOBook_repayLoan_clamped(uint256 loanId, uint128 amount) public {
        uint256 maxLoan = book.nextLoanId();
        if (maxLoan <= 1) return;
        loanId = clampBetween(loanId, 1, maxLoan - 1);
        amount = uint128(clampBetween(uint256(amount), 1, ovrfloToken.balanceOf(actor)));
        if (amount == 0) return;
        oVRFLOBook_repayLoan(loanId, amount);
    }

    function oVRFLOBook_poolClaimLoan_clamped(uint256 poolId, uint128 amount) public {
        uint256 maxPool = book.nextPoolId();
        if (maxPool <= 1) return;
        poolId = clampBetween(poolId, 1, maxPool - 1);
        amount = uint128(clampBetween(uint256(amount), 1, type(uint128).max));
        oVRFLOBook_poolClaimLoan(poolId, amount);
    }

    function oVRFLOBook_claimPoolShare_clamped(uint256 poolId, uint128 amount) public {
        uint256 maxPool = book.nextPoolId();
        if (maxPool <= 1) return;
        poolId = clampBetween(poolId, 1, maxPool - 1);
        amount = uint128(clampBetween(uint256(amount), 1, type(uint128).max));
        oVRFLOBook_claimPoolShare(poolId, amount);
    }

    function oVRFLOBook_cancelOffer_clamped(uint256 offerId) public {
        uint256 maxOffer = book.nextOfferId();
        if (maxOffer <= 1) return;
        offerId = clampBetween(offerId, 1, maxOffer - 1);
        oVRFLOBook_cancelOffer(offerId);
    }

    function oVRFLOBook_cancelSaleListing_clamped(uint256 listingId) public {
        uint256 maxListing = book.nextSaleListingId();
        if (maxListing <= 1) return;
        listingId = clampBetween(listingId, 1, maxListing - 1);
        oVRFLOBook_cancelSaleListing(listingId);
    }

    function oVRFLOBook_secondary(uint8 selector, uint256 arg0, uint256 arg1) public {
        selector = uint8(selector % 3);
        if (selector == 0) _oVRFLOBook_setAprBounds(uint16(arg0), uint16(arg1));
        else if (selector == 1) _oVRFLOBook_setFee(uint16(arg0));
        else _oVRFLOBook_setTreasury(address(uint160(arg0)));
        // SP-70: Non-owner cannot call book admin functions
        property_nonOwnerCannotCallBookAdmin();
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function oVRFLOBook_postOffer(address _market, uint16 aprBps, uint128 capacity) public asActor {
        snapshotBefore();
        uint256 offerId = book.postOffer(_market, aprBps, capacity);
        ghosts.ghost_lastOfferId = offerId;
        snapshotAfter();
        // Ghost updates
        ghosts.ghost_offerFundedCapacity = capacity;
        // Property assertions
        property_postOfferIdIncrements();
        property_postOfferNewOfferActive();
    }

    function oVRFLOBook_sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut) public asActor {
        ghosts.ghost_lastOfferId = offerId;
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        book.sellIntoOffer(offerId, streamId, minNetOut);
        snapshotAfter();
        // Ghost updates
        uint256 grossPrice = uint256(stateBefore.offerCapacity) - uint256(stateAfter.offerCapacity);
        ghosts.ghost_lastGrossPrice = grossPrice;
        uint256 feeBps = book.feeBps();
        uint256 fee = feeBps == 0 ? 0 : grossPrice * feeBps / 10_000;
        ghosts.ghost_bookFeePaid = fee;
        ghosts.ghost_totalBookFees += fee;
        // Property assertions
        property_sellIntoOfferCapacityDecreases(grossPrice);
        property_bookFeeFlooredWithBps(fee, grossPrice, uint16(feeBps));
        property_streamOwnerOnly();
    }

    function oVRFLOBook_postSaleListing(address _market, uint256 streamId, uint16 aprBps) public asActor {
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        uint256 listingId = book.postSaleListing(_market, streamId, aprBps);
        ghosts.ghost_lastListingId = listingId;
        snapshotAfter();
        // Property assertions
        property_postListingIdIncrements();
        property_postListingActiveFeeSnapshotted();
        property_streamOwnerOnly();
    }

    function oVRFLOBook_buyListing(uint256 listingId, uint256 maxPriceIn) public asActor {
        ghosts.ghost_lastListingId = listingId;
        snapshotBefore();
        book.buyListing(listingId, maxPriceIn);
        snapshotAfter();
        // Ghost updates
        (, , , , uint16 listingFeeBps, ) = book.saleListings(listingId);
        uint256 grossPrice = stateBefore.actorUnderlying - stateAfter.actorUnderlying;
        ghosts.ghost_lastGrossPrice = grossPrice;
        uint256 fee = listingFeeBps == 0 ? 0 : grossPrice * listingFeeBps / 10_000;
        ghosts.ghost_bookFeePaid = fee;
        ghosts.ghost_totalBookFees += fee;
        // Property assertions
        property_buyListingInactive();
        property_bookFeeFlooredWithBps(fee, grossPrice, listingFeeBps);
    }

    function oVRFLOBook_createBorrowPool(uint256[] memory offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable) public asActor {
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        uint256 poolId = book.createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable);
        ghosts.ghost_lastPoolId = poolId;
        ghosts.ghost_lastLoanId = book.poolLoanId(poolId);
        snapshotAfter();
        // Ghost updates
        uint128 actualBorrow = stateAfter.poolTotalContributed;
        uint128 obligation = stateAfter.poolTotalObligation;
        ghosts.ghost_borrowReceived = actualBorrow;
        ghosts.ghost_streamRemainingBeforeBorrow = stateBefore.streamRemaining;
        ghosts.ghost_lastObligation = obligation;
        ghosts.ghost_lastObligationBorrowAmount = uint256(actualBorrow);
        uint256 feeBps = book.feeBps();
        uint256 fee = feeBps == 0 ? 0 : uint256(actualBorrow) * feeBps / 10_000;
        ghosts.ghost_bookFeePaid = fee;
        ghosts.ghost_totalBookFees += fee;
        // Property assertions
        property_obligationGeBorrow();
        property_obligationLeRemaining();
        property_quoteMatchesObligation(poolId, actualBorrow);
        property_fullBorrowFastPath();
        property_poolContributionsSum();
        property_createPoolIdIncrements();
        property_createPoolLoanState();
        property_createPoolContributionsSet();
        property_noSelfMatch();
        property_noLoanOnZeroRemaining();
        property_borrowAmountLeGrossPrice();
        property_offerIdsStrictlyIncreasing(offerIds);
        property_bookFeeFlooredWithBps(fee, uint256(actualBorrow), uint16(feeBps));
        property_streamOwnerOnly();
    }

    function oVRFLOBook_closeLoan(uint256 loanId) public asActor {
        ghosts.ghost_lastLoanId = loanId;
        ghosts.ghost_lastPoolId = book.loanPoolId(loanId);
        snapshotBefore();
        book.closeLoan(loanId);
        snapshotAfter();
        // Property assertions
        property_closeLoanDrawnIncreases();
        property_closeLoanOutstandingZero();
    }

    function oVRFLOBook_repayLoan(uint256 loanId, uint128 amount) public asActor {
        ghosts.ghost_lastLoanId = loanId;
        ghosts.ghost_lastPoolId = book.loanPoolId(loanId);
        snapshotBefore();
        book.repayLoan(loanId, amount);
        snapshotAfter();
        // Ghost updates
        ghosts.ghost_repayPaid = amount;
        // Property assertions
        property_repayLoanExactCheck(loanId, amount);
        property_repayLoanRepaidIncreases(loanId, amount);
        property_repayLoanClosedIff(loanId, amount);
        property_nonBorrowerCannotRepay(loanId);
    }

    function oVRFLOBook_poolClaimLoan(uint256 poolId, uint128 amount) public asActor {
        ghosts.ghost_lastPoolId = poolId;
        ghosts.ghost_lastLoanId = book.poolLoanId(poolId);
        snapshotBefore();
        book.poolClaimLoan(poolId, amount);
        snapshotAfter();
        // Property assertions
        property_poolClaimLoanDrawnIncreases();
        property_poolClaimLoanProceedsUnchanged();
        property_proRataEntitlementFloored();
        property_poolReceivedLeTotalObligation();
        property_poolReceivedLeEntitlement();
        property_poolConservation();
    }

    function oVRFLOBook_claimPoolShare(uint256 poolId, uint128 amount) public asActor {
        ghosts.ghost_lastPoolId = poolId;
        ghosts.ghost_lastLoanId = book.poolLoanId(poolId);
        snapshotBefore();
        book.claimPoolShare(poolId, amount);
        snapshotAfter();
        // Property assertions
        property_claimPoolShareReceivedIncreases();
        property_proRataEntitlementFloored();
        property_poolReceivedLeTotalObligation();
        property_poolReceivedLeEntitlement();
        property_poolConservation();
    }

    function oVRFLOBook_cancelOffer(uint256 offerId) public asActor {
        ghosts.ghost_lastOfferId = offerId;
        snapshotBefore();
        book.cancelOffer(offerId);
        snapshotAfter();
        // Property assertions
        property_cancelOfferInactive();
        property_cancelOfferRefundMatchesCapacity();
        property_nonMakerCannotCancelOffer(offerId);
    }

    function oVRFLOBook_cancelSaleListing(uint256 listingId) public asActor {
        ghosts.ghost_lastListingId = listingId;
        (, , uint256 streamId, , , ) = book.saleListings(listingId);
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        book.cancelSaleListing(listingId);
        snapshotAfter();
        // Property assertions
        property_cancelSaleListingInactive();
        property_cancelSaleListingReturnsStream();
        property_nonMakerCannotCancelListing(listingId);
    }

    function oVRFLOBook_gatherOfferCapacities(uint256 offerSeed, uint128 targetAmount) public {
        uint256 maxOffer = book.nextOfferId();
        if (maxOffer <= 1) return;
        uint256 startId = clampBetween(offerSeed, 1, maxOffer - 1);
        // Find a valid offer to get market and aprBps
        for (uint256 i = startId; i < maxOffer; i++) {
            (, address offerMarket, uint16 offerApr, , bool active) = book.offers(i);
            if (!active) continue;
            (uint256[] memory ids, bool sufficient) =
                book.gatherOfferCapacities(offerMarket, offerApr, targetAmount, 1);
            // Verify returned IDs are active with matching market and aprBps
            uint128 sum;
            for (uint256 j = 0; j < ids.length; j++) {
                (, address m, uint16 apr, uint128 cap, bool a) = book.offers(ids[j]);
                assert(a && m == offerMarket && apr == offerApr);
                sum += cap;
            }
            if (sufficient) {
                assert(sum >= targetAmount);
            }
            return;
        }
    }

    // ――――――――――――――――――― Admin (via factory) ―――――――――――――――――――

    function _oVRFLOBook_setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) internal asAdmin {
        if (aprMinBps_ > aprMaxBps_) return;
        factory.setBookAprBounds(address(book), aprMinBps_, aprMaxBps_);
    }

    function _oVRFLOBook_setFee(uint16 feeBps_) internal asAdmin {
        factory.setBookFee(address(book), feeBps_);
    }

    function _oVRFLOBook_setTreasury(address newTreasury) internal asAdmin {
        try factory.setBookTreasury(address(book), newTreasury) {} catch {}
    }

    // ―――――――――――――――――――― Round-trip handlers ――――――――――――――――――――

    /// @notice SP-03: postOffer -> cancelOffer returns exactly same capacity
    function roundTrip_postOfferCancel(uint16 aprBps, uint128 capacity) public {
        capacity = uint128(clampBetween(uint256(capacity), 1, underlying.balanceOf(actor)));
        if (capacity == 0) return;
        aprBps = _clampApr(aprBps);

        uint256 underlyingBefore = underlying.balanceOf(actor);

        vm.prank(actor);
        uint256 offerId = book.postOffer(market, aprBps, capacity);

        vm.prank(actor);
        book.cancelOffer(offerId);

        uint256 underlyingAfter = underlying.balanceOf(actor);
        property_postOfferCancelRoundTrip(underlyingBefore, underlyingAfter);
    }

    /// @notice SP-04: postSaleListing -> cancelSaleListing returns stream unchanged
    function roundTrip_postListingCancel(uint256 streamSeed, uint16 aprBps) public {
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;
        aprBps = _clampApr(aprBps);

        address ownerBefore;
        try ISablierV2LockupLinear(SABLIER_ADDR).ownerOf(streamId) returns (address owner) {
            ownerBefore = owner;
        } catch {
            return;
        }

        vm.prank(actor);
        try book.postSaleListing(market, streamId, aprBps) returns (uint256 listingId) {
            vm.prank(actor);
            try book.cancelSaleListing(listingId) {} catch {
                return;
            }
        } catch {
            return;
        }

        address ownerAfter;
        try ISablierV2LockupLinear(SABLIER_ADDR).ownerOf(streamId) returns (address owner) {
            ownerAfter = owner;
        } catch {
            return;
        }

        property_postListingCancelRoundTrip(ownerBefore, ownerAfter);
    }
}
