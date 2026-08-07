// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
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

    /// @notice Market => APR tick => book state.
    mapping(address market => mapping(uint16 aprBps => Tick tick)) internal ticks;
    /// @notice Market => immutable-once-set APR tick spacing in basis points.
    mapping(address market => uint16 spacing) public tickSpacing;
    /// @notice Position id => lender position.
    mapping(uint256 positionId => Position position) public positions;
    /// @notice Lender => number of positions appended by that lender.
    mapping(address lender => uint256 count) public lenderPositionCount;
    /// @notice Lender => zero-based index => position id.
    mapping(address lender => mapping(uint256 index => uint256 positionId)) public lenderPositionAt;

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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploys a lending market bound to one vault and Sablier instance.
    /// @dev Pulls treasury and token wiring from the factory registry.
    constructor(address factory_, address core_, address sablier_) {
        require(factory_ != address(0), "OVRFLOLending: factory zero");
        require(core_ != address(0), "OVRFLOLending: core zero");
        require(sablier_ != address(0), "OVRFLOLending: sablier zero");

        (address treasury_, address underlying_, address ovrfloToken_) =
            IOVRFLOFactoryRegistry(factory_).ovrfloInfo(core_);
        require(treasury_ != address(0), "OVRFLOLending: unknown core");
        require(underlying_ != address(0), "OVRFLOLending: underlying zero");
        require(ovrfloToken_ != address(0), "OVRFLOLending: token zero");

        factory = IOVRFLOFactoryRegistry(factory_);
        core = core_;
        sablier = ISablierV2LockupLinear(sablier_);
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        aprMinBps = LAUNCH_APR_BPS;
        aprMaxBps = LAUNCH_APR_BPS;
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Sets the accepted APR range for new supplies and borrows.
    /// @dev Existing positions are unaffected; tick validation reads these bounds at call time.
    function setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        require(aprMaxBps_ >= aprMinBps_, "OVRFLOLending: bad apr bounds");
        require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOLending: apr too high");

        aprMinBps = aprMinBps_;
        aprMaxBps = aprMaxBps_;

        emit LendingAprBoundsSet(aprMinBps_, aprMaxBps_);
    }

    /// @notice Sets a market's APR tick spacing exactly once.
    /// @dev Zero is the unset sentinel used by supply and borrow gating.
    function setTickSpacing(address market, uint16 spacing) external onlyOwner {
        if (spacing == 0) revert ZeroSpacing();
        if (tickSpacing[market] != 0) revert SpacingAlreadySet();

        tickSpacing[market] = spacing;
        emit TickSpacingSet(market, spacing);
    }

    /// @notice Sets the protocol fee applied by the borrower side.
    function setFee(uint16 feeBps_) external onlyOwner {
        require(feeBps_ <= MAX_FEE_BPS, "OVRFLOLending: fee too high");
        feeBps = feeBps_;
        emit LendingFeeSet(feeBps_);
    }

    /// @notice Sets the recipient of protocol fees.
    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "OVRFLOLending: treasury zero");
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

        Tick storage tick = ticks[market][aprBps];
        uint32 epoch = tick.currentEpoch;
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

        Epoch storage epochState = ticks[position.market][position.aprBps].epochs[position.epoch];
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
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

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

    /// @dev Converts wei to UNITs, flooring before a checked uint64 narrowing.
    function _toUnits(uint256 amount) internal pure returns (uint64) {
        return SafeCast.toUint64(amount / UNIT);
    }

    /// @dev Converts UNITs to wei through a checked uint128 narrowing.
    function _toWei(uint64 amount) internal pure returns (uint128) {
        return SafeCast.toUint128(uint256(amount) * UNIT);
    }

    /// @dev Pulls an exact amount and rejects fee-on-transfer behavior.
    function _pullExact(IERC20 token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 balanceAfter = token.balanceOf(to);
        require(balanceAfter - balanceBefore == amount, "OVRFLOLending: transfer mismatch");
    }
}
