// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {OVRFLOLendingHandler} from "./OVRFLOLendingHandler.sol";
import {OVRFLOHandler} from "./OVRFLOHandler.sol";
import {OVRFLOFactoryHandler} from "./OVRFLOFactoryHandler.sol";
import {MockSablier} from "../mocks/MockSablier.sol";

/// @notice Inherits from all the handlers to expose all entry points in a single contract.
///         Manages environment changes (e.g. current actor, current token, mocks setup, etc.)
///         and hosts the cross-contract scenario handlers that need both the vault and the
///         lending handler families.
abstract contract Handlers is OVRFLOLendingHandler, OVRFLOHandler, OVRFLOFactoryHandler {
    function setCurrentActor(uint256 entropy) public {
        actor = actors[entropy % actors.length];
    }

    /// @dev Locals for `scenario_exactFillBoundary`, packed to stay off the stack.
    struct BoundarySnap {
        uint256 ttm;
        uint256 factor;
        uint256 target;
        uint256 remaining;
        uint256 ptAmount;
        uint256 streamId;
    }

    /// @dev SP-08: deterministic exact-fill-boundary construction. Random fuzzing
    ///      essentially never lands `actualBorrow == grossPrice` exactly (UNIT = 1e12),
    ///      so the scenario builds it: pick a UNIT-aligned target g, derive the remaining
    ///      face R with `grossPrice(R) == g` under the live (apr, ttm), mint a fresh
    ///      stream with exactly that face via a vault deposit, supply g at an
    ///      otherwise-empty tick, and borrow g against the fresh stream. The pricing
    ///      formula is mirrored for CONSTRUCTION only — every guard bails with `return`,
    ///      and the final assertion compares the ON-CHAIN obligation against the ON-CHAIN
    ///      pre-borrow stream face, gated on the fill demonstrably landing on g. Lives in
    ///      this contract because it composes vault-side (`ovrflo_deposit`) and
    ///      lending-side (`lending_supply`/`lending_borrow`) handlers; every leg runs
    ///      through the instrumented `asActor` handlers, so hook accounting stays truthful.
    function scenario_exactFillBoundary(uint256 aprSeed) public {
        uint16 aprBps = validTick(aprSeed);
        // The tick must be empty so the fill consumes exactly the fresh g supplied below.
        (,, uint128 avail) = lending.tickState(market, aprBps);
        if (avail != 0) return;

        BoundarySnap memory snap;
        {
            (,, uint256 expiry,,,,) = vault.series(market);
            if (block.timestamp >= expiry) return;
            snap.ttm = expiry - block.timestamp;
        }

        // Mirror of StreamPricing.factor / the smallest R with grossPrice(R) == g.
        snap.factor = 1e18 + (snap.ttm * (uint256(aprBps) * 1e18)) / (365 days * 10_000);
        snap.target = 1e18; // UNIT-aligned and >= MIN_LIQUIDITY_AMOUNT
        snap.remaining = (snap.target * snap.factor + 1e18 - 1) / 1e18;
        if (snap.remaining > type(uint128).max) return;

        // Find the PT deposit whose streamed remainder is exactly R (the split moves by
        // 0 or 1 wei per 1 wei of PT, so a short local walk always lands or bails).
        {
            uint256 rate = vault.previewRate(market);
            if (rate >= 1e18) return;
            uint256 ptAmount = (snap.remaining * 1e18) / (1e18 - rate);
            if (ptAmount < vault.MIN_PT_AMOUNT()) return;
            bool hit;
            for (uint256 i; i < 64; ++i) {
                (, uint256 toStream,) = vault.previewStream(market, ptAmount);
                if (toStream == snap.remaining) {
                    hit = true;
                    break;
                }
                if (toStream < snap.remaining) ptAmount += 1;
                else ptAmount -= 1;
            }
            if (!hit) return;
            snap.ptAmount = ptAmount;
        }
        if (ptToken.balanceOf(actor) < snap.ptAmount) return;
        // Deposit fee (in underlying) plus the g supplied below — generous upper bound.
        if (underlying.balanceOf(actor) < snap.target + snap.ptAmount) return;

        ovrflo_deposit(market, snap.ptAmount, 0);
        snap.streamId = streamIds[streamIds.length - 1];
        {
            MockSablier sablierMock = MockSablier(SABLIER_ADDR);
            uint256 face =
                uint256(sablierMock.getDepositedAmount(snap.streamId)) - sablierMock.getWithdrawnAmount(snap.streamId);
            if (face != snap.remaining) return;
        }

        lending_supply(market, aprBps, uint128(snap.target));
        lending_borrow(market, aprBps, uint128(snap.target), snap.streamId, 0);

        uint256 loanId = loanIds[loanIds.length - 1];
        (, uint64 fillStart, uint64 fillEnd, uint128 obligation_,,) = _sp_loanFields(loanId);
        if (uint256(fillEnd - fillStart) * lending.UNIT() != snap.target) return; // boundary not reached
        property_equalityFastPath_exact(obligation_, uint128(snap.remaining)); // SP-08
    }
}
