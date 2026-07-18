// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {OVRFLOLendingHandler} from "./OVRFLOLendingHandler.sol";
import {MockSablier} from "../mocks/MockSablier.sol";
import {ISablierV2LockupLinear} from "../../../interfaces/ISablierV2LockupLinear.sol";
import {vm} from "../utils/Hevm.sol";

/// @notice Lending scenario and round-trip handlers extracted from OVRFLOLendingHandler.
///         Reachability ghosts track scenario completions for corpus triage.
abstract contract LendingScenarios is OVRFLOLendingHandler {
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
        ghost_scenarioCompletions[keccak256("supplyLiquidityCancel")]++;
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
        ghost_scenarioCompletions[keccak256("postListingCancel")]++;
    }

    /// @notice R15: Loan lifecycle scenario - multi-liquidity pool, vesting, close, claim
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
                            (address lender,,, uint128 capA) = lending.liquidityPositions(liquidityA);
                            (address makerB,,, uint128 liqCapB) = lending.liquidityPositions(liquidityB);
                            if (capA > 0 && liqCapB > 0 && lender != actorC && makerB != actorC) {
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
                    // Record withdrawal baseline for GL-70 (scenario bypasses the handler)
                    _recordLoanCreateGhost(loanPoolId, streamId);

                    // Step 4: Advance time for stream vesting
                    skipTime(365 days);

                    // Step 5: Close the loan
                    try lending.closeLoan(loanPoolId) {
                        _recordLoanCloseGhost(loanPoolId, streamId);
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
                                (,,, uint128 drawn, uint128 repaid,) = lending.loans(loanPoolId);
                                eq(
                                    uint256(proceeds) + sumReceived,
                                    uint256(drawn) + uint256(repaid),
                                    "R15: pool conservation violated in lifecycle"
                                );
                                ghost_scenarioCompletions[keccak256("poolLifecycle")]++;
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
            (,,, uint128 remaining) = lending.liquidityPositions(liquidityId);
            assert(remaining == 0);
            ghost_scenarioCompletions[keccak256("sellExactsLiquidity")]++;
        } catch {}
    }
}
