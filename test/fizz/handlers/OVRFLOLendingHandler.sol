// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {OVRFLOLending} from "../../../src/OVRFLOLending.sol";
import {MockSablier} from "../mocks/MockSablier.sol";

/// @notice Handles the interaction with OVRFLOLending
/// @dev Ghost-accounting hooks: Base.sol's `asActor` modifier runs the
///      `_beforeHandlerCall`/`_afterHandlerCall` pair (with a depth guard) around every
///      actor handler — handlers must NOT call the hooks directly, or a composed handler
///      would double-count. Specific properties (SP-*) are called at the end of the
///      handler they belong to, after the state change they check; pre-state is captured
///      locally in the handler rather than through the global snapshot machinery, because
///      it is entity-keyed (position/loan ids) rather than actor-keyed.
abstract contract OVRFLOLendingHandler is Properties {
    /// @dev `Panic(uint256)` selector, for SP-06's arithmetic-fault detection.
    bytes4 internal constant PANIC_SELECTOR = 0x4e487b71;
    /// @dev `Error(string)` selector, for SP-06's SafeCast-require detection (OZ v4
    ///      SafeCast reverts with a require string, not a panic).
    bytes4 internal constant ERROR_SELECTOR = 0x08c379a0;

    // ―― Ghosts owned by this handler's specific properties ――
    /// @dev SP-02: cumulative supply→withdraw round-trip drift across the whole campaign,
    ///      so an accumulation bug cannot hide behind a single exact round trip.
    uint256 internal spRoundTripCycles;
    uint256 internal spRoundTripGained;
    uint256 internal spRoundTripLost;
    /// @dev SP-20/SP-09 pacing: the O(positions) tape scan runs every Nth claim only.
    uint256 internal spClaimCount;
    uint256 internal constant SP_SCAN_EVERY = 8;
    /// @dev SP-20/SP-09 cost bound: skip the tape scan once the campaign has more
    ///      positions than this (the scan is O(positions) with ~2 view calls each).
    uint256 internal constant SP_SCAN_POSITION_BOUND = 400;

    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    /// @dev amount MUST be an exact multiple of UNIT and >= MIN_LIQUIDITY_AMOUNT.
    function lending_supply_clamped(uint256 aprSeed, uint256 amountSeed) public {
        uint128 minLiquidity = lending.MIN_LIQUIDITY_AMOUNT();
        uint256 balance = underlying.balanceOf(actor);
        if (balance < minLiquidity) return;

        uint256 unit = lending.UNIT();
        uint256 cap = balance < 1_000e18 ? balance : 1_000e18;
        if (cap < minLiquidity) return;

        // forge-lint: disable-next-line(divide-before-multiply) — flooring to a UNIT multiple is the point.
        uint256 amount = (clampBetween(amountSeed, minLiquidity, cap) / unit) * unit;
        if (amount < minLiquidity) return;

        uint16 aprBps = validTick(aprSeed);
        lending_supply(market, aprBps, uint128(amount));
    }

    /// @dev Withdraws from a position actually owned by the current actor.
    function lending_withdraw_clamped(uint256 seed) public {
        (uint256 positionId, bool found) = _actorPosition(actor, seed);
        if (!found) return;
        lending_withdraw(positionId);
    }

    /// @dev Pledges a stream the actor currently owns (i.e. not already backing an
    ///      open loan). targetBorrow spans partial and full fills; the contract's own
    ///      min(target, available, price) sizing does the rest. `minAcceptable` is
    ///      usually 0, but is occasionally fuzzed to reach BelowMinAcceptable.
    function lending_borrow_clamped(
        uint256 aprSeed,
        uint256 targetSeed,
        uint256 streamSeed,
        bool useMinAcceptable,
        uint256 minAcceptableSeed
    ) public {
        (uint256 streamId, bool found) = _actorStream(actor, streamSeed);
        if (!found) return;

        uint16 aprBps = validTick(aprSeed);
        uint128 targetBorrow = uint128(clampBetween(targetSeed, lending.MIN_LIQUIDITY_AMOUNT(), 1_000e18));
        uint128 minAcceptable = useMinAcceptable ? uint128(clampBetween(minAcceptableSeed, 0, 1_000e18)) : 0;

        lending_borrow(market, aprBps, targetBorrow, streamId, minAcceptable);
    }

    /// @dev SP-06: the documented max-borrow sentinel (`targetBorrow == type(uint128).max`)
    ///      must partial-fill, never arithmetic-fault. `_toUnits(type(uint128).max)` would
    ///      overflow SafeCast.toUint64; the inlined `/ UNIT` at OVRFLOLending.sol:1070
    ///      avoids that, and a "cleanup" refactor reintroducing `_toUnits` is exactly what
    ///      the fault detection below catches. Legitimate custom-error reverts (EmptyTick,
    ///      BelowMinimum, eligibility gates, EpochBacklog) pass through unflagged.
    function lending_borrow_maxSentinel(uint256 aprSeed, uint256 streamSeed) public {
        (uint256 streamId, bool found) = _actorStream(actor, streamSeed);
        if (!found) return;
        uint16 aprBps = validTick(aprSeed);

        try this.lending_borrow(market, aprBps, type(uint128).max, streamId, 0) {
            property_maxSentinel_partialFills(false); // SP-06: filled without faulting
        } catch (bytes memory err) {
            bool fault;
            bytes4 sel = _errSelector(err);
            if (sel == PANIC_SELECTOR) {
                // Panic(0x01) is an inner property assertion — re-raise it instead of
                // relabeling it as an arithmetic fault. Any other panic code is a fault.
                uint256 code = _panicCode(err);
                if (code == 0x01) assert(false);
                fault = true;
            } else if (sel == ERROR_SELECTOR) {
                fault = _isSafeCastError(err);
            }
            property_maxSentinel_partialFills(fault); // SP-06
        }
    }

    /// @dev SP-24: the withdraw-then-borrow griefing race. The griefer (another position's
    ///      owner) withdraws immediately before the victim's borrow lands. Both legs run
    ///      through the instrumented `asActor` handlers — the griefer leg by temporarily
    ///      rotating `actor`, so the hook accounting stays truthful. If the thinned borrow
    ///      reverts, the victim must have lost nothing but gas.
    function scenario_withdrawThenBorrow(uint256 griefSeed, uint256 aprSeed, uint256 targetSeed, uint256 streamSeed)
        public
    {
        (uint256 streamId, bool found) = _actorStream(actor, streamSeed);
        if (!found) return;

        // Pick any tracked position with unfilled liquidity as the griefer's weapon.
        if (positionIds.length == 0) return;
        uint256 griefPositionId = positionIds[griefSeed % positionIds.length];
        (address griefer,,,,) = lending.positions(griefPositionId);
        if (griefer == address(0)) return;
        (,,, uint128 unfilled) = lending.positionState(griefPositionId);
        if (unfilled == 0) return;

        address victim = actor;
        uint16 aprBps = validTick(aprSeed);
        uint128 targetBorrow = uint128(clampBetween(targetSeed, lending.MIN_LIQUIDITY_AMOUNT(), 1_000e18));

        // Griefer leg: withdraw as the position's owner, through the instrumented handler.
        if (griefer != victim) {
            actor = griefer;
            lending_withdraw(griefPositionId);
            actor = victim;
        } else {
            lending_withdraw(griefPositionId);
        }

        // Victim leg: the borrow lands on the thinned tick.
        uint256 balanceBefore = underlying.balanceOf(victim);
        try this.lending_borrow(market, aprBps, targetBorrow, streamId, 0) {
        // Fill still succeeded on the thinned tick — nothing to assert.
        }
        catch (bytes memory err) {
            if (_errSelector(err) == PANIC_SELECTOR && _panicCode(err) == 0x01) assert(false); // inner assertion
            bool ownsStream = MockSablier(SABLIER_ADDR).ownerOf(streamId) == victim;
            property_withdrawBeforeBorrow_cleanRevert(balanceBefore, underlying.balanceOf(victim), ownsStream); // SP-24
        }
    }

    /// @dev Repays against a real loan, clamped to its live outstanding and the actor's
    ///      ovrfloToken balance. Repay is permissionless, so any tracked loan qualifies.
    function lending_repay_clamped(uint256 loanSeed, uint256 amountSeed) public {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];

        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        if (loan.closed || outstanding == 0) return;

        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance == 0) return;

        uint256 cap = outstanding < balance ? outstanding : balance;
        uint128 amount = uint128(clampBetween(amountSeed, 1, cap));
        lending_repay(loanId, amount);
    }

    /// @dev Fully repays a real loan using the actor's full outstanding-capped balance,
    ///      the boundary case that closes the loan and returns the stream in one call.
    function lending_repay_full_clamped(uint256 loanSeed) public {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];

        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        if (loan.closed || outstanding == 0) return;

        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance < outstanding) return;

        lending_repay(loanId, outstanding);
    }

    /// @dev Closes a real loan. `advanceTime` optionally skips to the pledged stream's
    ///      end so its withdrawable accrual covers the outstanding — without this,
    ///      `close` almost always reverts NotCovered because nothing has vested yet.
    ///      SP-05 rides the fully-vested case: past the stream's end time the whole
    ///      remaining face is withdrawable, so `close` reverting NotCovered there means
    ///      grossPrice's floor and obligation's ceil have drifted apart and the loan is
    ///      permanently unclosable.
    function lending_close_clamped(uint256 loanSeed, bool advanceTime) public {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];

        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        if (loan.closed) return;

        MockSablier sablierMock = MockSablier(SABLIER_ADDR);
        if (advanceTime && outstanding > 0) {
            uint40 endTime = sablierMock.getEndTime(loan.streamId);
            if (endTime > block.timestamp) skipTime(uint256(endTime) - block.timestamp + 1);
        }

        if (block.timestamp >= sablierMock.getEndTime(loan.streamId)) {
            try this.lending_close(loanId) {
            // Closed fine — the fully-vested stream covered the loan, as required.
            }
            catch (bytes memory err) {
                bytes4 sel = _errSelector(err);
                if (sel == PANIC_SELECTOR) assert(false); // bubble an inner assertion/panic
                property_freshLoan_alwaysClosable(sel == OVRFLOLending.NotCovered.selector); // SP-05
            }
            return;
        }

        lending_close(loanId);
    }

    /// @dev Claims against a loan discovered to actually overlap the actor's position
    ///      via `loansOf` — the intended discovery path. Picking a random loanId here
    ///      would almost always hit EpochMismatch/NotLender and never cover the payout
    ///      math.
    function lending_claim_clamped(uint256 positionSeed, uint256 loanPickSeed, bool claimMax, uint256 amountSeed)
        public
    {
        (uint256 positionId, bool found) = _actorPosition(actor, positionSeed);
        if (!found) return;

        (OVRFLOLending.LoanShare[] memory shares,) = lending.loansOf(positionId, 0, 10);
        if (shares.length == 0) return;

        uint256 loanId = shares[loanPickSeed % shares.length].loanId;
        uint128 amount = claimMax ? type(uint128).max : uint128(clampBetween(amountSeed, 1, type(uint128).max));

        lending_claim(loanId, positionId, amount);
    }

    function lending_advanceEpochCursor_clamped(uint256 aprSeed, uint256 maxStepsSeed) public {
        uint16 aprBps = validTick(aprSeed);
        uint32 maxSteps = uint32(clampBetween(maxStepsSeed, 1, 64));
        lending_advanceEpochCursor(market, aprBps, maxSteps);
    }

    // ―――――――――――――――――― Round-trip / scenario handlers ――――――――――――――――――

    /// @dev SP-01/SP-02: atomic supply → withdraw round trip. Both legs run through the
    ///      instrumented `asActor` handlers, so each leg fires its own postconditions and
    ///      hook accounting; the round-trip identity is asserted across the pair.
    function roundTrip_supplyWithdraw(uint256 aprSeed, uint256 amountSeed) public {
        uint128 minLiquidity = lending.MIN_LIQUIDITY_AMOUNT();
        uint256 balance = underlying.balanceOf(actor);
        if (balance < minLiquidity) return;
        uint256 unit = lending.UNIT();
        uint256 cap = balance < 1_000e18 ? balance : 1_000e18;
        // forge-lint: disable-next-line(divide-before-multiply) — flooring to a UNIT multiple is the point.
        uint256 amount = (clampBetween(amountSeed, minLiquidity, cap) / unit) * unit;
        if (amount < minLiquidity) return;
        uint16 aprBps = validTick(aprSeed);

        snapshotBefore();
        lending_supply(market, aprBps, uint128(amount));
        uint256 positionId = positionIds[positionIds.length - 1];
        (,,, uint32 epoch,) = lending.positions(positionId);
        (, uint64 filledMid,,,,) = lending.fizz_epochState(market, aprBps, epoch);

        lending_withdraw(positionId);
        snapshotAfter();

        (, uint64 filledAfter,,,,) = lending.fizz_epochState(market, aprBps, epoch);
        property_supplyWithdraw_exact(
            stateBefore.actorUnderlyingBalance, stateAfter.actorUnderlyingBalance, filledMid, filledAfter
        ); // SP-01

        if (stateAfter.actorUnderlyingBalance > stateBefore.actorUnderlyingBalance) {
            spRoundTripGained += stateAfter.actorUnderlyingBalance - stateBefore.actorUnderlyingBalance;
        }
        if (stateBefore.actorUnderlyingBalance > stateAfter.actorUnderlyingBalance) {
            spRoundTripLost += stateBefore.actorUnderlyingBalance - stateAfter.actorUnderlyingBalance;
        }
        spRoundTripCycles += 1;
        property_supplyWithdraw_noDrift(spRoundTripGained, spRoundTripLost, spRoundTripCycles); // SP-02
    }

    /// @dev Bare-donation handler (property-plan `fizz_donate`): sends tokens straight to
    ///      the lending contract, bypassing supply/repay. No specific property — the
    ///      global donation-resistance lane (GL-10/GL-11) and the hook's donation
    ///      classification consume the resulting state. Runs `asActor` so the hook pair
    ///      observes and classifies the transfer.
    function lending_donate(bool donateOvrflo, uint256 amountSeed) public asActor {
        if (donateOvrflo) {
            uint256 balance = ovrfloToken.balanceOf(actor);
            if (balance == 0) return;
            require(ovrfloToken.transfer(address(lending), clampBetween(amountSeed, 1, balance)), "donate failed");
        } else {
            uint256 balance = underlying.balanceOf(actor);
            if (balance == 0) return;
            require(underlying.transfer(address(lending), clampBetween(amountSeed, 1, balance)), "donate failed");
        }
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    /// @dev Locals for `lending_supply`'s pre-state, packed to stay off the stack.
    struct SupplySnap {
        uint256 nextIdBefore;
        uint256 lenderCountBefore;
        uint32 currentEpochBefore;
        uint32 leavesBefore;
        bool otherSampled;
        address otherLender;
        uint256 otherPositionId;
        uint256 otherCountBefore;
        bytes32 otherHashBefore;
    }

    function lending_supply(address _market, uint16 aprBps, uint128 amount) public asActor {
        SupplySnap memory snap;
        snap.nextIdBefore = lending.nextPositionId();
        snap.lenderCountBefore = lending.lenderPositionCount(actor);
        (, snap.currentEpochBefore) = lending.fizz_tickCursors(_market, aprBps);
        (,,, snap.leavesBefore,,) = lending.fizz_epochState(_market, aprBps, snap.currentEpochBefore);
        (snap.otherSampled, snap.otherLender, snap.otherPositionId, snap.otherCountBefore, snap.otherHashBefore) =
            _sampleOtherLender();

        uint256 positionId = lending.supply(_market, aprBps, amount);
        positionIds.push(positionId);

        property_supply_postconditions(
            positionId, snap.nextIdBefore, actor, _market, aprBps, amount, snap.lenderCountBefore
        ); // SP-12

        (,,, uint32 storedEpoch, uint32 leafIndex) = lending.positions(positionId);
        (,,, uint32 leavesAfter,,) = lending.fizz_epochState(_market, aprBps, storedEpoch);
        property_tickTree_structural(
            true, leafIndex, snap.leavesBefore, leavesAfter, storedEpoch != snap.currentEpochBefore, 0, 0, 0, false, 0
        ); // SP-17 (append half)

        if (snap.otherSampled) {
            property_supply_isolation(
                true,
                snap.otherCountBefore,
                lending.lenderPositionCount(snap.otherLender),
                snap.otherHashBefore,
                _sp_positionFullHash(snap.otherPositionId)
            ); // SP-18
        }
    }

    function lending_withdraw(uint256 positionId) public asActor {
        // Instrument only ids that exist and belong to the current actor — anything else
        // reverts inside `withdraw` and discards the whole call anyway.
        (address positionLender,,,,) = lending.positions(positionId);
        bool instrumented = positionLender == actor;

        bytes32 structHashBefore;
        uint128 unfilledBefore;
        uint256 balanceBefore;
        bool siblingSampled;
        uint256 siblingId;
        bytes32 siblingSigBefore;
        if (instrumented) {
            structHashBefore = _sp_positionStructHash(positionId);
            (,,, unfilledBefore) = lending.positionState(positionId);
            balanceBefore = underlying.balanceOf(actor);
            (siblingSampled, siblingId) = _sampleSibling(positionId);
            if (siblingSampled) siblingSigBefore = _siblingSig(siblingId);
        }

        lending.withdraw(positionId);

        if (!instrumented) return;

        uint256 refund = underlying.balanceOf(actor) - balanceBefore;
        bool siblingUntouched = !siblingSampled || _siblingSig(siblingId) == siblingSigBefore;

        // A second withdraw with no intervening borrow must revert NothingToWithdraw.
        bool secondSucceeded;
        bool secondRevertExpected;
        try lending.withdraw(positionId) {
            secondSucceeded = true;
        } catch (bytes memory err) {
            secondRevertExpected = _errSelector(err) == OVRFLOLending.NothingToWithdraw.selector;
        }

        property_withdraw_postconditions(
            positionId,
            structHashBefore,
            unfilledBefore,
            refund,
            siblingUntouched,
            secondSucceeded,
            secondRevertExpected
        ); // SP-13
    }

    /// @dev Locals for `lending_borrow`'s pre-state, packed to stay off the stack.
    struct BorrowSnap {
        uint128 remainingBefore;
        uint256 balanceBefore;
        uint256 nextLoanIdBefore;
        uint256 borrowerCountBefore;
        uint32 oldestBefore;
        uint32 currentBefore;
        uint64 filledOldestBefore;
        uint64 filledCurrentBefore;
        bool positionsSampled;
        bytes32 positionsHashBefore;
    }

    function lending_borrow(
        address _market,
        uint16 aprBps,
        uint128 targetBorrow,
        uint256 streamId,
        uint128 minAcceptable
    ) public asActor {
        BorrowSnap memory snap;
        {
            MockSablier sablierMock = MockSablier(SABLIER_ADDR);
            uint128 deposited = sablierMock.getDepositedAmount(streamId);
            uint128 withdrawn = sablierMock.getWithdrawnAmount(streamId);
            snap.remainingBefore = deposited > withdrawn ? deposited - withdrawn : 0;
        }
        snap.balanceBefore = underlying.balanceOf(actor);
        snap.nextLoanIdBefore = lending.nextLoanId();
        snap.borrowerCountBefore = lending.borrowerLoanCount(actor);
        (snap.oldestBefore, snap.currentBefore) = lending.fizz_tickCursors(_market, aprBps);
        (, snap.filledOldestBefore,,,,) = lending.fizz_epochState(_market, aprBps, snap.oldestBefore);
        (, snap.filledCurrentBefore,,,,) = lending.fizz_epochState(_market, aprBps, snap.currentBefore);
        (snap.positionsSampled, snap.positionsHashBefore) = _samplePositionsHash();

        uint256 loanId = lending.borrow(_market, aprBps, targetBorrow, streamId, minAcceptable);
        loanIds.push(loanId);

        {
            (,,, uint128 obligation_,,) = _sp_loanFields(loanId);
            property_obligation_le_remaining_atOrigination(obligation_, snap.remainingBefore); // SP-07
        }

        {
            bool escrowed = MockSablier(SABLIER_ADDR).ownerOf(streamId) == address(lending);
            property_borrow_postconditions(
                loanId, snap.nextLoanIdBefore, actor, _market, aprBps, streamId, snap.borrowerCountBefore, escrowed
            ); // SP-14
        }

        {
            (,,, uint32 loanEpoch,) = _sp_loanTape(loanId);
            (, uint64 filledAfter,,,,) = lending.fizz_epochState(_market, aprBps, loanEpoch);
            bool preFilledKnown;
            uint64 preFilled;
            if (loanEpoch == snap.oldestBefore) {
                preFilledKnown = true;
                preFilled = snap.filledOldestBefore;
            } else if (loanEpoch == snap.currentBefore) {
                preFilledKnown = true;
                preFilled = snap.filledCurrentBefore;
            }
            (, uint64 fillStart, uint64 fillEnd,,,) = _sp_loanFields(loanId);
            property_tickTree_structural(
                false, 0, 0, 0, false, fillStart, fillEnd, filledAfter, preFilledKnown, preFilled
            ); // SP-17 (fill half)
        }

        if (snap.positionsSampled) {
            (, bytes32 positionsHashAfter) = _samplePositionsHash();
            property_borrow_touchesNoPosition(true, snap.positionsHashBefore, positionsHashAfter); // SP-19
        }

        property_belowMinAcceptable_neverBypassed(underlying.balanceOf(actor) - snap.balanceBefore, minAcceptable); // SP-23
    }

    function lending_repay(uint256 loanId, uint128 amount) public asActor {
        (address borrowerBefore,,,,) = _sp_loanTape(loanId);
        bool instrumented = borrowerBefore != address(0);

        uint128 outstandingBefore;
        uint128 repaidBefore;
        uint256 pledgedStreamId;
        if (instrumented) {
            (,,,,, repaidBefore) = _sp_loanFields(loanId);
            (, outstandingBefore) = lending.loanState(loanId);
            (,,,,,, pledgedStreamId,,,,,) = lending.loans(loanId);
        }

        lending.repay(loanId, amount);

        if (!instrumented) return;
        property_repay_faceValue_timeIndependent(loanId, outstandingBefore, amount); // SP-11
        property_repay_postconditions(
            loanId, repaidBefore, amount, outstandingBefore, _streamDisposedToBorrower(pledgedStreamId, borrowerBefore)
        ); // SP-16
    }

    function lending_close(uint256 loanId) public asActor {
        (address borrowerBefore,,,,) = _sp_loanTape(loanId);
        bool instrumented = borrowerBefore != address(0);

        uint128 outstandingBefore;
        uint128 drawnBefore;
        uint256 pledgedStreamId;
        if (instrumented) {
            (,,,, drawnBefore,) = _sp_loanFields(loanId);
            (, outstandingBefore) = lending.loanState(loanId);
            (,,,,,, pledgedStreamId,,,,,) = lending.loans(loanId);
        }

        lending.close(loanId);

        if (!instrumented) return;
        property_close_zeroOutstanding(
            loanId, outstandingBefore, drawnBefore, _streamDisposedToBorrower(pledgedStreamId, borrowerBefore)
        ); // SP-15
    }

    function lending_claim(uint256 loanId, uint256 positionId, uint128 amount) public asActor {
        (bool pairValid, uint64 overlapUnits) = _pairOverlap(loanId, positionId);

        lending.claim(loanId, positionId, amount);

        if (!pairValid) return;
        property_claim_orderIndependent_cap(loanId, positionId, overlapUnits); // SP-22
        property_claimAcrossClose_boundedByFinal(loanId, positionId, overlapUnits); // SP-25

        _spClaimTapeScan(loanId); // SP-20 + SP-09, reduced frequency
        _spZeroOverlapProbe(loanId); // SP-21, opportunistic
    }

    function lending_advanceEpochCursor(address _market, uint16 aprBps, uint32 maxSteps) public asActor {
        lending.advanceEpochCursor(_market, aprBps, maxSteps);
    }

    // ―――――――――――――――――――――― Wiring internals ――――――――――――――――――――――

    /// @dev First 4 bytes of a revert payload, or zero when it is too short to carry one.
    function _errSelector(bytes memory err) internal pure returns (bytes4 sel) {
        if (err.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(err, 0x20))
        }
    }

    /// @dev The code word of a `Panic(uint256)` payload (0 when malformed).
    function _panicCode(bytes memory err) internal pure returns (uint256 code) {
        if (err.length < 36) return 0;
        assembly {
            code := mload(add(err, 0x24))
        }
    }

    /// @dev True for an `Error(string)` payload whose message starts with "SafeCast" —
    ///      OZ v4 SafeCast reverts with require strings, which SP-06 must treat as an
    ///      arithmetic fault. Payload layout: selector, string offset, length, data.
    function _isSafeCastError(bytes memory err) internal pure returns (bool) {
        if (err.length < 4 + 32 + 32 + 8) return false;
        bytes32 firstWord;
        assembly {
            firstWord := mload(add(err, 0x64))
        }
        return bytes8(firstWord) == bytes8("SafeCast");
    }

    /// @dev Picks another actor with at least one position, for SP-18's isolation check.
    function _sampleOtherLender()
        internal
        view
        returns (bool sampled, address otherLender, uint256 otherPositionId, uint256 countBefore, bytes32 hashBefore)
    {
        for (uint256 i; i < actors.length; ++i) {
            address candidate = actors[i];
            if (candidate == actor) continue;
            uint256 count = lending.lenderPositionCount(candidate);
            if (count == 0) continue;
            otherPositionId = lending.lenderPositionAt(candidate, count - 1);
            return (true, candidate, otherPositionId, count, _sp_positionFullHash(otherPositionId));
        }
    }

    /// @dev Sibling signature for SP-13: the stored struct plus the leaf's SIZE (end - start).
    ///      Withdrawing an earlier position legitimately compacts later siblings left (their
    ///      interval start moves), but must never change a sibling's leaf size or struct.
    function _siblingSig(uint256 positionId) internal view returns (bytes32) {
        (, uint64 start, uint64 end,) = lending.positionState(positionId);
        return keccak256(abi.encode(_sp_positionStructHash(positionId), end - start));
    }

    /// @dev Finds another position on the same tape, scanning recent ids (bounded).
    function _sampleSibling(uint256 positionId) internal view returns (bool found, uint256 siblingId) {
        (, address m, uint16 apr, uint32 epoch,) = lending.positions(positionId);
        uint256 total = positionIds.length;
        uint256 scanned;
        for (uint256 i = total; i > 0 && scanned < 20; --i) {
            uint256 candidate = positionIds[i - 1];
            ++scanned;
            if (candidate == positionId) continue;
            (, address cm, uint16 capr, uint32 cepoch,) = lending.positions(candidate);
            if (cm == m && capr == apr && cepoch == epoch) return (true, candidate);
        }
    }

    /// @dev Aggregate full-hash over (up to) the 3 most recent positions, for SP-19.
    function _samplePositionsHash() internal view returns (bool sampled, bytes32 aggregate) {
        uint256 total = positionIds.length;
        if (total == 0) return (false, bytes32(0));
        uint256 take = total < 3 ? total : 3;
        for (uint256 i; i < take; ++i) {
            aggregate = keccak256(abi.encode(aggregate, _sp_positionFullHash(positionIds[total - 1 - i])));
        }
        return (true, aggregate);
    }

    /// @dev The pair's overlap in UNITs, recomputed from the position's live interval and
    ///      the loan's frozen one (with the tape-equality gate first, mirroring the claim
    ///      path's plan-risk-#3 ordering) rather than read back from `contributionOf`.
    function _pairOverlap(uint256 loanId, uint256 positionId) internal view returns (bool valid, uint64 overlapUnits) {
        {
            (address borrower, address lm, uint16 lapr, uint32 lepoch,) = _sp_loanTape(loanId);
            if (borrower == address(0)) return (false, 0);
            (address positionLender, address pm, uint16 papr, uint32 pepoch,) = lending.positions(positionId);
            if (positionLender == address(0)) return (false, 0);
            if (pm != lm || papr != lapr || pepoch != lepoch) return (false, 0);
        }
        (, uint64 positionStart, uint64 positionEnd,) = lending.positionState(positionId);
        (, uint64 fillStart, uint64 fillEnd,,,) = _sp_loanFields(loanId);
        uint64 overlapStart = positionStart > fillStart ? positionStart : fillStart;
        uint64 overlapEnd = positionEnd < fillEnd ? positionEnd : fillEnd;
        if (overlapEnd <= overlapStart) return (false, 0);
        return (true, overlapEnd - overlapStart);
    }

    /// @dev SP-20 (tiling) + SP-09 (dust bound) share one bounded tape scan, run every
    ///      SP_SCAN_EVERY-th claim and skipped once the position count outgrows the bound.
    ///      Every position ever created flows through `lending_supply`'s `positionIds`
    ///      push, so the enumeration is complete by construction.
    /// @dev Accumulator for `_spClaimTapeScan`, packed to stay off the stack.
    struct TapeScanAcc {
        uint64 fillStart;
        uint64 fillEnd;
        uint256 recoveredFinal;
        uint256 sumOverlap;
        uint256 contributors;
        bool allDrained;
    }

    function _spClaimTapeScan(uint256 loanId) internal {
        ++spClaimCount;
        if (spClaimCount % SP_SCAN_EVERY != 0) return;
        if (positionIds.length > SP_SCAN_POSITION_BOUND) return;

        TapeScanAcc memory acc;
        bool closed;
        {
            uint128 drawn;
            uint128 repaid;
            (closed, acc.fillStart, acc.fillEnd,, drawn, repaid) = _sp_loanFields(loanId);
            acc.recoveredFinal = uint256(drawn) + repaid;
            acc.allDrained = true;
        }

        for (uint256 i; i < positionIds.length; ++i) {
            _spScanPosition(loanId, positionIds[i], acc);
        }

        property_lazyAttribution_sumsToWhole(acc.sumOverlap, acc.fillStart, acc.fillEnd); // SP-20
        if (closed && acc.contributors > 0 && acc.allDrained) {
            property_closedLoan_dustBounded(lending.proceeds(loanId), acc.contributors); // SP-09
        }
    }

    /// @dev One `_spClaimTapeScan` probe: folds a position's overlap with the loan's fill
    ///      interval into the accumulator. `_pairOverlap` re-derives the tape-equality
    ///      gate and interval intersection itself.
    function _spScanPosition(uint256 loanId, uint256 positionId, TapeScanAcc memory acc) internal view {
        (bool overlaps, uint64 overlap) = _pairOverlap(loanId, positionId);
        if (!overlaps) return;
        acc.sumOverlap += overlap;
        acc.contributors += 1;
        // Floor entitlement mirror, for the SP-09 drain gate only: a contributor with
        // unpaid entitlement means the residual pot is legitimately unclaimed value.
        uint256 entitlement = (uint256(overlap) * acc.recoveredFinal) / (acc.fillEnd - acc.fillStart);
        if (entitlement > lending.received(loanId, positionId)) acc.allDrained = false;
    }

    /// @dev SP-21: opportunistically pick one of the actor's OWN positions with no tape
    ///      overlap with the loan and assert the claim path rejects it cleanly. Own
    ///      positions only — claim checks NotLender before the overlap gate, so a foreign
    ///      position would never reach the check this property targets.
    function _spZeroOverlapProbe(uint256 loanId) internal {
        uint256 count = lending.lenderPositionCount(actor);
        if (count == 0) return;
        uint256 scan = count < 10 ? count : 10;
        for (uint256 i; i < scan; ++i) {
            uint256 positionId = lending.lenderPositionAt(actor, count - 1 - i);
            (bool overlaps,) = _pairOverlap(loanId, positionId);
            if (overlaps) continue;
            bool paidOut;
            bool cleanReject;
            try lending.claim(loanId, positionId, type(uint128).max) {
                paidOut = true;
            } catch (bytes memory err) {
                bytes4 sel = _errSelector(err);
                cleanReject = sel == OVRFLOLending.NoOverlap.selector || sel == OVRFLOLending.EpochMismatch.selector;
            }
            property_claim_zeroOverlap_reverts(paidOut, cleanReject); // SP-21
            return;
        }
    }
}
