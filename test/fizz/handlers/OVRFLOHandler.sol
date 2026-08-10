// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {MockFlashBorrower} from "../mocks/MockFlashBorrower.sol";

/// @notice Handles the interaction with OVRFLO
abstract contract OVRFLOHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    /// @dev Deposits a valid PT amount owned by the actor. This is the collateral-supply
    ///      line for the entire lending campaign: every stream borrow can pledge comes
    ///      from here.
    function ovrflo_deposit_clamped(uint256 ptAmountSeed) public {
        uint256 minPt = vault.MIN_PT_AMOUNT();
        uint256 balance = ptToken.balanceOf(actor);
        if (balance < minPt) return;
        uint256 ptAmount = clampBetween(ptAmountSeed, minPt, balance);
        ovrflo_deposit(market, ptAmount, 0);
    }

    function ovrflo_wrap_clamped(uint256 amountSeed) public {
        uint256 balance = underlying.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, balance);
        ovrflo_wrap(amount);
    }

    function ovrflo_unwrap_clamped(uint256 amountSeed) public {
        uint256 balance = ovrfloToken.balanceOf(actor);
        uint256 reserve = vault.wrappedUnderlying();
        uint256 cap = balance < reserve ? balance : reserve;
        if (cap == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, cap);
        ovrflo_unwrap(amount);
    }

    /// @dev Claim only succeeds post-maturity; the mock series is deliberately set far
    ///      in the future (matches the recovered setup), so within a normal campaign
    ///      this mostly exercises the "not matured" revert path via the unclamped call.
    ///      Left clamped to a real balance so it is meaningful if time is ever skipped
    ///      far enough by `handler_skipTime`.
    function ovrflo_claim_clamped(uint256 amountSeed) public {
        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, balance);
        ovrflo_claim(address(ptToken), amount);
    }

    function ovrflo_flashLoan_clamped(uint256 amountSeed, bytes memory data) public {
        uint256 deposited = vault.marketTotalDeposited(market);
        if (deposited == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, deposited);
        ovrflo_flashLoan(address(ptToken), amount, data);
    }

    /// @dev Routes the flash loan through the dedicated MockFlashBorrower contract
    ///      instead of an Actor, exercising the deposit-during-callback reentrancy path.
    function ovrflo_flashLoan_viaBorrower_clamped(uint256 amountSeed, bool reenter) public {
        uint256 deposited = vault.marketTotalDeposited(market);
        if (deposited == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, deposited);
        MockFlashBorrower(mockFlashBorrowerAddr).executeFlashLoan(amount, abi.encode(reenter));
    }

    function handler_skipTime(uint256 seed) public {
        uint256 time = clampBetween(seed, 1, 30 days);
        skipTime(time);
    }

    // ―――――――――――――――――― Round-trip handlers ――――――――――――――――――

    /// @dev SP-03 ghost: completed wrap/unwrap cycles across the whole campaign.
    uint256 internal spWrapCycles;

    /// @dev SP-03: atomic wrap → unwrap round trip. Both legs run through the
    ///      instrumented `asActor` handlers (hook accounting per leg); the reserve the
    ///      unwrap draws on was funded by the wrap in the same call, so the pair can
    ///      only revert on a real reserve bug.
    function roundTrip_wrapUnwrap(uint256 amountSeed) public {
        uint256 balance = underlying.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = clampBetween(amountSeed, 1, balance);

        snapshotBefore();
        ovrflo_wrap(amount);
        ovrflo_unwrap(amount);
        snapshotAfter();

        spWrapCycles += 1;
        property_wrapUnwrap_noDrift(
            stateBefore.actorUnderlyingBalance,
            stateAfter.actorUnderlyingBalance,
            stateBefore.actorOvrfloTokenBalance,
            stateAfter.actorOvrfloTokenBalance,
            spWrapCycles
        ); // SP-03
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function ovrflo_deposit(address _market, uint256 ptAmount, uint256 minToUser) public asActor {
        // SP-04/SP-10 pre-state: both preview surfaces, read in the same block BEFORE the
        // money path runs. Any preview revert implies the deposit reverts too (same
        // market-approval and oracle-freshness gates), discarding the whole call.
        (uint256 previewToUser, uint256 previewToStream, uint256 previewFee,) = vault.previewDeposit(_market, ptAmount);
        (uint256 streamViewToUser, uint256 streamViewToStream,) = vault.previewStream(_market, ptAmount);
        uint256 underlyingBefore = underlying.balanceOf(actor);

        (uint256 toUser, uint256 toStream, uint256 streamId) = vault.deposit(_market, ptAmount, minToUser);
        if (toStream > 0) {
            streamIds.push(streamId);
            actorStreams[actor].push(streamId);
        }

        // The deposit fee leaves the actor in underlying and the vault treasury is never
        // an actor, so the realized delta is exactly the fee charged.
        uint256 actualFee = underlyingBefore - underlying.balanceOf(actor);
        property_previewDeposit_matchesApplied(previewToUser, previewToStream, previewFee, toUser, toStream, actualFee); // SP-04
        property_vaultPreview_matchesMoneyPath(streamViewToUser, streamViewToStream, toUser, toStream); // SP-10
    }

    function ovrflo_wrap(uint256 amount) public asActor {
        vault.wrap(amount);
    }

    function ovrflo_unwrap(uint256 amount) public asActor {
        vault.unwrap(amount);
    }

    function ovrflo_claim(address _ptToken, uint256 amount) public asActor {
        vault.claim(_ptToken, amount);
    }

    function ovrflo_flashLoan(address _ptToken, uint256 amount, bytes memory data) public asActor {
        vault.flashLoan(_ptToken, amount, data);
    }
}
