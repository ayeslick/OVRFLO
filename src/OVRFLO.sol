// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PRBMath} from "prb-math/PRBMath.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

/// @title OVRFLO
/// @notice A wrapper for Pendle Principal Tokens (PTs) that returns principal immediately and streams the discount
/// @dev Users deposit PT tokens pre-maturity and receive:
///      1. Immediate ovrfloTokens equal to PT's current market value (based on TWAP)
///      2. A Sablier stream that vests the remaining discount until PT maturity
///      After maturity, users can burn ovrfloTokens 1:1 to claim the underlying PT tokens.
contract OVRFLO is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Basis points denominator for fee calculations (100% = 10_000)
    uint256 public constant BASIS_POINTS = 10_000;

    /// @notice Scale factor for 18-decimal precision math
    uint256 public constant WAD = 1e18;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Minimum PT amount required for deposits
    uint256 public immutable MIN_PT_AMOUNT = 1e6;

    /// @notice Treasury address that receives protocol fees
    address private immutable TREASURY_ADDR;

    /// @notice Admin contract address with permission to configure markets
    address public adminContract;

    /// @notice Pendle Oracle for PT-to-SY TWAP pricing
    IPendleOracle public immutable pendleOracle = IPendleOracle(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);

    /// @notice Sablier V2 Lockup Linear contract for streaming
    ISablierV2LockupLinear public immutable sablierLL = ISablierV2LockupLinear(0x3962f6585946823440d274aD7C719B02b49DE51E);

    /*//////////////////////////////////////////////////////////////
                                STRUCTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Configuration for an approved Pendle market series
    /// @param approved Whether this market is approved for deposits
    /// @param twapDurationFixed TWAP duration in seconds for oracle queries
    /// @param feeBps Fee in basis points charged on immediate minting
    /// @param expiryCached Cached PT maturity timestamp
    /// @param ptToken Address of the Pendle PT token
    /// @param ovrfloToken Address of the corresponding ovrflo token
    /// @param underlying Address of the underlying asset for fee payment
    struct SeriesInfo {
        bool approved;
        uint32 twapDurationFixed;
        uint16 feeBps;
        uint256 expiryCached;
        address ptToken;
        address ovrfloToken;
        address underlying;
    }

    /*//////////////////////////////////////////////////////////////
                                MAPPINGS
    //////////////////////////////////////////////////////////////*/

    /// @notice Market address => Series configuration
    mapping(address => SeriesInfo) public series;

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
    /// @param burnedAmount Amount of ovrfloTokens burned
    /// @param ptOut Amount of PT tokens received
    event Claimed(
        address indexed user,
        address indexed market,
        address indexed ptToken,
        address ovrfloToken,
        uint256 burnedAmount,
        uint256 ptOut
    );

    /// @notice Emitted when the admin contract is updated
    /// @param adminContract The new admin contract address
    event AdminContractUpdated(address indexed adminContract);

    /// @notice Emitted when excess PT tokens are swept
    /// @param ptToken The PT token address
    /// @param to The recipient address
    /// @param amount The amount swept
    event ExcessSwept(address indexed ptToken, address indexed to, uint256 amount);

    /// @notice Emitted when a new market series is approved
    /// @param market The Pendle market address
    /// @param ptToken The PT token address
    /// @param ovrfloToken The corresponding ovrflo token address
    /// @param underlying The underlying asset for fee payment
    /// @param expiry The PT maturity timestamp
    /// @param feeBps Fee in basis points
    event SeriesApproved(
        address indexed market,
        address ptToken,
        address ovrfloToken,
        address underlying,
        uint256 expiry,
        uint16 feeBps
    );

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Restricts function access to the admin contract
    modifier onlyAdmin() {
        require(msg.sender == adminContract, "OVRFLO: not admin");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Initializes the OVRFLO contract
    /// @param admin The admin contract address
    /// @param treasury The treasury address for fee collection
    constructor(address admin, address treasury) {
        require(admin != address(0), "OVRFLO: admin is zero address");
        require(treasury != address(0), "OVRFLO: treasury is zero address");

        adminContract = admin;
        TREASURY_ADDR = treasury;
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Updates the admin contract address
    /// @param newAdminContract The new admin contract address
    function setAdminContract(address newAdminContract) external onlyAdmin {
        require(newAdminContract != address(0), "OVRFLO: admin contract is zero address");
        adminContract = newAdminContract;
        emit AdminContractUpdated(newAdminContract);
    }

    /// @notice Approves a new market series for deposits
    /// @dev Also approves Sablier to spend ovrfloToken for stream creation
    /// @param market The Pendle market address
    /// @param pt The PT token address
    /// @param underlying The underlying asset address for fee payment
    /// @param ovrfloToken The ovrflo token address for this series
    /// @param twapDuration TWAP duration in seconds
    /// @param expiry PT maturity timestamp
    /// @param feeBps Fee in basis points
    function setSeriesApproved(
        address market,
        address pt,
        address underlying,
        address ovrfloToken,
        uint32 twapDuration,
        uint256 expiry,
        uint16 feeBps
    ) external onlyAdmin {
        SeriesInfo storage info = series[market];
        info.approved = true;
        info.twapDurationFixed = twapDuration;
        info.feeBps = feeBps;
        info.expiryCached = expiry;
        info.ptToken = pt;
        info.ovrfloToken = ovrfloToken;
        info.underlying = underlying;

        ptToMarket[pt] = market;

        IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max);

        emit SeriesApproved(market, pt, ovrfloToken, underlying, expiry, feeBps);
    }

    /// @notice Sets the deposit limit for a market
    /// @param market The market address
    /// @param limit The maximum total PT deposits (0 = unlimited)
    function setMarketDepositLimit(address market, uint256 limit) external onlyAdmin {
        marketDepositLimits[market] = limit;
    }

    /// @notice Sweeps excess PT tokens accidentally sent to the contract
    /// @dev Only sweeps tokens above the tracked deposit amount
    /// @param ptToken The PT token address to sweep
    /// @param to The recipient address
    function sweepExcessPt(address ptToken, address to) external onlyAdmin {
        uint256 balance = IERC20(ptToken).balanceOf(address(this));
        uint256 deposited = marketTotalDeposited[ptToMarket[ptToken]];
        uint256 excess = balance > deposited ? balance - deposited : 0;

        require(excess > 0, "OVRFLO: no excess");
        IERC20(ptToken).safeTransfer(to, excess);
        emit ExcessSwept(ptToken, to, excess);
    }

    /*//////////////////////////////////////////////////////////////
                            USER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposits PT tokens to receive ovrfloTokens immediately and a stream for the discount
    /// @dev User must approve both PT token and underlying (for fee) before calling.
    ///      The rate determines the split: if PT is at 95% of face value, user gets 95% immediately
    ///      and 5% is streamed via Sablier until maturity.
    /// @param market The Pendle market address
    /// @param ptAmount Amount of PT tokens to deposit
    /// @param minToUser Minimum ovrfloTokens to receive immediately (slippage protection)
    /// @return toUser Amount of ovrfloTokens minted immediately to caller
    /// @return toStream Amount of ovrfloTokens streamed until maturity via Sablier
    /// @return streamId The Sablier stream ID for tracking
    function deposit(address market, uint256 ptAmount, uint256 minToUser)
        external
        nonReentrant
        returns (uint256 toUser, uint256 toStream, uint256 streamId)
    {
        SeriesInfo memory info = series[market]; 
        require(info.approved, "OVRFLO: market not approved");
        require(ptAmount >= MIN_PT_AMOUNT, "OVRFLO: amount < min PT");
        require(block.timestamp < info.expiryCached, "OVRFLO: matured"); 

        {
            uint256 currentDeposited = marketTotalDeposited[market];
            uint256 limit = marketDepositLimits[market];
            
            if (limit > 0) {
                require(currentDeposited + ptAmount <= limit, "OVRFLO: deposit limit exceeded");
            }
            marketTotalDeposited[market] = currentDeposited + ptAmount;
        }

        IERC20(info.ptToken).safeTransferFrom(msg.sender, address(this), ptAmount);

        uint256 rateE18 = pendleOracle.getPtToSyRate(market, info.twapDurationFixed);

        toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD);
        if (toUser > ptAmount) toUser = ptAmount;
        toStream = ptAmount - toUser;

        require(toStream > 0, "OVRFLO: nothing to stream");
        require(toUser >= minToUser, "OVRFLO: slippage");

        uint256 feeAmount = info.feeBps == 0 ? 0 : PRBMath.mulDiv(toUser, info.feeBps, BASIS_POINTS);

        if (feeAmount > 0) {
            IERC20(info.underlying).safeTransferFrom(msg.sender, TREASURY_ADDR, feeAmount);
            emit FeeTaken(msg.sender, info.underlying, feeAmount);
        }

        OVRFLOToken ovrfloToken = OVRFLOToken(info.ovrfloToken);
        ovrfloToken.mint(msg.sender, toUser);
        ovrfloToken.mint(address(this), toStream);

        uint256 duration = info.expiryCached - block.timestamp;
        ISablierV2LockupLinear.CreateWithDurations memory p = ISablierV2LockupLinear.CreateWithDurations({
            sender: address(this),
            recipient: msg.sender,
            totalAmount: uint128(toStream),
            asset: IERC20(info.ovrfloToken),
            cancelable: false,
            transferable: true,
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
    function claim(address ptToken, uint256 amount) external nonReentrant {
        address market = ptToMarket[ptToken];
        require(market != address(0), "OVRFLO: unknown PT");

        SeriesInfo memory info = series[market];
        require(info.approved, "OVRFLO: market not approved");
        require(block.timestamp >= info.expiryCached, "OVRFLO: not matured");
        require(amount > 0, "OVRFLO: amount is zero");

        uint256 vaultBalance = IERC20(ptToken).balanceOf(address(this));
        require(amount <= vaultBalance, "OVRFLO: insufficient PT reserves");

        uint256 currentDeposited = marketTotalDeposited[market];
        require(currentDeposited >= amount, "OVRFLO: deposit accounting");
        marketTotalDeposited[market] = currentDeposited - amount;

        OVRFLOToken(info.ovrfloToken).burn(msg.sender, amount);
        IERC20(ptToken).safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, market, ptToken, info.ovrfloToken, amount, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Returns the claimable PT balance for a given PT token
    /// @param ptToken The PT token address
    /// @return The contract's PT token balance
    function claimablePt(address ptToken) external view returns (uint256) {
        require(ptToMarket[ptToken] != address(0), "OVRFLO: unknown PT");
        return IERC20(ptToken).balanceOf(address(this));
    }

    /// @notice Returns the current PT-to-SY TWAP rate for a market
    /// @param market The Pendle market address
    /// @return rateE18 The rate in 1e18 scale (e.g., 0.95e18 = PT at 95% of SY value)
    function previewRate(address market) external view returns (uint256 rateE18) {
        SeriesInfo memory info = series[market];
        require(info.approved, "OVRFLO: market not approved");
        rateE18 = pendleOracle.getPtToSyRate(market, info.twapDurationFixed);
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
        SeriesInfo memory info = series[market];
        require(info.approved, "OVRFLO: market not approved");
        rateE18 = pendleOracle.getPtToSyRate(market, info.twapDurationFixed);
        toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD);
        if (toUser > ptAmount) toUser = ptAmount;
        toStream = ptAmount - toUser;
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
        SeriesInfo memory info = series[market];
        require(info.approved, "OVRFLO: market not approved");
        rateE18 = pendleOracle.getPtToSyRate(market, info.twapDurationFixed);
        toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD);
        if (toUser > ptAmount) toUser = ptAmount;
        toStream = ptAmount - toUser;
        feeAmount = info.feeBps == 0 ? 0 : PRBMath.mulDiv(toUser, info.feeBps, BASIS_POINTS);
    }
}
