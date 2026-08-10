// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {TickTree} from "../src/TickTree.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";
import {LendingInternalHarness} from "./OVRFLOLending.t.sol";

/*//////////////////////////////////////////////////////////////
              X-RAY INVARIANT CATALOG — DISPOSITION
//////////////////////////////////////////////////////////////*/

/**
 * Every G/I/X/E block in `x-ray/invariants.md` (regenerated 2026-08-10 at f0661ab) is dispositioned below:
 * ENCODED here, COVERED by a cited existing test, or OUT-OF-SCOPE with a reason. Guard blocks G-1..G-68 are
 * per-call preconditions, not falsifiable global properties, so they are covered by the unit suite's
 * error-path tests rather than encoded as invariants; only the guards whose *lifted* form is a global
 * property appear below (via their I-N).
 *
 *  ID    Disposition   Where
 *  ----  ------------  ------------------------------------------------------------------------------
 *  I-1   ENCODED       invariant_IntervalPartition — tiling of [0, filled) verified through stored `seq`
 *  I-2   ENCODED       invariant_FrozenHistory — per-position frozen sub-interval ghosts
 *  I-3   ENCODED       invariant_EscrowSolvency — underlying balance vs summed unfilled depth
 *  I-4   ENCODED       invariant_PotConservation — proceeds + Σreceived == drawn + repaid
 *  I-5   ENCODED       invariant_TokenCustody — ovrfloToken balance == Σ proceeds
 *  I-6   ENCODED       invariant_ClaimCaps (per-pair cap) + handler reaches over-vested open loans
 *  I-7   ENCODED       invariant_ClaimCaps (drawn + repaid <= obligation)
 *  I-8   ENCODED       invariant_LoanIntervalAtom — every fill >= MIN_LIQUIDITY_AMOUNT
 *  I-9   OUT-OF-SCOPE  Deliberately-contradicted lift (sub-atom leaves are legal after a partial
 *                      withdraw). Asserting it would be wrong; its *correct* consequence — that a
 *                      shrunken leaf never drops below filled — is I-2, which is encoded.
 *  I-10  ENCODED       invariant_UnitAlignment — tape quantities are exact UNIT multiples
 *  I-11  COVERED       test_SetAprBounds_* in test/OVRFLOLending.t.sol (admin-only bound, no fuzz reach)
 *  I-12  COVERED       test_SetFee_* in test/OVRFLOLending.t.sol (admin-only bound)
 *  I-13  COVERED       test/TickTree.t.sol NodeOverflow tests + its reference-model differential fuzz;
 *                      re-asserted indirectly here by invariant_TreeIntegrity (root vs ghost mirror)
 *  I-14  ENCODED       invariant_ClosedIsTerminal — closed never reverts to open
 *  I-15  OUT-OF-SCOPE  Admin one-shot latch; spacing is set once in setUp and no handler action mutates
 *                      it. Covered by test_SetTickSpacing_SetsOnceAndEmits in test/OVRFLOLending.t.sol.
 *  I-16  ENCODED       invariant_CursorSoundness (oldestLiveEpoch <= currentEpoch, both monotone)
 *  I-17  ENCODED       invariant_CursorSoundness (every epoch below the cursor is under the atom)
 *  I-18  ENCODED       invariant_TreeIntegrity + covGrowth (height monotone across forced growth)
 *  I-19  ENCODED       invariant_ViewTruth — loansOf's reported claimable must equal what a subsequent
 *                      max claim actually pays; recorded by the claimMax action, asserted in the invariant
 *  I-20  ENCODED       invariant_ClaimCaps (obligation <= remaining at origination) and
 *                      test_GrossPriceNotUnitAligned_ObligationStrictlyBelowRemaining (the floor/ceil
 *                      boundary the 73-day/1.02 fixture never reaches)
 *  I-21  ENCODED       afterInvariant dust bound — closed-loan shortfall <= contributor count, in wei
 *  I-22  OUT-OF-SCOPE  Maturity-gate asymmetry is a per-function routing fact, not a state identity.
 *                      Covered by test_Supply_RevertsAtMaturity / test_Withdraw_WorksAfterMaturity and
 *                      siblings in test/OVRFLOLending.t.sol. `warpAndVest` advances up to 4 days a call,
 *                      so the 73-day maturity is crossable inside depth 40 and the wind-down half is
 *                      exercised under every invariant below when it is.
 *  I-23  OUT-OF-SCOPE  Ordering property inside one call (checked-then-computed); unreachable as a
 *                      cross-call state identity. Covered by test_Borrow_RevertsAtMaturity.
 *  I-24  OUT-OF-SCOPE  Vault solvency — different contract. Covered by test/OVRFLOInvariant.t.sol and
 *                      test/OVRFLOWrapUnwrap.invariant.t.sol; this suite deploys no vault.
 *  X-1   OUT-OF-SCOPE  Series config immutability lives in OVRFLO.setSeriesApproved. Covered by
 *                      test_SetSeriesApproved_RevertsOnSecondCall in test/OVRFLO.t.sol.
 *  X-2   ENCODED       invariant_EscrowSolvency + invariant_TreeIntegrity both read root() - filled on
 *                      every epoch every call; an underflow reverts the invariant, which is the failure.
 *  X-3   OUT-OF-SCOPE  Constructor wiring against a write-once factory mapping; no runtime state
 *                      transition to fuzz. Covered by test_Constructor_WiresRegistryAndInitialAdminState.
 *  X-4   OUT-OF-SCOPE  Mutable treasury is admin-only and multisig-bounded. Covered by
 *                      test_SetTreasury_* in test/OVRFLOLending.t.sol.
 *  X-5   OUT-OF-SCOPE  Vault/token ownership. Covered by test/OVRFLOToken.t.sol.
 *  E-1   ENCODED       afterInvariant lazy-attribution coverage — Σ overlap over the epoch's positions
 *                      equals the loan's interval length, for every loan, forever
 *  E-2   ENCODED       invariant_ClaimCaps + invariant_PotConservation together
 *  E-3   ENCODED       invariant_EscrowSolvency + invariant_TokenCustody (both exit paths are funded)
 *  E-4   ENCODED       invariant_ClaimCaps (obligation <= remaining at origination)
 *  E-5   ENCODED       invariant_LoanIntervalAtom + invariant_CursorSoundness + covGrowth/covRollover
 *
 * Additionally encoded beyond the catalog, per the ticket's acceptance criteria:
 *   - GL-70 re-pledge safety: invariant_GL70StreamDrawAccounting, using close-time withdrawn snapshots.
 *   - Epoch isolation (risk #3): the adversarialCrossEpochClaim action pairs numerically identical
 *     intervals across epochs and records whether the claim paid; invariant_EpochIsolation asserts it
 *     never did, and afterInvariant's _assertEpochIsolation independently asserts that no cross-tape
 *     pair ever accrued a payout.
 *   - Handler structural coverage: afterInvariant asserts multi-node fills, growth, rollover, self-fills,
 *     re-pledges and over-vested open loans all executed in the run.
 */

