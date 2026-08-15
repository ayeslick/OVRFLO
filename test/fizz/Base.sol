// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Actor} from "./Actor.sol";
import {Clamp} from "./utils/Clamp.sol";
import {DecimalPrinter} from "./utils/DecimalPrinter.sol";
import {Deployer} from "./utils/Deployer.sol";
import {vm} from "./utils/Hevm.sol";
import {Logger} from "./utils/Logger.sol";
import {Math} from "./utils/Math.sol";
import {StringUtils} from "./utils/StringUtils.sol";
import {EnumerableSet} from "./utils/EnumerableSet.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {OVRFLOLending} from "../../src/OVRFLOLending.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOLendingHarness} from "./harness/OVRFLOLendingHarness.sol";
import {MockSablier, MockSablierComptroller} from "./mocks/MockSablier.sol";
import {MockPendleOracle} from "./mocks/MockPendleOracle.sol";
import {MockPendleMarket} from "./mocks/MockPendleMarket.sol";
import {MockStandardizedYield} from "./mocks/MockStandardizedYield.sol";
import {MockFlashBorrower} from "./mocks/MockFlashBorrower.sol";

/// @notice Base contract with state variables and setup functions
abstract contract Base is StringUtils, Clamp, Deployer, Math {
    using DecimalPrinter for uint256;

    string[] internal ACTOR_LABELS = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace"];
    uint256 internal constant BLOCK_INTERVAL = 12 seconds;
    uint256 internal constant INITIAL_ETH_BALANCE = 1_000 ether;
    uint256 internal constant INITIAL_TOKEN_AMOUNT = 1_000_000 ether;

    // ―――――――――――――――――――――――――― Ghosts ――――――――――――――――――――――――――
    // Scalar aggregates live in `Ghosts`; anything keyed by entity id or by tape
    // coordinate is a top-level mapping below. Every field here is read by at least one
    // property in `Properties.sol` — the Spec ID that consumes it is named inline.

    struct Ghosts {
        // GL-04 — underlying flow, accumulated from REALIZED actor/treasury balance
        // deltas rather than from the lending market's own counters.
        uint256 underlyingSupplied;
        uint256 underlyingRefunded;
        uint256 underlyingBorrowedOut;
        uint256 underlyingDonated;
        // GL-01 — ovrfloToken pot, reconstructed WITHOUT reading `proceeds`.
        uint256 sumRecovered; // Σ over every tracked loan of (drawn + repaid)
        uint256 frozenRecovered; // the closed-loan half of `sumRecovered`, frozen at closure
        uint256 claimPaidOut; // realized ovrfloToken that left the market via `claim`
        uint256 ovrfloDonated; // ovrfloToken that arrived without a matching recovery
        // GL-22 — monotone id counters.
        uint256 maxNextPositionId;
        uint256 maxNextLoanId;
        // GL-08 — per-scan marker used to detect a duplicated open-loan stream in O(n).
        uint256 runId;
        // GL-21 — rotating window over positions for the `received` pair scan.
        uint256 receivedScanCursor;
    }

    Ghosts internal ghosts;

    // Actor starting net worth (underlying + PT), used by Step 9 solvency properties.
    mapping(address => uint256) internal ghost_actorStartValue;
    // Reentrancy-capable flash-loan borrower, deployed once in setup for the
    // OVRFLO flashLoan callback path.
    address public mockFlashBorrowerAddr;

    // ―― Per-loan ghosts ――
    /// @dev Hash of every `Loan` field except the three mutable servicing fields, taken
    ///      in the same call that created the loan. Read by GL-14 and GL-29.
    mapping(uint256 loanId => bytes32 fingerprint) internal ghost_loanFingerprint;
    /// @dev `sablier.getWithdrawnAmount(streamId)` at origination. Read by GL-31.
    mapping(uint256 loanId => uint128 withdrawn) internal ghost_loanWithdrawnAtCreate;
    /// @dev `sablier.getWithdrawnAmount(streamId)` captured in the SAME handler call that
    ///      closed the loan, on either closure path. Read by GL-31.
    mapping(uint256 loanId => uint128 withdrawn) internal ghost_loanWithdrawnAtClose;
    /// @dev Latched true once the closure snapshot above exists. Read by GL-26, GL-27, GL-31.
    mapping(uint256 loanId => bool closed) internal ghost_everClosed;
    /// @dev `loan.drawn` frozen at closure. Read by GL-27.
    mapping(uint256 loanId => uint128 drawn) internal ghost_drawnAtClose;
    /// @dev High-water marks for the additive-only servicing counters. Read by GL-21.
    mapping(uint256 loanId => uint128 drawn) internal ghost_maxDrawn;
    mapping(uint256 loanId => uint128 repaid) internal ghost_maxRepaid;
    /// @dev High-water mark of `received[loanId][positionId]`, keyed by the pair. Read by GL-21.
    mapping(bytes32 pairKey => uint128 received) internal ghost_maxReceived;
    /// @dev High-water mark of the loan's cumulative payout `(drawn + repaid) − proceeds`.
    ///      That difference is exactly what `claim` has paid out for the loan, so it is
    ///      monotone — a donation credited into `proceeds` would make it fall. Read by GL-11.
    mapping(uint256 loanId => uint256 paid) internal ghost_maxLoanPaid;

    // ―― Per-position ghosts ――
    /// @dev Last observed `positionState().unfilled`. Read by GL-10.
    mapping(uint256 positionId => uint128 unfilled) internal ghost_lastUnfilled;
    /// @dev Whether `ghost_lastUnfilled` has ever been written for this position.
    mapping(uint256 positionId => bool seen) internal ghost_unfilledSeen;
    /// @dev High-water mark of the position's consumed prefix, in UNITs. Read by GL-25.
    mapping(uint256 positionId => uint64 units) internal ghost_maxFilledHistory;

    // ―― Per-tape ghosts, keyed by keccak(market, aprBps, epoch) ――
    mapping(bytes32 tapeKey => uint64 filled) internal ghost_maxFilled; // GL-20
    mapping(bytes32 tapeKey => uint64 count) internal ghost_maxLoanCount; // GL-23
    mapping(bytes32 tapeKey => uint32 leaves) internal ghost_maxLeaves; // GL-23
    mapping(bytes32 tapeKey => uint8 height) internal ghost_maxHeight; // GL-23

    // ―― Per-tick ghosts, keyed by keccak(market, aprBps) ――
    mapping(bytes32 tickKey => uint32 epoch) internal ghost_maxCurrentEpoch; // GL-24, GL-28
    mapping(bytes32 tickKey => uint32 epoch) internal ghost_maxOldestEpoch; // GL-24

    // ―― GL-08 duplicate-stream detection ――
    mapping(uint256 streamId => uint256 runId) internal ghost_streamRunMark;

    // ―――――――――――――――――――――――――― Actors ――――――――――――――――――――――――――

    address[] internal actors;
    address internal actor;
    address internal admin;

    /// @dev Reentrancy depth of the handler hook, so a handler that composes two other
    ///      `asActor` handlers still produces exactly one before/after pair.
    uint256 internal handlerDepth;

    modifier asActor() virtual {
        if (handlerDepth == 0) _beforeHandlerCall();
        handlerDepth += 1;
        vm.startPrank(actor);
        _;
        vm.stopPrank();
        handlerDepth -= 1;
        if (handlerDepth == 0) _afterHandlerCall();
    }

    modifier asAdmin() virtual {
        vm.startPrank(admin);
        _;
        vm.stopPrank();
    }

    // ―――――――――――――――――――――――― Contracts ―――――――――――――――――――――――――

    OVRFLOFactory public factory;
    OVRFLO public vault;
    OVRFLOToken public ovrfloToken;
    OVRFLOLendingHarness public lending;
    MockERC20 public underlying;
    MockERC20 public ptToken;
    MockPendleOracle public mockOracle;
    MockPendleMarket public mockMarket;
    MockStandardizedYield public mockSY;
    MockSablier public mockSablier;

    address public treasury;
    address public market;
    address constant SABLIER_ADDR = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    uint32 constant TWAP_DURATION = 900; // 15 minutes

    /// @notice Immutable-once tick spacing configured on the lending market for `market`.
    uint16 public constant TICK_SPACING = 25;

    // ―――――――――――――――――― Lending entity tracking ―――――――――――――――――
    // Collateral streams created by OVRFLO deposits, keyed by the depositing actor.
    // The mock lockup enumerates per owner (`balanceOf` / `tokensOfOwnerIn`). The
    // mirror is a handler convenience, not a second source of truth — SC10 checks it
    // against the mock's enumeration.
    uint256[] internal streamIds;
    mapping(address => uint256[]) internal actorStreams;
    mapping(uint256 => bool) internal burnedStreams;

    // Every lender position / loan ever created, for handlers that don't need
    // ownership scoping (repay and close are permissionless).
    uint256[] internal positionIds;
    uint256[] internal loanIds;

    /// @notice One `(market, aprBps, epoch)` coordinate tape that has ever been touched.
    /// @dev The properties that walk the book need EVERY tape, including epochs the
    ///      cursor has already skipped — those legitimately still hold sub-atom dust, so
    ///      enumerating only live epochs would undercount (GL-02's implementer warning).
    struct Tape {
        address market;
        uint16 aprBps;
        uint32 epoch;
    }

    Tape[] internal tapes;
    mapping(bytes32 tapeKey => bool seen) internal tapeSeen;

    /// @dev Per-tape accumulator scratch space for GL-05's two-pass position/loan sum
    ///      comparison. Every key written during a property run is deleted again before
    ///      that run returns, so the mapping is empty between property calls.
    mapping(bytes32 tapeKey => uint256 sum) internal scratch_tapePosSum;

    /// @dev Cursors into `positionIds` / `loanIds` for the incremental hook scan.
    uint256 internal positionCursor;
    uint256 internal loanCursor;
    /// @dev Loans whose closure has not been observed yet.
    uint256[] internal openLoanIds;

    // ―― Pre-call snapshots consumed by `_afterHandlerCall` ――
    uint256 internal snapLendingUnderlying;
    uint256 internal snapLendingOvrflo;
    uint256 internal snapActorUnderlying;
    uint256 internal snapTreasuryUnderlying;
    address internal snapTreasury;
    uint256 internal snapPositionCount;
    uint256 internal snapLoanCount;

    // ―――――――――――――――――――――――――― Setup ―――――――――――――――――――――――――――

    function setup() internal {
        // 1. Deploy mock tokens
        underlying = new MockERC20(address(this), 0, "Underlying", "UND", 18);
        ptToken = new MockERC20(address(this), 0, "Pendle PT", "PPT", 18);

        // 2. Deploy mock infrastructure
        mockOracle = new MockPendleOracle();
        mockSY = new MockStandardizedYield(address(underlying));
        mockMarket =
            new MockPendleMarket(block.timestamp + 1000 * 365 days, address(mockSY), address(ptToken), address(0));
        market = address(mockMarket);

        // 3. Deploy factory first so the mock lockup can bake factory as admin, then
        //    etch the mock at SABLIER_ADDR (immutables live in the runtime bytecode).
        factory = new OVRFLOFactory(address(this), address(mockOracle));
        MockSablierComptroller mockComptroller = new MockSablierComptroller(address(factory));
        mockSablier = new MockSablier(address(factory), address(factory), address(mockComptroller));
        vm.etch(SABLIER_ADDR, address(mockSablier).code);
        factory.setOvrfloStream(SABLIER_ADDR);

        // 4. Deploy the vault externally (it constructs its own token) and register it.
        treasury = address(this);
        vm.label(treasury, "Treasury");
        vault = new OVRFLO(
            address(factory),
            treasury,
            address(underlying),
            "OVRFLO TEST",
            "ovrfloTST",
            address(mockOracle),
            SABLIER_ADDR
        );
        factory.registerOvrflo(address(vault));
        address vaultAddr = address(vault);
        ovrfloToken = OVRFLOToken(vault.ovrfloToken());
        vm.label(vaultAddr, "OVRFLO Vault");
        vm.label(address(ovrfloToken), "ovrfloToken");

        // 6. Add market (15 min TWAP, 0.1% deposit fee)
        factory.prepareOracle(market, TWAP_DURATION);
        factory.addMarket(vaultAddr, market, TWAP_DURATION, 10);
        vm.label(market, "MockPendleMarket");

        // 7. Deploy the harness AS the market. Medusa's geth-backed EVM pairs an
        //    etch-over-existing-code with the OLD code's jump analysis, so the first
        //    call into the overlay dies on an invalid opcode mid-pushdata (Foundry's
        //    revm re-analyzes and hides the problem; etching onto an EMPTY address,
        //    like SABLIER_ADDR above, is fine). The harness is constructed with the
        //    SAME arguments `registerLending` would check (every immutable resolves
        //    identically); its constructor already transfers ownership to `factory`
        //    (Decision 7(b)), so registration is a real call, not state grafting.
        OVRFLOLendingHarness harnessMarket = new OVRFLOLendingHarness(address(factory), vaultAddr, SABLIER_ADDR);
        address lendingAddr = address(harnessMarket);
        factory.registerLending(lendingAddr);
        lending = harnessMarket;
        vm.label(lendingAddr, "OVRFLOLending");

        // 8. Configure limits, APR bounds, fee, and tick spacing.
        //    Tick spacing MUST be set before any supply/borrow call — without it every
        //    fill reverts SpacingUnset and the whole lending campaign covers nothing.
        factory.setMarketDepositLimit(vaultAddr, market, type(uint256).max);
        factory.setLendingAprBounds(lendingAddr, 0, 10_000); // 0% to 100% APR, 0 is a legal min
        factory.setLendingFee(lendingAddr, 0); // 0% lending fee
        factory.setLendingTickSpacing(lendingAddr, market, TICK_SPACING);

        // 9. Deploy a flash-loan borrower for the OVRFLO flashLoan reentrancy path.
        //    Actors can also call flashLoan directly (Actor implements onFlashLoan),
        //    but this contract exercises the deposit-during-callback path.
        mockFlashBorrowerAddr = address(new MockFlashBorrower(vaultAddr, address(ptToken), address(underlying), market));
        underlying.deal(mockFlashBorrowerAddr, INITIAL_TOKEN_AMOUNT);
        vm.label(mockFlashBorrowerAddr, "MockFlashBorrower");

        // Fund this contract for Actor creation (Medusa doesn't fund during construction)
        vm.deal(address(this), INITIAL_ETH_BALANCE * ACTOR_LABELS.length);

        setupActors();

        ghosts.maxNextPositionId = lending.nextPositionId();
        ghosts.maxNextLoanId = lending.nextLoanId();
    }

    function setupActors() internal {
        admin = address(this);
        vm.label(admin, "Admin");

        for (uint256 i; i < ACTOR_LABELS.length; i++) {
            address _actor = address(new Actor{value: INITIAL_ETH_BALANCE}());
            actors.push(_actor);
            if (ACTOR_LABELS.length > i) {
                vm.label(_actor, ACTOR_LABELS[i]);
            }
            // Mint tokens to actor
            underlying.deal(_actor, INITIAL_TOKEN_AMOUNT);
            ptToken.deal(_actor, INITIAL_TOKEN_AMOUNT);
            // Set approvals: vault (deposit + wrap), lending (supply + repay).
            // Also approve lending for Sablier NFT transfers — `borrow` escrows the
            // pledged stream via `sablier.transferFrom(msg.sender, ...)`.
            vm.startPrank(_actor);
            ptToken.approve(address(vault), type(uint256).max);
            underlying.approve(address(vault), type(uint256).max);
            underlying.approve(address(lending), type(uint256).max);
            ovrfloToken.approve(address(lending), type(uint256).max);
            MockSablier(SABLIER_ADDR).setApprovalForAll(address(lending), true);
            vm.stopPrank();
            ghost_actorStartValue[_actor] = INITIAL_TOKEN_AMOUNT * 2; // underlying + PT
        }
        actor = actors[0];
    }

    // ―――――――――――――――――――― Handler hook (ghost wiring) ―――――――――――――――――――
    // Ghost state that is ORDER-SENSITIVE cannot be latched lazily inside a property:
    // under `testMode: assertion` the fuzzers call properties as ordinary transactions at
    // arbitrary points in the sequence, so "record the moment X happened" has to run in
    // the same transaction as X. The `asActor` modifier is the one place every
    // actor-driven handler passes through, which makes it the correct home for that
    // wiring — and it keeps `handlers/` untouched.
    //
    // Everything that is merely MONOTONE (high-water marks) is latched inside the
    // properties instead: latching is sound at any sampling frequency and costs nothing
    // per handler call.

    function _beforeHandlerCall() internal {
        snapLendingUnderlying = underlying.balanceOf(address(lending));
        snapLendingOvrflo = ovrfloToken.balanceOf(address(lending));
        snapActorUnderlying = underlying.balanceOf(actor);
        snapTreasury = lending.treasury();
        snapTreasuryUnderlying = underlying.balanceOf(snapTreasury);
        snapPositionCount = positionIds.length;
        snapLoanCount = loanIds.length;
    }

    function _afterHandlerCall() internal {
        _registerNewPositions();
        _registerNewLoans();
        uint256 newSum = _sweepClosures();
        _accountUnderlyingFlow();
        _accountOvrfloPot(newSum);
    }

    /// @dev Registers the tape of every position created since the last hook run.
    function _registerNewPositions() private {
        uint256 count = positionIds.length;
        for (uint256 i = positionCursor; i < count; ++i) {
            (, address m, uint16 apr, uint32 ep,) = lending.positions(positionIds[i]);
            _registerTape(m, apr, ep);
        }
        positionCursor = count;
    }

    /// @dev Registers the tape, the immutable-field fingerprint and the origination-time
    ///      stream-withdrawn snapshot of every loan created since the last hook run.
    function _registerNewLoans() private {
        uint256 count = loanIds.length;
        for (uint256 i = loanCursor; i < count; ++i) {
            uint256 loanId = loanIds[i];
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            _registerTape(loan.market, loan.aprBps, loan.epoch);
            ghost_loanFingerprint[loanId] = _fingerprint(loan);
            ghost_loanWithdrawnAtCreate[loanId] = MockSablier(SABLIER_ADDR).getWithdrawnAmount(loan.streamId);
            openLoanIds.push(loanId);
        }
        loanCursor = count;
    }

    /// @dev Records the close-time stream-withdrawn snapshot for every loan that closed
    ///      during this handler call, on EITHER closure path (`close` or a full `repay`),
    ///      and retires it from the open list.
    ///
    ///      This is the whole point of GL-31: `getWithdrawnAmount` is cumulative across
    ///      every use of a stream, and a returned stream is immediately re-pledgeable, so
    ///      the value has to be captured here — in the same transaction as the closure —
    ///      and never re-read later.
    /// @return newSum Σ over every tracked loan of (drawn + repaid) after this call.
    function _sweepClosures() private returns (uint256 newSum) {
        uint256 openSum;
        uint256 n = openLoanIds.length;
        uint256 i;
        while (i < n) {
            uint256 loanId = openLoanIds[i];
            (OVRFLOLending.Loan memory loan,) = lending.loanState(loanId);
            if (loan.closed) {
                ghost_loanWithdrawnAtClose[loanId] = MockSablier(SABLIER_ADDR).getWithdrawnAmount(loan.streamId);
                ghost_everClosed[loanId] = true;
                ghost_drawnAtClose[loanId] = loan.drawn;
                ghosts.frozenRecovered += uint256(loan.drawn) + uint256(loan.repaid);
                if (_ownerOfOrZero(loan.streamId) == address(0)) {
                    _pruneBurnedActorStream(loan.borrower, loan.streamId);
                }
                openLoanIds[i] = openLoanIds[n - 1];
                openLoanIds.pop();
                n -= 1;
            } else {
                openSum += uint256(loan.drawn) + uint256(loan.repaid);
                ++i;
            }
        }
        newSum = ghosts.frozenRecovered + openSum;
    }

    /// @dev GL-04's flow ghosts. The action is classified by what the call produced —
    ///      a new position (supply), a new loan (borrow), a drop in the market's escrow
    ///      with neither (withdraw), a rise with neither (a bare donation) — and the
    ///      amount is then taken from the REALIZED counterparty balance delta, never from
    ///      the market's own bookkeeping.
    function _accountUnderlyingFlow() private {
        uint256 lendUnd = underlying.balanceOf(address(lending));
        uint256 actorUnd = underlying.balanceOf(actor);

        if (positionIds.length > snapPositionCount) {
            ghosts.underlyingSupplied += _sub0(snapActorUnderlying, actorUnd);
        } else if (loanIds.length > snapLoanCount) {
            uint256 gained = _sub0(actorUnd, snapActorUnderlying);
            uint256 treasuryGain =
                snapTreasury == actor ? 0 : _sub0(underlying.balanceOf(snapTreasury), snapTreasuryUnderlying);
            ghosts.underlyingBorrowedOut += gained + treasuryGain;
        } else if (lendUnd < snapLendingUnderlying) {
            ghosts.underlyingRefunded += _sub0(actorUnd, snapActorUnderlying);
        } else if (lendUnd > snapLendingUnderlying) {
            ghosts.underlyingDonated += lendUnd - snapLendingUnderlying;
        }
    }

    /// @dev GL-01's pot ghosts. `repay`, `close` and `claim`'s harvest all credit the
    ///      recovery counters 1:1 with the ovrfloToken they bring in, so the difference
    ///      between the market's balance delta and its recovery delta is exactly the
    ///      payout that left via `claim` — or, when negative, a bare donation.
    function _accountOvrfloPot(uint256 newSum) private {
        uint256 lendOvr = ovrfloToken.balanceOf(address(lending));
        uint256 recoveryDelta = _sub0(newSum, ghosts.sumRecovered);
        uint256 balanceGain = _sub0(lendOvr, snapLendingOvrflo);
        uint256 balanceLoss = _sub0(snapLendingOvrflo, lendOvr);

        // payout = recoveryDelta − (balanceGain − balanceLoss)
        uint256 credited = recoveryDelta + balanceLoss;
        if (credited >= balanceGain) {
            ghosts.claimPaidOut += credited - balanceGain;
        } else {
            ghosts.ovrfloDonated += balanceGain - credited;
        }
        ghosts.sumRecovered = newSum;
    }

    function _registerTape(address m, uint16 aprBps, uint32 epoch) private {
        bytes32 key = tapeKeyOf(m, aprBps, epoch);
        if (tapeSeen[key]) return;
        tapeSeen[key] = true;
        tapes.push(Tape({market: m, aprBps: aprBps, epoch: epoch}));
    }

    // ――――――――――――――――――――――――― Helpers ――――――――――――――――――――――――――

    /// @dev Hash of every `Loan` field the struct's NatSpec calls immutable — i.e. all of
    ///      them except `closed`, `drawn` and `repaid`.
    function _fingerprint(OVRFLOLending.Loan memory loan) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                loan.borrower,
                loan.aprBps,
                loan.epoch,
                loan.market,
                loan.seq,
                loan.streamId,
                loan.fillStart,
                loan.fillEnd,
                loan.obligation
            )
        );
    }

    function tapeKeyOf(address m, uint16 aprBps, uint32 epoch) internal pure returns (bytes32) {
        return keccak256(abi.encode(m, aprBps, epoch));
    }

    function tickKeyOf(address m, uint16 aprBps) internal pure returns (bytes32) {
        return keccak256(abi.encode(m, aprBps));
    }

    function pairKeyOf(uint256 loanId, uint256 positionId) internal pure returns (bytes32) {
        return keccak256(abi.encode(loanId, positionId));
    }

    /// @dev Saturating subtraction. Used only inside the accounting hook so that a
    ///      classification the hook did not anticipate degrades into a zero contribution
    ///      instead of panicking mid-handler.
    function _sub0(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    // Maps an arbitrary address to an actor address
    function toActor(address addy) internal view returns (address) {
        return actors[uint256(uint160(addy)) % actors.length];
    }

    // Maps an arbitrary address to an actor address that is different from the current actor
    function toActorNotCurrent(address addy) internal view returns (address) {
        address _actor = actors[uint256(uint160(addy)) % actors.length];
        if (_actor == actor) {
            _actor = actors[(uint256(uint160(addy)) + 1) % actors.length];
        }
        return _actor;
    }

    // Sums the native token balances of all actors
    function sumActorsBalances() internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            sumOfBalances += actors[i].balance;
        }
    }

    // Sums the ERC-20 token balances of all actors for a given token
    function sumActorsERC20Balances(address _token) internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            bytes memory data = abi.encodeWithSignature("balanceOf(address)", actors[i]);
            (bool success, bytes memory result) = _token.staticcall(data);
            require(success, "sumActorsERC20Balances: failed to get balance");
            sumOfBalances += abi.decode(result, (uint256));
        }
    }

    function skipBlocks(uint256 blocks) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * BLOCK_INTERVAL);
    }

    function skipTime(uint256 time) internal {
        uint256 blocks = (time + BLOCK_INTERVAL - 1) / BLOCK_INTERVAL;
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + time);
    }

    // ――――――――――――――――――――― Lending selection helpers ―――――――――――――――――――

    /// @notice Picks a spacing-aligned APR tick inside the lending market's live bounds.
    /// @dev Assumes `aprMinBps` is always spacing-aligned and `aprMaxBps >= aprMinBps`,
    ///      which the setup and the factory-admin dispatcher handler both preserve.
    function validTick(uint256 seed) internal view returns (uint16) {
        uint16 minBps = lending.aprMinBps();
        uint16 maxBps = lending.aprMaxBps();
        uint256 count = (uint256(maxBps) - minBps) / TICK_SPACING + 1;
        return uint16(minBps + (seed % count) * TICK_SPACING);
    }

    /// @dev Picks a stream id the actor currently owns (i.e. not already pledged to an
    ///      open loan) from the tracked deposit-stream mirror. Skips burned ids so
    ///      `ownerOf` never reverts after R17.
    function _actorStream(address who, uint256 seed) internal view returns (uint256 streamId, bool found) {
        uint256[] storage list = actorStreams[who];
        if (list.length == 0) return (0, false);
        streamId = list[seed % list.length];
        if (burnedStreams[streamId]) return (0, false);
        address owner = _ownerOfOrZero(streamId);
        found = owner == who;
    }

    function _ownerOfOrZero(uint256 streamId) internal view returns (address owner) {
        try MockSablier(SABLIER_ADDR).ownerOf(streamId) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }

    /// @dev After close or a completing repay the NFT is either owned by the borrower
    ///      or burned. Both are a successful disposal.
    function _streamDisposedToBorrower(uint256 streamId, address borrower) internal view returns (bool) {
        address owner = _ownerOfOrZero(streamId);
        return owner == address(0) || owner == borrower;
    }

    function _pruneBurnedActorStream(address who, uint256 streamId) internal {
        burnedStreams[streamId] = true;
        uint256[] storage list = actorStreams[who];
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == streamId) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }

    /// @dev Picks a lender position actually owned by `who`, read live from the lending
    ///      contract's own per-lender index rather than a mirrored ghost.
    function _actorPosition(address who, uint256 seed) internal view returns (uint256 positionId, bool found) {
        uint256 count = lending.lenderPositionCount(who);
        if (count == 0) return (0, false);
        positionId = lending.lenderPositionAt(who, seed % count);
        found = true;
    }

    /// @dev Picks a loan actually originated by `who`, read live from the lending
    ///      contract's own per-borrower index.
    function _actorLoan(address who, uint256 seed) internal view returns (uint256 loanId, bool found) {
        uint256 count = lending.borrowerLoanCount(who);
        if (count == 0) return (0, false);
        loanId = lending.borrowerLoanAt(who, seed % count);
        found = true;
    }
}
