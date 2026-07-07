// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Base} from "./Base.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";

/// @notice Used to take snapshots of the state before and after a function call
abstract contract Snapshots is Base {
    struct State {
        // Actor balances
        uint256 actorUnderlying;        // 1: actor's underlying balance
        uint256 actorOvrfloToken;       // 2: actor's ovrfloToken balance
        uint256 actorPt;                // 3: actor's PT balance
        // Vault state
        uint256 vaultTotalDeposited;    // 4: marketTotalDeposited[market]
        uint256 vaultWrappedUnderlying; // 5: wrappedUnderlying
        uint256 vaultPtBalance;         // 6: ptToken.balanceOf(vault)
        uint256 ovrfloTotalSupply;      // 7: ovrfloToken.totalSupply()
        // Book balances
        uint256 bookUnderlyingBalance;  // 8: underlying.balanceOf(book)
        uint256 bookOvrfloTokenBalance; // 9: ovrfloToken.balanceOf(book)
        // Entity-specific state (keyed by ghost_last* IDs)
        uint128 poolProceeds;           // 10: poolProceeds[poolId]
        uint128 poolTotalObligation;    // 11: pools[poolId].totalObligation
        uint128 poolTotalContributed;   // 12: pools[poolId].totalContributed
        uint128 loanObligation;         // 13: loans[loanId].obligation
        uint128 loanDrawn;              // 14: loans[loanId].drawn
        uint128 loanRepaid;             // 15: loans[loanId].repaid
        bool loanClosed;                // 16: loans[loanId].closed
        // Stream state (keyed by ghost_lastStreamId)
        uint128 streamRemaining;        // 17: deposited - withdrawn
        address streamOwner;            // 18: sablier.ownerOf(streamId)
        // Offer state (keyed by ghost_lastOfferId)
        uint128 offerCapacity;          // 19: offers[offerId].capacity
        bool offerActive;               // 20: offers[offerId].active
        // Listing state (keyed by ghost_lastListingId)
        bool listingActive;             // 21: saleListings[listingId].active
        // ID counters
        uint256 nextOfferId;            // 22
        uint256 nextSaleListingId;      // 23
        uint256 nextLoanId;             // 24
        uint256 nextPoolId;             // 25
        // Vault config
        uint16 flashFeeBps;             // 26
        bool flashLoanPaused;           // 27
        // Pool received for current actor
        uint128 poolReceived;           // 28: poolReceived[poolId][actor]
    }

    State internal stateBefore;
    State internal stateAfter;

    function _takeSnapshot(State storage state) private {
        // Actor balances
        state.actorUnderlying = underlying.balanceOf(actor);
        state.actorOvrfloToken = ovrfloToken.balanceOf(actor);
        state.actorPt = ptToken.balanceOf(actor);

        // Vault state
        state.vaultTotalDeposited = vault.marketTotalDeposited(market);
        state.vaultWrappedUnderlying = vault.wrappedUnderlying();
        state.vaultPtBalance = ptToken.balanceOf(address(vault));
        state.ovrfloTotalSupply = ovrfloToken.totalSupply();

        // Book balances
        state.bookUnderlyingBalance = underlying.balanceOf(address(book));
        state.bookOvrfloTokenBalance = ovrfloToken.balanceOf(address(book));

        // Entity-specific state (defaults to 0/false for non-existent entities)
        state.poolProceeds = book.poolProceeds(ghosts.ghost_lastPoolId);
        if (ghosts.ghost_lastPoolId > 0) {
            (, , , uint128 totalContributed, uint128 totalObligation) = book.pools(ghosts.ghost_lastPoolId);
            state.poolTotalObligation = totalObligation;
            state.poolTotalContributed = totalContributed;
        } else {
            state.poolTotalObligation = 0;
            state.poolTotalContributed = 0;
        }

        if (ghosts.ghost_lastLoanId > 0) {
            (, , , uint128 obligation, uint128 drawn, uint128 repaid, bool closed) =
                book.loans(ghosts.ghost_lastLoanId);
            state.loanObligation = obligation;
            state.loanDrawn = drawn;
            state.loanRepaid = repaid;
            state.loanClosed = closed;
        } else {
            state.loanObligation = 0;
            state.loanDrawn = 0;
            state.loanRepaid = 0;
            state.loanClosed = false;
        }

        // Stream state
        uint256 streamId = ghosts.ghost_lastStreamId;
        if (streamId > 0) {
            try ISablierV2LockupLinear(SABLIER_ADDR).getDepositedAmount(streamId) returns (uint128 deposited) {
                uint128 withdrawn = ISablierV2LockupLinear(SABLIER_ADDR).getWithdrawnAmount(streamId);
                state.streamRemaining = deposited > withdrawn ? deposited - withdrawn : 0;
            } catch {
                state.streamRemaining = 0;
            }
            try ISablierV2LockupLinear(SABLIER_ADDR).ownerOf(streamId) returns (address owner) {
                state.streamOwner = owner;
            } catch {
                state.streamOwner = address(0);
            }
        } else {
            state.streamRemaining = 0;
            state.streamOwner = address(0);
        }

        // Offer state
        if (ghosts.ghost_lastOfferId > 0) {
            (, , , uint128 capacity, bool active) = book.offers(ghosts.ghost_lastOfferId);
            state.offerCapacity = capacity;
            state.offerActive = active;
        } else {
            state.offerCapacity = 0;
            state.offerActive = false;
        }

        // Listing state
        if (ghosts.ghost_lastListingId > 0) {
            (, , , , , bool active) = book.saleListings(ghosts.ghost_lastListingId);
            state.listingActive = active;
        } else {
            state.listingActive = false;
        }

        // ID counters
        state.nextOfferId = book.nextOfferId();
        state.nextSaleListingId = book.nextSaleListingId();
        state.nextLoanId = book.nextLoanId();
        state.nextPoolId = book.nextPoolId();

        // Vault config
        state.flashFeeBps = vault.flashFeeBps();
        state.flashLoanPaused = vault.flashLoanPaused();

        // Pool received for current actor
        state.poolReceived = book.poolReceived(ghosts.ghost_lastPoolId, actor);
    }

    function snapshotBefore() internal {
        _takeSnapshot(stateBefore);
    }

    function snapshotAfter() internal {
        _takeSnapshot(stateAfter);
    }
}
