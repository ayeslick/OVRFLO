// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Snapshots} from "./Snapshots.sol";
import {PropertiesAsserts} from "./utils/PropertiesAsserts.sol";
import {MockSablier} from "./mocks/MockSablier.sol";

/// @notice Contains the functions that check the properties (invariants)
abstract contract Properties is PropertiesAsserts, Snapshots {
    // ―――――――――――――――――――― Global properties ―――――――――――――――――――――
    // These properties must always hold after any function call.
    // They MUST BE PUBLIC so that fuzzers can find and call them.
    //
    // Reading discipline: everything below goes through the FLATTENED public getters
    // (`lending.loans(...)`, `lending.positions(...)`, `lending.positionState(...)` with
    // skipped tuple components) and the `fizz_*` harness getters, so this file needs no
    // `OVRFLOLending` struct import. Monotone (high-water) ghosts are latched INSIDE the
    // properties — sound at any sampling frequency — while order-sensitive ghosts are
    // written by the `asActor` hooks in `Base.sol` in the same transaction as the event
    // they record (see the hook comment there).

    // ―― Conservation & solvency ――

    /// @notice GL-01: the market's ovrfloToken pot bookkeeping (`proceeds`) equals the
    ///         recovery-minus-payout pot reconstructed WITHOUT reading `proceeds`: the
    ///         ghost side rebuilds it from live `drawn + repaid` and the hook-inferred
    ///         realized claim payouts.
    function property_pot_conservation() public {
        uint256 sumProceeds;
        uint256 sumRecovered;
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            sumProceeds += lending.proceeds(loanId);
            (,,,,,,,,,, uint128 drawn, uint128 repaid) = lending.loans(loanId);
            sumRecovered += uint256(drawn) + uint256(repaid);
        }
        eq(
            sumProceeds + ghosts.claimPaidOut,
            sumRecovered,
            "GL-01: proceeds bookkeeping diverged from the ghost-reconstructed pot"
        );
        eq(
            ovrfloToken.balanceOf(address(lending)),
            sumProceeds + ghosts.ovrfloDonated,
            "GL-01: market ovrfloToken balance != sum of loan pots plus donations"
        );
    }

    /// @notice GL-02: the market's underlying balance equals the sum, over EVERY position
    ///         ever created (dead/cursor-skipped epochs included — they legitimately hold
    ///         sub-atom dust), of that position's live `positionState().unfilled`, plus
    ///         any bare donations.
    function property_escrow_solvency_positionSide() public {
        uint256 sumUnfilled;
        for (uint256 i; i < positionIds.length; ++i) {
            (,,, uint128 unfilled) = lending.positionState(positionIds[i]);
            sumUnfilled += unfilled;
        }
        eq(
            underlying.balanceOf(address(lending)),
            sumUnfilled + ghosts.underlyingDonated,
            "GL-02: market underlying balance != sum of unfilled positions plus donations"
        );
    }

    /// @notice GL-03: tree-side cross-check of GL-02 — the sum over every tape ever
    ///         supplied to of `(root − filled) × UNIT` never exceeds the market's
    ///         underlying balance. Computed from the raw harness coordinates, not from
    ///         `positionState`, so a GL-02/GL-03 divergence localizes a bug to the
    ///         position-enumeration layer vs. the tree layer.
    function property_escrow_solvency_treeSide() public {
        uint256 unit = lending.UNIT();
        uint256 sumDepth;
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            (uint64 root, uint64 filled,,,,) = lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
            gte(root, filled, "GL-03: epoch filled exceeds its tree root");
            sumDepth += uint256(root - filled) * unit;
        }
        lte(
            sumDepth,
            underlying.balanceOf(address(lending)),
            "GL-03: tree-side unfilled depth exceeds the market's underlying balance"
        );
    }

    /// @notice GL-04: backstop flow identity from realized actor/treasury balance deltas
    ///         (hook-tracked), independent of GL-02/GL-03's view-based paths. Written in
    ///         addition form so a violation asserts instead of underflowing.
    function property_underlying_flow_ghosts() public {
        eq(
            underlying.balanceOf(address(lending)) + ghosts.underlyingRefunded + ghosts.underlyingBorrowedOut,
            ghosts.underlyingSupplied + ghosts.underlyingDonated,
            "GL-04: market underlying balance != supplied - refunded - borrowedOut + donated"
        );
    }

    /// @notice GL-05: per-tape tiling agreement — the position-side filled history
    ///         (withdraw's clamp math, via `positionState`) sums to exactly the loan-side
    ///         interval lengths (`_fillTick`'s bookkeeping, via the `loanAt` list). Two
    ///         independently written paths claiming the same `filled` coordinate.
    function property_tiling_agreement() public {
        uint256 unit = lending.UNIT();
        for (uint256 i; i < positionIds.length; ++i) {
            uint256 positionId = positionIds[i];
            (, address m, uint16 apr, uint32 ep,) = lending.positions(positionId);
            (, uint64 start, uint64 end, uint128 unfilled) = lending.positionState(positionId);
            uint64 span = end - start;
            uint64 unfilledUnits = uint64(unfilled / unit);
            t(span >= unfilledUnits, "GL-05: a position's unfilled amount exceeds its own interval");
            scratch_tapePosSum[tapeKeyOf(m, apr, ep)] += span - unfilledUnits;
        }
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            bytes32 key = tapeKeyOf(tape.market, tape.aprBps, tape.epoch);
            (,, uint64 loanCount,,,) = lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
            uint256 loanSum;
            for (uint64 seq; seq < loanCount; ++seq) {
                uint256 loanId = lending.loanAt(tape.market, tape.aprBps, tape.epoch, seq);
                (,,,,,,, uint64 fillStart, uint64 fillEnd,,,) = lending.loans(loanId);
                loanSum += fillEnd - fillStart;
            }
            eq(scratch_tapePosSum[key], loanSum, "GL-05: position-side filled history != loan-side interval sum");
            delete scratch_tapePosSum[key];
        }
    }

    /// @notice GL-06: for the fixed-supply tokens (`underlying`, `ptToken`) the known
    ///         holder set accounts for the entire totalSupply. `ovrfloToken` is
    ///         deliberately excluded — the vault genuinely mints and burns it.
    function property_erc20_supply_conservation() public {
        address[7] memory holders = [
            address(this),
            address(vault),
            address(lending),
            address(factory),
            SABLIER_ADDR,
            address(mockSY),
            address(mockMarket)
        ];
        uint256 sumUnderlying = sumActorsERC20Balances(address(underlying));
        uint256 sumPt = sumActorsERC20Balances(address(ptToken));
        for (uint256 i; i < holders.length; ++i) {
            sumUnderlying += underlying.balanceOf(holders[i]);
            sumPt += ptToken.balanceOf(holders[i]);
        }
        eq(sumUnderlying, underlying.totalSupply(), "GL-06: underlying appeared or vanished outside the known holders");
        eq(sumPt, ptToken.totalSupply(), "GL-06: ptToken appeared or vanished outside the known holders");
    }

    /// @notice GL-07: vault combined solvency — total ovrfloToken supply is backed by the
    ///         vault's underlying plus PT, regardless of who holds the token. The
    ///         documented combined form (2026-07-01 campaign); per-leg forms are too
    ///         strict post-maturity.
    function property_vault_combined_solvency() public {
        lte(
            ovrfloToken.totalSupply(),
            underlying.balanceOf(address(vault)) + ptToken.balanceOf(address(vault)),
            "GL-07: ovrfloToken supply exceeds vault underlying + PT backing"
        );
    }

    /// @notice SC10: for every actor, mock `balanceOf` equals the ownership-filtered
    ///         mirror and `tokensOfOwnerIn(actor, 0, balanceOf)` is exactly that id set.
    function property_actorStreamEnumeration() public {
        for (uint256 a; a < actors.length; ++a) {
            address who = actors[a];
            uint256[] storage mirror = actorStreams[who];
            uint256 live;
            for (uint256 i; i < mirror.length; ++i) {
                if (burnedStreams[mirror[i]]) continue;
                if (_ownerOfOrZero(mirror[i]) == who) live += 1;
            }
            MockSablier sablierMock = MockSablier(SABLIER_ADDR);
            uint256 bal = sablierMock.balanceOf(who);
            eq(bal, live, "SC10: balanceOf != ownership-filtered mirror");
            uint256[] memory ids = sablierMock.tokensOfOwnerIn(who, 0, bal == 0 ? 1 : bal);
            eq(ids.length, live, "SC10: tokensOfOwnerIn length != live mirror");
            for (uint256 j; j < ids.length; ++j) {
                t(_ownerOfOrZero(ids[j]) == who, "SC10: enumerated id is not owned by the actor");
                t(!burnedStreams[ids[j]], "SC10: enumerated a burned id");
            }
        }
    }

    function property_openLoan_streamCustody() public {
        ghosts.runId += 1;
        uint256 runId = ghosts.runId;
        for (uint256 i; i < openLoanIds.length; ++i) {
            (,,,,,, uint256 streamId,,,,,) = lending.loans(openLoanIds[i]);
            t(
                MockSablier(SABLIER_ADDR).ownerOf(streamId) == address(lending),
                "GL-08: an open loan's pledged stream is not owned by the market"
            );
            t(ghost_streamRunMark[streamId] != runId, "GL-08: two open loans share one pledged stream");
            ghost_streamRunMark[streamId] = runId;
        }
    }

    // ―― Liveness, donation resistance & access control ――

    /// @notice GL-09: the wrap reserve never exceeds the vault's raw underlying balance —
    ///         a donation can inflate the balance but never the reserve.
    function property_wrapReserve_le_balance() public {
        lte(
            vault.wrappedUnderlying(),
            underlying.balanceOf(address(vault)),
            "GL-09: wrap reserve exceeds the vault's underlying balance"
        );
    }

    /// @notice GL-10: no tracked position's `unfilled` ever grows after creation — fills
    ///         and withdrawals only shrink it, and a donation must not touch it at all
    ///         (`positionState` derives from tree state, never from balanceOf).
    function property_donation_no_position_inflation() public {
        for (uint256 i; i < positionIds.length; ++i) {
            uint256 positionId = positionIds[i];
            (,,, uint128 unfilled) = lending.positionState(positionId);
            if (ghost_unfilledSeen[positionId]) {
                lte(unfilled, ghost_lastUnfilled[positionId], "GL-10: a position's unfilled amount grew after creation");
            }
            ghost_lastUnfilled[positionId] = unfilled;
            ghost_unfilledSeen[positionId] = true;
        }
    }

    /// @notice GL-11: a donation cannot inflate any loan's `proceeds` pot: the pot never
    ///         exceeds the loan's recovered total, and the difference `(drawn + repaid) −
    ///         proceeds` — exactly the loan's cumulative claim payout — is monotone. A
    ///         balance-blind credit into `proceeds` would make that payout total fall.
    function property_donation_no_proceeds_inflation() public {
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            (,,,,,,,,,, uint128 drawn, uint128 repaid) = lending.loans(loanId);
            uint256 recovered = uint256(drawn) + uint256(repaid);
            uint256 pot = lending.proceeds(loanId);
            lte(pot, recovered, "GL-11: loan pot exceeds its recovered total (credited from thin air)");
            uint256 paid = recovered - pot;
            gte(paid, ghost_maxLoanPaid[loanId], "GL-11: per-loan payout total decreased (proceeds inflated)");
            ghost_maxLoanPaid[loanId] = paid;
        }
    }

    /// @notice GL-12: the cursor never strands a live epoch — every tape strictly below
    ///         its tick's `oldestLiveEpoch` fails the dead-epoch predicate (available
    ///         depth below MIN_LIQUIDITY). Sound as a standing state check because dead
    ///         epochs stay dead: supply only appends to `currentEpoch` and withdraw only
    ///         shrinks depth.
    function property_cursor_predicate() public {
        uint64 minUnits = uint64(lending.MIN_LIQUIDITY_AMOUNT() / lending.UNIT());
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            (uint32 oldest,) = lending.fizz_tickCursors(tape.market, tape.aprBps);
            if (tape.epoch < oldest) {
                (uint64 root, uint64 filled,,,,) = lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
                t(
                    root >= filled && root - filled < minUnits,
                    "GL-12: the epoch cursor skipped past a live epoch's liquidity"
                );
            }
        }
    }

    /// @notice GL-13: no lending admin surface yields to a non-owner. This tester
    ///         contract is the FACTORY admin but not the lending owner (the factory
    ///         contract is), so a direct call from here must revert with storage
    ///         untouched.
    function property_lending_admin_onlyOwner() public {
        uint16 feeBefore = lending.feeBps();
        uint16 minBefore = lending.aprMinBps();
        uint16 maxBefore = lending.aprMaxBps();
        address treasuryBefore = lending.treasury();

        try lending.setFee(feeBefore) {
            t(false, "GL-13: non-owner setFee succeeded");
        } catch {}
        try lending.setAprBounds(minBefore, maxBefore) {
            t(false, "GL-13: non-owner setAprBounds succeeded");
        } catch {}
        try lending.setTreasury(treasuryBefore) {
            t(false, "GL-13: non-owner setTreasury succeeded");
        } catch {}
        try lending.setTickSpacing(address(0xBEEF), 1) {
            t(false, "GL-13: non-owner setTickSpacing succeeded");
        } catch {}

        eq(lending.feeBps(), feeBefore, "GL-13: feeBps moved under a non-owner call");
        eq(lending.aprMinBps(), minBefore, "GL-13: aprMinBps moved under a non-owner call");
        eq(lending.aprMaxBps(), maxBefore, "GL-13: aprMaxBps moved under a non-owner call");
        t(lending.treasury() == treasuryBefore, "GL-13: treasury moved under a non-owner call");
        t(lending.tickSpacing(address(0xBEEF)) == 0, "GL-13: tickSpacing moved under a non-owner call");
    }

    /// @notice GL-14: no admin action (setAprBounds) or later market state retroactively
    ///         changes an already-originated loan's aprBps, interval, or obligation.
    /// @dev Shares the creation-time fingerprint machinery with GL-29: the fingerprint
    ///      hashes every non-servicing field, which includes exactly the rate-defining
    ///      trio this property pins.
    function property_fixedRate_frozen() public {
        _gl_assertLoanFingerprints("GL-14: an admin action moved a live loan's rate/interval/obligation");
    }

    // ―― Entity bookkeeping / slot existence ――

    /// @notice GL-15: `positions[id].lender != 0` exactly for `1 <= id < nextPositionId`
    ///         (ids start at 1); the count identity plus per-id checks make it exact.
    function property_position_slot_exists() public {
        uint256 next = lending.nextPositionId();
        eq(positionIds.length + 1, next, "GL-15: tracked position count disagrees with nextPositionId");
        (address lenderZero,,,,) = lending.positions(0);
        t(lenderZero == address(0), "GL-15: position id 0 is populated");
        (address lenderNext,,,,) = lending.positions(next);
        t(lenderNext == address(0), "GL-15: the slot at nextPositionId is already populated");
        for (uint256 i; i < positionIds.length; ++i) {
            (address lender,,,,) = lending.positions(positionIds[i]);
            t(lender != address(0), "GL-15: an allocated position has a zero lender");
        }
    }

    /// @notice GL-16: `loans[id].borrower != 0` exactly for `1 <= id < nextLoanId`.
    function property_loan_slot_exists() public {
        uint256 next = lending.nextLoanId();
        eq(loanIds.length + 1, next, "GL-16: tracked loan count disagrees with nextLoanId");
        (address borrowerZero,,,,,,,,,,,) = lending.loans(0);
        t(borrowerZero == address(0), "GL-16: loan id 0 is populated");
        (address borrowerNext,,,,,,,,,,,) = lending.loans(next);
        t(borrowerNext == address(0), "GL-16: the slot at nextLoanId is already populated");
        for (uint256 i; i < loanIds.length; ++i) {
            (address borrower,,,,,,,,,,,) = lending.loans(loanIds[i]);
            t(borrower != address(0), "GL-16: an allocated loan has a zero borrower");
        }
    }

    /// @notice GL-17: an unconfigured market (`tickSpacing == 0`) holds no position or
    ///         loan — `_validateTick` gates every write path.
    function property_unconfigured_market_empty() public {
        for (uint256 i; i < positionIds.length; ++i) {
            (, address m,,,) = lending.positions(positionIds[i]);
            t(lending.tickSpacing(m) != 0, "GL-17: a position exists on a market with unset tick spacing");
        }
        for (uint256 i; i < loanIds.length; ++i) {
            (,,,, address m,,,,,,,) = lending.loans(loanIds[i]);
            t(lending.tickSpacing(m) != 0, "GL-17: a loan exists on a market with unset tick spacing");
        }
    }

    /// @notice GL-18: `loanAt[market][aprBps][epoch][seq] != 0` exactly for
    ///         `seq < loanCount`, and the per-tape loan lists partition the tracked loans.
    function property_loanAt_soundness() public {
        uint256 total;
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            (,, uint64 loanCount,,,) = lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
            t(
                lending.loanAt(tape.market, tape.aprBps, tape.epoch, loanCount) == 0,
                "GL-18: the tick-epoch loan list has an entry at loanCount"
            );
            for (uint64 seq; seq < loanCount; ++seq) {
                t(
                    lending.loanAt(tape.market, tape.aprBps, tape.epoch, seq) != 0,
                    "GL-18: hole inside a tick-epoch loan list"
                );
            }
            total += loanCount;
        }
        eq(total, loanIds.length, "GL-18: tick-epoch loan lists do not partition the tracked loans");
    }

    /// @notice GL-19: `lenderPositionAt` / `borrowerLoanAt` are exactly (complete and
    ///         correct) each actor's entity sets: every listed entry belongs to that
    ///         actor, entries are strictly increasing (hence distinct), nothing sits past
    ///         the count, and the counts sum to the total entity count.
    function property_index_mirrors_exact() public {
        uint256 totalPositions;
        uint256 totalLoans;
        for (uint256 a; a < actors.length; ++a) {
            address who = actors[a];

            uint256 positionCount = lending.lenderPositionCount(who);
            uint256 prevId;
            for (uint256 i; i < positionCount; ++i) {
                uint256 positionId = lending.lenderPositionAt(who, i);
                t(positionId > prevId, "GL-19: lender position index not strictly increasing");
                (address lender,,,,) = lending.positions(positionId);
                t(lender == who, "GL-19: lender index points at someone else's position");
                prevId = positionId;
            }
            t(lending.lenderPositionAt(who, positionCount) == 0, "GL-19: lender index has an entry past its count");
            totalPositions += positionCount;

            uint256 loanCount = lending.borrowerLoanCount(who);
            prevId = 0;
            for (uint256 i; i < loanCount; ++i) {
                uint256 loanId = lending.borrowerLoanAt(who, i);
                t(loanId > prevId, "GL-19: borrower loan index not strictly increasing");
                (address borrower,,,,,,,,,,,) = lending.loans(loanId);
                t(borrower == who, "GL-19: borrower index points at someone else's loan");
                prevId = loanId;
            }
            t(lending.borrowerLoanAt(who, loanCount) == 0, "GL-19: borrower index has an entry past its count");
            totalLoans += loanCount;
        }
        eq(totalPositions, positionIds.length, "GL-19: lender indexes do not cover every tracked position");
        eq(totalLoans, loanIds.length, "GL-19: borrower indexes do not cover every tracked loan");
    }

    // ―― Monotonicity ――

    /// @notice GL-20: per-epoch `filled` never exceeds the tree root and never decreases.
    function property_epoch_filled_bounds() public {
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            bytes32 key = tapeKeyOf(tape.market, tape.aprBps, tape.epoch);
            (uint64 root, uint64 filled,,,,) = lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
            lte(filled, root, "GL-20: epoch filled exceeds its tree root");
            gte(filled, ghost_maxFilled[key], "GL-20: epoch filled decreased");
            ghost_maxFilled[key] = filled;
        }
    }

    /// @notice GL-21: the loan servicing accumulators (`drawn`, `repaid`) and the
    ///         per-pair `received` totals are non-decreasing. `received` is scanned
    ///         through a rotating one-position window over that position's own tape loan
    ///         list, so every pair that can ever be paid is eventually covered.
    function property_loan_accumulators_monotonic() public {
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            (,,,,,,,,,, uint128 drawn, uint128 repaid) = lending.loans(loanId);
            gte(drawn, ghost_maxDrawn[loanId], "GL-21: loan.drawn decreased");
            ghost_maxDrawn[loanId] = drawn;
            gte(repaid, ghost_maxRepaid[loanId], "GL-21: loan.repaid decreased");
            ghost_maxRepaid[loanId] = repaid;
        }

        uint256 n = positionIds.length;
        if (n == 0) return;
        uint256 positionId = positionIds[ghosts.receivedScanCursor % n];
        ghosts.receivedScanCursor += 1;
        (, address m, uint16 apr, uint32 ep,) = lending.positions(positionId);
        (,, uint64 loanCount,,,) = lending.fizz_epochState(m, apr, ep);
        for (uint64 seq; seq < loanCount; ++seq) {
            uint256 loanId = lending.loanAt(m, apr, ep, seq);
            uint128 pairReceived = lending.received(loanId, positionId);
            bytes32 pairKey = pairKeyOf(loanId, positionId);
            gte(pairReceived, ghost_maxReceived[pairKey], "GL-21: received[loan][position] decreased");
            ghost_maxReceived[pairKey] = pairReceived;
        }
    }

    /// @notice GL-22: the id counters never move backwards. (Strict per-allocation
    ///         increase is a handler-level fact; a sampled global property can only
    ///         assert the non-decreasing envelope without turning monotone into a
    ///         brittle equality.)
    function property_id_counters_increasing() public {
        uint256 nextPosition = lending.nextPositionId();
        gte(nextPosition, ghosts.maxNextPositionId, "GL-22: nextPositionId decreased");
        ghosts.maxNextPositionId = nextPosition;

        uint256 nextLoan = lending.nextLoanId();
        gte(nextLoan, ghosts.maxNextLoanId, "GL-22: nextLoanId decreased");
        ghosts.maxNextLoanId = nextLoan;
    }

    /// @notice GL-23: the structural counters — tree `leaves`, tree `height`, epoch
    ///         `loanCount` — are each non-decreasing.
    function property_tree_structural_counters() public {
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            bytes32 key = tapeKeyOf(tape.market, tape.aprBps, tape.epoch);
            (,, uint64 loanCount, uint32 leaves, uint8 height,) =
                lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
            gte(loanCount, ghost_maxLoanCount[key], "GL-23: epoch loanCount decreased");
            ghost_maxLoanCount[key] = loanCount;
            gte(leaves, ghost_maxLeaves[key], "GL-23: tree leaves decreased");
            ghost_maxLeaves[key] = leaves;
            gte(height, ghost_maxHeight[key], "GL-23: tree height decreased");
            ghost_maxHeight[key] = height;
        }
    }

    /// @notice GL-24: `currentEpoch` and `oldestLiveEpoch` are non-decreasing, and the
    ///         cursor never passes `currentEpoch` (which would DoS the tick forever).
    function property_epoch_cursor_monotonic() public {
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            bytes32 key = tickKeyOf(tape.market, tape.aprBps);
            (uint32 oldest, uint32 current) = lending.fizz_tickCursors(tape.market, tape.aprBps);
            lte(oldest, current, "GL-24: oldestLiveEpoch passed currentEpoch");
            gte(current, ghost_maxCurrentEpoch[key], "GL-24: currentEpoch decreased");
            ghost_maxCurrentEpoch[key] = current;
            gte(oldest, ghost_maxOldestEpoch[key], "GL-24: oldestLiveEpoch decreased");
            ghost_maxOldestEpoch[key] = oldest;
        }
    }

    /// @notice GL-25: a position's consumed prefix (`filledHistory`, derived from
    ///         `positionState` exactly as `withdraw` derives it) never decreases —
    ///         E-1's frozen-history lemma.
    function property_frozen_history_floor() public {
        uint256 unit = lending.UNIT();
        for (uint256 i; i < positionIds.length; ++i) {
            uint256 positionId = positionIds[i];
            (, uint64 start, uint64 end, uint128 unfilled) = lending.positionState(positionId);
            uint64 span = end - start;
            uint64 unfilledUnits = uint64(unfilled / unit);
            t(span >= unfilledUnits, "GL-25: a position's unfilled amount exceeds its own interval");
            uint64 filledHistory = span - unfilledUnits;
            gte(filledHistory, ghost_maxFilledHistory[positionId], "GL-25: position filled history decreased");
            ghost_maxFilledHistory[positionId] = filledHistory;
        }
    }

    // ―― State transitions ――

    /// @notice GL-26: `loan.closed` is a one-way latch — once the hook observed a
    ///         closure, the live flag never reads false again.
    function property_loan_closed_latch() public {
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            if (!ghost_everClosed[loanId]) continue;
            (,,, bool closed,,,,,,,,) = lending.loans(loanId);
            t(closed, "GL-26: a closed loan reopened (closed flipped true -> false)");
        }
    }

    /// @notice GL-27: once closed, `loan.drawn` is frozen at its closure value — `claim`
    ///         stays callable on a closed loan (it pays from the residual pot; that
    ///         asymmetry is INTENTIONAL and must not be "fixed") but must never harvest
    ///         the returned stream.
    function property_claim_not_gated_on_closed() public {
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            if (!ghost_everClosed[loanId]) continue;
            (,,,,,,,,,, uint128 drawn,) = lending.loans(loanId);
            eq(
                drawn,
                ghost_drawnAtClose[loanId],
                "GL-27: drawn moved after closure (a closed loan's stream was harvested)"
            );
        }
    }

    /// @notice GL-28: an epoch rolls over ONLY at terminal capacity and only one step at
    ///         a time: every epoch strictly below its tick's `currentEpoch` — including
    ///         `currentEpoch - 1`, which catches a skipped never-supplied epoch — must be
    ///         a MAX_HEIGHT tree with every leaf allocated.
    function property_epoch_advance_predicate() public {
        uint8 maxHeight = lending.fizz_maxTreeHeight();
        for (uint256 i; i < tapes.length; ++i) {
            Tape storage tape = tapes[i];
            (, uint32 current) = lending.fizz_tickCursors(tape.market, tape.aprBps);
            if (tape.epoch < current) {
                (,,,, uint8 height, bool atCap) = lending.fizz_epochState(tape.market, tape.aprBps, tape.epoch);
                t(height == maxHeight && atCap, "GL-28: an epoch rolled over before terminal capacity");
            }
            if (current > 0) {
                (,,,, uint8 prevHeight, bool prevAtCap) = lending.fizz_epochState(tape.market, tape.aprBps, current - 1);
                t(prevHeight == maxHeight && prevAtCap, "GL-28: currentEpoch advanced past a non-terminal epoch");
            }
        }
    }

    /// @notice GL-29: every `Loan` field except {closed, drawn, repaid} is identical at
    ///         every observation after creation — checked against the creation-time
    ///         fingerprint the hook recorded in the same transaction as the borrow.
    function property_loan_immutable_fields() public {
        _gl_assertLoanFingerprints("GL-29: an immutable loan field changed after creation");
    }

    /// @notice GL-30: the vault owns its ovrfloToken for the campaign's whole life.
    function property_ovrfloToken_owner_stable() public {
        t(ovrfloToken.owner() == address(vault), "GL-30: ovrfloToken ownership left the vault");
    }

    /// @notice GL-31: [GL-70 successor] a closed loan's `drawn` equals the pledged
    ///         stream's withdrawn delta over EXACTLY that loan's custody window,
    ///         `snapshotAtClose - snapshotAtCreation`, both recorded by the hook in the
    ///         same transaction as origination/closure (either closure path). NEVER a
    ///         live `getWithdrawnAmount` re-read: the counter is cumulative across uses
    ///         and a returned stream is immediately re-pledgeable, which is precisely
    ///         the pre-rewrite false positive this formulation buries.
    function property_gl70_successor_closeTimeDrawIsolation() public {
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            if (!ghost_everClosed[loanId]) continue;
            (,,,,,,,,,, uint128 drawn,) = lending.loans(loanId);
            uint128 atClose = ghost_loanWithdrawnAtClose[loanId];
            uint128 atCreate = ghost_loanWithdrawnAtCreate[loanId];
            gte(atClose, atCreate, "GL-31: close-time stream snapshot below the origination snapshot");
            eq(drawn, atClose - atCreate, "GL-31: closed loan's drawn != its own custody window's stream-draw delta");
        }
    }

    // ―― Shared global-property internals (prefixed _gl_) ――

    /// @dev GL-14 / GL-29 core: recompute each tracked loan's immutable-field hash from
    ///      the flattened getter, in the exact field order `Base._fingerprint` used at
    ///      creation, and compare against the hook-recorded creation-time value.
    function _gl_assertLoanFingerprints(string memory reason) internal {
        for (uint256 i; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[i];
            (
                address borrower,
                uint16 aprBps,
                uint32 epoch,,
                address m,
                uint64 seq,
                uint256 streamId,
                uint64 fillStart,
                uint64 fillEnd,
                uint128 obligation_,,
            ) = lending.loans(loanId);
            bytes32 fingerprint =
                keccak256(abi.encode(borrower, aprBps, epoch, m, seq, streamId, fillStart, fillEnd, obligation_));
            t(fingerprint == ghost_loanFingerprint[loanId], reason);
        }
    }

    // ――――――――――――――――――― Specific properties ――――――――――――――――――――
    // These properties must hold after specific function calls.
    // They MUST BE INTERNAL and called at the end of the relevant handlers.

    // Shared readers for the specific properties. They go through the FLATTENED public
    // getters (and skipped tuple components) on purpose: that keeps this file free of a
    // `OVRFLOLending` struct import, which the handlers already carry.

    /// @dev The loan fields the specific properties read, via the flattened `loans` getter.
    function _sp_loanFields(uint256 loanId)
        internal
        view
        returns (bool closed, uint64 fillStart, uint64 fillEnd, uint128 obligation_, uint128 drawn, uint128 repaid)
    {
        (,,, closed,,,, fillStart, fillEnd, obligation_, drawn, repaid) = lending.loans(loanId);
    }

    /// @dev The loan's tape coordinate, via the flattened `loans` getter.
    function _sp_loanTape(uint256 loanId)
        internal
        view
        returns (address borrower, address market_, uint16 aprBps, uint32 epoch, uint64 seq)
    {
        (borrower, aprBps, epoch,, market_, seq,,,,,,) = lending.loans(loanId);
    }

    /// @dev Hash of a position's STORED fields only. Stable across a withdraw, which may
    ///      shrink the leaf but must never rewrite the struct.
    function _sp_positionStructHash(uint256 positionId) internal view returns (bytes32) {
        (address lender, address market_, uint16 aprBps, uint32 epoch, uint32 leafIndex) = lending.positions(positionId);
        return keccak256(abi.encode(lender, market_, aprBps, epoch, leafIndex));
    }

    /// @dev Hash of a position's stored fields PLUS its derived tape interval. Stable across
    ///      `supply` (append-only) and `borrow` (epoch-slot writes only), neither of which may
    ///      move an existing coordinate. NOT stable across a withdraw, which compacts left.
    function _sp_positionFullHash(uint256 positionId) internal view returns (bytes32) {
        (, uint64 start, uint64 end,) = lending.positionState(positionId);
        return keccak256(abi.encode(_sp_positionStructHash(positionId), start, end));
    }

    /// @notice SP-01: supply -> withdraw with no intervening borrow refunds exactly the amount
    ///         supplied and leaves the tick's borrowable depth exactly where it started.
    function property_supplyWithdraw_exact(
        uint256 balanceBefore,
        uint256 balanceAfter,
        uint128 depthBefore,
        uint128 depthAfter
    ) internal {
        eq(balanceAfter, balanceBefore, "SP-01: supply->withdraw did not refund exactly the amount supplied");
        eq(depthAfter, depthBefore, "SP-01: supply->withdraw moved the tick's borrowable depth (filled changed)");
    }

    /// @notice SP-02: N repeated supply/withdraw cycles never drift the actor's underlying balance.
    /// @dev `gained`/`lost` are cumulative across every cycle the campaign has run, so an
    ///      off-by-one that only shows up after repeated leaf mutation cannot hide behind a
    ///      single exact round trip.
    function property_supplyWithdraw_noDrift(uint256 gained, uint256 lost, uint256 cycles) internal {
        t(cycles > 0, "SP-02: drift check ran without a completed supply/withdraw cycle");
        eq(gained, 0, "SP-02: repeated supply/withdraw cycles created underlying out of nothing");
        eq(lost, 0, "SP-02: repeated supply/withdraw cycles leaked the lender's underlying");
    }

    /// @notice SP-03: N repeated wrap/unwrap cycles never drift the actor's balances.
    function property_wrapUnwrap_noDrift(
        uint256 underlyingBefore,
        uint256 underlyingAfter,
        uint256 tokenBefore,
        uint256 tokenAfter,
        uint256 cycles
    ) internal {
        t(cycles > 0, "SP-03: drift check ran without a completed wrap/unwrap cycle");
        eq(underlyingAfter, underlyingBefore, "SP-03: wrap->unwrap drifted the actor's underlying balance");
        eq(tokenAfter, tokenBefore, "SP-03: wrap->unwrap drifted the actor's ovrfloToken balance");
    }

    /// @notice SP-04: previewDeposit's reported split AND fee are exactly what `deposit` applies
    ///         in the same block.
    function property_previewDeposit_matchesApplied(
        uint256 previewToUser,
        uint256 previewToStream,
        uint256 previewFee,
        uint256 actualToUser,
        uint256 actualToStream,
        uint256 actualFee
    ) internal {
        eq(previewToUser, actualToUser, "SP-04: previewDeposit's toUser is not what deposit minted");
        eq(previewToStream, actualToStream, "SP-04: previewDeposit's toStream is not what deposit streamed");
        eq(previewFee, actualFee, "SP-04: previewDeposit's fee is not what deposit charged");
    }

    /// @notice SP-05: a FULLY VESTED stream always covers its loan, so `close` never reverts
    ///         NotCovered there.
    /// @dev The gate is full vest (`withdrawable == deposited - withdrawn`), never
    ///      `withdrawable >= outstanding` — the latter would just re-state `close`'s own guard.
    ///      What is actually asserted is the behavioural form of `obligation <= remaining`: if
    ///      grossPrice's floor and obligation's ceil ever drift apart, the loan becomes
    ///      permanently unclosable and this fires.
    function property_freshLoan_alwaysClosable(bool notCoveredAtFullVest) internal {
        t(!notCoveredAtFullVest, "SP-05: close reverted NotCovered on a fully-vested stream (obligation > remaining)");
    }

    /// @notice SP-06: `targetBorrow == type(uint128).max` partial-fills instead of faulting.
    /// @dev The documented deliberate exception to the `_toUnits` conversion discipline. A
    ///      "cleanup" refactor reusing `_toUnits` here reintroduces a SafeCast narrowing revert,
    ///      which is exactly what `arithmeticFault` detects.
    function property_maxSentinel_partialFills(bool arithmeticFault) internal {
        t(!arithmeticFault, "SP-06: targetBorrow == type(uint128).max tripped an arithmetic/SafeCast fault");
    }

    /// @notice SP-07: obligation <= the stream's remaining face, observed black-box from Sablier
    ///         immediately before the fill.
    function property_obligation_le_remaining_atOrigination(uint128 obligation_, uint128 remainingBefore) internal {
        lte(obligation_, remainingBefore, "SP-07: loan obligation exceeded the pledged stream's remaining face");
    }

    /// @notice SP-08: on the exact fill boundary (`actualBorrow == grossPrice`) the obligation
    ///         equals `remaining` EXACTLY, not merely `<=`.
    function property_equalityFastPath_exact(uint128 obligation_, uint128 remainingAtOrigination) internal {
        eq(obligation_, remainingAtOrigination, "SP-08: actualBorrow landed on grossPrice but obligation != remaining");
    }

    /// @notice SP-09: once a loan is closed AND every contributing position is drained (checked,
    ///         not assumed), the residual pot is at most 1 wei per contributing position.
    function property_closedLoan_dustBounded(uint128 residualPot, uint256 contributors) internal {
        lte(residualPot, contributors, "SP-09: a closed, fully drained loan stranded more than 1 wei per contributor");
    }

    /// @notice SP-10: previewStream's reported split is exactly what `deposit` applies.
    function property_vaultPreview_matchesMoneyPath(
        uint256 previewToUser,
        uint256 previewToStream,
        uint256 actualToUser,
        uint256 actualToStream
    ) internal {
        eq(previewToUser, actualToUser, "SP-10: previewStream's toUser is not what deposit minted");
        eq(previewToStream, actualToStream, "SP-10: previewStream's toStream is not what deposit streamed");
    }

    /// @notice SP-11: repay reduces outstanding by precisely the repaid amount, with no
    ///         time-dependent discount however early it lands relative to seriesMaturity.
    function property_repay_faceValue_timeIndependent(uint256 loanId, uint128 outstandingBefore, uint128 amount)
        internal
    {
        (, uint128 outstandingAfter) = lending.loanState(loanId);
        eq(
            outstandingBefore - outstandingAfter,
            amount,
            "SP-11: repay moved outstanding by other than the repaid amount"
        );
    }

    /// @notice SP-12: supply allocates exactly one position id whose stored fields match the
    ///         call inputs, and appends exactly one lenderPositionAt entry at the pre-call index.
    function property_supply_postconditions(
        uint256 returnedId,
        uint256 nextPositionIdBefore,
        address expectedLender,
        address expectedMarket,
        uint16 expectedAprBps,
        uint128 amount,
        uint256 lenderCountBefore
    ) internal {
        eq(returnedId, nextPositionIdBefore, "SP-12: supply did not allocate the next position id");
        eq(lending.nextPositionId(), nextPositionIdBefore + 1, "SP-12: supply moved nextPositionId by other than 1");

        (address lender, address m, uint16 apr,,) = lending.positions(returnedId);
        t(lender == expectedLender, "SP-12: stored lender is not the caller");
        t(m == expectedMarket, "SP-12: stored market does not match the call input");
        eq(apr, expectedAprBps, "SP-12: stored aprBps does not match the call input");

        (, uint64 intervalStart, uint64 intervalEnd, uint128 unfilled) = lending.positionState(returnedId);
        eq(
            uint256(intervalEnd - intervalStart) * lending.UNIT(),
            amount,
            "SP-12: leaf size differs from the supplied amount"
        );
        eq(unfilled, amount, "SP-12: a fresh position is not fully unfilled");

        eq(
            lending.lenderPositionCount(expectedLender),
            lenderCountBefore + 1,
            "SP-12: lenderPositionCount moved by other than 1"
        );
        eq(
            lending.lenderPositionAt(expectedLender, lenderCountBefore),
            returnedId,
            "SP-12: lenderPositionAt was not appended at the pre-call index"
        );
    }

    /// @notice SP-13: withdraw refunds exactly the unfilled suffix, rewrites no struct field,
    ///         moves no sibling leaf, and a second withdraw with no intervening borrow reverts
    ///         NothingToWithdraw (no double refund).
    function property_withdraw_postconditions(
        uint256 positionId,
        bytes32 structHashBefore,
        uint128 unfilledBefore,
        uint256 refundReceived,
        bool siblingUntouched,
        bool secondWithdrawSucceeded,
        bool secondRevertWasNothingToWithdraw
    ) internal {
        t(
            _sp_positionStructHash(positionId) == structHashBefore,
            "SP-13: withdraw rewrote the position's stored struct"
        );
        eq(refundReceived, unfilledBefore, "SP-13: refund differs from the pre-call unfilled amount");
        (,,, uint128 unfilledAfter) = lending.positionState(positionId);
        eq(unfilledAfter, 0, "SP-13: position still reports unfilled liquidity after withdraw");
        t(siblingUntouched, "SP-13: withdraw moved a sibling position's leaf or struct");
        t(!secondWithdrawSucceeded, "SP-13: second withdraw with no intervening borrow succeeded (double refund)");
        t(secondRevertWasNothingToWithdraw, "SP-13: second withdraw reverted with an unexpected error");
    }

    /// @notice SP-14: borrow allocates the next loan id, newly populates the epoch's loan list
    ///         at the pre-call loanCount, appends one borrowerLoanAt entry, and escrows the
    ///         pledged stream with the lending contract.
    function property_borrow_postconditions(
        uint256 returnedLoanId,
        uint256 nextLoanIdBefore,
        address expectedBorrower,
        address expectedMarket,
        uint16 expectedAprBps,
        uint256 expectedStreamId,
        uint256 borrowerCountBefore,
        bool streamEscrowed
    ) internal {
        eq(returnedLoanId, nextLoanIdBefore, "SP-14: borrow did not allocate the next loan id");
        eq(lending.nextLoanId(), nextLoanIdBefore + 1, "SP-14: borrow moved nextLoanId by other than 1");

        {
            (address borrower, address m, uint16 apr,,) = _sp_loanTape(returnedLoanId);
            t(borrower == expectedBorrower, "SP-14: stored borrower is not the caller");
            t(m == expectedMarket, "SP-14: stored market does not match the call input");
            eq(apr, expectedAprBps, "SP-14: stored aprBps does not match the call input");
        }

        {
            (,,,,,, uint256 streamId,,,,,) = lending.loans(returnedLoanId);
            eq(streamId, expectedStreamId, "SP-14: stored streamId does not match the pledged stream");
            t(streamEscrowed, "SP-14: pledged stream is not owned by the lending contract after borrow");
        }

        {
            (, address m, uint16 apr, uint32 epoch, uint64 seq) = _sp_loanTape(returnedLoanId);
            eq(
                lending.loanAt(m, apr, epoch, seq),
                returnedLoanId,
                "SP-14: epoch loan list slot not populated with the loan"
            );
            (,, uint64 loanCount,,,) = lending.fizz_epochState(m, apr, epoch);
            eq(loanCount, uint256(seq) + 1, "SP-14: epoch loanCount is not seq + 1 after the fill");
        }

        eq(
            lending.borrowerLoanCount(expectedBorrower),
            borrowerCountBefore + 1,
            "SP-14: borrowerLoanCount moved by other than 1"
        );
        eq(
            lending.borrowerLoanAt(expectedBorrower, borrowerCountBefore),
            returnedLoanId,
            "SP-14: borrowerLoanAt was not appended at the pre-call index"
        );
    }

    /// @notice SP-15: close latches closed and returns the stream; on the documented legal
    ///         `outstanding == 0` state (reachable via a prior full harvest through `claim`)
    ///         it draws nothing, otherwise it draws exactly the outstanding.
    function property_close_zeroOutstanding(
        uint256 loanId,
        uint128 outstandingBefore,
        uint128 drawnBefore,
        bool streamReturnedToBorrower
    ) internal {
        (bool closed,,,, uint128 drawn,) = _sp_loanFields(loanId);
        t(closed, "SP-15: close returned without latching closed");
        t(streamReturnedToBorrower, "SP-15: close did not dispose the stream to the borrower");
        if (outstandingBefore == 0) {
            eq(drawn, drawnBefore, "SP-15: close of a zero-outstanding loan changed drawn");
        } else {
            eq(drawn, uint256(drawnBefore) + outstandingBefore, "SP-15: close drew other than the outstanding");
        }
    }

    /// @notice SP-16: repay adds exactly `amount` to repaid; a full repay latches closed AND
    ///         returns the stream in the same call; a partial repay leaves the loan open.
    function property_repay_postconditions(
        uint256 loanId,
        uint128 repaidBefore,
        uint128 amount,
        uint128 outstandingBefore,
        bool streamOwnedByBorrower
    ) internal {
        (bool closed,,,,, uint128 repaid) = _sp_loanFields(loanId);
        eq(repaid, uint256(repaidBefore) + amount, "SP-16: repay moved repaid by other than the amount");
        if (amount == outstandingBefore) {
            t(closed, "SP-16: full repay did not latch closed");
            t(streamOwnedByBorrower, "SP-16: full repay did not dispose the stream to the borrower");
        } else {
            t(!closed, "SP-16: partial repay latched closed");
        }
    }

    /// @notice SP-17: TickTree structural correctness. Supply path: append hands out the next
    ///         (never-reused) leaf index and grows `leaves` by exactly 1 — index 0 of a fresh
    ///         tree after an epoch rollover. Borrow path: the loan's fillStart equals the
    ///         epoch's pre-call `filled` and the post-call `filled` equals fillEnd. The
    ///         pre-call `filled` is only known when the fill landed on an epoch the handler
    ///         snapshotted (the pre-call cursor or current epoch — the dominant case); a fill
    ///         landing on a cursor-advanced middle epoch checks the post side only.
    function property_tickTree_structural(
        bool supplyPath,
        uint32 leafIndex,
        uint32 leavesBefore,
        uint32 leavesAfter,
        bool rolledEpoch,
        uint64 fillStart,
        uint64 fillEnd,
        uint64 filledAfter,
        bool preFilledKnown,
        uint64 preFilled
    ) internal {
        if (supplyPath) {
            if (rolledEpoch) {
                eq(leafIndex, 0, "SP-17: first append of a fresh epoch did not take leaf index 0");
                eq(leavesAfter, 1, "SP-17: fresh epoch's tree does not have exactly 1 leaf");
            } else {
                eq(leafIndex, leavesBefore, "SP-17: append reused or skipped a leaf index");
                eq(leavesAfter, uint256(leavesBefore) + 1, "SP-17: append grew leaves by other than 1");
            }
        } else {
            eq(filledAfter, fillEnd, "SP-17: epoch filled after borrow is not the loan's fillEnd");
            if (preFilledKnown) {
                eq(fillStart, preFilled, "SP-17: loan fillStart is not the epoch's pre-call filled");
            }
        }
    }

    /// @notice SP-18: a supply by one actor never touches another lender's index or positions.
    function property_supply_isolation(
        bool otherLenderSampled,
        uint256 otherCountBefore,
        uint256 otherCountAfter,
        bytes32 otherPositionHashBefore,
        bytes32 otherPositionHashAfter
    ) internal {
        if (!otherLenderSampled) return;
        eq(otherCountAfter, otherCountBefore, "SP-18: supply changed another lender's position count");
        t(otherPositionHashBefore == otherPositionHashAfter, "SP-18: supply moved another lender's position");
    }

    /// @notice SP-19: borrow mutates NO Position struct or coordinate — the architectural claim
    ///         the blind-fill design rests on (fill gas is flat in positions crossed precisely
    ///         because no position is written).
    function property_borrow_touchesNoPosition(bool sampled, bytes32 sampleHashBefore, bytes32 sampleHashAfter)
        internal
    {
        if (!sampled) return;
        t(sampleHashBefore == sampleHashAfter, "SP-19: borrow mutated a lender position");
    }

    /// @notice SP-20: over every position on the loan's exact (market, aprBps, epoch) tape,
    ///         contributions tile the loan's frozen fill interval exactly.
    function property_lazyAttribution_sumsToWhole(uint256 sumOverlapUnits, uint64 fillStart, uint64 fillEnd) internal {
        eq(
            sumOverlapUnits,
            uint256(fillEnd) - fillStart,
            "SP-20: position contributions do not tile the loan's fill interval"
        );
    }

    /// @notice SP-21: claim on a position with zero tape overlap with the loan (including a
    ///         numerically-identical interval from a DIFFERENT epoch) always reverts
    ///         NoOverlap/EpochMismatch and never pays out.
    function property_claim_zeroOverlap_reverts(bool paidOut, bool revertedWithOverlapError) internal {
        t(!paidOut, "SP-21: claim paid out on a position with no tape overlap");
        t(revertedWithOverlapError, "SP-21: zero-overlap claim reverted with an unexpected error");
    }

    /// @notice SP-22: no claim ordering across positions overlapping the same loan lets any one
    ///         claimer collect more than its pro-rata share of what can ever be recovered: the
    ///         recovery counters never exceed the obligation (the harvestCap
    ///         `min(withdrawable, outstanding)` clamp made observable — on an over-vested
    ///         stream a bare `withdrawable` harvest would push drawn past the obligation), and
    ///         the pair's cumulative payout never exceeds its pro-rata slice of the obligation.
    /// @dev Products stay far below 2^256: overlap is uint64, obligation uint128.
    function property_claim_orderIndependent_cap(uint256 loanId, uint256 positionId, uint64 overlapUnits) internal {
        (, uint64 fillStart, uint64 fillEnd, uint128 obligation_, uint128 drawn, uint128 repaid) =
            _sp_loanFields(loanId);
        lte(uint256(drawn) + repaid, obligation_, "SP-22: recovered (drawn + repaid) exceeds the loan obligation");
        uint256 cap = (uint256(overlapUnits) * obligation_) / (fillEnd - fillStart);
        lte(
            lending.received(loanId, positionId),
            cap,
            "SP-22: pair received more than its pro-rata share of the obligation"
        );
    }

    /// @notice SP-23: a successful borrow's realized proceeds are never below the caller's own
    ///         `minAcceptable` floor. The handler passes the actor's realized underlying gain,
    ///         which equals net proceeds (actualBorrow - fee) exactly unless the actor is also
    ///         the fee treasury — where the gain additionally contains the fee, which only
    ///         widens the left side, keeping the check sound (conservative) either way.
    function property_belowMinAcceptable_neverBypassed(uint256 realizedGain, uint128 minAcceptable) internal {
        gte(realizedGain, minAcceptable, "SP-23: borrow succeeded with net proceeds below minAcceptable");
    }

    /// @notice SP-24: a withdraw landing immediately before another actor's borrow can at worst
    ///         cause that borrow to revert cleanly on the thinned tick — the victim loses only
    ///         gas: no balance moves and the pledged stream stays with its owner.
    function property_withdrawBeforeBorrow_cleanRevert(
        uint256 victimUnderlyingBefore,
        uint256 victimUnderlyingAfter,
        bool victimStillOwnsStream
    ) internal {
        eq(victimUnderlyingAfter, victimUnderlyingBefore, "SP-24: griefed borrow revert moved the victim's underlying");
        t(victimStillOwnsStream, "SP-24: griefed borrow revert did not leave the stream with the victim");
    }

    /// @notice SP-25: a position claiming both before AND after a close() on the same loan never
    ///         receives, summed across both claims, more than its pro-rata share of the FINAL
    ///         drawn + repaid. Asserted whenever the loan is observed closed: `received` is a
    ///         running total, so the bound covers every earlier pre-close claim by the pair too.
    function property_claimAcrossClose_boundedByFinal(uint256 loanId, uint256 positionId, uint64 overlapUnits)
        internal
    {
        (bool closed, uint64 fillStart, uint64 fillEnd,, uint128 drawn, uint128 repaid) = _sp_loanFields(loanId);
        if (!closed) return;
        uint256 cap = (uint256(overlapUnits) * (uint256(drawn) + repaid)) / (fillEnd - fillStart);
        lte(lending.received(loanId, positionId), cap, "SP-25: pair received more than its share of the final recovery");
    }

    // ―――― SP-26: property_noFreeProfit_lendingChain — TODO stub, marked [-] in PROPERTIES.md ――――
    // EXPLORATORY / LOW. A sound single-actor "no free profit" bound is not writable without
    // full cross-actor flow attribution: a lender legitimately realizes value that originated
    // in ANOTHER actor's pledged stream (claim payouts), and a borrower legitimately swaps
    // future face value for discounted principal now, so one actor's realized balances can rise
    // above `ghost_actorStartValue` through entirely legitimate flows. Any assertion tight
    // enough to catch a real lending-chain profit leak would need to re-derive the whole
    // conservation lane per-actor; system-level no-free-value is already covered by
    // GL-01..GL-06 (pot, escrow, flow and supply conservation). Left as a spec note rather
    // than an unsound assertion; `ghost_actorStartValue` in Base.sol stays reserved for a
    // future sound formulation.
}
