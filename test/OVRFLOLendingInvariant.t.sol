// SPDX-License-Identifier: MIT
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
 * Mirror of the disposition table in `x-ray/invariants.md` ("Suite disposition"), which is the authoritative
 * copy. Every G/I/X/E block in that catalog (regenerated 2026-08-10 at f0661ab) is ENCODED here, COVERED by a
 * cited existing test, PARTIAL (with the uncovered half named), or OUT-OF-SCOPE with a reason. Guard blocks
 * G-1..G-68 are per-call preconditions, not falsifiable global properties, so they are covered by the unit
 * suite's error-path tests rather than encoded as invariants; only the guards whose *lifted* form is a global
 * property appear below (via their I-N).
 *
 *  ID    Disposition   Where
 *  ----  ------------  ------------------------------------------------------------------------------
 *  I-1   ENCODED       invariant_IntervalPartition — tiling of [0, filled) verified through stored `seq`
 *  I-2   ENCODED       invariant_FrozenHistory — per-position frozen sub-interval ghosts
 *  I-3   ENCODED       invariant_EscrowSolvency — underlying balance vs summed unfilled depth
 *  I-4   ENCODED       invariant_PotConservation — proceeds + Σ payouts == drawn + repaid, where Σ payouts is
 *                      the handler's balance-delta ghost, not the contract's own `received` mapping
 *  I-5   ENCODED       invariant_TokenCustody — ovrfloToken balance == Σ proceeds
 *  I-6   ENCODED       invariant_ClaimCaps (per-pair cap) + invariant_ClaimEntitlementCeiling (an independent
 *                      ghost-side ceiling recomputed per claim) + handler reaches over-vested open loans
 *  I-7   ENCODED       invariant_ClaimCaps (drawn + repaid <= obligation)
 *  I-8   ENCODED       invariant_LoanIntervalAtom — every fill >= MIN_LIQUIDITY_AMOUNT
 *  I-9   OUT-OF-SCOPE  Deliberately-contradicted lift (sub-atom leaves are legal after a partial
 *                      withdraw). Asserting it would be wrong; its *correct* consequence — that a
 *                      shrunken leaf never drops below filled — is I-2, which is encoded.
 *  I-10  ENCODED       invariant_UnitAlignment — tape quantities are exact UNIT multiples
 *  I-11  COVERED       test_SetAprBounds_RejectsInvertedRangeAndAboveCeiling in test/OVRFLOLending.t.sol
 *                      (admin-only bound, no fuzz reach)
 *  I-12  COVERED       test_SetFee_RejectsAboveMaxFeeBps in test/OVRFLOLending.t.sol (admin-only bound)
 *  I-13  ENCODED       invariant_TreeIntegrity's per-level Σchildren == parent walk, plus
 *                      test/TickTree.t.sol NodeOverflow tests and its reference-model differential fuzz
 *  I-14  ENCODED       invariant_ClosedIsTerminal — closed never reverts to open
 *  I-15  COVERED       test_SetTickSpacing_SetsOnceAndEmits in test/OVRFLOLending.t.sol (admin one-shot
 *                      latch; spacing is set once in setUp and no handler action mutates it)
 *  I-16  ENCODED       invariant_CursorSoundness — oldestLiveEpoch <= currentEpoch, every epoch below the
 *                      cursor is under the atom, AND both counters are monotone against pre-action ghosts
 *  I-17  ENCODED       invariant_CursorSoundness (every epoch below the cursor is under the atom)
 *  I-18  ENCODED       invariant_TreeIntegrity — per-epoch height monotone against a pre-action ghost, plus
 *                      covGrowth (a real height 4 -> 5 growth event executes in every run)
 *  I-19  ENCODED       invariant_ViewTruth — loansOf's reported claimable must equal what a subsequent
 *                      max claim actually pays, and a reported-nonzero claimable must never revert
 *  I-20  ENCODED       invariant_ClaimCaps (obligation <= remaining at origination),
 *                      invariant_ObligationPricing (obligation recomputed handler-side per tick), and
 *                      test_GrossPriceNotUnitAligned_ObligationStrictlyBelowRemaining and
 *                      test_Borrow_ObligationTracksTheTickRate (the floor/ceil boundary and the second
 *                      tick, neither of which the 73-day/1.02 fixture reaches)
 *  I-21  ENCODED       afterInvariant dust bound — a closed, fully drained loan's residual `proceeds` is at
 *                      most one wei per contributing position
 *  I-22  OUT-OF-SCOPE  Maturity-gate asymmetry is a per-function routing fact, not a state identity.
 *                      Covered by test_Supply_RevertsAtAndAfterMaturity /
 *                      test_Withdraw_RemainsAvailableAfterMaturity / test_Repay_WorksAfterMaturity /
 *                      test_Close_WorksAfterMaturity in test/OVRFLOLending.t.sol. The wind-down half is
 *                      additionally exercised here: `_maturityExcursion` warps past expiry every run and
 *                      repays, closes and claims there (covMaturityReached).
 *  I-23  OUT-OF-SCOPE  Ordering property inside one call (checked-then-computed); unreachable as a
 *                      cross-call state identity. Covered by
 *                      test_Borrow_SucceedsOneSecondBeforeMaturityRevertsAtMaturity.
 *  I-24  OUT-OF-SCOPE  Vault solvency — different contract. Covered by test/OVRFLOInvariant.t.sol and
 *                      test/OVRFLOWrapUnwrap.invariant.t.sol; this suite deploys no vault.
 *  X-1   OUT-OF-SCOPE  Series config immutability lives in OVRFLO.setSeriesApproved. Covered by
 *                      test_SetSeriesApproved_RevertsForDuplicateMarketConfiguration and
 *                      test_SetSeriesApproved_RevertsForDuplicatePtRegistration in test/OVRFLO.t.sol.
 *  X-2   ENCODED       invariant_EscrowSolvency + invariant_TreeIntegrity both read root() - filled on
 *                      every epoch every call; an underflow reverts the invariant, which is the failure.
 *  X-3   OUT-OF-SCOPE  Constructor wiring against a write-once factory mapping; no runtime state
 *                      transition to fuzz. Covered by test_Constructor_WiresRegistryAndInitialAdminState.
 *  X-4   COVERED       test_SetTreasury_RejectsZeroAddress in test/OVRFLOLending.t.sol; the residual
 *                      "treasury stays a live sink" half is an off-chain multisig assumption, not fuzzable.
 *  X-5   OUT-OF-SCOPE  Vault/token ownership. Covered by test/OVRFLOToken.t.sol.
 *  E-1   ENCODED       afterInvariant lazy-attribution coverage — Σ overlap over the epoch's positions
 *                      equals the loan's interval length, for every loan, forever
 *  E-2   ENCODED       invariant_ClaimCaps + invariant_ClaimEntitlementCeiling + invariant_PotConservation
 *  E-3   ENCODED       invariant_EscrowSolvency + invariant_TokenCustody (both exit paths are funded)
 *  E-4   ENCODED       invariant_ClaimCaps (obligation <= remaining at origination)
 *  E-5   PARTIAL       The structural half is encoded — invariant_LoanIntervalAtom (borrow atom),
 *                      invariant_CursorSoundness, covGrowth/covRollover prove growth and rollover are
 *                      survivable non-events. The *economic* half (griefing costs gas proportional to the
 *                      damage) is a cost claim, not a state identity: it is owned by U7's Multicall
 *                      supply+withdraw gas measurement and the borrow gas-flatness pair.
 *
 * Additionally encoded beyond the catalog, per the ticket's acceptance criteria:
 *   - GL-70 re-pledge safety: invariant_GL70StreamDrawAccounting, using close-time withdrawn snapshots.
 *   - Epoch isolation (risk #3): `_crossEpochProbe` and the adversarialCrossEpochClaim action pair
 *     numerically identical intervals across epochs, decode the revert selector, and require it to be
 *     exactly `EpochMismatch`; invariant_EpochIsolation asserts no such claim ever paid, and
 *     afterInvariant's _assertEpochIsolation independently asserts that no cross-tape pair ever accrued.
 *   - Money recipients (U6 mutation campaign): invariant_MoneyRecipients pins WHO receives value —
 *     borrower net, treasury fee, and withdraw refund all land in the right account.
 *   - Stream custody: invariant_StreamCustody — every open loan's NFT is held by the market.
 *   - Handler structural coverage: afterInvariant asserts multi-node fills, growth, rollover, self-fills,
 *     re-pledges, over-vested open loans, claims, repays, closes, post-fill withdraws, the cross-epoch
 *     rejection, maturity reachability, and post-baseline (fuzz-path) structural work all executed.
 */

/// @dev Extends the unit suite's harness with the reads, the walk and the one seed the property suite needs.
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
        _ticks[market][aprBps].epochs[epoch].tree.leaves = leaves;
    }

    function exposed_treeHeight(address market, uint16 aprBps, uint32 epoch) external view returns (uint8) {
        return _ticks[market][aprBps].epochs[epoch].tree.height;
    }

    function exposed_prefixAndLeaf(address market, uint16 aprBps, uint32 epoch, uint32 leafIndex)
        external
        view
        returns (uint64 prefixValue, uint64 leafValue)
    {
        TickTree.Tree storage tree = _ticks[market][aprBps].epochs[epoch].tree;
        return (tree.prefix(leafIndex), tree.leaf(leafIndex));
    }

    /// @notice Counts nodes whose stored value disagrees with the sum of their eight children.
    /// @dev The literal form of AC4 ("stored node = sum of children"). The walk runs inside the contract
    ///      rather than as one external call per node, and is bounded: a growth-seeded epoch carries 4,097
    ///      leaves, so a full level-0 walk would be 513 parents on every one of the 20,000 invariant
    ///      evaluations in a campaign. `maxParentsPerLevel` caps the prefix walk and the last active parent
    ///      is always checked, so both the frozen left edge and the live frontier are covered at every level.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps APR tick in basis points.
    /// @param epoch Tick epoch whose tape is walked.
    /// @param maxParentsPerLevel Parents to check per level before jumping to the last one.
    /// @return breaks Number of parents that did not equal the sum of their children.
    function exposed_treeNodeBreaks(address market, uint16 aprBps, uint32 epoch, uint256 maxParentsPerLevel)
        external
        view
        returns (uint256 breaks)
    {
        TickTree.Tree storage tree = _ticks[market][aprBps].epochs[epoch].tree;
        uint32 leaves = tree.leaves;
        uint8 height = tree.height;
        if (leaves == 0 || height == 0) return 0;

        for (uint8 level = 0; level + 1 < height; ++level) {
            uint256 span = uint256(TickTree.BRANCHING_FACTOR) ** (uint256(level) + 1);
            uint256 parents = (uint256(leaves) + span - 1) / span;
            uint256 walk = parents < maxParentsPerLevel ? parents : maxParentsPerLevel;
            for (uint256 p = 0; p < walk; ++p) {
                if (_nodeBroken(tree, level, p)) ++breaks;
            }
            if (parents > walk && _nodeBroken(tree, level, parents - 1)) ++breaks;
        }
    }

    /// @dev True when the parent at `level + 1` disagrees with the sum of its eight children at `level`.
    function _nodeBroken(TickTree.Tree storage tree, uint8 level, uint256 parentIndex) private view returns (bool) {
        uint256 childSum;
        for (uint256 c = 0; c < TickTree.BRANCHING_FACTOR; ++c) {
            childSum += _nodeAt(tree, level, parentIndex * TickTree.BRANCHING_FACTOR + c);
        }
        return childSum != _nodeAt(tree, level + 1, parentIndex);
    }

    /// @dev Unpacks one node from its four-per-word packing (mirrors `TickTree._readNode`, which is private).
    function _nodeAt(TickTree.Tree storage tree, uint8 level, uint256 nodeIndex) private view returns (uint64) {
        uint256 packed = tree.nodes[level][nodeIndex >> 2];
        return uint64((packed >> ((nodeIndex & 3) * 64)) & type(uint64).max);
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

    /// @dev Pricing constants, re-declared so the handler can recompute an obligation without calling
    ///      `StreamPricing` — the whole point of the check is that it is an independent derivation.
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant BPS = 10_000;

    /// @dev Handler calls between forced (non-baseline) structural passes. The weighted `structural`
    ///      selector alone cannot guarantee a post-baseline pass — at depth 10 the fuzzer skips it in
    ///      roughly half of all runs — and the fuzz-path coverage gate must not be weakened to accommodate
    ///      that. The cadence guarantees the gate; the weighted selector still adds unscheduled passes.
    uint256 internal constant STRUCTURAL_CADENCE = 5;
    /// @dev Bounds on the claim-drain scan, which is quadratic in (loans × positions) if left open.
    uint256 internal constant DRAIN_LOANS = 2;
    uint256 internal constant DRAIN_POSITIONS = 16;

    LendingInvariantHarness public immutable lending;
    MockLendingSablier public immutable sablier;
    TestERC20 public immutable underlying;
    TestERC20 public immutable ovrfloToken;
    address public immutable market;
    address public immutable treasury;
    uint256 public immutable expiry;

    address[5] public actors;
    uint16[2] public tickAprs;

    uint256[] public positionIds;
    uint256[] public loanIds;
    uint256[] public streamIds;
    mapping(uint256 => bool) public burnedStreams;

    /// @dev apr => epoch => position ids appended to that tape, in leaf order.
    mapping(uint16 => mapping(uint32 => uint256[])) internal epochPositions;
    mapping(uint16 => uint32) public maxEpochSeen;

    /// @dev Per-tape mirrors, in UNITs, accumulated from handler-observed token movement.
    mapping(uint16 => mapping(uint32 => uint64)) public ghostPosted;
    mapping(uint16 => mapping(uint32 => uint64)) public ghostWithdrawn;
    mapping(uint16 => mapping(uint32 => uint64)) public ghostFilled;

    /// @dev Pre-action monotonicity anchors (I-16, I-18). Recorded before every action so the invariant
    ///      compares live state against a value that predates the mutation it is judging.
    mapping(uint16 => uint32) public ghostOldestEpoch;
    mapping(uint16 => uint32) public ghostCurrentEpoch;
    mapping(uint16 => mapping(uint32 => uint8)) public ghostHeight;

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

    /// @dev Payouts as *observed at the claimant's balance*, not as the contract recorded them. Comparing
    ///      the two is the money-movement identity that a "credit without transfer" mutation breaks.
    mapping(uint256 => mapping(uint256 => uint128)) public ghostReceived;
    mapping(uint256 => uint128) public ghostReceivedLoan;

    /// @dev Fees as expected (recomputed handler-side) and as observed at the treasury's balance.
    uint256 public ghostFeeSum;
    uint256 public ghostTreasuryReceived;

    /// @dev Loans that were closed *and* fully drained by `_drainAllClaims`; the dust bound applies to them.
    uint256[] public dustLoans;
    mapping(uint256 => bool) internal dustLoanSeen;

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

    /// @dev The same events, counted only when they happen on a fuzzer-driven call rather than inside the
    ///      front-loaded baseline. Without them a mutation that breaks every path except the baseline's
    ///      first pass survives: the gate would still be green because the baseline alone satisfied it.
    uint256 public covRolloverFromFuzz;
    uint256 public covClaimFromFuzz;
    uint256 public covCloseFromFuzz;
    uint256 public covRepayFromFuzz;
    uint256 public covRepledgeFromFuzz;
    uint256 public covOverVestedFromFuzz;

    /// @dev Failure signals recorded by handler actions. They are counters rather than assertions because
    ///      an assertion that reverts inside a handler erases the state change that proves the failure —
    ///      and with `fail_on_revert = false` the reverting call is discarded entirely.
    uint256 public viewTruthMismatches;
    uint128 public lastViewReported;
    uint128 public lastViewPaid;
    uint256 public reportedButReverted;
    uint128 public lastReportedOnRevert;
    bool public crossEpochClaimSucceeded;

    uint256 public borrowPayoutMismatches;
    uint256 public lastBorrowExpected;
    uint256 public lastBorrowPaid;
    uint256 public refundRecipientMismatches;
    uint256 public lastRefundExpected;
    uint256 public lastRefundPaid;
    uint256 public obligationMismatches;
    uint256 public lastObligationExpected;
    uint256 public lastObligationStored;
    uint256 public entitlementCeilingViolations;
    uint256 public lastCeilingHeadroom;
    uint256 public lastCeilingPaid;

    /// @dev Growth and multi-node fills latch per tape, not per run: a rolled epoch is a fresh tape and
    ///      must be reachable again, or the fuzz-path counters could never move after the baseline.
    mapping(uint16 => mapping(uint32 => bool)) internal growthDone;
    mapping(uint16 => mapping(uint32 => bool)) internal multiNodeDone;
    bool internal baselineDone;
    bool internal inBaseline;
    uint256 internal callCount;
    /// @dev The loan most recently closed. `_drainAllClaims` starts there: a freshly settled loan is the
    ///      one whose pot is guaranteed non-empty, and the claim liveness gate must not depend on a random
    ///      rotation happening to land on it.
    uint256 internal lastSettledLoan;

    /// @notice Runs the structural scenarios once, on whichever handler action the fuzzer picks first in a
    ///         run, then forces a further pass every `STRUCTURAL_CADENCE` calls.
    /// @dev Three constraints shape this. (1) Selector weighting alone cannot *guarantee* the coverage gate
    ///      — at the default profile's depth 10 there is a real chance the fuzzer never picks `structural`
    ///      at all — and the gate must not be weakened to accommodate that, so the baseline front-loads it.
    ///      (2) A baseline-only proof is vacuous against any mutation that leaves the first pass intact, so
    ///      the cadence forces post-baseline passes whose counters are gated separately. (3) The seed is the
    ///      fuzzer's own, not a hardcoded prime: coverage stays deterministic while the *shape* of the
    ///      baseline (which tick, which actors, which streams) varies run to run.
    modifier handlerAction(uint256 seed) {
        _snapshotFrozenHistory();
        _snapshotMonotone();
        ++callCount;
        if (!baselineDone) {
            baselineDone = true;
            inBaseline = true;
            _runBaseline(seed);
            inBaseline = false;
        } else if (callCount % STRUCTURAL_CADENCE == 0) {
            _structuralPass(seed, false);
        }
        _;
    }

    /// @dev The front-loaded scenario set. Ordering is load-bearing: the partial fill must land on a fresh
    ///      single-epoch tape, the cross-epoch probe needs a rollover to have happened *and* a loan to exist
    ///      on the same tick, and the drain must follow the closure that funded the pot.
    function _runBaseline(uint256 seed) internal {
        _withdrawFromFilledPosition(seed);
        _multiNodeFill(seed);
        _forceGrowth(seed);
        _forceRollover(seed);
        _crossEpochProbe(seed);
        _settleAndRepledge(seed);
        _overVestOpenLoan(seed);
        _partialRepay(seed);
        _drainAllClaims(seed);
        _maturityExcursion(seed);
    }

    /// @notice Records the pre-action truth that `invariant_FrozenHistory` (AC2 / I-2) asserts against.
    /// @dev Two constraints force this shape. First, Foundry discards storage written inside an invariant
    ///      function, so the ghost cannot be recorded there — it would record nothing and compare nothing,
    ///      passing against any implementation. Second, the recording must not assert: an assertion that
    ///      reverts inside a handler reverts the whole action, which un-does the very state change it was
    ///      meant to expose and hides it from the invariant. So this snapshots only, and it runs *before*
    ///      anything else in the action — including the baseline, whose own fills must be anchored too.
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

    /// @dev Pre-action anchors for the two monotonicity halves (I-16 cursor/epoch, I-18 tree height).
    function _snapshotMonotone() internal {
        for (uint256 t = 0; t < tickAprs.length; ++t) {
            uint16 aprBps = tickAprs[t];
            (,,, uint32 oldest, uint32 current) = lending.exposed_epochState(market, aprBps, 0);
            ghostOldestEpoch[aprBps] = oldest;
            ghostCurrentEpoch[aprBps] = current;
            ghostHeight[aprBps][current] = lending.exposed_treeHeight(market, aprBps, current);
        }
    }

    constructor(
        LendingInvariantHarness lending_,
        MockLendingSablier sablier_,
        TestERC20 underlying_,
        TestERC20 ovrfloToken_,
        address market_,
        address treasury_,
        uint256 expiry_,
        uint16 aprLow,
        uint16 aprHigh
    ) {
        lending = lending_;
        sablier = sablier_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        market = market_;
        treasury = treasury_;
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

    function supply(uint256 actorSeed, uint256 aprSeed, uint256 amountSeed) public handlerAction(amountSeed) {
        address actor = _actor(actorSeed);
        uint16 aprBps = _tick(aprSeed);
        uint128 amount = _unitAmount(amountSeed, MIN_LIQUIDITY_AMOUNT, 40 ether);
        _doSupply(actor, aprBps, amount);
    }

    function withdraw(uint256 positionSeed) public handlerAction(positionSeed) {
        if (positionIds.length == 0) return;
        _doWithdraw(positionIds[positionSeed % positionIds.length]);
    }

    function borrow(uint256 actorSeed, uint256 aprSeed, uint256 targetSeed) public handlerAction(targetSeed) {
        address actor = _actor(actorSeed);
        uint16 aprBps = _tick(aprSeed);
        uint128 target = _unitAmount(targetSeed, MIN_LIQUIDITY_AMOUNT, 120 ether);
        _doBorrow(actor, aprBps, target);
    }

    function repay(uint256 loanSeed, uint256 amountSeed) public handlerAction(amountSeed) {
        if (loanIds.length == 0) return;
        uint256 loanId = loanIds[loanSeed % loanIds.length];
        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        if (loan.closed || outstanding == 0) return;

        // A third of the time repay the exact outstanding, so the closure branch is not left to chance.
        uint128 amount = amountSeed % 3 == 0 ? outstanding : uint128(bound(amountSeed, 1, outstanding));
        _doRepay(loanId, _actor(amountSeed), amount);
    }

    function close(uint256 loanSeed) public handlerAction(loanSeed) {
        if (loanIds.length == 0) return;
        _doClose(loanIds[loanSeed % loanIds.length], _actor(loanSeed));
    }

    /// @notice Claims everything for a (loan, position) pair and pins `loansOf`'s reported `claimable`
    ///         against what the money path actually pays (U5-review view-truth criterion).
    function claimMax(uint256 loanSeed, uint256 positionSeed) public handlerAction(positionSeed) {
        if (loanIds.length == 0 || positionIds.length == 0) return;
        _claimAndRecord(loanIds[loanSeed % loanIds.length], positionIds[positionSeed % positionIds.length], true);
    }

    /// @notice Advances time and vests streams. Vesting is seeded independently of any loan's outstanding
    ///         so that `withdrawable > outstanding` (the over-vested theft boundary) is reachable.
    /// @dev Vesting is monotone: Sablier's withdrawable never decreases on its own, so the mock is only ever
    ///      pushed upward. A decreasing vest would fabricate a state the real contract cannot reach and
    ///      would let a claim's harvest silently under-draw for reasons no invariant could attribute.
    function warpAndVest(uint256 timeSeed, uint256 vestSeed) public handlerAction(vestSeed) {
        vm.warp(block.timestamp + bound(timeSeed, 1 hours, 4 days));
        if (block.timestamp >= expiry) ++covMaturityReached;

        for (uint256 i = 0; i < streamIds.length; ++i) {
            uint256 streamId = streamIds[i];
            uint128 deposited = sablier.getDepositedAmount(streamId);
            uint128 withdrawn = sablier.getWithdrawnAmount(streamId);
            if (deposited <= withdrawn) continue;
            uint128 headroom = deposited - withdrawn;
            uint128 vested = uint128(bound(uint256(keccak256(abi.encode(vestSeed, i))), 0, headroom));
            uint128 current = sablier.withdrawableAmountOf(streamId);
            sablier.setWithdrawable(streamId, vested > current ? vested : current);
        }
        _tallyOverVested();
    }

    function advanceCursor(uint256 aprSeed, uint256 stepSeed) public handlerAction(stepSeed) {
        uint16 aprBps = _tick(aprSeed);
        try lending.advanceEpochCursor(market, aprBps, uint32(bound(stepSeed, 1, 8))) {} catch {}
    }

    /// @notice Proves the epoch guard, not coincidental non-overlap: pairs a position and a loan that sit
    ///         on numerically identical intervals in different epochs and asserts the claim reverts.
    function adversarialCrossEpochClaim(uint256 seed) public handlerAction(seed) {
        _crossEpochProbe(seed);
    }

    /// @notice The structural driver. The two expensive sub-scenarios latch per tape so a rolled epoch can
    ///         reach them again; everything else runs on every call so rollovers, closures, repays, drains
    ///         and re-pledges keep interleaving with ordinary traffic.
    function structural(uint256 seed) public handlerAction(seed) {
        _structuralPass(seed, true);
    }

    /*//////////////////////////////////////////////////////////////
                        STRUCTURAL SUB-SCENARIOS
    //////////////////////////////////////////////////////////////*/

    /// @dev One structural pass. `heavy` gates the two scenarios that cost thousands of leaves.
    function _structuralPass(uint256 seed, bool heavy) internal {
        uint16 aprBps = _tick(seed);
        uint32 epoch = _tickCurrentEpoch(aprBps);
        if (heavy) {
            if (!multiNodeDone[aprBps][epoch]) _multiNodeFill(seed);
            if (!growthDone[aprBps][epoch]) _forceGrowth(seed);
        }
        _forceRollover(seed);
        _crossEpochProbe(seed);
        _settleAndRepledge(seed);
        _overVestOpenLoan(seed);
        _partialRepay(seed);
        _withdrawFromFilledPosition(seed);
        _drainAllClaims(seed);
    }

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
        if (_tickCurrentEpoch(aprBps) > before) {
            ++covRollover;
            if (_fuzzDriven()) ++covRolloverFromFuzz;
        }
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
            growthDone[aprBps][epoch] = true;
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
        if (covMultiNodeFill > before) multiNodeDone[aprBps][current] = true;
    }

    /// @dev Vests an open loan's stream strictly past its own outstanding. `withdrawable > outstanding` is
    ///      routine once a partially-borrowed stream keeps vesting, and it is the exact state in which a
    ///      claimer would drain co-lenders' pot shares if `claim`'s `min(withdrawable, outstanding)` clamp
    ///      were removed — the boundary the U4 review's mutation testing identified. The scan looks for a
    ///      loan that *can* be over-vested (a max borrow owes the whole stream, so it never can) rather than
    ///      taking the first open loan and giving up, or the coverage gate would depend on loan ordering.
    function _overVestOpenLoan(uint256 seed) internal {
        for (uint256 i = 0; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[_offsetIndex(seed, i, loanIds.length)];
            (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
            if (loan.closed || outstanding == 0) continue;

            uint128 headroom = sablier.getDepositedAmount(loan.streamId) - sablier.getWithdrawnAmount(loan.streamId);
            if (headroom <= outstanding) continue;

            sablier.setWithdrawable(loan.streamId, outstanding < headroom / 2 ? outstanding * 2 : headroom);
            uint256 before = covOverVested;
            _tallyOverVested();
            if (covOverVested > before && _fuzzDriven()) ++covOverVestedFromFuzz;
            return;
        }
    }

    /// @dev Settles an indebted open loan by vesting its stream to exactly cover the outstanding, then
    ///      re-pledges the returned stream to a fresh loan — GL-70's reuse scenario, driven rather than
    ///      hoped for. When no indebted loan is open it originates one first, so a structural pass always
    ///      leaves a closure, a funded pot and a fresh open loan behind: the closure, claim and repay
    ///      liveness gates would otherwise depend on what earlier passes happened to leave lying around.
    function _settleAndRepledge(uint256 seed) internal {
        uint256 loanId = _findOpenLoanWithDebt(seed);
        if (loanId == 0) {
            _repledgeReturnedStream(seed);
            loanId = _findOpenLoanWithDebt(seed);
        }
        if (loanId != 0) {
            (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
            // obligation <= remaining, so the outstanding is always reachable withdrawable.
            sablier.setWithdrawable(loan.streamId, outstanding);
            _doClose(loanId, _actor(seed));
        }
        _repledgeReturnedStream(seed);
    }

    /// @dev Re-pledges a stream that a prior loan already used and returned (GL-70's reuse scenario).
    function _repledgeReturnedStream(uint256 seed) internal {
        for (uint256 i = 0; i < streamIds.length; ++i) {
            uint256 streamId = streamIds[_offsetIndex(seed, i, streamIds.length)];
            if (!streamWasPledged[streamId]) continue;
            if (burnedStreams[streamId]) continue;
            address owner = _ownerOfOrZero(streamId);
            if (owner == address(0) || owner == address(lending)) continue;
            if (sablier.getDepositedAmount(streamId) <= sablier.getWithdrawnAmount(streamId)) continue;

            uint16 aprBps = _tick(seed);
            // Guarantee borrowable depth, otherwise the re-pledge cannot be observed.
            _doSupply(_actor(seed), aprBps, MIN_LIQUIDITY_AMOUNT * 5);
            _doBorrow(owner, aprBps, MIN_LIQUIDITY_AMOUNT * 3);
            return;
        }
    }

    /// @dev Repays part of an open loan's outstanding. `repay` is permissionless, so any funded actor may
    ///      be the payer. Without this the whole repay path depends on the weighted selector firing *and*
    ///      landing on a live loan, which no per-run gate can rely on.
    function _partialRepay(uint256 seed) internal {
        uint256 loanId = _findOpenLoanWithDebt(seed);
        if (loanId == 0) return;
        (, uint128 outstanding) = lending.loanState(loanId);

        uint128 amount = outstanding / 4;
        if (amount == 0) amount = outstanding;
        _doRepay(loanId, _actor(seed), amount);
    }

    /// @dev Supplies a fresh position, fills exactly two atoms of it, then withdraws the unfilled tail —
    ///      the AE2 shape, driven deterministically so the "withdraw after a partial fill" liveness gate
    ///      never depends on the fuzzer stumbling onto a partially consumed position.
    function _withdrawFromFilledPosition(uint256 seed) internal {
        uint16 aprBps = _tick(seed);
        (,,, uint32 oldest, uint32 current) = lending.exposed_epochState(market, aprBps, 0);
        // The fill lands in the oldest live epoch; if that is not where the supply goes, the construction
        // cannot place `filled` inside the new position.
        if (oldest != current) return;

        address lender = _actorAt(seed, 3);
        uint256 positionId = _doSupply(lender, aprBps, MIN_LIQUIDITY_AMOUNT * 4);
        if (positionId == 0) return;

        (uint64 start,) = _interval(positionId);
        (,, uint64 filled) = _epochNumbers(aprBps, current);
        if (filled > start) return;

        address borrower = _actorWithFreeStream(seed);
        if (borrower == address(0)) return;
        uint64 targetUnits = (start - filled) + MIN_LIQUIDITY_UNITS * 2;
        _doBorrow(borrower, aprBps, uint128(uint256(targetUnits) * UNIT));

        _doWithdraw(positionId);
    }

    /// @dev Claims every contributing position of a bounded set of loans to zero. Two properties depend on
    ///      an actually-drained loan: the claim liveness gate, and the dust bound (a closed loan's residual
    ///      `proceeds` after everyone has been paid). A loan is registered for the dust check only when it
    ///      was already closed at drain time — no further value can enter a closed loan's pot, so the
    ///      residual it is measured against can only shrink afterwards.
    function _drainAllClaims(uint256 seed) internal {
        uint256 loanTotal = loanIds.length;
        if (loanTotal == 0) return;

        if (lastSettledLoan != 0) _drainLoan(lastSettledLoan);
        uint256 scanned = DRAIN_LOANS < loanTotal ? DRAIN_LOANS : loanTotal;
        for (uint256 i = 0; i < scanned; ++i) {
            _drainLoan(loanIds[_offsetIndex(seed, i, loanTotal)]);
        }
    }

    /// @dev Claims one loan to exhaustion across every position on its tape, and registers it for the dust
    ///      bound when it was already closed — a closed loan can take no further inflow, so its residual
    ///      `proceeds` can only shrink after this point.
    function _drainLoan(uint256 loanId) internal {
        LoanGhost storage g = loanGhostOf[loanId];
        uint256[] storage inEpoch = epochPositions[g.aprBps][g.epoch];
        if (inEpoch.length > DRAIN_POSITIONS) return;

        for (uint256 j = 0; j < inEpoch.length; ++j) {
            _claimAndRecord(loanId, inEpoch[j], false);
        }

        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        if (loan.closed && !dustLoanSeen[loanId]) {
            dustLoanSeen[loanId] = true;
            dustLoans.push(loanId);
        }
    }

    /// @dev Pairs a position and a loan that sit on numerically identical intervals in different epochs.
    ///      The rejection is only meaningful if it is the *epoch guard* that fires, so the revert selector
    ///      is decoded and only `EpochMismatch` counts — a `NoOverlap` (coincidental non-overlap) or any
    ///      other revert leaves the coverage counter untouched and the gate red.
    function _crossEpochProbe(uint256 seed) internal {
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
                } catch (bytes memory reason) {
                    if (_selectorOf(reason) == OVRFLOLending.EpochMismatch.selector) ++covCrossEpochRejected;
                }
                return;
            }
        }
    }

    /// @dev Warps past series maturity, exercises the three wind-down paths there (repay, close, claim),
    ///      then restores the clock. KTD7's asymmetry is only half-proven by a suite that never crosses
    ///      expiry, and a permanent warp would kill `supply`/`borrow` for the rest of the run — every later
    ///      call would become a no-op and the money paths would stop being fuzzed. Rewinding is sound here:
    ///      every property this suite asserts is a state identity, not a temporal one, and no contract
    ///      state records a timestamp.
    function _maturityExcursion(uint256 seed) internal {
        uint256 restore = block.timestamp;
        if (restore >= expiry) return;

        vm.warp(expiry + 1 days);
        ++covMaturityReached;
        _partialRepay(seed);

        uint256 loanId = _findOpenLoan(seed);
        if (loanId != 0) {
            (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
            sablier.setWithdrawable(loan.streamId, outstanding);
            _doClose(loanId, _actor(seed));
        }
        _drainAllClaims(seed);

        vm.warp(restore);
    }

    function _findOpenLoan(uint256 seed) internal view returns (uint256) {
        for (uint256 i = 0; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[_offsetIndex(seed, i, loanIds.length)];
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            if (!loan.closed) return loanId;
        }
        return 0;
    }

    /// @dev An open loan that still owes something. `outstanding == 0 && !closed` is a legal, reachable
    ///      state (the obligation was fully harvested through claims), and closing such a loan draws
    ///      nothing — useless for the scenarios that need a funded pot afterwards.
    function _findOpenLoanWithDebt(uint256 seed) internal view returns (uint256) {
        for (uint256 i = 0; i < loanIds.length; ++i) {
            uint256 loanId = loanIds[_offsetIndex(seed, i, loanIds.length)];
            (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
            if (!loan.closed && outstanding > 0) return loanId;
        }
        return 0;
    }

    /*//////////////////////////////////////////////////////////////
                         CORE ACTION IMPLEMENTATIONS
    //////////////////////////////////////////////////////////////*/

    function _doSupply(address actor, uint16 aprBps, uint128 amount) internal returns (uint256) {
        vm.prank(actor);
        try lending.supply(market, aprBps, amount) returns (uint256 positionId) {
            (,,, uint32 epoch,) = lending.positions(positionId);
            positionIds.push(positionId);
            epochPositions[aprBps][epoch].push(positionId);
            ghostPosted[aprBps][epoch] += uint64(amount / UNIT);
            if (epoch > maxEpochSeen[aprBps]) maxEpochSeen[aprBps] = epoch;
            return positionId;
        } catch {
            return 0;
        }
    }

    /// @dev Withdraw with the recipient check the escrow invariant cannot make: escrow solvency only sees
    ///      the market's own balance fall, which a refund paid to the wrong address satisfies just as well.
    ///      The lender-side delta is what proves the money reached its owner.
    function _doWithdraw(uint256 positionId) internal {
        (address lender,, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);
        if (lender == address(0)) return;

        (,, uint64 filledBefore) = _epochNumbers(aprBps, epoch);
        (uint64 startBefore,) = _interval(positionId);

        uint256 lendingBefore = ovrfloToken.balanceOf(address(lending));
        uint256 lenderBefore = ovrfloToken.balanceOf(lender);
        vm.prank(lender);
        try lending.withdraw(positionId) {
            uint256 released = lendingBefore - ovrfloToken.balanceOf(address(lending));
            uint256 credited = ovrfloToken.balanceOf(lender) - lenderBefore;
            if (released != credited) {
                ++refundRecipientMismatches;
                lastRefundExpected = released;
                lastRefundPaid = credited;
            }
            ghostWithdrawn[aprBps][epoch] += uint64(released / UNIT);
            if (filledBefore > startBefore) ++covWithdrawAfterFill;
        } catch {}
    }

    function _doBorrow(address actor, uint16 aprBps, uint128 target) internal {
        uint256 streamId = _freeStreamOf(actor);
        if (streamId == 0) return;

        uint128 remainingBefore = sablier.getDepositedAmount(streamId) - sablier.getWithdrawnAmount(streamId);
        uint128 withdrawnBefore = sablier.getWithdrawnAmount(streamId);
        uint256 borrowerBefore = ovrfloToken.balanceOf(actor);
        uint256 treasuryBefore = ovrfloToken.balanceOf(treasury);
        // Saturating: warpAndVest can cross maturity, and a post-maturity borrow attempt must reach
        // the contract's own gate (caught below) instead of underflowing here in the handler.
        uint256 timeToMaturity = block.timestamp < expiry ? expiry - block.timestamp : 0;

        vm.prank(actor);
        try lending.borrow(market, aprBps, target, streamId, 0, address(0)) returns (uint256 loanId) {
            _recordBorrow(loanId, aprBps, streamId, remainingBefore, withdrawnBefore);
            _checkBorrowMoney(loanId, actor, borrowerBefore, treasuryBefore);
            _checkObligation(loanId, remainingBefore, aprBps, timeToMaturity);
        } catch {}
    }

    function _doRepay(uint256 loanId, address payer, uint128 amount) internal {
        vm.prank(payer);
        try lending.repay(loanId, amount) {
            ++covRepay;
            if (_fuzzDriven()) ++covRepayFromFuzz;
            _recordClosureIfSettled(loanId);
        } catch {}
    }

    function _doClose(uint256 loanId, address caller) internal {
        vm.prank(caller);
        try lending.close(loanId) {
            ++covClose;
            if (_fuzzDriven()) ++covCloseFromFuzz;
            lastSettledLoan = loanId;
            _recordClosureIfSettled(loanId);
        } catch {}
    }

    /// @dev The one claim path. Every claim in the suite routes through it so the balance-delta ghost is
    ///      complete: a payout the ghost never saw would break the `received` parity assertion.
    /// @param loanId The loan claimed against.
    /// @param positionId The claiming position.
    /// @param viewChecked When true, also pin `loansOf`'s reported claimable against the actual payout
    ///        (I-19) and record a reported-nonzero claimable that reverted.
    function _claimAndRecord(uint256 loanId, uint256 positionId, bool viewChecked) internal {
        (address lender,,,,) = lending.positions(positionId);
        if (lender == address(0)) return;

        uint128 reported = viewChecked ? _reportedClaimable(positionId, loanId) : 0;
        (bool capped, uint256 headroom) = _entitlementHeadroom(loanId, positionId);

        uint256 balanceBefore = ovrfloToken.balanceOf(lender);
        vm.prank(lender);
        try lending.claim(loanId, positionId, type(uint128).max) {
            uint128 paid = uint128(ovrfloToken.balanceOf(lender) - balanceBefore);
            // Recorded, never asserted here: an assertion that reverts inside a handler reverts the whole
            // action, and with `fail_on_revert = false` that call is silently discarded — the divergence
            // would erase its own evidence. The invariants read these counters and assert.
            if (viewChecked && paid != reported) {
                ++viewTruthMismatches;
                lastViewReported = reported;
                lastViewPaid = paid;
            }
            if (capped && paid > headroom) {
                ++entitlementCeilingViolations;
                lastCeilingHeadroom = headroom;
                lastCeilingPaid = paid;
            }
            ghostReceived[loanId][positionId] += paid;
            ghostReceivedLoan[loanId] += paid;
            ++covClaim;
            if (_fuzzDriven()) ++covClaimFromFuzz;
        } catch {
            if (viewChecked && reported > 0) {
                ++reportedButReverted;
                lastReportedOnRevert = reported;
            }
        }
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
        if (streamWasPledged[streamId]) {
            ++covRepledge;
            if (_fuzzDriven()) ++covRepledgeFromFuzz;
        }
        streamWasPledged[streamId] = true;

        _tallyFillShape(loanId, aprBps, loan);
    }

    /// @dev Where the principal landed. `actualBorrow` is read back from the loan's own frozen interval —
    ///      the tape, not the payment path — so a borrow that consumes depth and pays the wrong account (or
    ///      nothing) leaves the tape correct and this check red.
    function _checkBorrowMoney(uint256 loanId, address borrower, uint256 borrowerBefore, uint256 treasuryBefore)
        internal
    {
        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        uint256 actualBorrow = uint256(loan.fillEnd - loan.fillStart) * UNIT;
        uint256 expectedFee = (actualBorrow * lending.feeBps()) / BPS;
        uint256 expectedNet = actualBorrow - expectedFee;

        uint256 paidNet = ovrfloToken.balanceOf(borrower) - borrowerBefore;
        if (paidNet != expectedNet) {
            ++borrowPayoutMismatches;
            lastBorrowExpected = expectedNet;
            lastBorrowPaid = paidNet;
        }

        ghostFeeSum += expectedFee;
        ghostTreasuryReceived += ovrfloToken.balanceOf(treasury) - treasuryBefore;
    }

    /// @dev Recomputes the obligation from the four inputs that determine it, mirroring `StreamPricing`'s
    ///      documented branches without calling it: the linear factor, the floored gross price, the
    ///      full-borrow fast path, and the ceiling accrual otherwise. A pricing path that ignored the tick's
    ///      APR would agree with a stored obligation on the fixture rate and diverge here.
    function _checkObligation(uint256 loanId, uint128 remaining, uint16 aprBps, uint256 timeToMaturity) internal {
        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
        uint256 actualBorrow = uint256(loan.fillEnd - loan.fillStart) * UNIT;

        uint256 factor = WAD + (timeToMaturity * uint256(aprBps) * WAD) / (YEAR * BPS);
        uint256 grossPrice = (uint256(remaining) * WAD) / factor;

        uint256 expected;
        if (actualBorrow == grossPrice) {
            expected = remaining;
        } else {
            uint256 accrued = actualBorrow * factor;
            expected = accrued / WAD + (accrued % WAD == 0 ? 0 : 1);
        }

        if (expected != loan.obligation) {
            ++obligationMismatches;
            lastObligationExpected = expected;
            lastObligationStored = loan.obligation;
        }
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
        if (_ownerOfOrZero(g.streamId) == address(0)) burnedStreams[g.streamId] = true;
    }

    function _ownerOfOrZero(uint256 streamId) internal view returns (address owner) {
        try sablier.ownerOf(streamId) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
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

    /// @dev True once the front-loaded baseline is behind us, i.e. the call is fuzzer-driven.
    function _fuzzDriven() internal view returns (bool) {
        return baselineDone && !inBaseline;
    }

    /// @dev The pair's payout ceiling, recomputed from loan state and the stream — never from
    ///      `_claimableOf`, whose own arithmetic is what the check exists to falsify. `capped` is false when
    ///      the pair cannot legally claim at all (different tape, or no overlap), in which case the claim
    ///      reverts and there is nothing to bound.
    function _entitlementHeadroom(uint256 loanId, uint256 positionId) internal view returns (bool, uint256) {
        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);

        uint64 contribution;
        {
            (, address positionMarket, uint16 aprBps, uint32 epoch,) = lending.positions(positionId);
            if (positionMarket != loan.market || aprBps != loan.aprBps || epoch != loan.epoch) return (false, 0);
            (uint64 start, uint64 end) = _interval(positionId);
            contribution = _overlap(start, end, loan.fillStart, loan.fillEnd);
        }
        if (contribution == 0) return (false, 0);

        uint256 recovered = uint256(loan.drawn) + loan.repaid;
        if (!loan.closed) {
            uint128 withdrawable = sablier.withdrawableAmountOf(loan.streamId);
            recovered += withdrawable < outstanding ? withdrawable : outstanding;
        }

        return (true, _headroom(loanId, positionId, contribution, recovered, loan.fillEnd - loan.fillStart));
    }

    /// @dev Pro-rata ceiling minus what the pair already took. Split out of `_entitlementHeadroom` purely
    ///      to keep that frame inside the non-IR stack limit.
    function _headroom(uint256 loanId, uint256 positionId, uint64 contribution, uint256 recovered, uint64 length)
        internal
        view
        returns (uint256)
    {
        uint256 ceiling = (uint256(contribution) * recovered) / length;
        uint256 already = lending.received(loanId, positionId);
        return ceiling > already ? ceiling - already : 0;
    }

    /// @dev Scans `loansOf` for the pair's entry and returns the view's reported claimable, or zero.
    ///      Paginates through `nextSeq`: a single unpaginated page silently truncates once a position's
    ///      tape holds more overlapping loans than the page size, which would turn a divergence into a
    ///      quietly skipped comparison.
    function _reportedClaimable(uint256 positionId, uint256 loanId) internal view returns (uint128) {
        uint64 cursor;
        for (uint256 page = 0; page < 8; ++page) {
            try lending.loansOf(positionId, cursor, 32) returns (
                OVRFLOLending.LoanShare[] memory entries, uint64 nextSeq
            ) {
                for (uint256 i = 0; i < entries.length; ++i) {
                    if (entries[i].loanId == loanId) return entries[i].claimable;
                }
                if (nextSeq == 0) return 0;
                cursor = nextSeq;
            } catch {
                return 0;
            }
        }
        return 0;
    }

    /// @dev First four bytes of a revert payload, or zero for a bare/empty revert.
    function _selectorOf(bytes memory reason) internal pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(reason, 0x20))
        }
    }

    function _freeStreamOf(address actor) internal view returns (uint256) {
        for (uint256 i = 0; i < streamIds.length; ++i) {
            uint256 streamId = streamIds[i];
            if (burnedStreams[streamId]) continue;
            if (_ownerOfOrZero(streamId) != actor) continue;
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

    function dustLoanCount() external view returns (uint256) {
        return dustLoans.length;
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
    /// @dev Parents checked per level before the walk jumps to the last active one (see
    ///      `exposed_treeNodeBreaks`).
    uint256 internal constant TREE_WALK_PARENTS = 12;

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
        vm.startPrank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
        lending.setAprBounds(APR_LOW, APR_HIGH);
        lending.setFee(50);
        vm.stopPrank();

        handler = new LendingInvariantHandler(
            lending, sablier, underlying, ovrfloToken, MARKET, TREASURY, expiry, APR_LOW, APR_HIGH
        );
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
        // The money paths carry the weight. `structural` needs only one slot because the handler's own
        // cadence forces a structural pass every few calls regardless of what the fuzzer picks — the
        // per-run coverage gate is therefore guaranteed without spending a third of the call budget on it,
        // which is what the U6 mutation campaign measured (structural drew 35.8% of 20,000 calls while
        // each money path drew ~7%, and seven mutants on the money paths survived).
        selectors[9] = LendingInvariantHandler.structural.selector;
        selectors[10] = LendingInvariantHandler.claimMax.selector;
        selectors[11] = LendingInvariantHandler.repay.selector;
        selectors[12] = LendingInvariantHandler.withdraw.selector;
        selectors[13] = LendingInvariantHandler.borrow.selector;

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
        // The counter and the handler's independent sum of every fill it observed must agree; a fill that
        // advanced `filled` further than the interval it recorded would tile and still steal depth.
        assertEq(filled, handler.ghostFilled(aprBps, epoch), "partition: filled diverged from the fill ghost");
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

    /// @notice Unfilled tape depth in wei. Ticket 03 minimum retarget: one token is both escrow and pot.
    function _unfilledWei() internal view returns (uint256 unfilledWei) {
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            uint32 maxEpoch = handler.maxEpochSeen(aprs[t]);
            for (uint32 epoch = 0; epoch <= maxEpoch; ++epoch) {
                (uint64 root, uint64 filled,,,) = lending.exposed_epochState(MARKET, aprs[t], epoch);
                unfilledWei += uint256(root - filled) * UNIT;
            }
        }
    }

    /// @notice Summed loan pots in wei. Ticket 03 minimum retarget; 06 re-derives the identities.
    function _proceedsWei() internal view returns (uint256 potTotal) {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            potTotal += lending.proceeds(handler.loanIds(i));
        }
    }

    /// @notice AC3 / I-3. Escrow solvency: held ovrfloToken equals unfilled depth plus summed pots.
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
        assertEq(
            ovrfloToken.balanceOf(address(lending)),
            unfilledWei + _proceedsWei(),
            "escrow: held ovrfloToken != unfilled + proceeds"
        );
    }

    /// @notice AC4 / I-18, I-13. Tree integrity across growth and rollover. Three independent checks: the
    ///         root against a handler-side mirror of everything posted and withdrawn, the root against the
    ///         prefix walk, and — the literal form of the criterion — every walked node against the sum of
    ///         its eight children. Height monotonicity is checked against the pre-action ghost.
    function invariant_TreeIntegrity() public view {
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            uint32 maxEpoch = handler.maxEpochSeen(aprs[t]);
            for (uint32 epoch = 0; epoch <= maxEpoch; ++epoch) {
                _assertTreeEpoch(aprs[t], epoch);
            }
        }
    }

    function _assertTreeEpoch(uint16 aprBps, uint32 epoch) internal view {
        (uint64 root,, uint32 leaves,,) = lending.exposed_epochState(MARKET, aprBps, epoch);
        assertEq(
            root,
            handler.ghostPosted(aprBps, epoch) - handler.ghostWithdrawn(aprBps, epoch),
            "tree: root diverged from the posted/withdrawn ghost mirror"
        );
        assertGe(
            lending.exposed_treeHeight(MARKET, aprBps, epoch), handler.ghostHeight(aprBps, epoch), "tree: height shrank"
        );
        if (leaves == 0) return;

        (uint64 prefixValue, uint64 leafValue) = lending.exposed_prefixAndLeaf(MARKET, aprBps, epoch, leaves - 1);
        assertEq(root, prefixValue + leafValue, "tree: root != prefix(last) + leaf(last)");
        assertEq(
            lending.exposed_treeNodeBreaks(MARKET, aprBps, epoch, TREE_WALK_PARENTS),
            0,
            "tree: a stored node != the sum of its children"
        );
    }

    /// @notice AC5 / I-6, I-7, I-20, E-4. Claim caps, the obligation ceiling, and the payout ghost parity.
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
            // Money-movement identity: what the contract recorded as paid is exactly what showed up in the
            // claimant's balance. Credit without a transfer, or a transfer to the wrong account, breaks it.
            assertEq(paid, handler.ghostReceived(loanId, positionId), "caps: received != observed payout");
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

    /// @notice I-6, E-2. The per-claim ceiling, recomputed handler-side from loan state and the stream
    ///         before every claim. `invariant_ClaimCaps` bounds payouts by the *obligation*, which a
    ///         mutation that inflated `recovered` all the way to the obligation would still satisfy; this
    ///         one bounds each payout by what the loan had actually recovered at that moment.
    function invariant_ClaimEntitlementCeiling() public view {
        if (handler.entitlementCeilingViolations() != 0) {
            assertLe(
                handler.lastCeilingPaid(),
                handler.lastCeilingHeadroom(),
                "entitlement: a claim paid more than the loan had recovered pro-rata"
            );
        }
        assertEq(handler.entitlementCeilingViolations(), 0, "entitlement: pro-rata ceiling breached");
    }

    /// @notice I-4. Pot conservation: nothing recovered is lost and nothing unearned is credited. The
    ///         payout term is the handler's balance-delta ghost, so this is an identity between the pot and
    ///         money that actually left the contract, not between two of the contract's own counters.
    function invariant_PotConservation() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            assertEq(
                uint256(lending.proceeds(loanId)) + handler.ghostReceivedLoan(loanId),
                uint256(loan.drawn) + loan.repaid,
                "pot: proceeds + payouts != drawn + repaid"
            );
        }
    }

    /// @notice I-5. Every ovrfloToken the market holds is unfilled escrow or a loan pot.
    function invariant_TokenCustody() public view {
        assertEq(
            ovrfloToken.balanceOf(address(lending)),
            _proceedsWei() + _unfilledWei(),
            "custody: token balance != proceeds + unfilled"
        );
    }

    /// @notice Risk #6 / GL-70 custody half. An open loan's collateral is held by the market — nothing else
    ///         can draw it, and nothing returns it before closure.
    function invariant_StreamCustody() public view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            (OVRFLOLending.Loan memory loan,) = lending.loanState(handler.loanIds(i));
            if (loan.closed) continue;
            assertEq(sablier.ownerOf(loan.streamId), address(lending), "custody: open loan's stream left escrow");
        }
    }

    /// @notice AC9 / I-16, I-17. Cursor soundness, including both monotonicity halves.
    function invariant_CursorSoundness() public view {
        uint16[2] memory aprs = [APR_LOW, APR_HIGH];
        for (uint256 t = 0; t < aprs.length; ++t) {
            (,,, uint32 oldestLiveEpoch, uint32 currentEpoch) = lending.exposed_epochState(MARKET, aprs[t], 0);
            assertLe(oldestLiveEpoch, currentEpoch, "cursor: advanced past the writing epoch");
            assertGe(oldestLiveEpoch, handler.ghostOldestEpoch(aprs[t]), "cursor: oldest live epoch went backwards");
            assertGe(currentEpoch, handler.ghostCurrentEpoch(aprs[t]), "cursor: current epoch went backwards");
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

    /// @notice I-10, plus a view/tape differential. Unfilled escrow never carries sub-UNIT residue, and the
    ///         `positionState` named view reports exactly the refundable remainder the tape itself holds.
    ///         Proceeds can hold 1-wei dust, so the check is on held minus pots, not the whole balance.
    function invariant_UnitAlignment() public view {
        uint256 held = ovrfloToken.balanceOf(address(lending));
        uint256 pot = _proceedsWei();
        assertGe(held, pot, "units: proceeds exceed held balance");
        assertEq((held - pot) % UNIT, 0, "units: escrow carries sub-UNIT residue");

        uint256 count = handler.positionCount();
        for (uint256 i = 0; i < count; ++i) {
            _assertPositionView(handler.positionIds(i));
        }
    }

    function _assertPositionView(uint256 positionId) internal view {
        (uint64 start, uint64 end) = handler.interval(positionId);
        (,,, uint128 unfilled) = lending.positionState(positionId);
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
    ///         max `claim` actually made — and a pair the view reported as claimable never reverted.
    function invariant_ViewTruth() public view {
        if (handler.viewTruthMismatches() != 0) {
            assertEq(
                handler.lastViewPaid(), handler.lastViewReported(), "view-truth: loansOf claimable != max claim payout"
            );
        }
        assertEq(handler.viewTruthMismatches(), 0, "view-truth: loansOf claimable != max claim payout");
        assertEq(handler.reportedButReverted(), 0, "view-truth: loansOf reported a claimable that the claim rejected");
    }

    /// @notice AC8 / risk #3. A claim pairing a position and a loan on different tapes must never pay.
    ///         The adversarial actions pair numerically identical intervals across epochs, so the rejection
    ///         has to come from the `(market, aprBps, epoch)` guard, not coincidental non-overlap.
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

    /// @notice Recipients. Escrow solvency and pot conservation both see only aggregate outflow, so they
    ///         are equally satisfied by principal that reaches the wrong account. These are the identities
    ///         that name the payee: the borrower's own balance, and the treasury's.
    function invariant_MoneyRecipients() public view {
        if (handler.borrowPayoutMismatches() != 0) {
            assertEq(
                handler.lastBorrowPaid(), handler.lastBorrowExpected(), "recipients: borrower net != actualBorrow - fee"
            );
        }
        assertEq(handler.borrowPayoutMismatches(), 0, "recipients: borrower net != actualBorrow - fee");

        if (handler.refundRecipientMismatches() != 0) {
            assertEq(
                handler.lastRefundPaid(), handler.lastRefundExpected(), "recipients: withdraw refund missed the lender"
            );
        }
        assertEq(handler.refundRecipientMismatches(), 0, "recipients: withdraw refund missed the lender");

        assertEq(handler.ghostTreasuryReceived(), handler.ghostFeeSum(), "recipients: treasury credit != summed fees");
        assertEq(ovrfloToken.balanceOf(TREASURY), handler.ghostFeeSum(), "recipients: treasury balance != summed fees");
    }

    /// @notice I-20. Every stored obligation equals an obligation recomputed from `(actualBorrow,
    ///         remaining, aprBps, timeToMaturity)` alone, at whatever tick the fill happened on.
    function invariant_ObligationPricing() public view {
        if (handler.obligationMismatches() != 0) {
            assertEq(
                handler.lastObligationStored(),
                handler.lastObligationExpected(),
                "pricing: stored obligation != independently recomputed obligation"
            );
        }
        assertEq(handler.obligationMismatches(), 0, "pricing: obligation diverged from the tick's rate");
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
        _assertDustBound();
        _assertEpochIsolation();
        _assertStructuralCoverage();
        _assertLivenessCoverage();
    }

    /// @notice E-1. For every loan, the positions on its own tape tile its interval exactly — the lazy
    ///         attribution identity, still exact however many withdraws, growths and rollovers happened
    ///         since the fill.
    struct Attribution {
        uint64 covered;
        uint256 contributors;
    }

    function _assertLazyAttributionCoverage() internal view {
        uint256 loanTotal = handler.loanCount();
        for (uint256 i = 0; i < loanTotal; ++i) {
            uint256 loanId = handler.loanIds(i);
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);
            Attribution memory a = _tallyAttribution(g.aprBps, g.epoch, loan.fillStart, loan.fillEnd);
            assertEq(
                a.covered,
                loan.fillEnd - loan.fillStart,
                "attribution: positions do not tile the loan's frozen interval"
            );
        }
    }

    /// @notice AC9 dust half / risk #5. On a closed loan whose every contributor has claimed to exhaustion,
    ///         the value stranded by floor division is at most one wei per contributing position.
    /// @dev This replaces the previous formulation (`recovered − Σ floor(contribution × recovered / length)
    ///      ≤ contributors`), which was unfalsifiable: it followed arithmetically from `Σ contribution ==
    ///      length` — asserted two lines above it — and read no contract state at all. The residual
    ///      `proceeds` of a drained loan is the same quantity as the contract actually holds it, so a
    ///      rounding direction that stranded more than dust now fails here.
    function _assertDustBound() internal view {
        uint256 total = handler.dustLoanCount();
        for (uint256 i = 0; i < total; ++i) {
            uint256 loanId = handler.dustLoans(i);
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            LendingInvariantHandler.LoanGhost memory g = handler.loanGhost(loanId);
            Attribution memory a = _tallyAttribution(g.aprBps, g.epoch, loan.fillStart, loan.fillEnd);
            assertLe(
                uint256(lending.proceeds(loanId)),
                a.contributors,
                "dust: a drained closed loan stranded more than one wei per contributor"
            );
        }
    }

    function _tallyAttribution(uint16 aprBps, uint32 epoch, uint64 fillStart, uint64 fillEnd)
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
        assertGt(handler.covCrossEpochRejected(), 0, "coverage: the cross-epoch claim guard never fired");
        assertGt(handler.covMaturityReached(), 0, "coverage: the run never reached series maturity");
    }

    /// @notice Liveness. A run in which nothing is ever claimed, repaid, closed or withdrawn-after-fill
    ///         satisfies every conservation identity above vacuously — the U6 mutation campaign found
    ///         entire 500x40 campaigns completing with zero claims. These gates make the money paths
    ///         mandatory, and the `FromFuzz` counters additionally require them to happen outside the
    ///         front-loaded baseline, so a mutation that only spares the baseline cannot hide.
    function _assertLivenessCoverage() internal view {
        assertGt(handler.covClaim(), 0, "liveness: no claim was ever paid");
        assertGt(handler.covRepay(), 0, "liveness: no loan was ever repaid");
        assertGt(handler.covClose(), 0, "liveness: no loan was ever closed");
        assertGt(handler.covWithdrawAfterFill(), 0, "liveness: no withdraw followed a partial fill");

        // Every post-baseline structural scenario needs a live market somewhere in its chain: `supply` and
        // `borrow` revert at maturity, so a run that has crossed expiry by its last call cannot be required
        // to have originated, rolled or settled anything on the fuzz path. Runs that stay pre-maturity —
        // every run at the default profile's depth — carry the full gate.
        if (block.timestamp < expiry) {
            assertGt(handler.covRolloverFromFuzz(), 0, "liveness: rollovers only ever happened in the baseline");
            assertGt(handler.covCloseFromFuzz(), 0, "liveness: closures only ever happened in the baseline");
            assertGt(handler.covClaimFromFuzz(), 0, "liveness: claims only ever happened in the baseline");
            assertGt(handler.covRepayFromFuzz(), 0, "liveness: repayments only ever happened in the baseline");
            assertGt(handler.covRepledgeFromFuzz(), 0, "liveness: re-pledges only ever happened in the baseline");
            assertGt(
                handler.covOverVestedFromFuzz(), 0, "liveness: over-vested loans only ever happened in the baseline"
            );
        }
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

        ovrfloToken.mint(lender, 200 ether);
        vm.prank(lender);
        ovrfloToken.approve(address(lending), type(uint256).max);
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
        uint256 loanId = lending.borrow(MARKET, APR_LOW, type(uint128).max, streamId, 0, address(0));

        (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);

        // The fill floored to the UNIT below grossPrice, so it is strictly under the stream's value.
        assertEq(loan.fillEnd - loan.fillStart, 50_000_000, "boundary: fill did not floor to the UNIT below");
        assertEq(loan.obligation, 51 ether, "boundary: obligation is not the ceil of the floored fill");
        assertLt(loan.obligation, remaining, "boundary: obligation must stay strictly below remaining");
    }
}
