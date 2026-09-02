// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {StreamPricing} from "./StreamPricing.sol";

/// @title OVRFLO
/// @notice A wrapper for Pendle Principal Tokens (PTs) that returns principal immediately and streams the discount
/// @dev Users deposit PT tokens pre-maturity and receive:
///      1. Immediate ovrfloTokens equal to PT's current market value (based on TWAP)
///      2. A Sablier stream that vests the remaining discount until PT maturity
///      After maturity, users can burn ovrfloTokens 1:1 to claim the underlying PT tokens.
contract OVRFLO {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Scale factor for 18-decimal precision math
    uint256 public constant WAD = 1e18;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev Caller is not the factory (the vault's sole admin).
    error NotAdmin();
    /// @dev A required constructor or admin-call address argument was the zero address.
    error ZeroAddress();
    /// @dev The stream constructor argument has no code.
    error NoCode();
    /// @dev `setSeriesApproved` was called for a market that already has a configured series.
    error SeriesAlreadyConfigured();
    /// @dev `setSeriesApproved` was called for a PT already mapped to a different market.
    error PtAlreadyMapped();
    /// @dev The supplied PT token has no market registered via `ptToMarket`.
    error UnknownPT();
    /// @dev There is no surplus above tracked balance to sweep.
    error NoExcess();
    /// @dev The supplied token amount is zero.
    error ZeroAmount();
    /// @dev The pulled token delivered less than the requested amount (fee-on-transfer behavior).
    error TransferMismatch();
    /// @dev `unwrap` requested more than the tracked wrap reserve holds.
    error InsufficientReserve();
    /// @dev The Pendle oracle lacks sufficient historical data for the series' fixed TWAP duration.
    error OracleNotReady();
    /// @dev A deposit's rate-split left nothing to stream (rounding produced a zero-duration stream).
    error NothingToStream();
    /// @dev `ptAmount` is below `MIN_PT_AMOUNT`.
    error BelowMinPT();
    /// @dev The series has reached or passed its maturity timestamp.
    error Matured();
    /// @dev The deposit would push a market's total above its configured deposit limit.
    error DepositLimitExceeded();
    /// @dev `toUser` fell below the caller's `minToUser` slippage floor.
    error SlippageExceeded();
    /// @dev `claim` was called before the series reached its maturity timestamp.
    error NotMatured();
    /// @dev `claim` requested more than the market's tracked total deposited.
    error InsufficientDeposited();
    /// @dev The market has no configured series (`ptToken == address(0)`).
    error MarketNotApproved();

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Minimum PT amount required for deposits
    uint256 public constant MIN_PT_AMOUNT = 1e6;

    /// @notice Treasury address that receives protocol fees
    address public immutable TREASURY_ADDR;

    /// @notice Underlying asset for wrap/unwrap and fee payment (constant per vault)
    address public immutable underlying;

    /// @notice ovrfloToken minted/burned by this vault (constant per vault)
    address public immutable ovrfloToken;

    /// @notice Pendle TWAP oracle for PT-to-SY rate lookups (constant per vault)
    address public immutable oracle;

    /// @notice Factory address with permission to configure markets (immutable, set at construction)
    address public immutable factory;

    /// @notice Underlying deposited through wrap and reserved for 1:1 unwraps
    uint256 public wrappedUnderlying;

    /// @notice OVRFLO Stream lockup used for deposit streams. Getter name stays `sablierLL`.
    ISablierV2LockupLinear public immutable sablierLL;

    /*//////////////////////////////////////////////////////////////
                                STRUCTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Configuration for an approved Pendle market series
    /// @param twapDurationFixed TWAP duration in seconds for oracle queries
    /// @param feeBps Fee in basis points charged on immediate minting
    /// @param expiryCached Cached PT maturity timestamp
    /// @param ptToken Address of the Pendle PT token (address(0) means unapproved/unconfigured)
    /// @dev ovrfloToken, underlying, and oracle are vault-level immutables, not stored per-series.
    struct SeriesInfo {
        uint32 twapDurationFixed;
        uint16 feeBps;
        uint256 expiryCached;
        address ptToken;
    }

    /*//////////////////////////////////////////////////////////////
                                MAPPINGS
    //////////////////////////////////////////////////////////////*/

    /// @notice Market address => Series configuration
    mapping(address => SeriesInfo) internal _series;

    /// @notice PT token address => Market address (reverse lookup)
    mapping(address => address) public ptToMarket;

    /// @notice Market address => Maximum total PT deposits allowed (0 = unlimited)
    mapping(address => uint256) public marketDepositLimits;

    /// @notice Market address => Current total PT deposited
    mapping(address => uint256) public marketTotalDeposited;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a user deposits PT tokens
    /// @param user The depositor's address
    /// @param market The Pendle market address
    /// @param ptAmount Total PT tokens deposited
    /// @param toUser Amount of ovrfloTokens minted immediately
    /// @param toStream Amount of ovrfloTokens sent to Sablier stream
    /// @param streamId The Sablier stream ID
    event Deposited(
        address indexed user,
        address indexed market,
        uint256 ptAmount,
        uint256 toUser,
        uint256 toStream,
        uint256 streamId
    );

    /// @notice Emitted when a fee is collected
    /// @param payer The address paying the fee
    /// @param token The token used for fee payment
    /// @param amount The fee amount
    event FeeTaken(address indexed payer, address indexed token, uint256 amount);

    /// @notice Emitted when a user claims PT tokens after maturity
    /// @param user The claimer's address
    /// @param market The Pendle market address
    /// @param ptToken The PT token address
    /// @param ovrfloToken The ovrflo token burned
    /// @param amount Amount redeemed; ovrflo burned equals PT delivered (1:1)
    event Claimed(
        address indexed user, address indexed market, address indexed ptToken, address ovrfloToken, uint256 amount
    );

    /// @notice Emitted when excess PT tokens are swept
    /// @param ptToken The PT token address
    /// @param to The recipient address
    /// @param amount The amount swept
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);

    /// @notice Emitted when a user wraps underlying into ovrfloToken
    /// @param user The wrapper's address
    /// @param amount Amount of underlying wrapped and ovrfloToken minted
    event Wrapped(address indexed user, uint256 amount);

    /// @notice Emitted when a user unwraps ovrfloToken back to underlying
    /// @param user The unwrapper's address
    /// @param amount Amount of ovrfloToken burned and underlying returned
    event Unwrapped(address indexed user, uint256 amount);

    /// @notice Emitted when excess underlying tokens are swept
    /// @param underlying The underlying token address
    /// @param to The recipient address
    /// @param amount The amount swept
    event ExcessUnderlyingSwept(address indexed underlying, address indexed to, uint256 amount);

    /// @notice Emitted when a new market series is approved
    /// @param market The Pendle market address
    /// @param ptToken The PT token address
    /// @param ovrfloToken The corresponding ovrflo token address
    /// @param underlying The underlying asset for fee payment
    /// @param oracle Oracle used for PT-to-SY rate lookups
    /// @param twapDuration TWAP duration in seconds for oracle queries
    /// @param expiry The PT maturity timestamp
    /// @param feeBps Fee in basis points
    event SeriesApproved(
        address indexed market,
        address indexed ptToken,
        address ovrfloToken,
        address underlying,
        address oracle,
        uint32 twapDuration,
        uint256 expiry,
        uint16 feeBps
    );

    /// @notice Emitted when a market deposit limit is updated
    /// @param market The Pendle market address
    /// @param limit The new deposit limit (0 = unlimited)
    event MarketDepositLimitSet(address indexed market, uint256 limit);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Restricts function access to the factory
    modifier onlyAdmin() {
        if (msg.sender != factory) revert NotAdmin();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Initializes the OVRFLO contract and constructs its ovrfloToken
    /// @dev The vault creates and permanently owns its token, so token ownership and
    ///      mint/burn wiring cannot be misconfigured by an external deployer. Name and
    ///      symbol are full ERC20 strings, reviewed by the multisig before registration.
    /// @param admin The factory address (immutable admin for the vault's lifetime)
    /// @param treasury The treasury address for fee collection
    /// @param _underlying The underlying asset address (constant per vault)
    /// @param name_ Full ERC20 name for the vault's ovrfloToken
    /// @param symbol_ Full ERC20 symbol for the vault's ovrfloToken
    /// @param _oracle Pendle TWAP oracle
    /// @param stream OVRFLO Stream lockup. Last argument. Getter stays `sablierLL()`.
    constructor(
        address admin,
        address treasury,
        address _underlying,
        string memory name_,
        string memory symbol_,
        address _oracle,
        address stream
    ) {
        if (admin == address(0)) revert ZeroAddress();
        if (treasury == address(0)) revert ZeroAddress();
        if (_underlying == address(0)) revert ZeroAddress();
        if (_oracle == address(0)) revert ZeroAddress();
        if (stream == address(0)) revert ZeroAddress();
        if (stream.code.length == 0) revert NoCode();

        factory = admin;
        TREASURY_ADDR = treasury;
        underlying = _underlying;
        ovrfloToken = address(new OVRFLOToken(name_, symbol_));
        oracle = _oracle;
        sablierLL = ISablierV2LockupLinear(stream);

        IERC20(ovrfloToken).approve(stream, type(uint256).max);
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Approves a new market series for deposits
    /// @param market The Pendle market address
    /// @param pt The PT token address
    /// @param twapDuration TWAP duration in seconds
    /// @param expiry PT maturity timestamp
    /// @param feeBps Fee in basis points
    function setSeriesApproved(address market, address pt, uint32 twapDuration, uint256 expiry, uint16 feeBps)
        external
        onlyAdmin
    {
        SeriesInfo storage info = _series[market];
        if (info.ptToken != address(0)) revert SeriesAlreadyConfigured();
        if (ptToMarket[pt] != address(0)) revert PtAlreadyMapped();

        info.twapDurationFixed = twapDuration;
        info.feeBps = feeBps;
        info.expiryCached = expiry;
        info.ptToken = pt;

        ptToMarket[pt] = market;

        emit SeriesApproved(market, pt, ovrfloToken, underlying, oracle, twapDuration, expiry, feeBps);
    }

    /// @notice Sets the deposit limit for a market
    /// @param market The market address
    /// @param limit The maximum total PT deposits (0 = unlimited)
    function setMarketDepositLimit(address market, uint256 limit) external onlyAdmin {
        marketDepositLimits[market] = limit;
        emit MarketDepositLimitSet(market, limit);
    }

    /// @notice Sweeps excess PT tokens accidentally sent to the contract
    /// @dev Only sweeps tokens above the tracked deposit amount. `to` is trusted because
    ///      the caller is always the factory (admin), which is itself owned by a timelocked
    ///      multisig; zero-address validation is intentionally omitted.
    /// @param ptToken The PT token address to sweep
    /// @param to The recipient address
    function sweepExcessPt(address ptToken, address to) external onlyAdmin {
        address market = ptToMarket[ptToken];
        if (market == address(0)) revert UnknownPT();
        uint256 balance = IERC20(ptToken).balanceOf(address(this));
        uint256 deposited = marketTotalDeposited[market];
        uint256 excess = balance > deposited ? balance - deposited : 0;

        if (excess == 0) revert NoExcess();
        IERC20(ptToken).safeTransfer(to, excess);
        emit ExcessSwept(ptToken, to, excess);
    }

    /// @notice Sweeps underlying accidentally sent above the wrap reserve
    /// @dev Underlying held for wrapped supply is reserved and cannot be swept. `to` is
    ///      trusted because the caller is always the factory (admin), which is itself owned
    ///      by a timelocked multisig; zero-address validation is intentionally omitted.
    /// @param to The recipient address
    function sweepExcessUnderlying(address to) external onlyAdmin {
        uint256 balance = IERC20(underlying).balanceOf(address(this));
        uint256 reserve = wrappedUnderlying;
        uint256 excess = balance > reserve ? balance - reserve : 0;

        if (excess == 0) revert NoExcess();
        IERC20(underlying).safeTransfer(to, excess);
        emit ExcessUnderlyingSwept(underlying, to, excess);
    }

    /*//////////////////////////////////////////////////////////////
                            USER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Wraps underlying 1:1 into ovrfloToken without fees or streams
    /// @param amount Amount of underlying to wrap
    function wrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        wrappedUnderlying += amount;

        uint256 balanceBefore = IERC20(underlying).balanceOf(address(this));
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(underlying).balanceOf(address(this));
        if (balanceAfter - balanceBefore != amount) revert TransferMismatch();

        OVRFLOToken(ovrfloToken).mint(msg.sender, amount);

        emit Wrapped(msg.sender, amount);
    }

    /// @notice Unwraps ovrfloToken 1:1 into underlying when the reserve is funded
    /// @param amount Amount of ovrfloToken to burn
    function unwrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 reserve = wrappedUnderlying;
        if (reserve < amount) revert InsufficientReserve();

        wrappedUnderlying = reserve - amount;
        OVRFLOToken(ovrfloToken).burn(msg.sender, amount);
        IERC20(underlying).safeTransfer(msg.sender, amount);

        emit Unwrapped(msg.sender, amount);
    }

    /// @dev Reverts if the TWAP oracle lacks sufficient historical data for the given duration.
    ///      Matches the freshness check performed at market onboarding in OVRFLOFactory.addMarket.
    function _requireOracleFresh(address market, uint32 twapDuration) internal view {
        (,, bool oldestObservationSatisfied) = IPendleOracle(oracle).getOracleState(market, twapDuration);
        if (!oldestObservationSatisfied) revert OracleNotReady();
    }

    /// @dev Splits a PT deposit into the immediate mint and the streamed remainder,
    ///      capping the immediate portion at face value (rate can exceed 1e18 briefly).
    function _computeSplit(uint256 ptAmount, uint256 rateE18) internal pure returns (uint256 toUser, uint256 toStream) {
        toUser = Math.mulDiv(ptAmount, rateE18, WAD);
        if (toUser > ptAmount) toUser = ptAmount;
        toStream = ptAmount - toUser;
        if (toStream == 0) revert NothingToStream();
    }

    /// @notice Deposits PT tokens to receive ovrfloTokens immediately and a stream for the discount
    /// @dev User must approve both PT token and underlying (for fee) before calling.
    ///      The rate determines the split: if PT is at 95% of face value, user gets 95% immediately
    ///      and 5% is streamed via Sablier until maturity.
    ///      Fee rate is ceiling-capped at FEE_MAX_BPS by the factory at setSeriesApproved time (KTD4).
    /// @param market The Pendle market address
    /// @param ptAmount Amount of PT tokens to deposit
    /// @param minToUser Minimum ovrfloTokens to receive immediately (slippage protection)
    /// @return toUser Amount of ovrfloTokens minted immediately to caller
    /// @return toStream Amount of ovrfloTokens streamed until maturity via Sablier
    /// @return streamId The Sablier stream ID for tracking
    function deposit(address market, uint256 ptAmount, uint256 minToUser)
        external
        returns (uint256 toUser, uint256 toStream, uint256 streamId)
    {
        SeriesInfo memory info;
        uint256 rateE18;
        (info, rateE18) = _approvedRate(market);
        if (ptAmount < MIN_PT_AMOUNT) revert BelowMinPT();
        if (block.timestamp >= info.expiryCached) revert Matured();

        {
            uint256 currentDeposited = marketTotalDeposited[market];
            uint256 limit = marketDepositLimits[market];

            if (limit > 0) {
                if (currentDeposited + ptAmount > limit) revert DepositLimitExceeded();
            }
            marketTotalDeposited[market] = currentDeposited + ptAmount;
        }

        IERC20(info.ptToken).safeTransferFrom(msg.sender, address(this), ptAmount);

        (toUser, toStream) = _computeSplit(ptAmount, rateE18);

        if (toUser < minToUser) revert SlippageExceeded();

        uint256 feeAmount = StreamPricing.fee(toUser, info.feeBps);

        if (feeAmount > 0) {
            IERC20(underlying).safeTransferFrom(msg.sender, TREASURY_ADDR, feeAmount);
            emit FeeTaken(msg.sender, underlying, feeAmount);
        }

        OVRFLOToken token = OVRFLOToken(ovrfloToken);
        token.mint(msg.sender, toUser);
        token.mint(address(this), toStream);

        uint256 duration = info.expiryCached - block.timestamp;
        ISablierV2LockupLinear.CreateWithDurations memory p = ISablierV2LockupLinear.CreateWithDurations({
            sender: address(this),
            recipient: msg.sender,
            // forge-lint: disable-next-line(unsafe-typecast) — Sablier requires uint128; safe with 18-decimal PT
            totalAmount: uint128(toStream),
            asset: IERC20(ovrfloToken),
            cancelable: false,
            transferable: true,
            // forge-lint: disable-next-line(unsafe-typecast) — Sablier requires uint40; duration <= expiry which fits
            durations: ISablierV2LockupLinear.Durations({cliff: 0, total: uint40(duration)}),
            broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
        });
        streamId = sablierLL.createWithDurations(p);

        emit Deposited(msg.sender, market, ptAmount, toUser, toStream, streamId);
    }

    /// @notice Burns ovrfloTokens to claim PT tokens after maturity
    /// @dev Only callable after market maturity. Redemption is 1:1 (1 ovrfloToken = 1 PT).
    ///      User must have sufficient ovrfloToken balance which gets burned.
    /// @param ptToken The PT token address to claim
    /// @param amount Amount of ovrfloTokens to burn (receives equal amount of PT)
    function claim(address ptToken, uint256 amount) external {
        address market = ptToMarket[ptToken];
        if (market == address(0)) revert UnknownPT();

        SeriesInfo storage info = _series[market];
        if (block.timestamp < info.expiryCached) revert NotMatured();
        if (amount == 0) revert ZeroAmount();

        uint256 currentDeposited = marketTotalDeposited[market];
        if (currentDeposited < amount) revert InsufficientDeposited();
        marketTotalDeposited[market] = currentDeposited - amount;

        OVRFLOToken(ovrfloToken).burn(msg.sender, amount);
        IERC20(ptToken).safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, market, ptToken, ovrfloToken, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Returns the full series configuration for a market
    /// @dev ovrfloToken (idx 4), underlying (idx 5), and oracle (idx 6) are synthesized
    ///      from vault immutables. A series is approved iff `ptToken != address(0)`.
    function series(address market)
        external
        view
        returns (
            uint32 twapDurationFixed,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address ovrfloToken_,
            address underlying_,
            address oracle_
        )
    {
        SeriesInfo memory s = _series[market];
        return (s.twapDurationFixed, s.feeBps, s.expiryCached, s.ptToken, ovrfloToken, underlying, oracle);
    }

    /// @notice Returns the claimable PT balance for a given PT token
    /// @param ptToken The PT token address
    /// @return The contract's PT token balance
    function claimablePt(address ptToken) external view returns (uint256) {
        if (ptToMarket[ptToken] == address(0)) revert UnknownPT();
        return IERC20(ptToken).balanceOf(address(this));
    }

    /// @notice Returns the current PT-to-SY TWAP rate for a market
    /// @param market The Pendle market address
    /// @return rateE18 The rate in 1e18 scale (e.g., 0.95e18 = PT at 95% of SY value)
    function previewRate(address market) external view returns (uint256 rateE18) {
        (, rateE18) = _approvedRate(market);
    }

    /// @notice Previews the immediate vs streamed split for a deposit
    /// @param market The Pendle market address
    /// @param ptAmount Amount of PT tokens to deposit
    /// @return toUser Amount that would be minted immediately
    /// @return toStream Amount that would be streamed
    /// @return rateE18 The TWAP rate used
    function previewStream(address market, uint256 ptAmount)
        external
        view
        returns (uint256 toUser, uint256 toStream, uint256 rateE18)
    {
        (, rateE18) = _approvedRate(market);
        (toUser, toStream) = _computeSplit(ptAmount, rateE18);
    }

    /// @notice Full deposit preview including fee calculation
    /// @param market The Pendle market address
    /// @param ptAmount Amount of PT tokens to deposit
    /// @return toUser Amount of ovrfloTokens minted immediately
    /// @return toStream Amount of ovrfloTokens streamed until maturity
    /// @return feeAmount Fee amount in underlying tokens user must pay
    /// @return rateE18 The PT-to-SY TWAP rate used (1e18 scale)
    function previewDeposit(address market, uint256 ptAmount)
        external
        view
        returns (uint256 toUser, uint256 toStream, uint256 feeAmount, uint256 rateE18)
    {
        SeriesInfo memory info;
        (info, rateE18) = _approvedRate(market);
        (toUser, toStream) = _computeSplit(ptAmount, rateE18);
        feeAmount = StreamPricing.fee(toUser, info.feeBps);
    }

    function _approvedRate(address market) internal view returns (SeriesInfo memory info, uint256 rateE18) {
        info = _series[market];
        if (info.ptToken == address(0)) revert MarketNotApproved();
        rateE18 = _freshRate(market, info.twapDurationFixed);
    }

    /// @dev Reads the PT-to-SY rate after verifying the oracle has enough history for the
    ///      market's fixed TWAP window. Used by `_approvedRate` (deposit/preview path).
    function _freshRate(address market, uint32 twapDurationFixed) internal view returns (uint256 rateE18) {
        _requireOracleFresh(market, twapDurationFixed);
        rateE18 = IPendleOracle(oracle).getPtToSyRate(market, twapDurationFixed);
    }
}