/// @dev Extends the unit suite's harness with the two reads and the one seed the property suite needs.
///      Everything else — `exposed_epochState`, `exposed_loanCount`, `exposed_setCapacityOverride`,
///      `exposed_setEpochs` — is inherited rather than re-declared.
contract LendingInvariantHarness is LendingInternalHarness {
    using TickTree for TickTree.Tree;

    constructor(address factory, address core, address sablier) LendingInternalHarness(factory, core, sablier) {}

    /// @dev Seeds the permanent leaf counter so the next two appends cross a real `TickTree` growth
    ///      boundary. The skipped coordinates are genuine zero-valued leaves, so every prefix sum, the
    ///      root, and every existing position interval are bit-identical before and after the seed —
    ///      it removes only the 4,096-append cost of reaching the boundary, never a behaviour.
    function exposed_seedLeafCount(address market, uint16 aprBps, uint32 epoch, uint32 leaves) external {
        ticks[market][aprBps].epochs[epoch].tree.leaves = leaves;
    }

    function exposed_treeHeight(address market, uint16 aprBps, uint32 epoch) external view returns (uint8) {
        return ticks[market][aprBps].epochs[epoch].tree.height;
    }

    function exposed_prefixAndLeaf(address market, uint16 aprBps, uint32 epoch, uint32 leafIndex)
        external
        view
        returns (uint64 prefixValue, uint64 leafValue)
    {
        TickTree.Tree storage tree = ticks[market][aprBps].epochs[epoch].tree;
        return (tree.prefix(leafIndex), tree.leaf(leafIndex));
    }
}

/*//////////////////////////////////////////////////////////////
                              HANDLER
//////////////////////////////////////////////////////////////*/

