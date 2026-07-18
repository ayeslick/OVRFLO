// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {MockSablier} from "../mocks/MockSablier.sol";
import {ISablierV2LockupLinear} from "../../../interfaces/ISablierV2LockupLinear.sol";

/// @notice Handles the interaction with OVRFLOLending
abstract contract OVRFLOLendingHandler is Properties {
    uint16 constant APR_STEP = 100;

    // ――――――――――――――――――――― Stream picker ―――――――――――――――――――――

    function _pickStream(uint256 seed) internal view returns (uint256) {
        uint256 maxId = MockSablier(SABLIER_ADDR).nextStreamId();
        if (maxId == 0) return 0;
        for (uint256 i = 0; i < 5; i++) {
            uint256 streamId = (seed + i) % maxId + 1;
            try ISablierV2LockupLinear(SABLIER_ADDR).ownerOf(streamId) returns (address owner) {
                if (owner == actor) return streamId;
            } catch {}
        }
        return 0;
    }

    function _clampApr(uint16 apr) internal view returns (uint16) {
        // forge-lint: disable-next-line(divide-before-multiply) — intentional round-to-step
        apr = (apr / APR_STEP) * APR_STEP; // round to step
        if (apr < lending.aprMinBps()) apr = lending.aprMinBps();
        if (apr > lending.aprMaxBps()) apr = lending.aprMaxBps();
        return apr;
    }

    function _listingPrice(uint256 listingId) internal view returns (uint256 grossPrice, bool active) {
        (, address listingMarket, uint256 streamId, uint16 apr,, bool isActive) = lending.saleListings(listingId);
        if (!isActive) return (0, false);
        try lending.quote(listingMarket, streamId, apr, 0) returns (uint256 price, uint128, uint256, uint256, uint128) {
            return (price, true);
        } catch {
            return (0, false);
        }
    }

    function _claimable(uint256 loanPoolId, address account) internal view returns (uint256) {
        uint128 contribution = lending.loanPoolContributions(loanPoolId, account);
        if (contribution == 0) return 0;
        (,,, uint128 totalContributed,) = lending.loanPools(loanPoolId);
        (,, uint256 streamId, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) =
            lending.loans(lending.loanPoolLoanId(loanPoolId));
        uint256 recovered = uint256(drawn) + uint256(repaid);
        if (!closed) {
            uint128 outstanding = obligation - drawn - repaid;
            uint128 withdrawable = MockSablier(SABLIER_ADDR).withdrawableAmountOf(streamId);
            recovered += withdrawable < outstanding ? withdrawable : outstanding;
        }
        uint256 entitled = uint256(contribution) * recovered / totalContributed;
        uint256 received = lending.loanPoolReceived(loanPoolId, account);
        return entitled > received ? entitled - received : 0;
    }

    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function _recordLoanCloseGhost(uint256 loanId, uint256 streamId) internal {
        ghost_loanStreamWithdrawnAtClose[loanId] = ISablierV2LockupLinear(SABLIER_ADDR).getWithdrawnAmount(streamId);
    }

    function oVRFLOLending_supplyLiquidity_clamped(address, uint16 aprBps, uint128 availableLiquidity) public {
        availableLiquidity = uint128(clampBetween(uint256(availableLiquidity), 1, underlying.balanceOf(actor)));
        if (availableLiquidity == 0) return;
        aprBps = _clampApr(aprBps);
        oVRFLOLending_supplyLiquidity(market, aprBps, availableLiquidity);
    }

    function oVRFLOLending_sellStreamToLiquidity_clamped(uint256 liquidityId, uint256 streamSeed, uint256) public {
        uint256 maxLiquidity = lending.nextLiquidityId();
        if (maxLiquidity <= 1) return;
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;
        uint256 start = clampBetween(liquidityId, 1, maxLiquidity - 1);
        for (uint256 offset; offset < maxLiquidity - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxLiquidity - 1) + 1;
            (, address liquidityMarket, uint16 apr, uint128 capacity, bool active) =
                lending.liquidityPositions(candidate);
            if (!active) continue;
            try lending.quote(liquidityMarket, streamId, apr, 0) returns (
                uint256 grossPrice, uint128, uint256, uint256, uint128
            ) {
                if (grossPrice > 0 && grossPrice <= capacity) {
                    oVRFLOLending_sellStreamToLiquidity(candidate, streamId, 0);
                    return;
                }
            } catch {}
        }
    }

    function oVRFLOLending_postSaleListing_clamped(address, uint256 streamSeed, uint16 aprBps) public {
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;
        aprBps = _clampApr(aprBps);
        oVRFLOLending_postSaleListing(market, streamId, aprBps);
    }

    function oVRFLOLending_buyListing_clamped(uint256 listingId, uint256 maxPriceIn) public {
        uint256 maxListing = lending.nextSaleListingId();
        if (maxListing <= 1) return;
        uint256 start = clampBetween(listingId, 1, maxListing - 1);
        for (uint256 offset; offset < maxListing - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxListing - 1) + 1;
            (uint256 grossPrice, bool active) = _listingPrice(candidate);
            if (!active) continue;
            uint256 balance = underlying.balanceOf(actor);
            if (grossPrice == 0 || grossPrice > balance) continue;
            maxPriceIn = clampBetween(maxPriceIn, grossPrice, balance);
            oVRFLOLending_buyListing(candidate, maxPriceIn);
            return;
        }
    }

    function oVRFLOLending_createBorrowerLoanPool_clamped(
        uint256[] memory,
        uint256 streamSeed,
        uint128 targetBorrow,
        uint128 poolSizeSeed
    ) public {
        uint256 maxLiquidity = lending.nextLiquidityId();
        if (maxLiquidity <= 1) return;
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;

        // Determine pool size: 1-3 liquidityPositions
        uint256 poolSize = uint256(poolSizeSeed) % 3 + 1;
        if (poolSize > maxLiquidity - 1) poolSize = maxLiquidity - 1;

        // Find a first valid liquidity (active, not owned by actor)
        uint256 firstLiquidityId = 0;
        for (uint256 i = 1; i < maxLiquidity; i++) {
            (address lender,,, uint128 cap, bool active) = lending.liquidityPositions(i);
            if (active && cap > 0 && lender != actor) {
                firstLiquidityId = i;
                break;
            }
        }
        if (firstLiquidityId == 0) return;

        // Get first liquidity's market and aprBps for matching
        (, address liquidityMarket, uint16 liquidityApr,,) = lending.liquidityPositions(firstLiquidityId);

        // Build liquidity array with matching liquidityPositions (ascending order by construction)
        uint256[] memory liquidityIds = new uint256[](poolSize);
        liquidityIds[0] = firstLiquidityId;
        uint256 count = 1;
        for (uint256 i = firstLiquidityId + 1; i < maxLiquidity && count < poolSize; i++) {
            (address lender, address m, uint16 apr, uint128 cap, bool active) = lending.liquidityPositions(i);
            if (active && cap > 0 && lender != actor && m == liquidityMarket && apr == liquidityApr) {
                liquidityIds[count] = i;
                count++;
            }
        }

        // Trim if fewer matching liquidityPositions found
        if (count < poolSize) {
            uint256[] memory trimmed = new uint256[](count);
            for (uint256 i = 0; i < count; i++) {
                trimmed[i] = liquidityIds[i];
            }
            liquidityIds = trimmed;
        }

        uint256 totalAvailable;
        for (uint256 i; i < liquidityIds.length; i++) {
            (,,, uint128 capacity,) = lending.liquidityPositions(liquidityIds[i]);
            totalAvailable += capacity;
        }
        uint256 maxBorrow;
        try lending.quote(liquidityMarket, streamId, liquidityApr, 0) returns (
            uint256 grossPrice, uint128, uint256, uint256, uint128
        ) {
            maxBorrow = grossPrice < totalAvailable ? grossPrice : totalAvailable;
        } catch {
            return;
        }
        if (maxBorrow == 0) return;
        targetBorrow = uint128(clampBetween(uint256(targetBorrow), 1, maxBorrow));
        oVRFLOLending_createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, 0);
    }

    function oVRFLOLending_closeLoan_clamped(uint256 loanId) public {
        uint256 maxLoan = lending.nextLoanId();
        if (maxLoan <= 1) return;
        uint256 start = clampBetween(loanId, 1, maxLoan - 1);
        for (uint256 offset; offset < maxLoan - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxLoan - 1) + 1;
            (,,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = lending.loans(candidate);
            uint128 outstanding = obligation - drawn - repaid;
            (,, uint256 streamId,,,,) = lending.loans(candidate);
            if (!closed && MockSablier(SABLIER_ADDR).withdrawableAmountOf(streamId) >= outstanding) {
                oVRFLOLending_closeLoan(candidate);
                return;
            }
        }
    }

    function oVRFLOLending_repayLoan_clamped(uint256 loanId, uint128 amount) public {
        uint256 maxLoan = lending.nextLoanId();
        if (maxLoan <= 1) return;
        uint256 start = clampBetween(loanId, 1, maxLoan - 1);
        for (uint256 offset; offset < maxLoan - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxLoan - 1) + 1;
            (address borrower,,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) =
                lending.loans(candidate);
            uint256 maxRepay = obligation - drawn - repaid;
            uint256 balance = ovrfloToken.balanceOf(actor);
            if (!closed && borrower == actor && maxRepay > 0 && balance > 0) {
                if (maxRepay > balance) maxRepay = balance;
                // Occasionally repay exact outstanding to exercise loan-close path
                if (amount % 3 == 0) {
                    amount = uint128(maxRepay);
                } else {
                    amount = uint128(clampBetween(uint256(amount), 1, maxRepay));
                }
                oVRFLOLending_repayLoan(candidate, amount);
                return;
            }
        }
    }

    function oVRFLOLending_claimLoanPoolShare_clamped(uint256 loanPoolId, uint128 amount) public {
        uint256 maxPool = lending.nextLoanPoolId();
        if (maxPool <= 1) return;
        uint256 start = clampBetween(loanPoolId, 1, maxPool - 1);
        for (uint256 offset; offset < maxPool - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxPool - 1) + 1;
            uint256 claimable = _claimable(candidate, actor);
            if (claimable > 0) {
                amount = uint128(clampBetween(uint256(amount), 1, claimable));
                oVRFLOLending_claimLoanPoolShare(candidate, amount);
                return;
            }
        }
    }

    function oVRFLOLending_withdrawLiquidity_clamped(uint256 liquidityId) public {
        uint256 maxLiquidity = lending.nextLiquidityId();
        if (maxLiquidity <= 1) return;
        uint256 start = clampBetween(liquidityId, 1, maxLiquidity - 1);
        for (uint256 offset; offset < maxLiquidity - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxLiquidity - 1) + 1;
            (address lender,,,, bool active) = lending.liquidityPositions(candidate);
            if (active && lender == actor) {
                oVRFLOLending_withdrawLiquidity(candidate);
                return;
            }
        }
    }

    function oVRFLOLending_cancelSaleListing_clamped(uint256 listingId) public {
        uint256 maxListing = lending.nextSaleListingId();
        if (maxListing <= 1) return;
        uint256 start = clampBetween(listingId, 1, maxListing - 1);
        for (uint256 offset; offset < maxListing - 1; offset++) {
            uint256 candidate = (start - 1 + offset) % (maxListing - 1) + 1;
            (address seller,,,,, bool active) = lending.saleListings(candidate);
            if (active && seller == actor) {
                oVRFLOLending_cancelSaleListing(candidate);
                return;
            }
        }
    }

    function oVRFLOLending_secondary(uint8 selector, uint256 arg0, uint256 arg1) public {
        selector = uint8(selector % 3);
        if (selector == 0) _oVRFLOLending_setAprBounds(uint16(arg0), uint16(arg1));
        else if (selector == 1) _oVRFLOLending_setFee(uint16(arg0));
        else _oVRFLOLending_setTreasury(address(uint160(arg0)));
        // SP-70: Non-owner cannot call lending admin functions
        property_nonOwnerCannotCallLendingAdmin();
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function oVRFLOLending_supplyLiquidity(address _market, uint16 aprBps, uint128 availableLiquidity) public asActor {
        snapshotBefore();
        uint256 liquidityId = lending.supplyLiquidity(_market, aprBps, availableLiquidity);
        ghosts.ghost_lastLiquidityId = liquidityId;
        // Ghost: record initial capacity for GL-71, GL-81
        ghost_liquidityInitialCapacity[liquidityId] = availableLiquidity;
        snapshotAfter();
        // Property assertions
        property_supplyLiquidityIdIncrements();
        property_supplyLiquidityNewLiquidityActive();
    }

    function oVRFLOLending_sellStreamToLiquidity(uint256 liquidityId, uint256 streamId, uint256 minNetOut)
        public
        asActor
    {
        ghosts.ghost_lastLiquidityId = liquidityId;
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        lending.sellStreamToLiquidity(liquidityId, streamId, minNetOut);
        snapshotAfter();
        uint256 grossPrice = uint256(stateBefore.liquidityCapacity) - uint256(stateAfter.liquidityCapacity);
        uint256 feeBps = lending.feeBps();
        uint256 fee = feeBps == 0 ? 0 : grossPrice * feeBps / 10_000;
        // Property assertions
        property_sellStreamToLiquidityCapacityDecreases(grossPrice);
        property_lendingFeeFlooredWithBps(fee, grossPrice, uint16(feeBps));
        property_streamOwnerOnly();
        property_sellStream_transfers_to_lender();
        property_sale_settlement_conservation(fee);
        property_stream_escrow_withdraw_acl();
    }

    function oVRFLOLending_postSaleListing(address _market, uint256 streamId, uint16 aprBps) public asActor {
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        uint256 listingId = lending.postSaleListing(_market, streamId, aprBps);
        ghosts.ghost_lastListingId = listingId;
        snapshotAfter();
        // Property assertions
        property_postListingIdIncrements();
        property_postListingActiveFeeSnapshotted();
        property_streamOwnerOnly();
        property_postListing_escrows_stream();
        property_stream_escrow_withdraw_acl();
    }

    function oVRFLOLending_buyListing(uint256 listingId, uint256 maxPriceIn) public asActor {
        ghosts.ghost_lastListingId = listingId;
        // Single read of saleListings; derive grossPrice from quote() (not balance delta)
        (, address listingMarket, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool isActive) =
            lending.saleListings(listingId);
        ghosts.ghost_lastStreamId = streamId;
        if (!isActive) return;
        uint256 grossPrice;
        try lending.quote(listingMarket, streamId, aprBps, 0) returns (
            uint256 price, uint128, uint256, uint256, uint128
        ) {
            grossPrice = price;
        } catch {
            return;
        }
        uint256 fee = listingFeeBps == 0 ? 0 : grossPrice * listingFeeBps / 10_000;
        snapshotBefore();
        lending.buyListing(listingId, maxPriceIn);
        snapshotAfter();
        // Property assertions
        property_buyListingInactive();
        property_buyListing_transfers_to_buyer();
        property_sale_settlement_conservation(fee);
    }

    function oVRFLOLending_createBorrowerLoanPool(
        uint256[] memory liquidityIds,
        uint256 streamId,
        uint128 targetBorrow,
        uint128 minAcceptable
    ) public asActor {
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, minAcceptable);
        ghosts.ghost_lastPoolId = loanPoolId;
        ghosts.ghost_lastLoanId = lending.loanPoolLoanId(loanPoolId);
        // Ghost: record stream withdrawn amount at creation for GL-70
        ghost_loanStreamWithdrawnAtCreation[ghosts.ghost_lastLoanId] =
            ISablierV2LockupLinear(SABLIER_ADDR).getWithdrawnAmount(streamId);
        snapshotAfter();
        uint128 actualBorrow = stateAfter.poolTotalContributed;
        uint256 feeBps = lending.feeBps();
        uint256 fee = feeBps == 0 ? 0 : uint256(actualBorrow) * feeBps / 10_000;
        // Property assertions
        property_obligationGeBorrow();
        property_obligationLeRemaining();
        property_quoteMatchesObligation(loanPoolId, actualBorrow);
        property_fullBorrowFastPath();
        property_poolContributionsSum();
        property_createPoolIdIncrements();
        property_createPoolLoanState();
        property_createPoolContributionsSet();
        property_noSelfMatch();
        property_noLoanOnZeroRemaining();
        property_borrowAmountLeGrossPrice();
        property_liquidityIdsStrictlyIncreasing(liquidityIds);
        property_lendingFeeFlooredWithBps(fee, uint256(actualBorrow), uint16(feeBps));
        property_streamOwnerOnly();
        property_createPool_escrows_stream();
        property_repledge_bounded_by_residual();
        property_createPool_zero_reverts();
        property_quote_full_correspondence();
        // SP-100 only valid when actor is not the treasury (otherwise actor receives fee too)
        if (lending.treasury() != actor) {
            property_borrow_disbursement_conservation(actualBorrow, fee);
        }
        property_stream_escrow_withdraw_acl();
    }

    function oVRFLOLending_closeLoan(uint256 loanId) public asActor {
        ghosts.ghost_lastLoanId = loanId;
        ghosts.ghost_lastPoolId = lending.loanToLoanPool(loanId);
        (,, uint256 streamId,,,,) = lending.loans(loanId);
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        lending.closeLoan(loanId);
        _recordLoanCloseGhost(loanId, streamId);
        snapshotAfter();
        // Property assertions
        property_closeLoanDrawnIncreases();
        property_closeLoanOutstandingZero();
        property_closeLoan_returns_stream();
        property_closeLoan_sets_closed();
        property_closeLoan_invalid_reverts();
        property_harvest_no_block_close();
    }

    function oVRFLOLending_repayLoan(uint256 loanId, uint128 amount) public asActor {
        ghosts.ghost_lastLoanId = loanId;
        ghosts.ghost_lastPoolId = lending.loanToLoanPool(loanId);
        (,, uint256 streamId,,,,) = lending.loans(loanId);
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        lending.repayLoan(loanId, amount);
        snapshotAfter();
        // Record stream withdrawn snapshot if repay closed the loan (stream returned to borrower)
        if (stateAfter.loanClosed) {
            _recordLoanCloseGhost(loanId, streamId);
        }
        // Property assertions
        property_repayLoanExactCheck(loanId, amount);
        property_repayLoanRepaidIncreases(loanId, amount);
        property_repayLoanClosedIff(loanId, amount);
        property_nonBorrowerCannotRepay(loanId);
        property_repayLoan_returns_stream();
        property_multi_partial_repay_closes();
        property_repayLoan_zero_reverts();
    }

    function oVRFLOLending_claimLoanPoolShare(uint256 loanPoolId, uint128 amount) public asActor {
        ghosts.ghost_lastPoolId = loanPoolId;
        ghosts.ghost_lastLoanId = lending.loanPoolLoanId(loanPoolId);
        (,, uint256 streamId,,,,) = lending.loans(ghosts.ghost_lastLoanId);
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        lending.claimLoanPoolShare(loanPoolId, amount);
        snapshotAfter();
        // Property assertions
        property_claimLoanPoolShareReceivedIncreases();
        property_proRataEntitlementFloored();
        property_poolReceivedLeTotalObligation();
        property_poolReceivedLeEntitlement();
        property_poolConservation();
        property_claimPool_zero_reverts();
        property_received_le_proRata_recovered();
        property_non_contributor_cannot_claim();
    }

    function oVRFLOLending_withdrawLiquidity(uint256 liquidityId) public asActor {
        ghosts.ghost_lastLiquidityId = liquidityId;
        snapshotBefore();
        lending.withdrawLiquidity(liquidityId);
        snapshotAfter();
        // Property assertions
        property_withdrawLiquidityInactive();
        property_withdrawLiquidityRefundMatchesCapacity();
        property_nonMakerCannotWithdrawLiquidity(liquidityId);
        property_withdraw_post_maturity();
    }

    function oVRFLOLending_cancelSaleListing(uint256 listingId) public asActor {
        ghosts.ghost_lastListingId = listingId;
        (,, uint256 streamId,,,) = lending.saleListings(listingId);
        ghosts.ghost_lastStreamId = streamId;
        snapshotBefore();
        lending.cancelSaleListing(listingId);
        snapshotAfter();
        // Property assertions
        property_cancelSaleListingInactive();
        property_cancelSaleListingReturnsStream();
        property_nonMakerCannotCancelListing(listingId);
        property_cancel_post_maturity();
    }

    function oVRFLOLending_gatherLiquidity(uint256 liquiditySeed, uint128 targetAmount) public {
        uint256 maxLiquidity = lending.nextLiquidityId();
        // Sometimes pass startId >= nextLiquidityId to cover the early-return path
        if (liquiditySeed % 3 == 0) {
            try lending.gatherLiquidity(market, 1000, targetAmount, maxLiquidity + 1, actor) returns (
                uint256[] memory ids, bool sufficient
            ) {
                assert(ids.length == 0 && !sufficient);
            } catch {}
            return;
        }
        if (maxLiquidity <= 1) return;
        uint256 startId = clampBetween(liquiditySeed, 1, maxLiquidity - 1);
        // Find a valid liquidity to get market and aprBps
        for (uint256 i = startId; i < maxLiquidity; i++) {
            (, address liquidityMarket, uint16 liquidityApr,, bool active) = lending.liquidityPositions(i);
            if (!active) continue;
            (uint256[] memory ids, bool sufficient) =
                lending.gatherLiquidity(liquidityMarket, liquidityApr, targetAmount, 1, actor);
            // Verify returned IDs are active with matching market and aprBps
            uint128 sum;
            for (uint256 j = 0; j < ids.length; j++) {
                (, address m, uint16 apr, uint128 cap, bool a) = lending.liquidityPositions(ids[j]);
                assert(a && m == liquidityMarket && apr == liquidityApr);
                sum += cap;
            }
            if (sufficient) {
                assert(sum >= targetAmount);
            }
            return;
        }
    }

    // ――――――――――――――――――― Admin (via factory) ―――――――――――――――――――

    function _oVRFLOLending_setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) internal asAdmin {
        if (aprMinBps_ > aprMaxBps_) return;
        factory.setLendingAprBounds(address(lending), aprMinBps_, aprMaxBps_);
    }

    function _oVRFLOLending_setFee(uint16 feeBps_) internal asAdmin {
        factory.setLendingFee(address(lending), feeBps_);
    }

    function _oVRFLOLending_setTreasury(address newTreasury) internal asAdmin {
        try factory.setLendingTreasury(address(lending), newTreasury) {} catch {}
    }

    // ―――――――――――――――――――― Round-trip handlers ――――――――――――――――――――

    /// @notice SP-03: supplyLiquidity -> withdrawLiquidity returns exactly same availableLiquidity
    function roundTrip_supplyLiquidityCancel(uint16 aprBps, uint128 availableLiquidity) public {
        availableLiquidity = uint128(clampBetween(uint256(availableLiquidity), 1, underlying.balanceOf(actor)));
        if (availableLiquidity == 0) return;
        aprBps = _clampApr(aprBps);

        uint256 underlyingBefore = underlying.balanceOf(actor);

        vm.prank(actor);
        uint256 liquidityId = lending.supplyLiquidity(market, aprBps, availableLiquidity);

        vm.prank(actor);
        lending.withdrawLiquidity(liquidityId);

        uint256 underlyingAfter = underlying.balanceOf(actor);
        property_supplyLiquidityCancelRoundTrip(underlyingBefore, underlyingAfter);
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
        try lending.postSaleListing(market, streamId, aprBps) returns (uint256 listingId) {
            vm.prank(actor);
            try lending.cancelSaleListing(listingId) {}
            catch {
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

    /// @notice R15: LoanPool lifecycle scenario - multi-liquidity pool, vesting, close, claim
    function scenario_poolLifecycle(uint16 aprBps, uint128 availableLiquidity, uint128 targetBorrow) public {
        if (actors.length < 3) return;
        address actorA = actors[0];
        address actorB = actors[1];
        address actorC = actors[2];

        aprBps = _clampApr(aprBps);
        availableLiquidity = uint128(clampBetween(uint256(availableLiquidity), 1, underlying.balanceOf(actorA)));
        if (availableLiquidity == 0) return;

        // Step 1: Actor A posts an liquidity
        vm.prank(actorA);
        try lending.supplyLiquidity(market, aprBps, availableLiquidity) returns (uint256 liquidityA) {
            // Step 2: Actor B posts an liquidity with same market and aprBps
            uint256 capB = uint128(clampBetween(uint256(availableLiquidity), 1, underlying.balanceOf(actorB)));
            if (capB == 0) return;
            vm.prank(actorB);
            try lending.supplyLiquidity(market, aprBps, uint128(capB)) returns (uint256 liquidityB) {
                // Step 3: Actor C creates a borrow pool with both liquidityPositions
                uint256 streamId = 0;
                for (uint256 i = 1; i < MockSablier(SABLIER_ADDR).nextStreamId() + 1; i++) {
                    try ISablierV2LockupLinear(SABLIER_ADDR).ownerOf(i) returns (address owner) {
                        if (owner == actorC) {
                            (address lender,,,, bool active) = lending.liquidityPositions(liquidityA);
                            (address makerB,,,, bool activeB) = lending.liquidityPositions(liquidityB);
                            if (active && activeB && lender != actorC && makerB != actorC) {
                                streamId = i;
                                break;
                            }
                        }
                    } catch {}
                }
                if (streamId == 0) return;

                uint256[] memory liquidityIds = new uint256[](2);
                liquidityIds[0] = liquidityA;
                liquidityIds[1] = liquidityB;
                targetBorrow = uint128(clampBetween(uint256(targetBorrow), 1, type(uint128).max));

                vm.prank(actorC);
                try lending.createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, 0) returns (
                    uint256 loanPoolId
                ) {
                    uint256 loanId = lending.loanPoolLoanId(loanPoolId);

                    // Record withdrawal baseline for GL-70 (scenario bypasses the handler)
                    ghost_loanStreamWithdrawnAtCreation[loanId] =
                        ISablierV2LockupLinear(SABLIER_ADDR).getWithdrawnAmount(streamId);

                    // Step 4: Advance time for stream vesting
                    skipTime(365 days);

                    // Step 5: Close the loan
                    try lending.closeLoan(loanId) {
                        _recordLoanCloseGhost(loanId, streamId);
                        // Step 6: Actor A claims pool share
                        vm.prank(actorA);
                        try lending.claimLoanPoolShare(loanPoolId, type(uint128).max) {
                            // Step 7: Actor B claims pool share
                            vm.prank(actorB);
                            try lending.claimLoanPoolShare(loanPoolId, type(uint128).max) {
                                // Assert pool conservation held through lifecycle
                                uint128 proceeds = lending.loanPoolProceeds(loanPoolId);
                                uint256 sumReceived;
                                for (uint256 i = 0; i < actors.length; i++) {
                                    sumReceived += lending.loanPoolReceived(loanPoolId, actors[i]);
                                }
                                (,,,, uint128 drawn, uint128 repaid,) = lending.loans(loanId);
                                eq(
                                    uint256(proceeds) + sumReceived,
                                    uint256(drawn) + uint256(repaid),
                                    "R15: pool conservation violated in lifecycle"
                                );
                            } catch {}
                        } catch {}
                    } catch {}
                } catch {}
            } catch {}
        } catch {}
    }

    /// @dev Scenario: sell a stream to a liquidity position with exactly matching capacity,
    ///      covering the `availableLiquidity == 0` deactivation branch (line 379).
    function scenario_sellExactsLiquidity(uint256 streamSeed, uint16 aprBps) public {
        uint256 streamId = _pickStream(streamSeed);
        if (streamId == 0) return;
        aprBps = _clampApr(aprBps);
        try lending.quote(market, streamId, aprBps, 0) returns (
            uint256 grossPrice, uint128, uint256, uint256, uint128
        ) {
            if (grossPrice == 0 || grossPrice > type(uint128).max) return;
            uint128 cap = uint128(grossPrice);
            // Supply liquidity with exactly the gross price as capacity
            underlying.deal(actor, grossPrice);
            ghost_actorStartValue[actor] += grossPrice; // keep GL-57 conservation honest
            vm.startPrank(actor);
            underlying.approve(address(lending), grossPrice);
            uint256 liquidityId = lending.supplyLiquidity(market, aprBps, cap);
            // Sell the stream to this liquidity position, exhausting it
            MockSablier(SABLIER_ADDR).approve(address(lending), streamId);
            lending.sellStreamToLiquidity(liquidityId, streamId, 0);
            vm.stopPrank();
            // Verify the position is now inactive
            (,,, uint128 remaining, bool active) = lending.liquidityPositions(liquidityId);
            assert(!active && remaining == 0);
        } catch {}
    }
}
