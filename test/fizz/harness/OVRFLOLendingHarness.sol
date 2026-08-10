// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OVRFLOLending} from "../../../src/OVRFLOLending.sol";
import {TickTree} from "../../../src/TickTree.sol";

/// @title OVRFLOLendingHarness
/// @notice Read-only window onto the `Epoch`/`TickTree` state that `OVRFLOLending`'s
///         public view surface does not expose.
/// @dev `tickState` reports only the *summed live* depth, `positionState` only a single
///      position's interval — neither surfaces a specific epoch's raw `filled`, its
///      `loanCount`, or the tree's `leaves`/`height`. GL-03, GL-12, GL-18, GL-20, GL-23
///      and GL-28 all need those raw coordinates, and several of them need them for
///      *dead* epochs the live-depth views deliberately skip.
///
///      This harness adds getters only — no setter, no overridden behaviour, no extra
///      storage. `Base.setup()` deploys it directly AS the market, with the same
///      constructor arguments `deployLending` would use (so every immutable resolves to
///      the same value), hands ownership to the factory, and replays `deployLending`'s
///      registry writes via `vm.store` — the etch-overlay alternative is banned because
///      Medusa's geth EVM pairs etched-over code with the old code's jump analysis.
contract OVRFLOLendingHarness is OVRFLOLending {
    using TickTree for TickTree.Tree;

    constructor(address factory_, address core_, address sablier_) OVRFLOLending(factory_, core_, sablier_) {}

    /// @notice Raw per-epoch tape coordinates for one `(market, aprBps, epoch)` tuple.
    /// @dev Never reverts on an untouched tuple: an unwritten `Epoch` reads as an
    ///      all-zero tree, and `TickTree.root()` short-circuits at `leaves == 0`.
    /// @return root Total quantity appended to the epoch's tree, in UNITs.
    /// @return filled Cumulative quantity consumed from the tape, in UNITs.
    /// @return loanCount Number of frozen loan intervals in this epoch.
    /// @return leaves Number of permanently allocated leaf coordinates.
    /// @return height Current tree height; zero means never appended to.
    /// @return atCap Whether the active height has allocated every leaf index.
    function fizz_epochState(address market, uint16 aprBps, uint32 epoch)
        external
        view
        returns (uint64 root, uint64 filled, uint64 loanCount, uint32 leaves, uint8 height, bool atCap)
    {
        Epoch storage epochState = ticks[market][aprBps].epochs[epoch];
        return (
            epochState.tree.root(),
            epochState.filled,
            epochState.loanCount,
            epochState.tree.leaves,
            epochState.tree.height,
            epochState.tree.atCapacity()
        );
    }

    /// @notice The tick's epoch cursors without the `SpacingUnset` gate `tickState` applies.
    function fizz_tickCursors(address market, uint16 aprBps)
        external
        view
        returns (uint32 oldestLiveEpoch, uint32 currentEpoch)
    {
        Tick storage tick = ticks[market][aprBps];
        return (tick.oldestLiveEpoch, tick.currentEpoch);
    }

    /// @notice `TickTree.MAX_HEIGHT`, so properties need not import the library.
    function fizz_maxTreeHeight() external pure returns (uint8) {
        return TickTree.MAX_HEIGHT;
    }
}