/// @notice Single bounded-actor handler. Every lending call is `try`/`catch`-skipped: a reverting path is
///         not a failure, it is simply a sequence the fuzzer may not take. Ghosts are updated only on the
///         success branch, and every ghost is derived from an observation independent of the arithmetic it
///         is used to check (balance deltas, amounts the handler itself chose, or pre-call snapshots).
contract LendingInvariantHandler is Test {
    uint128 internal constant UNIT = 1e12;
    uint128 internal constant MIN_LIQUIDITY_AMOUNT = 1e15;
    uint64 internal constant MIN_LIQUIDITY_UNITS = 1000;
    uint32 internal constant HEIGHT4_CAPACITY = 4096;
    uint128 internal constant STREAM_DEPOSIT = 400 ether;

    LendingInvariantHarness public immutable lending;
    MockLendingSablier public immutable sablier;
    TestERC20 public immutable underlying;
    TestERC20 public immutable ovrfloToken;
    address public immutable market;
    uint256 public immutable expiry;

    address[5] public actors;
    uint16[2] public tickAprs;

    uint256[] public positionIds;
    uint256[] public loanIds;
    uint256[] public streamIds;

    /// @dev apr => epoch => position ids appended to that tape, in leaf order.
    mapping(uint16 => mapping(uint32 => uint256[])) internal epochPositions;
    mapping(uint16 => uint32) public maxEpochSeen;

    /// @dev Per-tape mirrors, in UNITs, accumulated from handler-observed token movement.
    mapping(uint16 => mapping(uint32 => uint64)) public ghostPosted;
    mapping(uint16 => mapping(uint32 => uint64)) public ghostWithdrawn;
    mapping(uint16 => mapping(uint32 => uint64)) public ghostFilled;

    struct LoanGhost {
        uint16 aprBps;
        uint32 epoch;
        uint64 fillStart;
        uint64 fillEnd;
        uint128 obligation;
        uint128 remainingAtOrigin;
        uint256 streamId;
        uint128 withdrawnAtCreate;
        uint128 withdrawnAtClose;
        bool closedSeen;
    }

    mapping(uint256 => LoanGhost) internal loanGhostOf;

    /// @dev Frozen sub-interval `[start, min(end, filled))` once `filled` has passed the position's start.
    mapping(uint256 => uint64) internal frozenStart;
    mapping(uint256 => uint64) internal frozenEnd;
    mapping(uint256 => bool) internal frozenSet;
    uint256 public frozenRecordCount;

    mapping(uint256 => mapping(uint256 => uint128)) public ghostReceived;
    mapping(uint256 => uint128) public ghostReceivedLoan;

    mapping(uint256 => bool) internal streamWasPledged;

    // Structural coverage counters.
    uint256 public covMultiNodeFill;
    uint256 public covGrowth;
    uint256 public covRollover;
    uint256 public covSelfFill;
    uint256 public covRepledge;
    uint256 public covOverVested;
    uint256 public covWithdrawAfterFill;
    uint256 public covCrossEpochRejected;
    uint256 public covClaim;
    uint256 public covRepay;
    uint256 public covClose;
    uint256 public covMaturityReached;

    /// @dev Failure signals recorded by handler actions. They are counters rather than assertions because
    ///      an assertion that reverts inside a handler erases the state change that proves the failure.
    uint256 public viewTruthMismatches;
    uint128 public lastViewReported;
    uint128 public lastViewPaid;
    bool public crossEpochClaimSucceeded;

    bool internal growthDoneThisRun;
    bool internal multiNodeDoneThisRun;
    bool internal baselineDone;

    /// @dev Runs the five structural scenarios once, on whichever handler action the fuzzer picks first in
    ///      a run. Selector weighting alone cannot *guarantee* the coverage gate — at the default profile's
    ///      depth 10 there is a real chance the fuzzer never picks `structural` at all — and the gate must
    ///      not be weakened to accommodate that. Front-loading makes coverage deterministic; the weighted
    ///      `structural` action still fires repeatedly afterwards, so rollovers, closures and re-pledges
    ///      keep interleaving with ordinary traffic rather than only happening up front.
    modifier handlerAction() {
        if (!baselineDone) {
            baselineDone = true;
            _multiNodeFill(7_919);
            _forceGrowth(104_729);
            _forceRollover(15_485_863);
            _overVestOpenLoan(27_644_437);
            _settleAndRepledge(32_452_843);
        }
        _snapshotFrozenHistory();
        _;
    }

    /// @notice Records the pre-action truth that `invariant_FrozenHistory` (AC2 / I-2) asserts against.
    /// @dev Two constraints force this shape. First, Foundry discards storage written inside an invariant
    ///      function, so the ghost cannot be recorded there — it would record nothing and compare nothing,
    ///      passing against any implementation. Second, the recording must not assert: an assertion that
    ///      reverts inside a handler reverts the whole action, which un-does the very state change it was
    ///      meant to expose and hides it from the invariant. So this snapshots only, and it runs *before*
    ///      the action body, giving the invariant an anchor that always predates the mutation it guards.
    function _snapshotFrozenHistory() internal {
        for (uint256 i = 0; i < positionIds.length; ++i) {
            uint256 positionId = positionIds[i];
            (,, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);
            (, uint64 filled,,,) = lending.exposed_epochState(market, aprBps, epoch);
            (uint64 start, uint64 end) = _interval(positionId);
            if (start >= filled) continue;

            if (!frozenSet[positionId]) {
                frozenSet[positionId] = true;
                ++frozenRecordCount;
            }
            frozenStart[positionId] = start;
            frozenEnd[positionId] = end < filled ? end : filled;
        }
    }

    constructor(
        LendingInvariantHarness lending_,
        MockLendingSablier sablier_,
        TestERC20 underlying_,
        TestERC20 ovrfloToken_,
        address market_,
        uint256 expiry_,
        uint16 aprLow,
        uint16 aprHigh
    ) {
        lending = lending_;
        sablier = sablier_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        market = market_;
        expiry = expiry_;
        tickAprs = [aprLow, aprHigh];

        actors = [
            makeAddr("lendActorA"),
            makeAddr("lendActorB"),
            makeAddr("lendActorC"),
            makeAddr("lendActorD"),
            makeAddr("lendActorE")
        ];

        for (uint256 i = 0; i < actors.length; ++i) {
            address actor = actors[i];
            underlying.mint(actor, 5_000 ether);
            ovrfloToken.mint(actor, 5_000 ether);
            vm.startPrank(actor);
            underlying.approve(address(lending), type(uint256).max);
            ovrfloToken.approve(address(lending), type(uint256).max);
            sablier.setApprovalForAll(address(lending), true);
            vm.stopPrank();

            // Two streams per actor: enough for concurrent loans plus re-pledge after settlement. The
            // streams themselves are minted by `bindStreams`, which knows the core address.
            for (uint256 s = 0; s < 2; ++s) {
                streamIds.push(10_000 + i * 10 + s);
            }
        }
    }

    /// @dev Mints every collateral stream with the real core as sender, which `StreamPricing.requireEligible`
    ///      demands. Split out of the constructor because the core address is known only to the test
    ///      contract, which calls this immediately after wiring.
    function bindStreams(address core) external {
        for (uint256 i = 0; i < streamIds.length; ++i) {
            sablier.setStream(
                streamIds[i],
                actors[i / 2],
                core,
                IERC20(address(ovrfloToken)),
                uint40(expiry),
                0,
                false,
                STREAM_DEPOSIT,
                0
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                            HANDLER ACTIONS
    //////////////////////////////////////////////////////////////*/

    function supply(uint256 actorSeed, uint256 aprSeed, uint256 amountSeed) public handlerAction {
        address actor = _actor(actorSeed);
        uint16 aprBps = _tick(aprSeed);
        uint128 amount = _unitAmount(amountSeed, MIN_LIQUIDITY_AMOUNT, 40 ether);
        _doSupply(actor, aprBps, amount);
    }

    function withdraw(uint256 positionSeed) public handlerAction {
        if (positionIds.length == 0) return;
        uint256 positionId = positionIds[positionSeed % positionIds.length];
        (address lender,, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);

        (,, uint64 filledBefore) = _epochNumbers(aprBps, epoch);
        (uint64 startBefore,) = _interval(positionId);

        uint256 lendingBefore = underlying.balanceOf(address(lending));
        vm.prank(lender);
        try lending.withdraw(positionId) {
            uint256 refund = lendingBefore - underlying.balanceOf(address(lending));
            ghostWithdrawn[aprBps][epoch] += uint64(refund / UNIT);
            if (filledBefore > startBefore) ++covWithdrawAfterFill;
        } catch {}
    }

    function borrow(uint256 actorSeed, uint256 aprSeed, uint256 targetSeed) public handlerAction {
        address actor = _actor(actorSeed);
        uint16 aprBps = _tick(aprSeed);
        uint128 target = _unitAmount(targetSeed, MIN_LIQUIDITY_AMOUNT, 120 ether);
        _doBorrow(actor, aprBps, target);
    }

    function repay(uint256 loanSeed, uint256 amountSeed) public handlerAction {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];
        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        if (loan.closed || outstanding == 0) return;

        // A third of the time repay the exact outstanding, so the closure branch is not left to chance.
        uint128 amount = amountSeed % 3 == 0 ? outstanding : uint128(bound(amountSeed, 1, outstanding));

        vm.prank(_actor(amountSeed));
        try lending.repay(loanId, amount) {
            ++covRepay;
            _recordClosureIfSettled(loanId);
        } catch {}
    }

    function close(uint256 loanSeed) public handlerAction {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];

        vm.prank(_actor(loanSeed));
        try lending.close(loanId) {
            ++covClose;
            _recordClosureIfSettled(loanId);
        } catch {}
    }

    /// @notice Claims everything for a (loan, position) pair and pins `loansOf`'s reported `claimable`
    ///         against what the money path actually pays (U5-review view-truth criterion).
    function claimMax(uint256 loanSeed, uint256 positionSeed) public handlerAction {
        if (loanIds.length == 0 || positionIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];
        uint256 positionId = positionIds[positionSeed % positionIds.length];
        (address lender,,,,) = lending.positions(positionId);

        uint128 reported = _reportedClaimable(positionId, loanId);

        uint256 balanceBefore = ovrfloToken.balanceOf(lender);
        vm.prank(lender);
        try lending.claim(loanId, positionId, type(uint128).max) {
            uint128 paid = uint128(ovrfloToken.balanceOf(lender) - balanceBefore);
            // Recorded, never asserted here: an assertion that reverts inside a handler reverts the whole
            // action, and with `fail_on_revert = false` that call is silently discarded — the divergence
            // would erase its own evidence. `invariant_ViewTruth` reads these and asserts.
            if (paid != reported) {
                ++viewTruthMismatches;
                lastViewReported = reported;
                lastViewPaid = paid;
            }
            ghostReceived[loanId][positionId] += paid;
            ghostReceivedLoan[loanId] += paid;
            ++covClaim;
        } catch {}
    }

    /// @notice Advances time and vests streams. Vesting is seeded independently of any loan's outstanding
    ///         so that `withdrawable > outstanding` (the over-vested theft boundary) is reachable.
    function warpAndVest(uint256 timeSeed, uint256 vestSeed) public handlerAction {
        vm.warp(block.timestamp + bound(timeSeed, 1 hours, 4 days));
        if (block.timestamp >= expiry) ++covMaturityReached;

        for (uint256 i = 0; i < streamIds.length; ++i) {
            uint256 streamId = streamIds[i];
            uint128 deposited = sablier.getDepositedAmount(streamId);
            uint128 withdrawn = sablier.getWithdrawnAmount(streamId);
            if (deposited <= withdrawn) continue;
            uint128 headroom = deposited - withdrawn;
            uint128 vested = uint128(bound(uint256(keccak256(abi.encode(vestSeed, i))), 0, headroom));
            sablier.setWithdrawable(streamId, vested);
        }
        _tallyOverVested();
    }

    function advanceCursor(uint256 aprSeed, uint256 stepSeed) public handlerAction {
        uint16 aprBps = _tick(aprSeed);
        try lending.advanceEpochCursor(market, aprBps, uint32(bound(stepSeed, 1, 8))) {} catch {}
    }

    /// @notice Proves the epoch guard, not coincidental non-overlap: pairs a position and a loan that sit
    ///         on numerically identical intervals in different epochs and asserts the claim reverts.
    function adversarialCrossEpochClaim(uint256 seed) public handlerAction {
        uint16 aprBps = _tick(seed);
        if (maxEpochSeen[aprBps] == 0) return;

        for (uint256 i = 0; i < loanIds.length; ++i) {
            LoanGhost storage g = loanGhostOf[loanIds[i]];
            if (g.aprBps != aprBps) continue;
            uint256[] storage others = epochPositions[aprBps][g.epoch == 0 ? 1 : g.epoch - 1];
            for (uint256 j = 0; j < others.length; ++j) {
                uint256 positionId = others[j];
                (address lender,,, uint32 epoch,) = lending.positions(positionId);
                if (epoch == g.epoch) continue;
                vm.prank(lender);
                try lending.claim(loanIds[i], positionId, type(uint128).max) {
                    // Recorded rather than reverted, for the same reason as the view-truth check: a revert
                    // here would roll back the very payout that proves the guard failed, and
                    // `fail_on_revert = false` would discard the call. `invariant_EpochIsolation` asserts.
                    crossEpochClaimSucceeded = true;
                } catch {
                    ++covCrossEpochRejected;
                }
                return;
            }
        }
    }

    /// @notice The structural driver. The two expensive sub-scenarios run once per run and go first, while
    ///         the tape is still single-epoch; rollover and settle-then-re-pledge run on every call so they
    ///         interleave with ordinary traffic.
    function structural(uint256 seed) public handlerAction {
        if (!multiNodeDoneThisRun) _multiNodeFill(seed);
        if (!growthDoneThisRun) _forceGrowth(seed);
        _forceRollover(seed);
        _overVestOpenLoan(seed);
        _settleAndRepledge(seed);
    }

    /*//////////////////////////////////////////////////////////////
                        STRUCTURAL SUB-SCENARIOS
    //////////////////////////////////////////////////////////////*/

    /// @dev Opens a fresh epoch by overriding terminal capacity for exactly one supply. The production
    ///      predicate (`height == MAX_HEIGHT && atCapacity()`) is restored immediately afterwards.
    function _forceRollover(uint256 seed) internal {
        uint16 aprBps = _tick(seed);
        uint32 currentEpoch = _tickCurrentEpoch(aprBps);
        (,, uint32 leaves) = _epochLeaves(aprBps, currentEpoch);
        if (leaves == 0) {
            // A never-supplied tape has nothing to roll over; seed it, then proceed.
            _doSupply(_actor(seed), aprBps, MIN_LIQUIDITY_AMOUNT);
            (,, leaves) = _epochLeaves(aprBps, currentEpoch);
            if (leaves == 0) return;
        }

        lending.exposed_setCapacityOverride(leaves);
        uint256 before = _tickCurrentEpoch(aprBps);
        _doSupply(_actor(seed), aprBps, MIN_LIQUIDITY_AMOUNT * 2);
        lending.exposed_setCapacityOverride(0);
        if (_tickCurrentEpoch(aprBps) > before) ++covRollover;
    }

    /// @dev Drives a real `TickTree` growth event (height 4 -> 5) by seeding the permanent leaf counter to
    ///      one below capacity and appending across the boundary.
    function _forceGrowth(uint256 seed) internal {
        uint16 aprBps = _tick(seed);
        uint32 epoch = _tickCurrentEpoch(aprBps);
        (,, uint32 leaves) = _epochLeaves(aprBps, epoch);
        if (leaves == 0 || leaves >= HEIGHT4_CAPACITY - 1) return;
        if (lending.exposed_treeHeight(market, aprBps, epoch) != 4) return;

        lending.exposed_seedLeafCount(market, aprBps, epoch, HEIGHT4_CAPACITY - 1);
        _doSupply(_actorAt(seed, 0), aprBps, MIN_LIQUIDITY_AMOUNT);
        _doSupply(_actorAt(seed, 1), aprBps, MIN_LIQUIDITY_AMOUNT);

        if (lending.exposed_treeHeight(market, aprBps, epoch) == 5) {
            ++covGrowth;
            growthDoneThisRun = true;
        }
    }

    /// @dev Nine consecutive positions then a max fill across all of them, so the consumed interval spans a
    ///      level-0 eight-node segment boundary. Runs only while the tape is single-epoch, so the fill and
    ///      the fresh positions are guaranteed to land on the same epoch.
    function _multiNodeFill(uint256 seed) internal {
        uint16 aprBps = _tick(seed);
        (,,, uint32 oldest, uint32 current) = lending.exposed_epochState(market, aprBps, 0);
        if (oldest != current) return;

        address borrower = _actorWithFreeStream(seed);
        if (borrower == address(0)) return;

        for (uint256 i = 0; i < 9; ++i) {
            _doSupply(_actorAt(seed, i), aprBps, MIN_LIQUIDITY_AMOUNT);
        }
        // Max borrow: bounded by available depth and the stream's gross price, so it crosses as many
        // positions as the tape holds.
        uint256 before = covMultiNodeFill;
        _doBorrow(borrower, aprBps, type(uint128).max);
        // Latch only on success — a skipped borrow must leave the scenario retryable, or the coverage
        // gate silently degrades into "we tried once".
        if (covMultiNodeFill > before) multiNodeDoneThisRun = true;
    }

    /// @dev Vests an open loan's stream strictly past its own outstanding. `withdrawable > outstanding` is
    ///      routine once a partially-borrowed stream keeps vesting, and it is the exact state in which a
    ///      claimer would drain co-lenders' pot shares if `claim`'s `min(withdrawable, outstanding)` clamp
    ///      were removed — the boundary the U4 review's mutation testing identified. Driven deterministically
    ///      rather than hoping a random vest lands above the outstanding, so the coverage gate can assert it.
    function _overVestOpenLoan(uint256 seed) internal {
        uint256 loanId = _findOpenLoan(seed);
        if (loanId == 0) return;

        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        if (outstanding == 0) return;

        uint128 headroom = sablier.getDepositedAmount(loan.streamId) - sablier.getWithdrawnAmount(loan.streamId);
        if (headroom <= outstanding) return;

        sablier.setWithdrawable(loan.streamId, outstanding < headroom / 2 ? outstanding * 2 : headroom);
        _tallyOverVested();
    }

    /// @dev Settles an open loan by vesting its stream to exactly cover the outstanding, then re-pledges
    ///      the returned stream to a fresh loan — GL-70's reuse scenario, driven rather than hoped for.
    function _settleAndRepledge(uint256 seed) internal {
        uint256 loanId = _findOpenLoan(seed);
        if (loanId != 0) {
            (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
            // obligation <= remaining, so the outstanding is always reachable withdrawable.
            sablier.setWithdrawable(loan.streamId, outstanding);
            try lending.close(loanId) {
                ++covClose;
                _recordClosureIfSettled(loanId);
            } catch {}
        }
        _repledgeReturnedStream(seed);
    }

    /// @dev Re-pledges a stream that a prior loan already used and returned (GL-70's reuse scenario).
    function _repledgeReturnedStream(uint256 seed) internal {
        for (uint256 i = 0; i < streamIds.length; ++i) {
            uint256 streamId = streamIds[_offsetIndex(seed, i, streamIds.length)];
            if (!streamWasPledged[streamId]) continue;
            address owner = sablier.ownerOf(streamId);
            if (owner == address(lending)) continue;
            if (sablier.getDepositedAmount(streamId) <= sablier.getWithdrawnAmount(streamId)) continue;

            uint16 aprBps = _tick(seed);
            // Guarantee borrowable depth, otherwise the re-pledge cannot be observed.
            _doSupply(_actor(seed), aprBps, MIN_LIQUIDITY_AMOUNT * 5);
            _doBorrow(owner, aprBps, MIN_LIQUIDITY_AMOUNT * 3);
            return;
        }
    }

    function _findOpenLoan(uint256 seed) internal view returns (uint256) {
        for (uint256 i = 0; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[_offsetIndex(seed, i, loanIds.length)];
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            if (!loan.closed) return loanId;
        }
        return 0;
    }

    /*//////////////////////////////////////////////////////////////
                         CORE ACTION IMPLEMENTATIONS
    //////////////////////////////////////////////////////////////*/

    function _doSupply(address actor, uint16 aprBps, uint128 amount) internal {
        vm.prank(actor);
        try lending.supply(market, aprBps, amount) returns (uint256 positionId) {
            (,,, uint32 epoch,) = lending.positions(positionId);
            positionIds.push(positionId);
            epochPositions[aprBps][epoch].push(positionId);
            ghostPosted[aprBps][epoch] += uint64(amount / UNIT);
            if (epoch > maxEpochSeen[aprBps]) maxEpochSeen[aprBps] = epoch;
        } catch {}
    }

    function _doBorrow(address actor, uint16 aprBps, uint128 target) internal {
        uint256 streamId = _freeStreamOf(actor);
        if (streamId == 0) return;

        uint128 remainingBefore = sablier.getDepositedAmount(streamId) - sablier.getWithdrawnAmount(streamId);
        uint128 withdrawnBefore = sablier.getWithdrawnAmount(streamId);

        vm.prank(actor);
        try lending.borrow(market, aprBps, target, streamId, 0) returns (uint256 loanId) {
            _recordBorrow(loanId, aprBps, streamId, remainingBefore, withdrawnBefore);
        } catch {}
    }

    function _recordBorrow(
        uint256 loanId,
        uint16 aprBps,
        uint256 streamId,
        uint128 remainingBefore,
        uint128 withdrawnBefore
    ) internal {
        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);

        loanIds.push(loanId);
        loanGhostOf[loanId] = LoanGhost({
            aprBps: aprBps,
            epoch: loan.epoch,
            fillStart: loan.fillStart,
            fillEnd: loan.fillEnd,
            obligation: loan.obligation,
            remainingAtOrigin: remainingBefore,
            streamId: streamId,
            withdrawnAtCreate: withdrawnBefore,
            withdrawnAtClose: 0,
            closedSeen: false
        });

        ghostFilled[aprBps][loan.epoch] += loan.fillEnd - loan.fillStart;
        if (loan.epoch > maxEpochSeen[aprBps]) maxEpochSeen[aprBps] = loan.epoch;
        if (streamWasPledged[streamId]) ++covRepledge;
        streamWasPledged[streamId] = true;

        _tallyFillShape(loanId, aprBps, loan);
    }

    /// @dev Classifies the fill: how many positions it crossed, whether it spanned an eight-node segment
    ///      boundary, and whether the borrower consumed their own liquidity.
    function _tallyFillShape(uint256 loanId, uint16 aprBps, OVRFLOLending.Loan memory loan) internal {
        uint256[] storage inEpoch = epochPositions[aprBps][loan.epoch];
        bool selfFilled;
        bool haveFirst;
        uint32 firstLeaf;
        uint32 lastLeaf;

        for (uint256 i = 0; i < inEpoch.length; ++i) {
            uint256 positionId = inEpoch[i];
            (uint64 start, uint64 end) = _interval(positionId);
            if (_overlap(start, end, loan.fillStart, loan.fillEnd) == 0) continue;

            (address lender,,,, uint32 leafIndex) = lending.positions(positionId);
            if (lender == loan.borrower) selfFilled = true;
            if (!haveFirst) {
                firstLeaf = leafIndex;
                haveFirst = true;
            }
            lastLeaf = leafIndex;
        }

        if (selfFilled) ++covSelfFill;
        if (haveFirst && firstLeaf / TickTree.BRANCHING_FACTOR != lastLeaf / TickTree.BRANCHING_FACTOR) {
            ++covMultiNodeFill;
        }
        loanId; // silences the unused-parameter warning without widening the signature
    }

    function _recordClosureIfSettled(uint256 loanId) internal {
        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        if (!loan.closed) return;
        LoanGhost storage g = loanGhostOf[loanId];
        if (g.closedSeen) return;
        g.closedSeen = true;
        g.withdrawnAtClose = sablier.getWithdrawnAmount(g.streamId);
    }

    function _tallyOverVested() internal {
        for (uint256 i = 0; i < loanIds.length; ++i) {
            (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanIds[i]);
            if (loan.closed) continue;
            if (sablier.withdrawableAmountOf(loan.streamId) > outstanding && outstanding > 0) {
                ++covOverVested;
                return;
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Scans `loansOf` for the pair's entry and returns the view's reported claimable, or zero.
    function _reportedClaimable(uint256 positionId, uint256 loanId) internal view returns (uint128) {
        try lending.loansOf(positionId, 0, 32) returns (OVRFLOLending.LoanShare[] memory entries, uint64) {
            for (uint256 i = 0; i < entries.length; ++i) {
                if (entries[i].loanId == loanId) return entries[i].claimable;
            }
        } catch {}
        return 0;
    }

    function _freeStreamOf(address actor) internal view returns (uint256) {
        for (uint256 i = 0; i < streamIds.length; ++i) {
            uint256 streamId = streamIds[i];
            if (sablier.ownerOf(streamId) != actor) continue;
            if (sablier.getDepositedAmount(streamId) <= sablier.getWithdrawnAmount(streamId)) continue;
            return streamId;
        }
        return 0;
    }

    function _interval(uint256 positionId) internal view returns (uint64 start, uint64 end) {
        (,, uint16 aprBps, uint32 epoch, uint32 leafIndex) = lending.positions(positionId);
        (uint64 prefixValue, uint64 leafValue) = lending.exposed_prefixAndLeaf(market, aprBps, epoch, leafIndex);
        return (prefixValue, prefixValue + leafValue);
    }

    function _overlap(uint64 aStart, uint64 aEnd, uint64 bStart, uint64 bEnd) internal pure returns (uint64) {
        uint64 lo = aStart > bStart ? aStart : bStart;
        uint64 hi = aEnd < bEnd ? aEnd : bEnd;
        return hi > lo ? hi - lo : 0;
    }

    function _epochNumbers(uint16 aprBps, uint32 epoch)
        internal
        view
        returns (uint64 root, uint32 leaves, uint64 filled)
    {
        (uint64 root_, uint64 filled_, uint32 leaves_,,) = lending.exposed_epochState(market, aprBps, epoch);
        return (root_, leaves_, filled_);
    }

    function _epochLeaves(uint16 aprBps, uint32 epoch)
        internal
        view
        returns (uint64 root, uint64 filled, uint32 leaves)
    {
        (uint64 root_, uint64 filled_, uint32 leaves_,,) = lending.exposed_epochState(market, aprBps, epoch);
        return (root_, filled_, leaves_);
    }

    function _tickCurrentEpoch(uint16 aprBps) internal view returns (uint32) {
        (,,,, uint32 currentEpoch) = lending.exposed_epochState(market, aprBps, 0);
        return currentEpoch;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// @dev Offset index that cannot overflow on a max-uint seed. A bare `seed + i` panics under 0.8
    ///      checked arithmetic, and inside a handler that surfaces as an unexplained revert — a silently
    ///      skipped path, which is exactly the vacuous-coverage failure mode to avoid.
    function _offsetIndex(uint256 seed, uint256 offset, uint256 length) internal pure returns (uint256) {
        return (seed % length + offset) % length;
    }

    function _actorAt(uint256 seed, uint256 offset) internal view returns (address) {
        return actors[_offsetIndex(seed, offset, actors.length)];
    }

    function _actorWithFreeStream(uint256 seed) internal view returns (address) {
        for (uint256 i = 0; i < actors.length; ++i) {
            address actor = _actorAt(seed, i);
            if (_freeStreamOf(actor) != 0) return actor;
        }
        return address(0);
    }

    function _tick(uint256 seed) internal view returns (uint16) {
        return tickAprs[seed % tickAprs.length];
    }

    /// @dev Floors a bounded amount onto the UNIT lattice, which `supply` requires exactly.
    function _unitAmount(uint256 seed, uint128 lo, uint128 hi) internal pure returns (uint128) {
        uint128 raw = uint128(bound(seed, lo, hi));
        // forge-lint: disable-next-line(divide-before-multiply) — flooring onto the UNIT lattice is the point
        return (raw / UNIT) * UNIT;
    }

    /*//////////////////////////////////////////////////////////////
                          READ SURFACE FOR THE SUITE
    //////////////////////////////////////////////////////////////*/

    function positionCount() external view returns (uint256) {
        return positionIds.length;
    }

    function loanCount() external view returns (uint256) {
        return loanIds.length;
    }

    function streamCount() external view returns (uint256) {
        return streamIds.length;
    }

    function epochPositionCount(uint16 aprBps, uint32 epoch) external view returns (uint256) {
        return epochPositions[aprBps][epoch].length;
    }

    function epochPositionAt(uint16 aprBps, uint32 epoch, uint256 index) external view returns (uint256) {
        return epochPositions[aprBps][epoch][index];
    }

    function loanGhost(uint256 loanId) external view returns (LoanGhost memory) {
        return loanGhostOf[loanId];
    }

    function frozenRecord(uint256 positionId) external view returns (bool isSet, uint64 start, uint64 end) {
        return (frozenSet[positionId], frozenStart[positionId], frozenEnd[positionId]);
    }

    function interval(uint256 positionId) external view returns (uint64 start, uint64 end) {
        return _interval(positionId);
    }

    function overlap(uint64 aStart, uint64 aEnd, uint64 bStart, uint64 bEnd) external pure returns (uint64) {
        return _overlap(aStart, aEnd, bStart, bEnd);
    }
}

/*//////////////////////////////////////////////////////////////
                            INVARIANT SUITE
//////////////////////////////////////////////////////////////*/

contract OVRFLOLendingInvariantTest is Test {
    uint128 internal constant UNIT = 1e12;
    uint128 internal constant MIN_LIQUIDITY_AMOUNT = 1e15;
    uint64 internal constant MIN_LIQUIDITY_UNITS = 1000;

    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x5555);
    uint16 internal constant APR_LOW = 1000;
    uint16 internal constant APR_HIGH = 1025;
    uint16 internal constant SPACING = 25;

    MockLendingFactory internal factory;
    MockLendingCore internal core;
    MockLendingSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    LendingInvariantHarness internal lending;
    LendingInvariantHandler internal handler;
    uint256 internal expiry;

    function setUp() public {
        factory = new MockLendingFactory();
        core = new MockLendingCore();
        sablier = new MockLendingSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO Token", "OVRFLO");

        // 73 days = YEAR / 5, so at APR 1000 the accrual factor is exactly 1.02e18 (repo fixture).
        expiry = block.timestamp + 73 days;
        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        core.setSeries(MARKET, expiry, address(ovrfloToken), address(underlying));

        lending = new LendingInvariantHarness(address(factory), address(core), address(sablier));
        lending.setTickSpacing(MARKET, SPACING);
        lending.setAprBounds(APR_LOW, APR_HIGH);
        lending.setFee(50);

        handler =
            new LendingInvariantHandler(lending, sablier, underlying, ovrfloToken, MARKET, expiry, APR_LOW, APR_HIGH);
        handler.bindStreams(address(core));

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = LendingInvariantHandler.supply.selector;
        selectors[1] = LendingInvariantHandler.withdraw.selector;
        selectors[2] = LendingInvariantHandler.borrow.selector;
        selectors[3] = LendingInvariantHandler.repay.selector;
        selectors[4] = LendingInvariantHandler.close.selector;
        selectors[5] = LendingInvariantHandler.claimMax.selector;
        selectors[6] = LendingInvariantHandler.warpAndVest.selector;
        selectors[7] = LendingInvariantHandler.advanceCursor.selector;
        selectors[8] = LendingInvariantHandler.adversarialCrossEpochClaim.selector;
        // `structural` is deliberately weighted: the coverage assertion below is a per-run gate, and an
        // unweighted 1-in-10 selector cannot reach it reliably inside depth 40 (coupon-collector).
        // Weighting the selector is the prescribed remedy — never weakening the assertion.
        selectors[9] = LendingInvariantHandler.structural.selector;
        selectors[10] = LendingInvariantHandler.structural.selector;
        selectors[11] = LendingInvariantHandler.structural.selector;
        selectors[12] = LendingInvariantHandler.structural.selector;
        selectors[13] = LendingInvariantHandler.structural.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /*//////////////////////////////////////////////////////////////
                               INVARIANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice AC1 / I-1. Per tick epoch, loan intervals are disjoint, contiguous, and exactly tile
    ///         `[0, filled)` — walked through each loan's stored `seq` via the `loanAt` index.
    function invariant_IntervalPartition() public view {
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            uint32 maxEpoch = handler.maxEpochSeen(aprs[t]);
            for (uint32 epoch = 0; epoch <= maxEpoch; ++epoch) {
                _assertEpochTiling(aprs[t], epoch);
            }
        }
    }

    function _assertEpochTiling(uint16 aprBps, uint32 epoch) internal view {
        uint64 count = lending.exposed_loanCount(MARKET, aprBps, epoch);
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, aprBps, epoch);
        if (count == 0) {
            assertEq(filled, 0, "partition: filled advanced with no loans recorded");
            return;
        }

        uint64 cursor;
        for (uint64 seq = 0; seq < count; ++seq) {
            uint256 loanId = lending.loanAt(MARKET, aprBps, epoch, seq);
            assertTrue(loanId != 0, "partition: gap in the tick-epoch loan list");
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            assertEq(loan.seq, seq, "partition: loan.seq disagrees with its loanAt slot");
            assertEq(loan.fillStart, cursor, "partition: interval is not contiguous with its predecessor");
            assertGt(loan.fillEnd, loan.fillStart, "partition: empty interval recorded");
            cursor = loan.fillEnd;
        }
        assertEq(cursor, filled, "partition: intervals do not tile [0, filled)");
    }

    /// @notice AC2 / I-2. No coordinate below `filled` ever changes. Once the counter has passed a
    ///         position's start, that start is fixed forever and the position's consumed sub-interval may
    ///         only *extend* rightward as later fills advance `filled` — it can never shrink, and nothing
    ///         already inside it can move. Anchors are snapshotted in the handler before each action, so
    ///         each comparison here is against state that predates the action being judged.
    function invariant_FrozenHistory() public view {
        uint256 count = handler.positionCount();
        for (uint256 i = 0; i < count; ++i) {
            uint256 positionId = handler.positionIds(i);
            (,, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);
            (, uint64 filled,,,) = lending.exposed_epochState(MARKET, aprBps, epoch);
            (uint64 start, uint64 end) = handler.interval(positionId);
            if (start >= filled) continue;

            uint64 consumedEnd = end < filled ? end : filled;
            (bool isSet, uint64 priorStart, uint64 priorEnd) = handler.frozenRecord(positionId);
            if (!isSet) continue;
            assertEq(start, priorStart, "frozen history: a consumed position's start moved");
            assertGe(consumedEnd, priorEnd, "frozen history: a consumed sub-interval shrank");
        }
    }

    /// @notice AC3 / I-3. Escrow solvency: the underlying held equals the unfilled depth summed across
    ///         every tick epoch, priced in wei (pattern #6's all-party balance rule, extended to the tape).
    function invariant_EscrowSolvency() public view {
        uint256 unfilledWei;
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            uint32 maxEpoch = handler.maxEpochSeen(aprs[t]);
            for (uint32 epoch = 0; epoch <= maxEpoch; ++epoch) {
                (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, aprs[t], epoch);
                assertGe(root, filled, "escrow: filled overran the tape root");
                unfilledWei += uint256(root - filled) * UNIT;
            }
        }
        assertEq(underlying.balanceOf(address(lending)), unfilledWei, "escrow: held underlying != unfilled depth");
    }

    /// @notice AC4 / I-18, I-13. Tree integrity across growth and rollover. The root is checked against an
    ///         independent handler-side mirror of everything posted and withdrawn, and against the prefix
    ///         walk — two different node paths that agree only if every stored subtotal is consistent.
    function invariant_TreeIntegrity() public view {
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            uint32 maxEpoch = handler.maxEpochSeen(aprs[t]);
            for (uint32 epoch = 0; epoch <= maxEpoch; ++epoch) {
                (uint64 root,, uint32 leaves,,) = lending.exposed_epochState(MARKET, aprs[t], epoch);
                assertEq(
                    root,
                    handler.ghostPosted(aprs[t], epoch) - handler.ghostWithdrawn(aprs[t], epoch),
                    "tree: root diverged from the posted/withdrawn ghost mirror"
                );
                if (leaves == 0) continue;
                (uint64 prefixValue, uint64 leafValue) =
                    lending.exposed_prefixAndLeaf(MARKET, aprs[t], epoch, leaves - 1);
                assertEq(root, prefixValue + leafValue, "tree: root != prefix(last) + leaf(last)");
            }
        }
    }

    /// @notice AC5 / I-6, I-7, I-20, E-4. Claim caps and the obligation ceiling.
    function invariant_ClaimCaps() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            _assertLoanCaps(loanId);
        }
    }

    function _assertLoanCaps(uint256 loanId) internal view {
        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);

        assertLe(loan.obligation, g.remainingAtOrigin, "caps: obligation exceeded the stream's remaining");
        assertLe(uint256(loan.drawn) + loan.repaid, loan.obligation, "caps: drawn + repaid exceeded obligation");

        uint64 length = loan.fillEnd - loan.fillStart;
        uint256 paidTotal;
        uint256 positions = handler.epochPositionCount(g.aprBps, g.epoch);
        for (uint256 j = 0; j < positions; ++j) {
            uint256 positionId = handler.epochPositionAt(g.aprBps, g.epoch, j);
            uint128 paid = lending.received(loanId, positionId);
            if (paid == 0) continue;
            paidTotal += paid;

            (uint64 start, uint64 end) = handler.interval(positionId);
            uint64 contribution = handler.overlap(start, end, loan.fillStart, loan.fillEnd);
            // Ceiling uses `obligation`, not the live `recovered`, so the bound is independent of the
            // arithmetic `claim` performs; recovered <= obligation holds by the assertion above.
            uint256 ceiling = (uint256(contribution) * loan.obligation) / length;
            assertLe(paid, ceiling, "caps: per-pair payout exceeded its pro-rata entitlement");
        }
        assertLe(paidTotal, uint256(loan.drawn) + loan.repaid, "caps: loan paid out more than it recovered");
    }

    /// @notice I-4. Pot conservation: nothing recovered is lost and nothing unearned is credited.
    function invariant_PotConservation() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);

            uint256 paidTotal;
            uint256 positions = handler.epochPositionCount(g.aprBps, g.epoch);
            for (uint256 j = 0; j < positions; ++j) {
                paidTotal += lending.received(loanId, handler.epochPositionAt(g.aprBps, g.epoch, j));
            }
            assertEq(
                uint256(lending.proceeds(loanId)) + paidTotal,
                uint256(loan.drawn) + loan.repaid,
                "pot: proceeds + payouts != drawn + repaid"
            );
        }
    }

    /// @notice I-5. Every ovrfloToken the market holds is accounted to some loan's pot.
    function invariant_TokenCustody() public view {
        uint256 potTotal;
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            potTotal += lending.proceeds(handler.loanIds(i));
        }
        assertEq(ovrfloToken.balanceOf(address(lending)), potTotal, "custody: token balance != summed proceeds");
    }

    /// @notice AC9 / I-16, I-17. Cursor soundness.
    function invariant_CursorSoundness() public view {
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            (,,, uint32 oldestLiveEpoch, uint32 currentEpoch) = lending.exposed_epochState(MARKET, aprs[t], 0);
            assertLe(oldestLiveEpoch, currentEpoch, "cursor: advanced past the writing epoch");
            for (uint32 epoch = 0; epoch < oldestLiveEpoch; ++epoch) {
                (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, aprs[t], epoch);
                assertLt(root - filled, MIN_LIQUIDITY_UNITS, "cursor: skipped an epoch that can still fill");
            }
        }
    }

    /// @notice I-8, I-10. The book's single atom and its UNIT granularity.
    function invariant_LoanIntervalAtom() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            (OVRFLOLending.Loan memory loan,) = lending.loanState(handler.loanIds(i));
            assertGe(loan.fillEnd - loan.fillStart, MIN_LIQUIDITY_UNITS, "atom: fill below MIN_LIQUIDITY_AMOUNT");
        }
    }

    /// @notice I-10, plus a view/tape differential. Escrowed wei never carries sub-UNIT residue, and the
    ///         `positionState` named view reports exactly the interval and refundable remainder that the
    ///         tape itself holds — the two are computed by different code paths and must not diverge.
    function invariant_UnitAlignment() public view {
        assertEq(underlying.balanceOf(address(lending)) % UNIT, 0, "units: escrow carries sub-UNIT residue");

        uint256 count = handler.positionCount();
        for (uint256 i = 0; i < count; ++i) {
            _assertPositionView(handler.positionIds(i));
        }
    }

    function _assertPositionView(uint256 positionId) internal view {
        (uint64 start, uint64 end) = handler.interval(positionId);
        (, uint64 viewStart, uint64 viewEnd, uint128 unfilled) = lending.positionState(positionId);

        assertEq(viewStart, start, "view: positionState start diverged from the tape");
        assertEq(viewEnd, end, "view: positionState end diverged from the tape");
        assertEq(unfilled % UNIT, 0, "units: reported unfilled carries sub-UNIT residue");

        (,, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);
        (, uint64 filled,,,) = lending.exposed_epochState(MARKET, aprBps, epoch);
        // Clamp the counter into the position's own span: below `start` nothing of this position is
        // consumed, above `end` all of it is.
        uint64 consumedEnd = filled < start ? start : (filled < end ? filled : end);
        assertEq(unfilled, uint256(end - consumedEnd) * UNIT, "view: reported unfilled != tape remainder");
    }

    /// @notice AC7 / I-19. The view mirror and the money path may never diverge: for every (loan, position)
    ///         pair the handler claimed, `loansOf`'s reported `claimable` equalled the payout a subsequent
    ///         max `claim` actually made. Recorded by `claimMax`, asserted here.
    function invariant_ViewTruth() public view {
        if (handler.viewTruthMismatches() == 0) return;
        assertEq(
            handler.lastViewPaid(), handler.lastViewReported(), "view-truth: loansOf claimable != max claim payout"
        );
    }

    /// @notice AC8 / risk #3. A claim pairing a position and a loan on different tapes must never pay.
    ///         The adversarial handler action pairs numerically identical intervals across epochs, so the
    ///         rejection has to come from the `(market, aprBps, epoch)` guard, not coincidental non-overlap.
    function invariant_EpochIsolation() public view {
        assertFalse(handler.crossEpochClaimSucceeded(), "epoch isolation: a cross-epoch claim paid out");
    }

    /// @notice I-14. Closure is terminal on both paths.
    function invariant_ClosedIsTerminal() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);
            if (!g.closedSeen) continue;
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            assertTrue(loan.closed, "terminal: a loan observed closed reverted to open");
        }
    }

    /// @notice GL-70. A loan's `drawn` matches exactly the stream withdrawals that happened during its own
    ///         lifetime — measured against the close-time snapshot, so a re-pledged stream's later draws
    ///         can never be attributed to the settled loan.
    function invariant_GL70StreamDrawAccounting() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);

            if (g.closedSeen) {
                assertEq(
                    uint256(loan.drawn),
                    uint256(g.withdrawnAtClose - g.withdrawnAtCreate),
                    "GL-70: closed loan's drawn != withdrawals during its own lifetime"
                );
            } else {
                // Still escrowed: nobody else can withdraw, so the live total is authoritative.
                assertEq(
                    uint256(loan.drawn),
                    uint256(sablier.getWithdrawnAmount(g.streamId) - g.withdrawnAtCreate),
                    "GL-70: open loan's drawn != withdrawals since origination"
                );
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                    PER-RUN SCANS AND COVERAGE GATE
    //////////////////////////////////////////////////////////////*/

    function afterInvariant() public view {
        _assertLazyAttributionCoverage();
        _assertEpochIsolation();
        _assertStructuralCoverage();
    }

    /// @notice E-1 / AC9 dust half. For every loan, the positions on its own tape tile its interval
    ///         exactly, and the floor-division shortfall on a closed loan is at most one wei per
    ///         contributing position.
    struct Attribution {
        uint64 covered;
        uint256 contributors;
        uint256 entitlementSum;
    }

    function _assertLazyAttributionCoverage() internal view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            _assertLoanAttribution(handler.loanIds(i));
        }
    }

    function _assertLoanAttribution(uint256 loanId) internal view {
        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);
        uint256 recovered = uint256(loan.drawn) + loan.repaid;

        Attribution memory a = _tallyAttribution(g.aprBps, g.epoch, loan.fillStart, loan.fillEnd, recovered);

        assertEq(
            a.covered, loan.fillEnd - loan.fillStart, "attribution: positions do not tile the loan's frozen interval"
        );
        if (loan.closed && a.contributors > 0) {
            assertLe(recovered - a.entitlementSum, a.contributors, "dust: shortfall exceeds contributor count");
        }
    }

    function _tallyAttribution(uint16 aprBps, uint32 epoch, uint64 fillStart, uint64 fillEnd, uint256 recovered)
        internal
        view
        returns (Attribution memory a)
    {
        uint256 positions = handler.epochPositionCount(aprBps, epoch);
        for (uint256 j = 0; j < positions; ++j) {
            (uint64 start, uint64 end) = handler.interval(handler.epochPositionAt(aprBps, epoch, j));
            uint64 contribution = handler.overlap(start, end, fillStart, fillEnd);
            if (contribution == 0) continue;
            a.covered += contribution;
            ++a.contributors;
            a.entitlementSum += (uint256(contribution) * recovered) / (fillEnd - fillStart);
        }
    }

    /// @notice AC8 / risk #3. No payout ever crossed a `(market, aprBps, epoch)` boundary.
    function _assertEpochIsolation() internal view {
        uint256 loanTotal = handler.loanCount();
        uint256 positionTotal = handler.positionCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);
            for (uint256 j = 0; j < positionTotal; ++j) {
                uint256 positionId = handler.positionIds(j);
                (,, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);
                if (aprBps == g.aprBps && epoch == g.epoch) continue;
                assertEq(lending.received(loanId, positionId), 0, "epoch isolation: cross-tape pair was paid");
            }
        }
    }

    /// @notice AC10. Every structural path the ticket names actually executed in this run.
    function _assertStructuralCoverage() internal view {
        assertGt(handler.frozenRecordCount(), 0, "coverage: no position was ever consumed (frozen-history idle)");
        assertGt(handler.covMultiNodeFill(), 0, "coverage: no fill crossed a tree-node boundary");
        assertGt(handler.covGrowth(), 0, "coverage: no tree growth event");
        assertGt(handler.covRollover(), 0, "coverage: no epoch rollover");
        assertGt(handler.covSelfFill(), 0, "coverage: no self-fill");
        assertGt(handler.covRepledge(), 0, "coverage: no stream re-pledge");
        assertGt(handler.covOverVested(), 0, "coverage: no over-vested open loan (withdrawable > outstanding)");
    }

    /*//////////////////////////////////////////////////////////////
                   NON-UNIT-ALIGNED GROSS PRICE (U3 REVIEW)
    //////////////////////////////////////////////////////////////*/

    /// @notice AC6 / I-20. Pins the floor/ceil boundary the 73-day/1.02 fixture never reaches: when a max
    ///         borrow's `grossPrice` is not a UNIT multiple, the fill floors below it, `obligationForFill`
    ///         leaves its equality fast path, and the resulting obligation must land strictly *below* the
    ///         stream's remaining — the safe direction. An off-by-one in either rounding direction, or a
    ///         fast path that fired on an inexact match, would break this.
    function test_GrossPriceNotUnitAligned_ObligationStrictlyBelowRemaining() public {
        address lender = makeAddr("boundaryLender");
        address borrower = makeAddr("boundaryBorrower");

        underlying.mint(lender, 200 ether);
        vm.prank(lender);
        underlying.approve(address(lending), type(uint256).max);
        vm.prank(lender);
        lending.supply(MARKET, APR_LOW, 100 ether);

        // factor = 1.02e18 exactly at 73 days / APR 1000, so grossPrice = remaining * 50 / 51.
        // remaining = 51e18 + 51 gives grossPrice = 50e18 + 50 — deliberately NOT a multiple of UNIT.
        uint128 remaining = 51 ether + 51;
        uint256 streamId = 90_001;
        sablier.setStream(
            streamId, borrower, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, remaining, 0
        );
        vm.prank(borrower);
        sablier.setApprovalForAll(address(lending), true);

        vm.prank(borrower);
        uint256 loanId = lending.borrow(MARKET, APR_LOW, type(uint128).max, streamId, 0);

        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);

        // The fill floored to the UNIT below grossPrice, so it is strictly under the stream's value.
        assertEq(loan.fillEnd - loan.fillStart, 50_000_000, "boundary: fill did not floor to the UNIT below");
        assertEq(loan.obligation, 51 ether, "boundary: obligation is not the ceil of the floored fill");
        assertLt(loan.obligation, remaining, "boundary: obligation must stay strictly below remaining");
    }
}
