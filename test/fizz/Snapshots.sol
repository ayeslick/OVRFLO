// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Base} from "./Base.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";

/// @notice Used to take snapshots of the state before and after a function call
abstract contract Snapshots is Base {
    struct State {
        // Actor balances
        uint256 actorUnderlying; // 1: actor's underlying balance
        uint256 actorOvrfloToken; // 2: actor's ovrfloToken balance
        uint256 actorPt; // 3: actor's PT balance
        // Vault state
        uint256 vaultTotalDeposited; // 4: marketTotalDeposited[market]
        uint256 vaultWrappedUnderlying; // 5: wrappedUnderlying
        uint256 vaultPtBalance; // 6: ptToken.balanceOf(vault)
        uint256 ovrfloTotalSupply; // 7: ovrfloToken.totalSupply()
        // Lending balances
        uint256 lendingUnderlyingBalance; // 8: underlying.balanceOf(lending)
        uint256 lendingOvrfloTokenBalance; // 9: ovrfloToken.balanceOf(lending)
        // Entity-specific state (keyed by ghost_last* IDs)
        uint128 loanPoolProceeds; // 10: loanPoolProceeds[loanPoolId]
        uint128 poolTotalContributed; // 11: loanPools[loanPoolId].totalContributed
        uint128 loanObligation; // 12: loans[loanId].obligation
        uint128 loanDrawn; // 14: loans[loanId].drawn
        uint128 loanRepaid; // 15: loans[loanId].repaid
        bool loanClosed; // 16: loans[loanId].closed
        // Stream state (keyed by ghost_lastStreamId)
        uint128 streamRemaining; // 17: deposited - withdrawn
        address streamOwner; // 18: sablier.ownerOf(streamId)
        // LiquidityPosition state (keyed by ghost_lastLiquidityId)
        uint128 liquidityCapacity; // 19: liquidityPositions[liquidityId].availableLiquidity
        // Listing state (keyed by ghost_lastListingId)
        bool listingActive; // 21: saleListings[listingId].active
        // ID counters
        uint256 nextLiquidityId; // 22
        uint256 nextSaleListingId; // 23
        uint256 nextLoanId; // 24
        // Vault config
        uint16 flashFeeBps; // 26
        bool flashLoanPaused; // 27
        // LoanPool received for current actor
        uint128 loanPoolReceived; // 28: loanPoolReceived[loanPoolId][actor]
        // Lending treasury underlying balance (SP-99, SP-100)
        uint256 treasuryUnderlying; // 29: underlying.balanceOf(lending.treasury())
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

        // Lending balances
        state.lendingUnderlyingBalance = underlying.balanceOf(address(lending));
        state.lendingOvrfloTokenBalance = ovrfloToken.balanceOf(address(lending));

        // Entity-specific state (defaults to 0/false for non-existent entities)
        state.loanPoolProceeds = lending.loanPoolProceeds(ghosts.ghost_lastPoolId);
        if (ghosts.ghost_lastPoolId > 0) {
            (,,, uint128 totalContributed) = lending.loanPools(ghosts.ghost_lastPoolId);
            state.poolTotalContributed = totalContributed;
        } else {
            state.poolTotalContributed = 0;
        }

        if (ghosts.ghost_lastLoanId > 0) {
            (,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = lending.loans(ghosts.ghost_lastLoanId);
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

        // LiquidityPosition state
        if (ghosts.ghost_lastLiquidityId > 0) {
            (,,, uint128 availableLiquidity) = lending.liquidityPositions(ghosts.ghost_lastLiquidityId);
            state.liquidityCapacity = availableLiquidity;
        } else {
            state.liquidityCapacity = 0;
        }

        // Listing state
        if (ghosts.ghost_lastListingId > 0) {
            (,,,,, bool active) = lending.saleListings(ghosts.ghost_lastListingId);
            state.listingActive = active;
        } else {
            state.listingActive = false;
        }

        // ID counters
        state.nextLiquidityId = lending.nextLiquidityId();
        state.nextSaleListingId = lending.nextSaleListingId();
        state.nextLoanId = lending.nextLoanId();

        // Vault config
        state.flashFeeBps = vault.flashFeeBps();
        state.flashLoanPaused = vault.flashLoanPaused();

        // LoanPool received for current actor
        state.loanPoolReceived = lending.loanPoolReceived(ghosts.ghost_lastPoolId, actor);

        // Lending treasury underlying balance
        state.treasuryUnderlying = underlying.balanceOf(lending.treasury());
    }

    function snapshotBefore() internal {
        _takeSnapshot(stateBefore);
    }

    function snapshotAfter() internal {
        _takeSnapshot(stateAfter);
    }
}
