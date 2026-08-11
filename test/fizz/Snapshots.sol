// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Base} from "./Base.sol";

/// @notice Used to take snapshots of the state before and after a function call
/// @dev Deliberately minimal, per the property plan's Snapshot State Plan: the global
///      properties read their before/after state through the `asActor` hook snapshots in
///      `Base.sol` (which run around EVERY actor handler), and entity-keyed data is
///      cheaper to read locally inside the relevant handler than to snapshot globally.
///      What belongs here is exactly the actor-level balance triple the round-trip /
///      no-drift specific properties (SP-01, SP-02, SP-03, SP-26) compare across a call.
abstract contract Snapshots is Base {
    struct State {
        uint256 actorUnderlyingBalance;
        uint256 actorOvrfloTokenBalance;
        uint256 actorPtBalance;
    }

    State internal stateBefore;
    State internal stateAfter;

    function _takeSnapshot(State storage state) private {
        state.actorUnderlyingBalance = underlying.balanceOf(actor);
        state.actorOvrfloTokenBalance = ovrfloToken.balanceOf(actor);
        state.actorPtBalance = ptToken.balanceOf(actor);
    }

    function snapshotBefore() internal {
        _takeSnapshot(stateBefore);
    }

    function snapshotAfter() internal {
        _takeSnapshot(stateAfter);
    }
}
