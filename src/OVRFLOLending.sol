// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IOVRFLOFactoryRegistry, StreamPricing} from "./StreamPricing.sol";
import {TickTree} from "./TickTree.sol";

/// @title OVRFLOLending
/// @notice Loan-only fixed-rate order book for OVRFLO collateral streams.
/// @dev Lenders append underlying-denominated liquidity to per-market APR ticks.
///      Quantities are stored as UNIT-denominated tree leaves; the borrower side
///      advances an epoch's cumulative `filled` coordinate without enumerating
///      positions.
contract OVRFLOLending is Ownable2Step, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20;
    using TickTree for TickTree.Tree;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Launch APR (10%) used as the initial min and max APR bound.
    uint16 public constant LAUNCH_APR_BPS = 1000;
    /// @notice Hard ceiling on the maximum APR bound the owner may set (100%).
    uint16 public constant APR_MAX_CEILING = 10_000;
    /// @notice Hard ceiling on the protocol fee the owner may set (100%).
    uint16 public constant MAX_FEE_BPS = 10_000;
    /// @notice Book quantization granule in wei.
    uint128 public constant UNIT = 1e12;
    /// @notice Minimum supply and borrow-fill amount in wei.
    uint128 public constant MIN_LIQUIDITY_AMOUNT = 1e15;
    /// @dev `MIN_LIQUIDITY_AMOUNT` expressed in UNITs — a derivation, not a second
    ///      source: the cursor predicate compares tree quantities, which are UNITs.
    uint64 internal constant MIN_LIQUIDITY_UNITS = uint64(MIN_LIQUIDITY_AMOUNT / UNIT);
    /// @notice Maximum epoch-cursor steps one borrow may perform.
    uint8 public constant CURSOR_CAP = 32;
    /// @notice Minimum remaining stream face accepted by the borrower side.
    uint256 public constant MIN_STREAM_AMOUNT = 1e6;

    /*//////////////////////////////////////////////////////////////
                                  ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev The supplied token amount is zero.
    error ZeroAmount();
    /// @dev The supplied token amount is not an exact multiple of UNIT.
    error NotUnitAligned();
    /// @dev The supplied token amount is below MIN_LIQUIDITY_AMOUNT.
    error BelowMinimum();
    /// @dev The market has no configured APR tick spacing.
    error SpacingUnset();
    /// @dev The market's APR tick spacing was already configured.
    error SpacingAlreadySet();
    /// @dev APR tick spacing cannot use zero, which is the unset sentinel.
    error ZeroSpacing();
    /// @dev The APR is outside current bounds or is not spacing-aligned.
    error InvalidTick();
    /// @dev Only the position's recorded lender may act on it.
    error NotLender();
    /// @dev The position has no unfilled liquidity left to refund.
    error NothingToWithdraw();
    /// @dev The requested borrow target is zero.
    error ZeroTarget();
    /// @dev The tick has no available depth (never supplied or fully consumed).
    error EmptyTick();
    /// @dev The net proceeds fall below the borrower's acceptable floor.
    error BelowMinAcceptable();
    /// @dev The pair has no unpaid pro-rata entitlement to pay out.
    error NothingToClaim();
    /// @dev The position's interval does not intersect the loan's frozen fill interval.
    error NoOverlap();
    /// @dev The position and the loan sit on different `(market, aprBps, epoch)` tapes.
    error EpochMismatch();
    /// @dev The loan has already been settled and its stream returned.
    error LoanClosed();
    /// @dev The loan id was never originated.
    error LoanMissing();
    /// @dev The repayment exceeds the loan's outstanding obligation.
    error RepayExceedsOutstanding();
    /// @dev The stream's withdrawable accrual does not yet cover the loan's outstanding.
    error NotCovered();
    /// @dev More than CURSOR_CAP dead epochs precede the live one; call `advanceEpochCursor`.
    error EpochBacklog();
    /// @dev A bounded scan was asked for zero iterations (`maxSteps` or `maxN`).
    error ZeroSteps();
    /// @dev The position id was never created.
    error PositionMissing();
    /// @dev A required constructor or admin-setter address argument was the zero address.
    error ZeroAddress();
    /// @dev The factory has no vault registered for the supplied `core` address.
    error UnknownCore();
    /// @dev `aprMaxBps_` is below `aprMinBps_`.
    error BadAprBounds();
    /// @dev `aprMaxBps_` exceeds `APR_MAX_CEILING`.
    error AprTooHigh();
    /// @dev `feeBps_` exceeds `MAX_FEE_BPS`.
    error FeeTooHigh();
    /// @dev The pulled token delivered less than `amount` (fee-on-transfer behavior).
    error TransferMismatch();

    /*//////////////////////////////////////////////////////////////
                                IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice OVRFLOFactory registry; source of vault wiring.
    IOVRFLOFactoryRegistry public immutable factory;
    /// @notice The OVRFLO core vault this lending market serves.
    address public immutable core;
    /// @notice The ovrfloToken paid by collateral streams.
    address public immutable ovrfloToken;
    /// @notice The underlying ERC20 escrowed as lender liquidity.
    address public immutable underlying;
    /// @notice Sablier V2 Lockup Linear instance used for collateral-stream custody and withdrawal.
    ISablierV2LockupLinear public immutable sablier;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Current minimum APR in basis points accepted by new supplies.
    uint16 public aprMinBps;
    /// @notice Current maximum APR in basis points accepted by new supplies.
    uint16 public aprMaxBps;
    /// @notice Protocol fee in basis points applied by the borrower side.
    uint16 public feeBps;
    /// @notice Recipient of protocol fees.
    address public treasury;

    /// @notice Next lender position id, monotonically increasing from 1.
    uint256 public nextPositionId = 1;

    /// @notice One generation of a tick's permanent coordinate tape.
    /// @param tree Packed prefix-sum tree whose leaves are UNIT-denominated.
    /// @param filled Cumulative UNIT-denominated quantity consumed from the tape.
    /// @param loanCount Number of frozen loan intervals in this epoch.
    struct Epoch {
        TickTree.Tree tree;
        uint64 filled;
        uint64 loanCount;
    }

    /// @notice One APR price level for one market.
    /// @param oldestLiveEpoch Oldest epoch eligible for borrowing.
    /// @param currentEpoch Epoch receiving new supplies.
    /// @param epochs Permanently keyed epoch state.
    struct Tick {
        uint32 oldestLiveEpoch;
        uint32 currentEpoch;
        mapping(uint32 epoch => Epoch state) epochs;
    }

    /// @notice A lender's permanent coordinate in a tick epoch.
    /// @dev Position size is derived from the tree leaf; it is never duplicated here.
    /// @param lender Position owner.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps Fixed APR tick in basis points.
    /// @param epoch Tick generation containing the position.
    /// @param leafIndex Permanent tree leaf coordinate within the epoch.
    struct Position {
        address lender;
        address market;
        uint16 aprBps;
        uint32 epoch;
        uint32 leafIndex;
    }

    /// @notice Next loan id, monotonically increasing from 1.
    uint256 public nextLoanId = 1;

    /// @notice A borrower's frozen fill against one tick epoch.
    /// @dev Every field is immutable once stored; the interval `[fillStart, fillEnd)`
    ///      lies entirely below the epoch's `filled` counter forever (frozen history),
    ///      which is what makes lazy interval-overlap attribution exact at claim time.
    ///      Servicing state (`closed`, `drawn`, `repaid`) is the only mutable part:
    ///      `closed` rides the free bytes of the borrower slot and the two recovery
    ///      counters share one slot, so settlement never allocates a fresh word.
    /// @param borrower Loan owner; receives the stream back once settled.
    /// @param aprBps Fixed APR tick the loan filled from.
    /// @param epoch Tick generation containing the fill.
    /// @param closed True once the obligation is fully satisfied and the stream returned.
    /// @param market Pendle market identifying the collateral series.
    /// @param seq Zero-based index in the tick epoch's append-only loan list.
    /// @param streamId Pledged Sablier collateral stream.
    /// @param fillStart Inclusive tape coordinate where the fill begins, in UNITs.
    /// @param fillEnd Exclusive tape coordinate where the fill ends, in UNITs.
    /// @param obligation ovrfloToken owed at maturity for the advanced principal.
    /// @param drawn ovrfloToken drawn from the pledged stream so far.
    /// @param repaid ovrfloToken repaid at face so far.
    struct Loan {
        address borrower;
        uint16 aprBps;
        uint32 epoch;
        bool closed;
        address market;
        uint64 seq;
        uint256 streamId;
        uint64 fillStart;
        uint64 fillEnd;
        uint128 obligation;
        uint128 drawn;
        uint128 repaid;
    }

    /// @notice Market => APR tick => book state.
    mapping(address market => mapping(uint16 aprBps => Tick tick)) internal _ticks;
    /// @notice Market => immutable-once-set APR tick spacing in basis points.
    mapping(address market => uint16 spacing) public tickSpacing;
    /// @notice Position id => lender position.
    mapping(uint256 positionId => Position position) public positions;
    /// @notice Lender => number of positions appended by that lender.
    mapping(address lender => uint256 count) public lenderPositionCount;
    /// @notice Lender => zero-based index => position id.
    mapping(address lender => mapping(uint256 index => uint256 positionId)) public lenderPositionAt;
    /// @notice Loan id => frozen loan record.
    mapping(uint256 loanId => Loan loan) public loans;
    /// @notice Tick epoch's append-only loan list: sequence number => loan id.
    /// @dev Sorted by construction — loan intervals partition the tape in fill order.
    mapping(
        address market => mapping(uint16 aprBps => mapping(uint32 epoch => mapping(uint64 seq => uint256 loanId)))
    ) public loanAt;
    /// @notice Borrower => number of loans created by that borrower.
    mapping(address borrower => uint256 count) public borrowerLoanCount;
    /// @notice Borrower => zero-based index => loan id.
    mapping(address borrower => mapping(uint256 index => uint256 loanId)) public borrowerLoanAt;
    /// @notice Loan id => recovered ovrfloToken held for that loan's contributors.
    /// @dev Credited by `repay`, by `close`, and by `claim`'s just-in-time harvest;
    ///      debited by every payout. Rounding dust is lender-unfavorable and strands
    ///      here by design (plan risk #5).
    mapping(uint256 loanId => uint128 amount) public proceeds;
    /// @notice Loan id => position id => cumulative ovrfloToken paid to that pair.
    /// @dev Keyed by position rather than by lender address: positions are the
    ///      attribution unit, so the pro-rata cap is independent of address reuse
    ///      across positions (KTD9).
    mapping(uint256 loanId => mapping(uint256 positionId => uint128 amount)) public received;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when the owner changes the APR bounds.
    event LendingAprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    /// @notice Emitted when the owner changes the protocol fee.
    event LendingFeeSet(uint16 feeBps);
    /// @notice Emitted when the owner changes the fee treasury.
    event LendingTreasurySet(address indexed treasury);
    /// @notice Emitted when a market's immutable APR tick spacing is configured.
    event TickSpacingSet(address indexed market, uint16 spacing);
    /// @notice Emitted when underlying liquidity is appended to a tick tape.
    event Supplied(
        uint256 indexed positionId,
        address indexed lender,
        address indexed market,
        uint16 aprBps,
        uint32 epoch,
        uint32 leafIndex,
        uint128 amount
    );
    /// @notice Emitted when a position's unfilled suffix is refunded.
    /// @dev `remainingLeaf` is the absolute post-withdraw leaf size in wei.
    event Withdrawn(uint256 indexed positionId, address indexed lender, uint128 refund, uint128 remainingLeaf);
    /// @notice Emitted when a blind fill originates a loan against a pledged stream.
    /// @dev `fillStart`/`fillEnd` are absolute tape coordinates in UNITs; `fillEnd`
    ///      is the epoch's post-fill `filled` value (absolute-checkpoint pattern).
    ///      `actualBorrow`, `feeAmount`, and `obligation` are wei-denominated token
    ///      amounts. `feeAmount` is carried because `feeBps` is owner-mutable and no
    ///      per-loan snapshot exists, so net proceeds (`actualBorrow - feeAmount`)
    ///      would otherwise not be reconstructible from logs alone.
    event Borrowed(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed market,
        uint16 aprBps,
        uint32 epoch,
        uint64 seq,
        uint64 fillStart,
        uint64 fillEnd,
        uint128 actualBorrow,
        uint128 feeAmount,
        uint128 obligation,
        uint256 streamId
    );
    /// @notice Emitted when ovrfloToken is repaid at face against a loan.
    /// @dev `outstanding` is the absolute post-repay remainder; zero means the loan
    ///      closed in this call. Completing repay disposes the pledged stream: a
    ///      depleted NFT burns, a residual NFT returns to the borrower.
    event Repaid(uint256 indexed loanId, uint128 amount, uint128 outstanding);
    /// @notice Emitted when a loan is settled and the pledged stream is disposed.
    /// @dev `drawn` is the absolute lifetime draw, not this call's delta. Fires exactly
    ///      once per loan, on BOTH closure paths: the permissionless `close` draw and a
    ///      full `repay` (which emits `Repaid(…, 0)` first and leaves `drawn` untouched).
    event Closed(uint256 indexed loanId, uint128 drawn);
    /// @notice Emitted when settlement disposes of the pledged stream NFT.
    /// @dev Fires on `close` and on `repay` when remaining is zero, on both the burn
    ///      branch and the return branch. A burn `Transfer` to `address(0)` does not
    ///      carry the borrower; this event does. Does not fire on `claim`.
    event StreamDisposed(uint256 indexed loanId, address indexed borrower, uint256 streamId, bool burned);
    /// @notice Emitted when a contributing position is paid its pro-rata share.
    /// @dev `receivedTotal` is the absolute cumulative payout for the pair.
    event Claimed(uint256 indexed loanId, uint256 indexed positionId, uint128 amount, uint128 receivedTotal);
    /// @notice Emitted when a tick opens a fresh epoch because its tree hit capacity.
    event EpochOpened(address indexed market, uint16 aprBps, uint32 epoch);
    /// @notice Emitted when the borrowable cursor advances past dead epochs.
    /// @dev Emitted by `advanceEpochCursor` only; a `borrow` that advances the cursor
    ///      checkpoints the landing epoch in its own `Borrowed.epoch` field instead.
    event EpochCursorAdvanced(address indexed market, uint16 aprBps, uint32 fromEpoch, uint32 toEpoch);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploys a lending market bound to one vault and Sablier instance.
    /// @dev Pulls treasury and token wiring from the factory registry.
    /// @param factory_ OVRFLOFactory registry; also the initial owner via Ownable2Step.
    /// @param core_ The OVRFLO vault this lending market is bound to.
    /// @param sablier_ Sablier V2 LockupLinear deployment used for stream custody.
    constructor(address factory_, address core_, address sablier_) {
        if (factory_ == address(0)) revert ZeroAddress();
        if (core_ == address(0)) revert ZeroAddress();
        if (sablier_ == address(0)) revert ZeroAddress();

        (address treasury_, address underlying_, address ovrfloToken_) =
            IOVRFLOFactoryRegistry(factory_).ovrfloInfo(core_);
        if (treasury_ == address(0)) revert UnknownCore();
        if (underlying_ == address(0)) revert ZeroAddress();
        if (ovrfloToken_ == address(0)) revert ZeroAddress();

        factory = IOVRFLOFactoryRegistry(factory_);
        core = core_;
        sablier = ISablierV2LockupLinear(sablier_);
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        aprMinBps = LAUNCH_APR_BPS;
        aprMaxBps = LAUNCH_APR_BPS;

        _transferOwnership(factory_);
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Sets the accepted APR range for new supplies and borrows.
    /// @dev Existing positions are unaffected; tick validation reads these bounds at call time.
    /// @param aprMinBps_ New lower APR bound, in basis points.
    /// @param aprMaxBps_ New upper APR bound, in basis points; capped at `APR_MAX_CEILING`.
    function setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        if (aprMaxBps_ < aprMinBps_) revert BadAprBounds();
        if (aprMaxBps_ > APR_MAX_CEILING) revert AprTooHigh();

        aprMinBps = aprMinBps_;
        aprMaxBps = aprMaxBps_;

        emit LendingAprBoundsSet(aprMinBps_, aprMaxBps_);
    }

    /// @notice Sets a market's APR tick spacing exactly once.
    /// @dev Zero is the unset sentinel used by supply and borrow gating.
    /// @param market Pendle market identifying the collateral series.
    /// @param spacing APR tick spacing, in basis points; must be nonzero.
    function setTickSpacing(address market, uint16 spacing) external onlyOwner {
        if (spacing == 0) revert ZeroSpacing();
        if (tickSpacing[market] != 0) revert SpacingAlreadySet();

        tickSpacing[market] = spacing;
        emit TickSpacingSet(market, spacing);
    }

    /// @notice Sets the protocol fee applied by the borrower side.
    /// @param feeBps_ New protocol fee, in basis points; capped at `MAX_FEE_BPS`.
    function setFee(uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = feeBps_;
        emit LendingFeeSet(feeBps_);
    }

    /// @notice Sets the recipient of protocol fees.
    /// @param treasury_ New fee recipient; must be nonzero.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit LendingTreasurySet(treasury_);
    }

    /*//////////////////////////////////////////////////////////////
                            LENDER LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Escrows underlying and appends a lender position at an APR tick.
    /// @dev Amounts are exact UNIT multiples. New supplies are forbidden at or
    ///      after maturity. Positions append to the tick's current epoch.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps APR tick in basis points.
    /// @param amount Underlying liquidity to escrow, in wei.
    /// @return positionId Newly allocated lender position id.
    function supply(address market, uint16 aprBps, uint128 amount) external nonReentrant returns (uint256 positionId) {
        if (amount == 0) revert ZeroAmount();
        if (amount % UNIT != 0) revert NotUnitAligned();
        if (amount < MIN_LIQUIDITY_AMOUNT) revert BelowMinimum();

        _validateTick(market, aprBps);
        _requireMarketActive(market);

        Tick storage tick = _ticks[market][aprBps];
        uint32 epoch = tick.currentEpoch;
        // Rollover is a pre-check: internal library reverts cannot be try/caught,
        // so the at-cap epoch is detected *before* appending and a fresh epoch
        // opens. The library's own AtCapacity error remains defense-in-depth.
        if (_epochAtCapacity(tick.epochs[epoch].tree)) {
            epoch += 1;
            tick.currentEpoch = epoch;
            emit EpochOpened(market, aprBps, epoch);
        }
        uint32 leafIndex = tick.epochs[epoch].tree.append(_toUnits(amount));

        positionId = nextPositionId++;
        positions[positionId] =
            Position({lender: msg.sender, market: market, aprBps: aprBps, epoch: epoch, leafIndex: leafIndex});

        uint256 lenderIndex = lenderPositionCount[msg.sender];
        lenderPositionAt[msg.sender][lenderIndex] = positionId;
        lenderPositionCount[msg.sender] = lenderIndex + 1;

        _pullExact(IERC20(underlying), msg.sender, address(this), amount);

        emit Supplied(positionId, msg.sender, market, aprBps, epoch, leafIndex, amount);
    }

    /// @notice Refunds a position's entire unfilled suffix.
    /// @dev Never market-gated: lenders may unwind after maturity. The leaf is
    ///      replaced with its filled history, so coordinates below `filled`
    ///      remain immutable while later unfilled coordinates compact left.
    /// @param positionId Lender position to withdraw.
    function withdraw(uint256 positionId) external nonReentrant {
        Position storage position = positions[positionId];
        if (position.lender != msg.sender) revert NotLender();

        Epoch storage epochState = _ticks[position.market][position.aprBps].epochs[position.epoch];
        uint64 leafStart = epochState.tree.prefix(position.leafIndex);
        uint64 currentLeaf = epochState.tree.leaf(position.leafIndex);
        uint64 filledHistory;

        if (epochState.filled > leafStart) {
            uint64 consumedThroughPosition = epochState.filled - leafStart;
            filledHistory = consumedThroughPosition < currentLeaf ? consumedThroughPosition : currentLeaf;
        }

        uint64 unfilled = currentLeaf - filledHistory;
        if (unfilled == 0) revert NothingToWithdraw();

        epochState.tree.setLeaf(position.leafIndex, filledHistory);

        uint128 refund = _toWei(unfilled);
        uint128 remainingLeaf = _toWei(filledHistory);
        IERC20(underlying).safeTransfer(msg.sender, refund);

        emit Withdrawn(positionId, msg.sender, refund, remainingLeaf);
    }

    /*//////////////////////////////////////////////////////////////
                            BORROWER LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Borrows against a pledged Sablier stream by blind-filling one APR tick.
    /// @dev Takes no position identifiers: the fill advances the oldest live epoch's
    ///      cumulative `filled` counter by `min(target, available, price)` without
    ///      reading any lender position, so fill gas is flat in positions crossed and
    ///      concurrent borrows cannot collide (the loser of the race simply fills the
    ///      residue, bounded by `minAcceptable`). The target is floored to UNIT and
    ///      additionally capped at the stream's discounted gross price, which keeps
    ///      `obligation <= remaining` (a max borrow is economically a sale, R11).
    ///      A stream already backing an open loan is owned by this contract, so a
    ///      second pledge fails ERC-721's owner check inside Sablier's `transferFrom`
    ///      (no bespoke guard, user decision 2026-08-08). The stream NFT is escrowed
    ///      with plain `transferFrom` — never `safeTransferFrom` — leaving no
    ///      `onERC721Received` callback surface.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps APR tick in basis points to fill from.
    /// @param targetBorrow Desired principal in wei; floored to UNIT, filled up to depth.
    /// @param streamId Sablier stream pledged as collateral.
    /// @param minAcceptable Minimum net proceeds (after fee) the borrower accepts, in wei.
    /// @return loanId Newly allocated loan id.
    function borrow(address market, uint16 aprBps, uint128 targetBorrow, uint256 streamId, uint128 minAcceptable)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        if (targetBorrow == 0) revert ZeroTarget();
        _validateTick(market, aprBps);

        FillOutcome memory outcome = _fillTick(market, aprBps, targetBorrow, streamId);
        if (outcome.actualBorrow - outcome.feeAmount < minAcceptable) revert BelowMinAcceptable();

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            aprBps: aprBps,
            epoch: outcome.epoch,
            closed: false,
            market: market,
            seq: outcome.seq,
            streamId: streamId,
            fillStart: outcome.fillStart,
            fillEnd: outcome.fillEnd,
            obligation: outcome.obligation,
            drawn: 0,
            repaid: 0
        });
        loanAt[market][aprBps][outcome.epoch][outcome.seq] = loanId;

        borrowerLoanAt[msg.sender][borrowerLoanCount[msg.sender]] = loanId;
        borrowerLoanCount[msg.sender] += 1;

        sablier.transferFrom(msg.sender, address(this), streamId);
        _payUnderlying(msg.sender, outcome.actualBorrow - outcome.feeAmount);
        _payUnderlying(treasury, outcome.feeAmount);

        emit Borrowed(
            loanId,
            msg.sender,
            market,
            aprBps,
            outcome.epoch,
            outcome.seq,
            outcome.fillStart,
            outcome.fillEnd,
            outcome.actualBorrow,
            outcome.feeAmount,
            outcome.obligation,
            streamId
        );
    }

    /*//////////////////////////////////////////////////////////////
                            EPOCH MAINTENANCE
    //////////////////////////////////////////////////////////////*/

    /// @notice Advances a tick's borrowable cursor past drained or dust epochs.
    /// @dev Permissionless recovery valve for `borrow`'s `CURSOR_CAP` bound
    ///      (risk #4): advances at most `maxSteps` epochs under the same predicate
    ///      `borrow` uses (available depth `< MIN_LIQUIDITY_AMOUNT`), keeps
    ///      whatever progress it makes, succeeds as a no-op when nothing
    ///      qualifies, and never passes a live epoch or `currentEpoch`.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps APR tick in basis points.
    /// @param maxSteps Maximum epochs to advance; must be nonzero.
    /// @return cursor The tick's oldest live epoch after this call.
    function advanceEpochCursor(address market, uint16 aprBps, uint32 maxSteps)
        external
        nonReentrant
        returns (uint32 cursor)
    {
        if (maxSteps == 0) revert ZeroSteps();

        Tick storage tick = _ticks[market][aprBps];
        cursor = tick.oldestLiveEpoch;
        uint32 fromEpoch = cursor;
        uint32 currentEpoch = tick.currentEpoch;
        uint32 stepsLeft = maxSteps;

        while (stepsLeft > 0 && cursor < currentEpoch) {
            Epoch storage epochState = tick.epochs[cursor];
            if (epochState.tree.root() - epochState.filled >= MIN_LIQUIDITY_UNITS) break;
            unchecked {
                ++cursor;
                --stepsLeft;
            }
        }

        if (cursor != fromEpoch) {
            tick.oldestLiveEpoch = cursor;
            emit EpochCursorAdvanced(market, aprBps, fromEpoch, cursor);
        }
    }

    /*//////////////////////////////////////////////////////////////
                             LOAN SERVICING
    //////////////////////////////////////////////////////////////*/

    /// @notice Repays ovrfloToken at face value against a loan's outstanding.
    /// @dev Never market-gated: a matured series winds down through this path (KTD7).
    ///      Repayment is at face by design — an early repayment hands lenders their
    ///      promised fixed amount sooner, never a discounted one. Anyone may repay:
    ///      the funds come from `msg.sender` while a completing repay disposes of the
    ///      stream (burn if depleted, else return to `loan.borrower`), so a third-party
    ///      repayment is a donation with no lender-side or borrower-side downside, and
    ///      the error catalog carries no caller check for this path. The
    ///      `amount == outstanding` closure test cannot brick: `outstanding` is always
    ///      an exact integer wei and ovrfloToken has 18-decimal granularity (see
    ///      `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md`).
    ///      A full repayment emits `Repaid(…, 0)` and then `Closed(loanId, drawn)`, so
    ///      one terminal signal covers both closure paths. `StreamDisposed` fires on
    ///      the completing path as well.
    /// @param loanId The loan to repay.
    /// @param amount ovrfloToken to repay; must not exceed the outstanding.
    function repay(uint256 loanId, uint128 amount) external nonReentrant {
        Loan storage loan = _liveLoan(loanId);
        if (amount == 0) revert ZeroAmount();

        uint128 outstanding = _outstanding(loan);
        if (amount > outstanding) revert RepayExceedsOutstanding();

        uint128 remaining = outstanding - amount;
        loan.repaid += amount;
        if (remaining == 0) loan.closed = true;
        proceeds[loanId] += amount;

        _pullExact(IERC20(ovrfloToken), msg.sender, address(this), amount);
        if (remaining == 0) _disposeStream(loanId, loan.borrower, loan.streamId);

        emit Repaid(loanId, amount, remaining);
        // `Closed` fires exactly once per loan, on whichever path ends it. Repay does
        // not draw, so the absolute lifetime `drawn` checkpoint is unchanged here.
        if (remaining == 0) emit Closed(loanId, loan.drawn);
    }

    /// @notice Settles a covered loan from its stream and disposes of the stream NFT.
    /// @dev Permissionless and never market-gated (KTD7): once the stream's
    ///      withdrawable covers the outstanding, anyone may make the lenders whole.
    ///      Reverts `NotCovered` while the accrual is short of the outstanding, and
    ///      `LoanClosed` on a second call. Also reclaims an already-satisfied stream
    ///      (`outstanding == 0`), which draws nothing. After money movement, an empty
    ///      stream is burned and a residual stream returns to the borrower. The NFT
    ///      moves with plain `transferFrom` — never `safeTransferFrom` — leaving no
    ///      `onERC721Received` callback surface (plan risk #6). Burn revert falls
    ///      through to return. The branch is `isDepleted`, never a zero withdrawable.
    /// @param loanId The loan to close.
    function close(uint256 loanId) external nonReentrant {
        Loan storage loan = _liveLoan(loanId);

        uint128 outstanding = _outstanding(loan);
        uint256 streamId = loan.streamId;
        if (sablier.withdrawableAmountOf(streamId) < outstanding) revert NotCovered();

        loan.closed = true;
        uint128 drawn = loan.drawn;
        if (outstanding > 0) {
            drawn += outstanding;
            loan.drawn = drawn;
            proceeds[loanId] += outstanding;
            sablier.withdraw(streamId, address(this), outstanding);
        }
        _disposeStream(loanId, loan.borrower, streamId);

        emit Closed(loanId, drawn);
    }

    /// @notice Pays a contributing position its share of the loan's recovered value.
    /// @dev Lender-only and never market-gated (KTD7). The payout cap is pattern #12's
    ///      cumulative-recovered formula: `contribution * recovered / intervalLength`
    ///      minus everything the pair already received, where `recovered` is
    ///      `drawn + repaid` plus, while the loan is open, the stream's not-yet-drawn
    ///      accrual `min(withdrawable, outstanding)`. Because the entitlement counts
    ///      that live accrual, the deficit is harvested from the stream just in time —
    ///      the harvest fires if and only if the loan is open (pattern #13; a closed
    ///      loan has returned its stream and recovers `drawn + repaid` only). The cap
    ///      makes claiming order-independent: every contributor can always reach its
    ///      full pro-rata share regardless of who claims first. Floor division leaves
    ///      lender-unfavorable dust, which strands in `proceeds` by design.
    ///      Ordering rule (FREI-PI, mirroring `close`): every storage write — `received`,
    ///      `proceeds`, `loan.drawn` — lands before the first external call, so the
    ///      harvest withdraw and the payout transfer both observe consistent state.
    /// @param loanId The loan to claim against.
    /// @param positionId The claiming lender's position; must overlap the loan's fill.
    /// @param amount Requested payout in wei; `type(uint128).max` claims everything.
    function claim(uint256 loanId, uint256 positionId, uint128 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanMissing();

        Position storage position = positions[positionId];
        if (position.lender != msg.sender) revert NotLender();

        uint128 pot = proceeds[loanId];
        uint128 requestAmount;
        uint128 harvestAmount;
        {
            // `harvestCap` is the live accrual this loan may still draw:
            // `min(withdrawable, outstanding)` while open, and zero once closed. The
            // clamp is a security invariant, not arithmetic detail — on an over-vested
            // stream (`withdrawable > outstanding`) bare `withdrawable` would let the
            // first claimer drain value belonging to co-lenders.
            uint128 harvestCap;
            uint256 recovered = uint256(loan.drawn) + uint256(loan.repaid);
            if (!loan.closed) {
                harvestCap =
                    SafeCast.toUint128(Math.min(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan)));
                recovered += harvestCap;
            }

            uint256 entitlement = Math.mulDiv(_overlapUnits(loan, position), recovered, loan.fillEnd - loan.fillStart);
            requestAmount = SafeCast.toUint128(Math.min(amount, entitlement - received[loanId][positionId]));

            if (pot < requestAmount) {
                harvestAmount = SafeCast.toUint128(Math.min(requestAmount - pot, harvestCap));
            }
        }

        // The harvest is settled into the pot arithmetically first; the stream draw
        // that backs it is an interaction and happens below, after every write.
        pot += harvestAmount;
        uint128 payAmount = pot < requestAmount ? pot : requestAmount;
        if (payAmount == 0) revert NothingToClaim();

        uint128 receivedTotal = received[loanId][positionId] + payAmount;
        received[loanId][positionId] = receivedTotal;
        proceeds[loanId] = pot - payAmount;
        if (harvestAmount > 0) loan.drawn += harvestAmount;

        if (harvestAmount > 0) sablier.withdraw(loan.streamId, address(this), harvestAmount);
        IERC20(ovrfloToken).safeTransfer(msg.sender, payAmount);

        emit Claimed(loanId, positionId, payAmount, receivedTotal);
    }

    /*//////////////////////////////////////////////////////////////
                              VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Returns how much of a loan's fill came from one lender position.
    /// @dev Nothing is stored at fill time: the contribution is the overlap of the
    ///      position's *current* tape interval with the loan's frozen
    ///      `[fillStart, fillEnd)`. The two are comparable forever because unfilled
    ///      suffixes are the only thing a withdraw can remove, so a position slides
    ///      left only above the epoch's `filled` counter and never below it (frozen
    ///      history). Leaf numbering restarts per epoch, so intervals from different
    ///      epochs can collide numerically — the `(market, aprBps, epoch)` equality
    ///      check, not the interval arithmetic, is what blocks a cross-epoch claim
    ///      (plan risk #3).
    /// @param loanId The loan whose frozen interval is measured.
    /// @param positionId The lender position to measure against it.
    /// @return contribution Overlapping quantity in wei.
    function contributionOf(uint256 loanId, uint256 positionId) external view returns (uint128 contribution) {
        Loan storage loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanMissing();
        contribution = _toWei(_overlapUnits(loan, positions[positionId]));
    }

    /// @notice One rung of the tick ladder.
    /// @param aprBps The tick, in basis points.
    /// @param availableUnits Borrowable depth summed across live epochs, in UNITs.
    struct TickDepth {
        uint16 aprBps;
        uint128 availableUnits;
    }

    /// @notice One overlapping loan from a position's claim-discovery scan.
    /// @param loanId The overlapping loan.
    /// @param contribution The position's overlap with the loan's fill, in wei.
    /// @param claimable The pair's currently unpaid pro-rata entitlement, in wei.
    struct LoanShare {
        uint256 loanId;
        uint128 contribution;
        uint128 claimable;
    }

    /// @notice Returns the whole tick ladder for a market in one view call (R17).
    /// @dev Iterates every spacing multiple inside the APR bounds as read at call
    ///      time; each tick's depth is `root − filled` summed across its live
    ///      epochs. Reverts `SpacingUnset` for an unconfigured market.
    /// @param market Pendle market identifying the collateral series.
    /// @return depths One entry per tick, ascending by APR.
    function tickDepths(address market) external view returns (TickDepth[] memory depths) {
        uint16 spacing = tickSpacing[market];
        if (spacing == 0) revert SpacingUnset();

        uint16 minBps = aprMinBps;
        uint16 maxBps = aprMaxBps;
        // Ceiling to the next spacing multiple via the remainder, so the ladder
        // starts at the first valid tick at or above the lower bound.
        uint256 remainder = uint256(minBps) % spacing;
        uint256 first = remainder == 0 ? minBps : uint256(minBps) + (spacing - remainder);
        if (first > maxBps) return depths;

        uint256 count = (maxBps - first) / spacing + 1;
        depths = new TickDepth[](count);
        for (uint256 i = 0; i < count; ++i) {
            uint16 aprBps = SafeCast.toUint16(first + i * spacing);
            depths[i] = TickDepth({aprBps: aprBps, availableUnits: _liveDepthUnits(market, aprBps)});
        }
    }

    /// @notice Named tick view: cursor, current epoch, and live borrowable depth.
    /// @dev Reverts `SpacingUnset` for an unconfigured market (KTD8 convention:
    ///      named views revert on nonexistent entities). Validates spacing only —
    ///      not tick alignment or APR bounds — so ticks outside the owner-mutable
    ///      bounds stay readable through this view.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps The tick, in basis points.
    /// @return oldestLiveEpoch The tick's borrowable cursor.
    /// @return currentEpoch The tick's newest epoch.
    /// @return availableUnits Borrowable depth summed across live epochs, in UNITs.
    function tickState(address market, uint16 aprBps)
        external
        view
        returns (uint32 oldestLiveEpoch, uint32 currentEpoch, uint128 availableUnits)
    {
        if (tickSpacing[market] == 0) revert SpacingUnset();
        Tick storage tick = _ticks[market][aprBps];
        return (tick.oldestLiveEpoch, tick.currentEpoch, _liveDepthUnits(market, aprBps));
    }

    /// @notice Named position view: stored fields plus the derived tape interval.
    /// @dev Reverts `PositionMissing` on a never-created id (KTD8). The interval is
    ///      the live prefix-query result — the same coordinates claim math uses —
    ///      and `unfilled` mirrors `withdraw`'s refund computation.
    /// @param positionId The lender position to read.
    /// @return position Stored position fields (lender, market, aprBps, epoch, leafIndex).
    /// @return intervalStart Live tape coordinate where the position's leaf begins, in UNITs.
    /// @return intervalEnd Live tape coordinate where the position's leaf ends, in UNITs.
    /// @return unfilled Refundable quantity if withdrawn now, in wei.
    function positionState(uint256 positionId)
        external
        view
        returns (Position memory position, uint64 intervalStart, uint64 intervalEnd, uint128 unfilled)
    {
        Position storage stored = positions[positionId];
        if (stored.lender == address(0)) revert PositionMissing();
        position = stored;

        Epoch storage epochState = _ticks[stored.market][stored.aprBps].epochs[stored.epoch];
        intervalStart = epochState.tree.prefix(stored.leafIndex);
        uint64 leafValue = epochState.tree.leaf(stored.leafIndex);
        intervalEnd = intervalStart + leafValue;

        uint64 filledHistory;
        if (epochState.filled > intervalStart) {
            uint64 consumed = epochState.filled - intervalStart;
            filledHistory = consumed < leafValue ? consumed : leafValue;
        }
        unfilled = _toWei(leafValue - filledHistory);
    }

    /// @notice Named loan view: stored fields plus the derived outstanding.
    /// @dev Reverts `LoanMissing` on a never-originated id (KTD8).
    /// @param loanId The loan to read.
    /// @return loan Stored loan fields.
    /// @return outstanding Remaining obligation not yet drawn or repaid, in wei.
    function loanState(uint256 loanId) external view returns (Loan memory loan, uint128 outstanding) {
        Loan storage stored = loans[loanId];
        if (stored.borrower == address(0)) revert LoanMissing();
        loan = stored;
        outstanding = _outstanding(stored);
    }

    /// @notice Returns a position's overlapping loans with contribution and claimable (R18).
    /// @dev Claim discovery in one view call, no log scanning. The tick-epoch loan
    ///      list is interval-sorted by construction (loan fills partition the tape),
    ///      so entry is a binary search for the first loan ending past the
    ///      position's start — O(log n) — and the scan stops at the first loan
    ///      starting at or past the position's end. Loans on the position's own
    ///      tape cannot epoch-mismatch, so overlap uses the non-reverting core:
    ///      filtering skips, it never reverts (`contributionOf` is the reverting
    ///      single-pair form). `startSeq = 0` means "start from the binary-search
    ///      entry"; a nonzero `startSeq` resumes an earlier scan and MUST be a
    ///      `nextSeq` returned for the SAME position — arbitrary values silently
    ///      truncate the result set (discovery-only; `claim` re-derives all math).
    ///      `nextSeq = 0` means exhausted. `maxN == 0` reverts `ZeroSteps`.
    /// @param positionId The lender position to scan for.
    /// @param startSeq Resume point from a prior call's `nextSeq`, or 0 to start.
    /// @param maxN Maximum entries to return; must be nonzero.
    /// @return entries Overlapping loans, in fill order.
    /// @return nextSeq Sequence number to resume from, or 0 when exhausted.
    function loansOf(uint256 positionId, uint64 startSeq, uint256 maxN)
        external
        view
        returns (LoanShare[] memory entries, uint64 nextSeq)
    {
        if (maxN == 0) revert ZeroSteps();
        Position storage position = positions[positionId];
        if (position.lender == address(0)) revert PositionMissing();

        uint64 intervalStart;
        uint64 intervalEnd;
        uint64 count;
        {
            Epoch storage epochState = _ticks[position.market][position.aprBps].epochs[position.epoch];
            intervalStart = epochState.tree.prefix(position.leafIndex);
            intervalEnd = intervalStart + epochState.tree.leaf(position.leafIndex);
            count = epochState.loanCount;
        }
        if (count == 0 || intervalStart == intervalEnd) return (new LoanShare[](0), 0);

        uint64 seq = startSeq == 0 ? _firstOverlappingSeq(position, count, intervalStart) : startSeq;

        LoanShare[] memory buffer = new LoanShare[](maxN);
        uint256 found;
        while (seq < count && found < maxN) {
            (LoanShare memory share, bool past) =
                _shareOf(_loanIdAt(position, seq), positionId, intervalStart, intervalEnd);
            if (past) {
                // Sorted list: every later loan starts even further right.
                return (_shrink(buffer, found), 0);
            }
            if (share.loanId != 0) {
                buffer[found] = share;
                ++found;
            }
            ++seq;
        }

        if (seq < count && loans[_loanIdAt(position, seq)].fillStart < intervalEnd) {
            nextSeq = seq;
        }
        entries = _shrink(buffer, found);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Loads a loan that exists and is still open, or reverts.
    function _liveLoan(uint256 loanId) internal view returns (Loan storage loan) {
        loan = loans[loanId];
        if (loan.borrower == address(0)) revert LoanMissing();
        if (loan.closed) revert LoanClosed();
    }

    /// @dev Remaining ovrfloToken owed: `obligation - (drawn + repaid)`.
    function _outstanding(Loan storage loan) internal view returns (uint128) {
        return loan.obligation - loan.drawn - loan.repaid;
    }

    /// @dev Overlap of the position's current interval with the loan's frozen one,
    ///      in UNITs. Same-tape equality is checked first so a numerically identical
    ///      interval from another epoch can never be mistaken for a contribution.
    function _overlapUnits(Loan storage loan, Position storage position) internal view returns (uint64) {
        if (position.market != loan.market || position.aprBps != loan.aprBps || position.epoch != loan.epoch) {
            revert EpochMismatch();
        }

        Epoch storage epochState = _ticks[loan.market][loan.aprBps].epochs[loan.epoch];
        uint64 positionStart = epochState.tree.prefix(position.leafIndex);
        uint64 positionEnd = positionStart + epochState.tree.leaf(position.leafIndex);

        uint64 overlap = _intervalOverlap(positionStart, positionEnd, loan.fillStart, loan.fillEnd);
        if (overlap == 0) revert NoOverlap();
        return overlap;
    }

    /// @dev Non-reverting overlap core shared by the reverting single-pair path
    ///      (`_overlapUnits`) and the filtering scan (`loansOf`), which must skip
    ///      non-overlapping loans rather than revert. Callers own the tape-equality
    ///      check where one is needed; pure interval math happens here.
    function _intervalOverlap(uint64 aStart, uint64 aEnd, uint64 bStart, uint64 bEnd) internal pure returns (uint64) {
        uint64 overlapStart = aStart > bStart ? aStart : bStart;
        uint64 overlapEnd = aEnd < bEnd ? aEnd : bEnd;
        return overlapEnd > overlapStart ? overlapEnd - overlapStart : 0;
    }

    /// @dev Selects the epoch a borrow fills from: starts at the cursor and skips
    ///      epochs that can no longer host a minimum fill — one predicate covers
    ///      both fully-drained epochs and dust residuals, which become
    ///      withdraw-only. Advancement persists on success. The cap bounds a
    ///      single borrow's scan so inflated epoch counts can never gas-starve a
    ///      legitimate borrow (risk #4); `advanceEpochCursor` is the permissionless
    ///      recovery valve past the cap. Never passes `currentEpoch`.
    function _selectEpoch(Tick storage tick) internal returns (uint32 epoch, uint64 availableUnits) {
        epoch = tick.oldestLiveEpoch;
        Epoch storage epochState = tick.epochs[epoch];
        availableUnits = epochState.tree.root() - epochState.filled;

        uint32 currentEpoch = tick.currentEpoch;
        uint256 steps;
        while (availableUnits < MIN_LIQUIDITY_UNITS && epoch < currentEpoch) {
            if (steps == CURSOR_CAP) revert EpochBacklog();
            unchecked {
                ++steps;
                ++epoch;
            }
            epochState = tick.epochs[epoch];
            availableUnits = epochState.tree.root() - epochState.filled;
        }
        if (epoch != tick.oldestLiveEpoch) tick.oldestLiveEpoch = epoch;
    }

    /// @dev The tick-epoch loan list entry for the position's own tape.
    function _loanIdAt(Position storage position, uint64 seq) internal view returns (uint256) {
        return loanAt[position.market][position.aprBps][position.epoch][seq];
    }

    /// @dev One scan probe for `loansOf`: builds the pair's entry, or signals that
    ///      the loan (and, by sort order, every later one) lies past the position.
    ///      A zero `share.loanId` means "no overlap, keep scanning" — loan ids
    ///      start at 1, so zero is never a real entry.
    function _shareOf(uint256 loanId, uint256 positionId, uint64 intervalStart, uint64 intervalEnd)
        internal
        view
        returns (LoanShare memory share, bool past)
    {
        Loan storage loan = loans[loanId];
        if (loan.fillStart >= intervalEnd) return (share, true);
        uint64 overlap = _intervalOverlap(intervalStart, intervalEnd, loan.fillStart, loan.fillEnd);
        if (overlap != 0) {
            share = LoanShare({
                loanId: loanId,
                contribution: _toWei(overlap),
                claimable: _claimableOf(loanId, loan, positionId, overlap)
            });
        }
    }

    /// @dev Binary search for the first loan whose interval ends past the
    ///      position's start — the leftmost possible overlap. Sound because the
    ///      tick-epoch loan list is interval-sorted by construction: fills
    ///      partition `[0, filled)` in seq order, so `fillEnd` is strictly
    ///      increasing. O(log n): 21 probes at the 2M-leaf epoch bound.
    function _firstOverlappingSeq(Position storage position, uint64 count, uint64 intervalStart)
        internal
        view
        returns (uint64 lo)
    {
        uint64 hi = count;
        while (lo < hi) {
            uint64 mid = (lo + hi) / 2;
            if (loans[_loanIdAt(position, mid)].fillEnd <= intervalStart) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
    }

    /// @dev View mirror of `claim`'s entitlement math: pro-rata share of recovered
    ///      (pattern #12 — `drawn + repaid`, plus `min(withdrawable, outstanding)`
    ///      while open) minus everything the pair already received. Kept
    ///      arithmetic-identical to `claim`; the test suite pins the two together
    ///      by asserting a subsequent max-claim pays exactly this value.
    function _claimableOf(uint256 loanId, Loan storage loan, uint256 positionId, uint64 overlap)
        internal
        view
        returns (uint128)
    {
        uint256 recovered = uint256(loan.drawn) + loan.repaid;
        if (!loan.closed) {
            recovered += Math.min(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan));
        }
        uint256 entitlement = Math.mulDiv(overlap, recovered, loan.fillEnd - loan.fillStart);
        uint256 paid = received[loanId][positionId];
        return entitlement > paid ? SafeCast.toUint128(entitlement - paid) : 0;
    }

    /// @dev Borrowable depth summed across a tick's live epochs, in UNITs.
    function _liveDepthUnits(address market, uint16 aprBps) internal view returns (uint128 depth) {
        Tick storage tick = _ticks[market][aprBps];
        uint32 currentEpoch = tick.currentEpoch;
        for (uint32 epoch = tick.oldestLiveEpoch; epoch <= currentEpoch; ++epoch) {
            Epoch storage epochState = tick.epochs[epoch];
            depth += epochState.tree.root() - epochState.filled;
        }
    }

    /// @dev Copies the filled prefix of an over-allocated scan buffer.
    function _shrink(LoanShare[] memory buffer, uint256 found) internal pure returns (LoanShare[] memory out) {
        out = new LoanShare[](found);
        for (uint256 i = 0; i < found; ++i) {
            out[i] = buffer[i];
        }
    }

    /// @dev Rollover predicate for `supply`: TERMINAL capacity only. Below
    ///      `MAX_HEIGHT`, a full tree grows inside `TickTree.append` (U1) and no
    ///      epoch opens — `atCapacity` alone is true at every height's boundary,
    ///      so the height check is what separates "grow" from "roll over".
    ///      Virtual so the test harness can force terminal capacity without 8^7
    ///      appends.
    function _epochAtCapacity(TickTree.Tree storage tree) internal view virtual returns (bool) {
        return tree.height == TickTree.MAX_HEIGHT && tree.atCapacity();
    }

    /// @dev Priced, consumed result of one blind fill against a tick epoch.
    /// @param actualBorrow Principal advanced, in wei (an exact UNIT multiple).
    /// @param obligation ovrfloToken owed at maturity for `actualBorrow`.
    /// @param feeAmount Protocol fee on `actualBorrow`, in wei; bounded by
    ///        `actualBorrow` (fee bps are capped at 100%), so the narrowing is exact.
    /// @param epoch Tick epoch the fill consumed from.
    /// @param seq The loan's index in the tick epoch's loan list.
    /// @param fillStart Inclusive fill interval start, in UNITs.
    /// @param fillEnd Exclusive fill interval end, in UNITs.
    struct FillOutcome {
        uint128 actualBorrow;
        uint128 obligation;
        uint128 feeAmount;
        uint32 epoch;
        uint64 seq;
        uint64 fillStart;
        uint64 fillEnd;
    }

    /// @dev Prices the pledged stream, sizes the fill, and consumes it from the
    ///      oldest live epoch by advancing `filled` (with the packed `loanCount`
    ///      increment riding the same slot). The fill is `min(target, available)`
    ///      capped at the stream's gross price; the price-cap narrowing cannot
    ///      revert because in that branch `grossPrice / UNIT` is below the already
    ///      uint64-bounded fill.
    function _fillTick(address market, uint16 aprBps, uint128 targetBorrow, uint256 streamId)
        internal
        returns (FillOutcome memory outcome)
    {
        (StreamPricing.Eligibility memory eligibility, uint256 grossPrice, uint256 timeToMaturity) =
            _priceStream(market, streamId, aprBps);

        Tick storage tick = _ticks[market][aprBps];
        uint64 availableUnits;
        (outcome.epoch, availableUnits) = _selectEpoch(tick);
        Epoch storage epochState = tick.epochs[outcome.epoch];

        outcome.fillStart = epochState.filled;
        if (availableUnits == 0) revert EmptyTick();

        uint256 targetUnits = uint256(targetBorrow) / UNIT;
        uint64 fillUnits = SafeCast.toUint64(targetUnits < availableUnits ? targetUnits : availableUnits);
        outcome.actualBorrow = _toWei(fillUnits);
        if (outcome.actualBorrow > grossPrice) {
            fillUnits = _toUnits(grossPrice);
            outcome.actualBorrow = _toWei(fillUnits);
        }
        if (outcome.actualBorrow < MIN_LIQUIDITY_AMOUNT) revert BelowMinimum();

        outcome.obligation = StreamPricing.obligationForFill(
            outcome.actualBorrow, grossPrice, eligibility.remaining, aprBps, timeToMaturity
        );
        outcome.feeAmount = SafeCast.toUint128(StreamPricing.fee(outcome.actualBorrow, feeBps));

        outcome.fillEnd = outcome.fillStart + fillUnits;
        outcome.seq = epochState.loanCount;
        // Consumption: `filled` and `loanCount` share one packed storage slot, so
        // the entire fill is a single slot write regardless of positions crossed.
        epochState.filled = outcome.fillEnd;
        epochState.loanCount = outcome.seq + 1;
    }

    /// @dev Validates spacing, current APR bounds, and tick alignment.
    function _validateTick(address market, uint16 aprBps) internal view {
        uint16 spacing = tickSpacing[market];
        if (spacing == 0) revert SpacingUnset();
        if (aprBps < aprMinBps || aprBps > aprMaxBps || aprBps % spacing != 0) revert InvalidTick();
    }

    /// @dev Market-level gate delegated to the shared StreamPricing source of truth.
    function _requireMarketActive(address market) internal view {
        StreamPricing.marketActive(core, market);
    }

    /// @dev Stream-level eligibility gate; delegates to `StreamPricing.requireEligible`
    ///      (which includes the market/maturity gate) and enforces the
    ///      `MIN_STREAM_AMOUNT` floor so dust streams cannot be pledged.
    function _requireEligible(address market, uint256 streamId)
        internal
        view
        returns (StreamPricing.Eligibility memory eligibility)
    {
        eligibility = StreamPricing.requireEligible(address(sablier), core, market, streamId);
        if (eligibility.remaining < MIN_STREAM_AMOUNT) revert BelowMinimum();
    }

    /// @dev Prices a stream at a tick: eligibility gate, then the discounted gross price.
    function _priceStream(address market, uint256 streamId, uint16 aprBps)
        internal
        view
        returns (StreamPricing.Eligibility memory eligibility, uint256 grossPrice, uint256 timeToMaturity)
    {
        eligibility = _requireEligible(market, streamId);
        timeToMaturity = eligibility.seriesMaturity - block.timestamp;
        grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
    }

    /// @dev Converts wei to UNITs, flooring before a checked uint64 narrowing.
    function _toUnits(uint256 amount) internal pure returns (uint64) {
        return SafeCast.toUint64(amount / UNIT);
    }

    /// @dev Converts UNITs to wei through a checked uint128 narrowing.
    function _toWei(uint64 amount) internal pure returns (uint128) {
        return SafeCast.toUint128(uint256(amount) * UNIT);
    }

    /// @dev Pays `amount` underlying to `to`, skipping the transfer when zero.
    function _payUnderlying(address to, uint256 amount) internal {
        if (amount > 0) {
            IERC20(underlying).safeTransfer(to, amount);
        }
    }

    /// @dev Pulls an exact amount and rejects fee-on-transfer behavior.
    function _pullExact(IERC20 token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 balanceAfter = token.balanceOf(to);
        if (balanceAfter - balanceBefore != amount) revert TransferMismatch();
    }

    /// @dev Dispose of a pledged stream after money movement. Burn a depleted NFT;
    ///      otherwise return it. A reverting burn falls through to return so settlement
    ///      money movement never depends on disposal. Uses plain `transferFrom`.
    function _disposeStream(uint256 loanId, address borrower, uint256 streamId) internal {
        bool burned;
        if (sablier.isDepleted(streamId)) {
            try sablier.burn(streamId) {
                burned = true;
            } catch {
                sablier.transferFrom(address(this), borrower, streamId);
            }
        } else {
            sablier.transferFrom(address(this), borrower, streamId);
        }
        emit StreamDisposed(loanId, borrower, streamId, burned);
    }
}
