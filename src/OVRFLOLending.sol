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

/// @title OVRFLOLending
/// @notice Lending market for selling OVRFLO streams or lending against them.
/// @dev A per-vault lending market deployed against one OVRFLO core vault and one Sablier V2
///      Lockup Linear instance. It supports two primitives, all priced off
///      `StreamPricing` using a linear APR discount to the series maturity:
///        1. Liquidity positions / sale listings: sell a stream now for underlying.
///        2. Liquidity positions / borrower loan pools: pledge a stream as collateral for a loan,
///           settled in ovrfloToken (the stream's payout asset).
///      Liquidity positions (lender supplies liquidity, no stream bound) front-load market gating via
///      `_requireMarketActive`; listings (lender posts a specific stream) and all fills
///      run the full stream validation via `_requireEligible`. Fees are snapshotted per
///      listing at post time to protect sellers from retroactive fee changes; the global
///      `feeBps` applies to liquidity positions. All stateful functions are `nonReentrant`.
contract OVRFLOLending is Ownable2Step, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Launch APR (10%) used as the initial min and max APR bound.
    uint16 public constant LAUNCH_APR_BPS = 1000;
    /// @notice Step size for APR validation (100 bps = 1%). All APRs must be whole numbers.
    uint16 public constant APR_STEP_BPS = 100;
    /// @notice Hard ceiling on the maximum APR bound the owner may set (100%).
    uint16 public constant APR_MAX_CEILING = 10_000;
    /// @notice Hard ceiling on the protocol fee the owner may set (100%).
    uint16 public constant MAX_FEE_BPS = 10_000;

    /*//////////////////////////////////////////////////////////////
                                IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice OVRFLOFactory registry; source of vault info and market approval.
    IOVRFLOFactoryRegistry public immutable factory;
    /// @notice The OVRFLO core vault this lending market serves.
    address public immutable core;
    /// @notice The ovrfloToken of the served vault (loan repayment / stream asset).
    address public immutable ovrfloToken;
    /// @notice The underlying ERC20 used for sale proceeds and loan disbursements.
    address public immutable underlying;
    /// @notice Sablier V2 Lockup Linear instance streams are pledged to.
    ISablierV2LockupLinear public immutable sablier;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Current minimum APR (bps) accepted on any post; owner-governed.
    uint16 public aprMinBps;
    /// @notice Current maximum APR (bps) accepted on any post; owner-governed.
    uint16 public aprMaxBps;
    /// @notice Protocol fee (bps) applied to liquidity fills and quote; owner-governed.
    uint16 public feeBps;
    /// @notice Recipient of protocol fees; defaults to the vault's treasury.
    address public treasury;

    /// @notice Next liquidity id (monotonic from 1).
    uint256 public nextLiquidityId = 1;
    /// @notice Next sale-listing id (monotonic from 1).
    uint256 public nextSaleListingId = 1;
    /// @notice Next loan id (monotonic from 1); also serves as the loan-pool id.
    uint256 public nextLoanId = 1;

    /// @notice Standing liquidity: liquidity in underlying waiting to buy or lend against
    ///         any eligible stream from `market` at `aprBps`. The liquidity is consumable as
    ///         either a sale (permanent stream transfer via `sellStreamToLiquidity`) or a loan
    ///         (stream pledged with obligation via `createBorrowerLoanPool`); the lender cannot
    ///         restrict liquidity to one path.
    /// @param lender LiquidityPosition owner who funded the availableLiquidity.
    /// @param market Pendle market streams must belong to.
    /// @param aprBps Discount/accrual rate used to price any stream sold into or borrowed
    ///        against this liquidity.
    /// @param availableLiquidity Remaining underlying available (decremented on fill).
    struct LiquidityPosition {
        address lender;
        address market;
        uint16 aprBps;
        uint128 availableLiquidity;
    }

    /// @notice Sell-side listing: a specific stream listed for sale at `aprBps`.
    /// @param seller Listing owner.
    /// @param market Pendle market the stream belongs to.
    /// @param streamId The Sablier stream being sold.
    /// @param aprBps Discount rate determining the ask price.
    /// @param feeBps Protocol fee snapshotted at post time (lender-protective).
    /// @param active False once cancelled or taken.
    struct SaleListing {
        address seller;
        address market;
        uint256 streamId;
        uint16 aprBps;
        uint16 feeBps;
        bool active;
    }

    /// @notice A loan backed by a pledged Sablier stream.
    /// @dev Satisfied amount = `drawn + repaid`; outstanding = `obligation - satisfied`.
    ///      The lender (always `address(this)`) recovers by drawing ovrfloToken from the
    ///      stream via `closeLoan`, or by the borrower repaying in ovrfloToken (`repayLoan`).
    ///      Total recovery is capped at `obligation`; the stream is returned to the
    ///      borrower once the loan closes.
    /// @param borrower Stream owner who received the loan principal.
    /// @param streamId The pledged Sablier stream, held in escrow by the lending market.
    /// @param obligation Total ovrfloToken owed at maturity (ceiling-rounded).
    /// @param drawn ovrfloToken the lender has withdrawn from the stream so far.
    /// @param repaid ovrfloToken the borrower has repaid directly so far.
    /// @param closed True once satisfied == obligation (stream returned).
    struct Loan {
        address borrower;
        uint256 streamId;
        uint128 obligation;
        uint128 drawn;
        uint128 repaid;
        bool closed;
    }

    /// @notice A loan pool aggregates multiple liquidity positions into one atomic batch.
    /// @dev Borrower loan pools batch across liquidity positions via `createBorrowerLoanPool`. Claims are
    ///      address-based (no NFTs) via loanPoolContributions and loanPoolReceived. The pool's
    ///      total obligation is `loans[id].obligation` (single-id space: `loanId == loanPoolId`).
    /// @param borrower Loan-pool borrower.
    /// @param aprBps Shared rate across all consumed liquidity positions.
    /// @param market Pendle market all liquidity positions belong to.
    /// @param totalContributed Total capital contributed (borrowed).
    struct LoanPool {
        address borrower;
        uint16 aprBps;
        address market;
        uint128 totalContributed;
    }

    /// @notice Liquidity position id => liquidity position.
    mapping(uint256 => LiquidityPosition) public liquidityPositions;
    /// @notice Sale listing id => listing.
    mapping(uint256 => SaleListing) public saleListings;
    /// @notice Loan id => loan.
    mapping(uint256 => Loan) public loans;
    /// @notice Loan-pool id => loan pool.
    mapping(uint256 => LoanPool) public loanPools;
    /// @notice Loan-pool id => lender => contributed amount.
    mapping(uint256 => mapping(address => uint128)) public loanPoolContributions;
    /// @notice Loan-pool id => accumulated ovrfloToken from closeLoan/repayLoan.
    mapping(uint256 => uint128) public loanPoolProceeds;
    /// @notice Loan-pool id => lender => total received across both claim channels.
    mapping(uint256 => mapping(address => uint128)) public loanPoolReceived;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when the owner changes the APR bounds.
    event LendingAprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    /// @notice Emitted when the owner changes the protocol fee.
    event LendingFeeSet(uint16 feeBps);
    /// @notice Emitted when the owner changes the fee treasury.
    event LendingTreasurySet(address indexed treasury);
    /// @notice Emitted when liquidity is supplied.
    event LiquiditySupplied(
        uint256 indexed liquidityId,
        address indexed lender,
        address indexed market,
        uint16 aprBps,
        uint128 availableLiquidity
    );
    /// @notice Emitted when liquidity is withdrawn and its remaining amount refunded.
    event LiquidityWithdrawn(uint256 indexed liquidityId, address indexed lender, uint128 refunded);
    /// @notice Emitted when a seller sells a stream into liquidity.
    event StreamSoldToLiquidity(
        uint256 indexed liquidityId,
        uint256 indexed streamId,
        address indexed seller,
        address buyer,
        uint256 grossPrice,
        uint256 fee,
        uint256 netToSeller
    );
    /// @notice Emitted when a stream is listed for sale.
    event StreamSaleListingPosted(
        uint256 indexed listingId,
        address indexed seller,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps
    );
    /// @notice Emitted when a sale listing is cancelled and the stream returned.
    event StreamSaleListingCancelled(uint256 indexed listingId, address indexed seller, uint256 streamId);
    /// @notice Emitted when a buyer takes a sale listing, paying the seller and receiving the stream.
    event StreamSaleListingTaken(
        uint256 indexed listingId,
        uint256 indexed streamId,
        address indexed buyer,
        address seller,
        uint256 grossPrice,
        uint256 fee,
        uint256 netToSeller
    );
    /// @notice Emitted when a loan is closed by drawing the remainder and returning the stream.
    event LoanClosed(uint256 indexed loanId, address indexed borrower, uint128 finalDraw);
    /// @notice Emitted when a borrower repays ovrfloToken toward a loan (and whether it closed).
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint128 amount, bool closed);
    /// @notice Emitted when a borrower loan pool is created.
    event BorrowerLoanPoolCreated(
        uint256 indexed loanId, address indexed borrower, address market, uint16 aprBps, uint128 totalContributed
    );
    /// @notice Emitted when a lender claims ovrfloToken from loan-pool proceeds.
    event LoanPoolShareClaimed(uint256 indexed loanId, address indexed lender, uint128 amount);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploys an OVRFLOLending bound to one vault, Sablier instance, and fee config.
    /// @dev Pulls `treasury`, `underlying`, and `ovrfloToken` from the factory so they
    ///      stay consistent with the served vault. APR bounds initialize to the launch APR.
    /// @param factory_ The OVRFLOFactory registry address.
    /// @param core_ The OVRFLO core vault this lending market serves.
    /// @param sablier_ The Sablier V2 Lockup Linear address.
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

    /// @notice Sets the accepted APR range for new posts.
    /// @dev Does not affect existing liquidity positions or listings. Enforced per-post via `_validateApr`.
    ///      Both bounds must be multiples of `APR_STEP_BPS`.
    /// @param aprMinBps_ New minimum APR in basis points.
    /// @param aprMaxBps_ New maximum APR in basis points.
    function setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        require(aprMaxBps_ >= aprMinBps_, "OVRFLOLending: bad apr bounds");
        require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOLending: apr too high");
        require(aprMinBps_ % APR_STEP_BPS == 0, "OVRFLOLending: aprMin not step-aligned");
        require(aprMaxBps_ % APR_STEP_BPS == 0, "OVRFLOLending: aprMax not step-aligned");

        aprMinBps = aprMinBps_;
        aprMaxBps = aprMaxBps_;

        emit LendingAprBoundsSet(aprMinBps_, aprMaxBps_);
    }

    /// @notice Sets the protocol fee applied to liquidity fills and `quote`.
    /// @dev Does not affect listings, which snapshot `feeBps` at post time.
    /// @param feeBps_ New fee in basis points.
    function setFee(uint16 feeBps_) external onlyOwner {
        require(feeBps_ <= MAX_FEE_BPS, "OVRFLOLending: fee too high");

        feeBps = feeBps_;

        emit LendingFeeSet(feeBps_);
    }

    /// @notice Sets the recipient of protocol fees.
    /// @param treasury_ New treasury address (must not be zero).
    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "OVRFLOLending: treasury zero");

        treasury = treasury_;

        emit LendingTreasurySet(treasury_);
    }

    /*//////////////////////////////////////////////////////////////
                          LIQUIDITY POSITIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Supplies standing liquidity to buy or lend against
    ///         any eligible stream from `market` at rate `aprBps`.
    /// @dev Pulls `availableLiquidity` underlying from the lender upfront. The market is gated
    ///      with `_requireMarketActive` (no stream is bound yet); full stream
    ///      eligibility is checked per-fill in `sellStreamToLiquidity` and `createBorrowerLoanPool`.
    ///      The liquidity is consumable as either a sale or a loan; the lender cannot
    ///      restrict liquidity to one path.
    /// @param market Pendle market streams must belong to.
    /// @param aprBps Discount/accrual rate used to price streams.
    /// @param availableLiquidity Underlying liquidity to fund.
    /// @return liquidityId The new liquidity id.
    function supplyLiquidity(address market, uint16 aprBps, uint128 availableLiquidity)
        external
        nonReentrant
        returns (uint256 liquidityId)
    {
        _validateApr(aprBps);
        _requireMarketActive(market);
        require(availableLiquidity > 0, "OVRFLOLending: availableLiquidity zero");

        liquidityId = nextLiquidityId++;
        liquidityPositions[liquidityId] = LiquidityPosition({
            lender: msg.sender, market: market, aprBps: aprBps, availableLiquidity: availableLiquidity
        });

        _pullExact(IERC20(underlying), msg.sender, address(this), availableLiquidity);

        emit LiquiditySupplied(liquidityId, msg.sender, market, aprBps, availableLiquidity);
    }

    /// @notice Withdraws liquidity and refunds its remaining available amount.
    /// @param liquidityId The liquidity position to withdraw.
    function withdrawLiquidity(uint256 liquidityId) external nonReentrant {
        LiquidityPosition storage liquidity = liquidityPositions[liquidityId];
        require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
        require(liquidity.lender == msg.sender, "OVRFLOLending: not lender");

        uint128 refund = liquidity.availableLiquidity;
        liquidity.availableLiquidity = 0;

        _payUnderlying(msg.sender, refund);

        emit LiquidityWithdrawn(liquidityId, msg.sender, refund);
    }

    /// @notice Sells a stream into standing liquidity.
    /// @dev Prices `streamId` at the liquidity's `aprBps`, charges the global `feeBps`,
    ///      transfers the stream to the liquidity lender, and pays the seller (net of fee).
    ///      Reverts if the price exceeds remaining availableLiquidity or slips below `minNetOut`.
    /// @param liquidityId The liquidity to sell into.
    /// @param streamId The Sablier stream being sold.
    /// @param minNetOut Minimum underlying the seller must receive (slippage).
    function sellStreamToLiquidity(uint256 liquidityId, uint256 streamId, uint256 minNetOut) external nonReentrant {
        LiquidityPosition storage liquidity = liquidityPositions[liquidityId];
        require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");

        (, uint256 grossPrice,) = _priceStream(liquidity.market, streamId, liquidity.aprBps);
        require(grossPrice <= liquidity.availableLiquidity, "OVRFLOLending: insufficient availableLiquidity");

        uint256 feeAmount = StreamPricing.fee(grossPrice, feeBps);
        uint256 netToSeller = grossPrice - feeAmount;
        require(netToSeller >= minNetOut, "OVRFLOLending: slippage");

        liquidity.availableLiquidity -= _toUint128(grossPrice);

        sablier.transferFrom(msg.sender, liquidity.lender, streamId);
        _payUnderlying(msg.sender, netToSeller);
        _payUnderlying(treasury, feeAmount);

        emit StreamSoldToLiquidity(
            liquidityId, streamId, msg.sender, liquidity.lender, grossPrice, feeAmount, netToSeller
        );
    }

    /*//////////////////////////////////////////////////////////////
                              SALE LISTINGS
    //////////////////////////////////////////////////////////////*/

    /// @notice Lists a specific stream for sale at discount rate `aprBps`.
    /// @dev Escrows the stream (transferred to the lending market) and snapshots the current
    ///      `feeBps` so the seller is protected from later fee changes. Full stream
    ///      eligibility is validated now via `_requireEligible`.
    /// @param market Pendle market the stream belongs to.
    /// @param streamId The Sablier stream to sell.
    /// @param aprBps Discount rate determining the ask price.
    /// @return listingId The new sale listing id.
    function postSaleListing(address market, uint256 streamId, uint16 aprBps)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        _validateApr(aprBps);
        _requireEligible(market, streamId);

        listingId = nextSaleListingId++;
        saleListings[listingId] = SaleListing({
            seller: msg.sender, market: market, streamId: streamId, aprBps: aprBps, feeBps: feeBps, active: true
        });

        sablier.transferFrom(msg.sender, address(this), streamId);

        emit StreamSaleListingPosted(listingId, msg.sender, market, streamId, aprBps, feeBps);
    }

    /// @notice Cancels a sale listing and returns the escrowed stream to the seller.
    /// @param listingId The listing to cancel.
    function cancelSaleListing(uint256 listingId) external nonReentrant {
        SaleListing storage listing = saleListings[listingId];
        require(listing.active, "OVRFLOLending: listing inactive");
        require(listing.seller == msg.sender, "OVRFLOLending: not listing seller");

        listing.active = false;
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit StreamSaleListingCancelled(listingId, msg.sender, listing.streamId);
    }

    /// @notice Buys a sale listing.
    /// @dev Re-prices the stream at fill time (remaining may have changed since post),
    ///      charges the listing's snapshotted `feeBps`, pays the seller net, and
    ///      transfers the stream to the buyer. Reverts if the price exceeds `maxPriceIn`.
    /// @param listingId The listing to buy.
    /// @param maxPriceIn Maximum underlying the buyer will pay (slippage).
    function buyListing(uint256 listingId, uint256 maxPriceIn) external nonReentrant {
        SaleListing storage listing = saleListings[listingId];
        require(listing.active, "OVRFLOLending: listing inactive");

        (, uint256 grossPrice,) = _priceStream(listing.market, listing.streamId, listing.aprBps);
        require(grossPrice <= maxPriceIn, "OVRFLOLending: slippage");

        uint256 feeAmount = StreamPricing.fee(grossPrice, listing.feeBps);
        uint256 netToSeller = grossPrice - feeAmount;

        listing.active = false;

        _pullExact(IERC20(underlying), msg.sender, address(this), grossPrice);
        _payUnderlying(listing.seller, netToSeller);
        _payUnderlying(treasury, feeAmount);
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit StreamSaleListingTaken(
            listingId, listing.streamId, msg.sender, listing.seller, grossPrice, feeAmount, netToSeller
        );
    }

    /*//////////////////////////////////////////////////////////////
                              LOAN SERVICING
    //////////////////////////////////////////////////////////////*/

    /// @notice Closes a loan by drawing the remaining outstanding and returning the stream.
    /// @dev Permissionless. Requires the stream to have accrued at least `outstanding`
    ///      (so the lender can be made whole from the stream directly). Draws the exact
    ///      outstanding, marks the loan closed, and transfers the stream back to the
    ///      borrower. Also used to reclaim an empty stream once outstanding reaches 0.
    /// @param loanId The loan to close.
    function closeLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        require(!loan.closed, "OVRFLOLending: loan closed");

        uint128 outstanding = _outstanding(loan);
        uint256 streamId = loan.streamId;
        uint128 withdrawable = sablier.withdrawableAmountOf(streamId);
        require(withdrawable >= outstanding, "OVRFLOLending: loan not closable");

        loan.closed = true;
        if (outstanding > 0) {
            loan.drawn += outstanding;
            sablier.withdraw(streamId, address(this), outstanding);
            loanPoolProceeds[loanId] += outstanding;
        }
        sablier.transferFrom(address(this), loan.borrower, streamId);

        emit LoanClosed(loanId, loan.borrower, outstanding);
    }

    /// @notice Borrower repays ovrfloToken toward a loan to reduce or clear the obligation.
    /// @dev Repayment is in ovrfloToken (the stream's payout asset), credited to
    ///      `loanPoolProceeds`. `amount` is capped at outstanding; when it equals outstanding
    ///      the loan closes and the stream is returned to the borrower. The equality is
    ///      safe from rounding bricks because `outstanding` is always an exact integer wei
    ///      and ovrfloToken has 18-decimal granularity (see
    ///      `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md`).
    /// @param loanId The loan to repay.
    /// @param amount ovrfloToken to repay (must be <= outstanding).
    function repayLoan(uint256 loanId, uint128 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        require(!loan.closed, "OVRFLOLending: loan closed");
        require(loan.borrower == msg.sender, "OVRFLOLending: not borrower");

        uint128 outstanding = _outstanding(loan);
        require(outstanding > 0, "OVRFLOLending: nothing outstanding");
        require(amount > 0, "OVRFLOLending: repay zero");
        require(amount <= outstanding, "OVRFLOLending: repay too much");

        loan.repaid += amount;
        bool closes = amount == outstanding;
        if (closes) {
            loan.closed = true;
        }

        _pullExact(IERC20(ovrfloToken), msg.sender, address(this), amount);
        loanPoolProceeds[loanId] += amount;
        if (closes) {
            sablier.transferFrom(address(this), loan.borrower, loan.streamId);
        }

        emit LoanRepaid(loanId, msg.sender, amount, closes);
    }

    /*//////////////////////////////////////////////////////////////
                              LOAN POOLS
    //////////////////////////////////////////////////////////////*/

    /// @notice Creates a borrower loan pool from multiple liquidity positions.
    /// @dev The borrower pledges `streamId` and borrows from multiple liquidity positions in a
    ///      single atomic transaction. The loan and pool share a single id space (`loanId == loanPoolId`);
    ///      the lending market is the virtual lender on the loan. Each lender's consumed liquidity is
    ///      recorded for pro-rata claims. All liquidity positions must share the same `market` and
    ///      `aprBps`. Self-match (borrower is a lender) is prevented. CEI: all
    ///      validation before any state mutation.
    /// @param liquidityIds Liquidity position IDs to consume (must all match same market/aprBps).
    /// @param streamId The Sablier stream to pledge as collateral.
    /// @param targetBorrow Desired principal; actual may be less if availableLiquidity is insufficient.
    /// @param minAcceptable Minimum net proceeds the borrower will accept (after fees).
    /// @return loanId The new loan (and pool) id.
    function createBorrowerLoanPool(
        uint256[] memory liquidityIds,
        uint256 streamId,
        uint128 targetBorrow,
        uint128 minAcceptable
    ) external nonReentrant returns (uint256 loanId) {
        require(targetBorrow > 0, "OVRFLOLending: borrow zero");
        require(liquidityIds.length > 0, "OVRFLOLending: empty liquidity");

        address market;
        uint16 aprBps;
        {
            LiquidityPosition memory firstLiquidity = liquidityPositions[liquidityIds[0]];
            require(firstLiquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
            market = firstLiquidity.market;
            aprBps = firstLiquidity.aprBps;
        }

        uint128 obligation;
        uint128 actualBorrow128;
        uint256 netToBorrower;
        uint256 feeAmount;
        {
            uint256 totalAvailable = _validateLiquidity(liquidityIds, market, aprBps, msg.sender);
            (StreamPricing.Eligibility memory eligibility, uint256 grossPrice, uint256 timeToMaturity) =
                _priceStream(market, streamId, aprBps);
            uint256 actualBorrow = targetBorrow < totalAvailable ? uint256(targetBorrow) : totalAvailable;
            require(actualBorrow <= grossPrice, "OVRFLOLending: borrow above price");

            obligation = StreamPricing.obligationForFill(
                actualBorrow, grossPrice, eligibility.remaining, aprBps, timeToMaturity
            );
            feeAmount = StreamPricing.fee(actualBorrow, feeBps);
            netToBorrower = actualBorrow - feeAmount;
            require(netToBorrower >= minAcceptable, "OVRFLOLending: slippage");
            actualBorrow128 = _toUint128(actualBorrow);
        }

        loanId = _storeLoan(msg.sender, streamId, obligation);
        loanPools[loanId] =
            LoanPool({borrower: msg.sender, aprBps: aprBps, market: market, totalContributed: actualBorrow128});

        _consumeLiquidity(liquidityIds, loanId, actualBorrow128);

        sablier.transferFrom(msg.sender, address(this), streamId);
        _payUnderlying(msg.sender, netToBorrower);
        _payUnderlying(treasury, feeAmount);

        emit BorrowerLoanPoolCreated(loanId, msg.sender, market, aprBps, actualBorrow128);
    }

    /// @notice Lets a loan-pool lender claim ovrfloToken from accumulated proceeds.
    /// @dev Proceeds accumulate from `closeLoan` and `repayLoan` on loan-pool loans, and
    ///      from stream harvests during claims. Claimable is capped at
    ///      `contribution * recovered / totalContributed - loanPoolReceived`, where
    ///      `recovered = drawn + repaid + min(withdrawable, outstanding)` for open
    ///      loans and `recovered = drawn + repaid` for closed loans. When the loan
    ///      is open and `loanPoolProceeds` is insufficient, harvests the deficit from
    ///      the stream. Works whether the loan is open or closed.
    /// @param loanId The loan pool to claim from.
    /// @param amount Requested claim amount (capped at claimable).
    function claimLoanPoolShare(uint256 loanId, uint128 amount) external nonReentrant {
        require(amount > 0, "OVRFLOLending: claim zero");
        uint128 payAmount = _claimFair(loanId, msg.sender, amount);
        emit LoanPoolShareClaimed(loanId, msg.sender, payAmount);
    }

    /// @dev Claim logic for `claimLoanPoolShare`. Computes claimable as
    ///      `contribution * recovered / totalContributed - loanPoolReceived`, where
    ///      `recovered = drawn + repaid + min(withdrawable, outstanding)` for open
    ///      loans (including the stream's not-yet-drawn accrual), and `recovered =
    ///      drawn + repaid` for closed loans (outstanding == 0, stream returned).
    ///      Harvests only the deficit from the stream when `loanPoolProceeds` is
    ///      insufficient and the loan is open, then pays from `loanPoolProceeds`.
    function _claimFair(uint256 loanId, address account, uint128 amount) internal returns (uint128 payAmount) {
        uint128 contribution = loanPoolContributions[loanId][account];
        require(contribution > 0, "OVRFLOLending: not loan pool lender");

        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);

        uint256 recovered = uint256(loan.drawn) + uint256(loan.repaid);
        uint128 withdrawable;
        uint128 outstanding;
        if (!loan.closed) {
            outstanding = _outstanding(loan);
            withdrawable = sablier.withdrawableAmountOf(loan.streamId);
            recovered += uint256(_minUint128(withdrawable, outstanding));
        }

        uint256 claimable = uint256(contribution) * recovered / uint256(loanPools[loanId].totalContributed)
            - loanPoolReceived[loanId][account];

        uint128 requestAmount = _minUint128(amount, _toUint128(claimable));

        uint128 proceeds = loanPoolProceeds[loanId];
        if (!loan.closed && proceeds < requestAmount) {
            uint128 harvestAmount = _minUint128(
                _toUint128(uint256(requestAmount) - uint256(proceeds)), _minUint128(withdrawable, outstanding)
            );
            if (harvestAmount > 0) {
                sablier.withdraw(loan.streamId, address(this), harvestAmount);
                loan.drawn += harvestAmount;
                proceeds += harvestAmount;
            }
        }

        payAmount = _minUint128(requestAmount, proceeds);
        require(payAmount > 0, "OVRFLOLending: nothing claimable");

        loanPoolReceived[loanId][account] += payAmount;
        loanPoolProceeds[loanId] = proceeds - payAmount;
        IERC20(ovrfloToken).safeTransfer(account, payAmount);
    }

    /*//////////////////////////////////////////////////////////////
                              VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Quotes a fill for a stream at a given APR.
    /// @dev Pass `borrowAmount == 0` to quote the full-borrow case (borrows the entire
    ///      discounted price). Reverts if the requested borrow exceeds the price.
    /// @param market Pendle market the stream belongs to.
    /// @param streamId The Sablier stream to price.
    /// @param aprBps Discount/accrual rate.
    /// @param borrowAmount Principal to quote (0 = full borrow).
    /// @return grossPrice Discounted price of the full stream.
    /// @return obligation Amount owed at maturity for `borrowAmount`.
    /// @return feeAmount Protocol fee on `borrowAmount`.
    /// @return netToBorrower `borrowAmount` minus the fee.
    /// @return residual Remaining face value left in the stream after the obligation.
    function quote(address market, uint256 streamId, uint16 aprBps, uint128 borrowAmount)
        external
        view
        returns (uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual)
    {
        _validateApr(aprBps);
        StreamPricing.Eligibility memory eligibility;
        uint256 timeToMaturity;
        (eligibility, grossPrice, timeToMaturity) = _priceStream(market, streamId, aprBps);
        uint256 effectiveBorrowAmount = borrowAmount == 0 ? grossPrice : borrowAmount;
        require(effectiveBorrowAmount <= grossPrice, "OVRFLOLending: borrow above price");

        obligation = StreamPricing.obligationForFill(
            effectiveBorrowAmount, grossPrice, eligibility.remaining, aprBps, timeToMaturity
        );
        feeAmount = StreamPricing.fee(effectiveBorrowAmount, feeBps);
        netToBorrower = effectiveBorrowAmount - feeAmount;
        residual = eligibility.remaining - obligation;
    }

    /*//////////////////////////////////////////////////////////////
                          GATHER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Scans liquidity positions for matching available liquidity.
    /// @dev Gated by `marketActive` (reverts on expired series). Returns IDs of active
    ///      liquidity positions matching `market` and `aprBps` with remaining liquidity,
    ///      excluding positions owned by `borrower` (self-match guard in
    ///      `createBorrowerLoanPool`). Stops once accumulated liquidity meets `targetAmount`.
    ///      Use `startId` to paginate if the scan is large and `sufficient` is false.
    ///      Pass `address(0)` as `borrower` to disable exclusion.
    /// @param market Pendle market to match.
    /// @param aprBps Rate to match.
    /// @param targetAmount Minimum total liquidity desired.
    /// @param startId First liquidity ID to scan (inclusive).
    /// @param borrower Address to exclude (pass msg.sender for on-chain calls).
    /// @return ids Matching liquidity IDs.
    /// @return sufficient True if accumulated liquidity >= `targetAmount`.
    function gatherLiquidity(address market, uint16 aprBps, uint128 targetAmount, uint256 startId, address borrower)
        external
        view
        returns (uint256[] memory ids, bool sufficient)
    {
        _requireMarketActive(market);
        if (startId >= nextLiquidityId) {
            return (new uint256[](0), false);
        }

        uint256 maxCount = nextLiquidityId - startId;
        ids = new uint256[](maxCount);

        uint256 count;
        uint256 gathered;
        for (uint256 i = startId; i < nextLiquidityId; i++) {
            LiquidityPosition storage liquidity = liquidityPositions[i];
            if (
                liquidity.availableLiquidity > 0 && liquidity.market == market && liquidity.aprBps == aprBps
                    && liquidity.lender != borrower
            ) {
                ids[count++] = i;
                gathered += liquidity.availableLiquidity;
                if (gathered >= targetAmount) break;
            }
        }

        sufficient = gathered >= targetAmount;

        uint256[] memory result = new uint256[](count);
        for (uint256 i; i < count; i++) {
            result[i] = ids[i];
        }
        ids = result;
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Validates all liquidity positions in a borrower loan pool: available, same market,
    ///      same aprBps, and no self-match. Returns total available liquidity.
    function _validateLiquidity(uint256[] memory liquidityIds, address market, uint16 aprBps, address borrower)
        internal
        view
        returns (uint256 totalAvailable)
    {
        for (uint256 i; i < liquidityIds.length; i++) {
            if (i > 0) require(liquidityIds[i] > liquidityIds[i - 1], "OVRFLOLending: duplicate or unsorted ids");
            LiquidityPosition storage liquidity = liquidityPositions[liquidityIds[i]];
            require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
            require(liquidity.market == market, "OVRFLOLending: market mismatch");
            require(liquidity.aprBps == aprBps, "OVRFLOLending: apr mismatch");
            require(liquidity.lender != borrower, "OVRFLOLending: self-match");
            totalAvailable += liquidity.availableLiquidity;
        }
    }

    /// @dev Consumes liquidity positions up to `actualBorrow`, recording per-lender contributions.
    function _consumeLiquidity(uint256[] memory liquidityIds, uint256 loanId, uint256 actualBorrow) internal {
        uint256 toBorrow = actualBorrow;
        for (uint256 i; i < liquidityIds.length; i++) {
            if (toBorrow == 0) break;
            LiquidityPosition storage liquidity = liquidityPositions[liquidityIds[i]];
            uint256 consumed = toBorrow < liquidity.availableLiquidity ? toBorrow : liquidity.availableLiquidity;
            liquidity.availableLiquidity -= _toUint128(consumed);
            loanPoolContributions[loanId][liquidity.lender] += _toUint128(consumed);
            toBorrow -= consumed;
        }
    }

    /// @dev Reverts if `aprBps` is outside the current `[aprMinBps, aprMaxBps]` bounds.
    function _validateApr(uint16 aprBps) internal view {
        require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOLending: apr out of bounds");
        require(aprBps % APR_STEP_BPS == 0, "OVRFLOLending: apr not whole");
    }

    /// @dev Stream-level eligibility gate; delegates to `StreamPricing.requireEligible`.
    function _requireEligible(address market, uint256 streamId)
        internal
        view
        returns (StreamPricing.Eligibility memory)
    {
        return StreamPricing.requireEligible(address(factory), address(sablier), core, market, streamId);
    }

    /// @dev Market-level gate (no stream required); delegates to `StreamPricing.marketActive`.
    function _requireMarketActive(address market) internal view {
        StreamPricing.marketActive(address(factory), core, market);
    }

    /// @dev Seconds from now until the series maturity.
    function _timeToMaturity(uint256 seriesMaturity) internal view returns (uint256) {
        return seriesMaturity - block.timestamp;
    }

    /// @dev Prices a stream: eligibility check, gross price, and zero guard.
    function _priceStream(address market, uint256 streamId, uint16 aprBps)
        internal
        view
        returns (StreamPricing.Eligibility memory eligibility, uint256 grossPrice, uint256 timeToMaturity)
    {
        eligibility = _requireEligible(market, streamId);
        timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);
        grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
        require(grossPrice > 0, "OVRFLOLending: price zero");
    }

    /// @dev Pulls `amount` of `token` from `from` to `to` with a strict balance-delta check.
    function _pullExact(IERC20 token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 balanceAfter = token.balanceOf(to);
        require(balanceAfter - balanceBefore == amount, "OVRFLOLending: transfer mismatch");
    }

    /// @dev Pays `amount` underlying to `to`, skipping the transfer when zero.
    function _payUnderlying(address to, uint256 amount) internal {
        if (amount > 0) {
            IERC20(underlying).safeTransfer(to, amount);
        }
    }

    /// @dev Allocates a new loan and returns its id.
    function _storeLoan(address borrower, uint256 streamId, uint128 obligation) internal returns (uint256 loanId) {
        loanId = nextLoanId++;
        loans[loanId] =
            Loan({borrower: borrower, streamId: streamId, obligation: obligation, drawn: 0, repaid: 0, closed: false});
    }

    /// @dev Reverts if the loan slot is uninitialized.
    function _requireLoanExists(Loan storage loan) internal view {
        require(loan.borrower != address(0), "OVRFLOLending: unknown loan");
    }

    /// @dev Remaining ovrfloToken owed: `obligation - (drawn + repaid)`.
    function _outstanding(Loan storage loan) internal view returns (uint128) {
        return loan.obligation - loan.drawn - loan.repaid;
    }

    /// @dev Min of two uint128 values.
    function _minUint128(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }

    /// @dev Casts to uint128, reverting on overflow.
    function _toUint128(uint256 amount) internal pure returns (uint128) {
        return SafeCast.toUint128(amount);
    }
}
