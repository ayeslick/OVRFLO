// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IOVRFLOFactoryRegistry, StreamPricing} from "./StreamPricing.sol";

/// @title OVRFLOBook
/// @notice Secondary market book for selling OVRFLO streams or lending against them.
/// @dev A per-vault order book deployed against one OVRFLO core vault and one Sablier V2
///      Lockup Linear instance. It supports two primitives, all priced off
///      `StreamPricing` using a linear APR discount to the series maturity:
///        1. Offers / sale listings — sell a stream now for underlying.
///        2. Offers / borrow pools — pledge a stream as collateral for a loan,
///           settled in ovrfloToken (the stream's payout asset).
///      Offers (maker posts liquidity, no stream bound) front-load market gating via
///      `_requireMarketActive`; listings (maker posts a specific stream) and all fills
///      run the full stream validation via `_requireEligible`. Fees are snapshotted per
///      listing at post time to protect makers from retroactive fee changes; the global
///      `feeBps` applies to offers. All stateful functions are `nonReentrant`.
contract OVRFLOBook is Ownable2Step, ReentrancyGuard, Multicall {
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
    /// @notice The OVRFLO core vault this book serves.
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
    /// @notice Protocol fee (bps) applied to offer fills and quote; owner-governed.
    uint16 public feeBps;
    /// @notice Recipient of protocol fees; defaults to the vault's treasury.
    address public treasury;

    /// @notice Next offer id (monotonic from 1).
    uint256 public nextOfferId = 1;
    /// @notice Next sale-listing id (monotonic from 1).
    uint256 public nextSaleListingId = 1;
    /// @notice Next loan id (monotonic from 1).
    uint256 public nextLoanId = 1;
    /// @notice Next pool id (monotonic from 1).
    uint256 public nextPoolId = 1;

    /// @notice Standing offer: liquidity in underlying waiting to buy or lend against
    ///         any eligible stream from `market` at `aprBps`. The offer is consumable as
    ///         either a sale (permanent stream transfer via `sellIntoOffer`) or a loan
    ///         (stream pledged with obligation via `createBorrowPool`); the maker cannot
    ///         restrict an offer to one path.
    /// @param maker Offer owner who funded the capacity.
    /// @param market Pendle market streams must belong to.
    /// @param aprBps Discount/accrual rate used to price any stream sold into or borrowed
    ///        against this offer.
    /// @param capacity Remaining underlying available (decremented on fill).
    /// @param active False once cancelled or fully consumed.
    struct Offer {
        address maker;
        address market;
        uint16 aprBps;
        uint128 capacity;
        bool active;
    }

    /// @notice Sell-side listing: a specific stream offered for sale at `aprBps`.
    /// @param maker Listing owner (stream seller).
    /// @param market Pendle market the stream belongs to.
    /// @param streamId The Sablier stream being sold.
    /// @param aprBps Discount rate determining the ask price.
    /// @param feeBps Protocol fee snapshotted at post time (maker-protective).
    /// @param active False once cancelled or taken.
    struct SaleListing {
        address maker;
        address market;
        uint256 streamId;
        uint16 aprBps;
        uint16 feeBps;
        bool active;
    }

    /// @notice A loan backed by a pledged Sablier stream.
    /// @dev Satisfied amount = `drawn + repaid`; outstanding = `obligation - satisfied`.
    ///      The lender recovers by drawing ovrfloToken from the stream via
    ///      `closeLoan`, or by the borrower repaying in ovrfloToken (`repayLoan`).
    ///      Total recovery is capped at `obligation`; the stream is returned to the
    ///      borrower once the loan closes.
    /// @param borrower Stream owner who received the loan principal.
    /// @param lender Liquidity provider who funded the loan.
    /// @param streamId The pledged Sablier stream, held in escrow by the book.
    /// @param obligation Total ovrfloToken owed at maturity (ceiling-rounded).
    /// @param drawn ovrfloToken the lender has withdrawn from the stream so far.
    /// @param repaid ovrfloToken the borrower has repaid directly so far.
    /// @param closed True once satisfied == obligation (stream returned).
    struct Loan {
        address borrower;
        address lender;
        uint256 streamId;
        uint128 obligation;
        uint128 drawn;
        uint128 repaid;
        bool closed;
    }

    /// @notice A pool aggregates multiple offers into one atomic batch.
    /// @dev Borrower pools batch across offers via `createBorrowPool`. Claims are
    ///      address-based (no NFTs) via poolContributions and poolReceived.
    /// @param creator Pool creator (the borrower).
    /// @param aprBps Shared rate across all consumed offers.
    /// @param active False once the loan is settled and proceeds claimed.
    /// @param market Pendle market all offers belong to.
    /// @param totalContributed Total capital contributed (borrowed).
    /// @param totalObligation Total ovrfloToken owed on the pool's loan.
    struct Pool {
        address creator;
        uint16 aprBps;
        bool active;
        address market;
        uint128 totalContributed;
        uint128 totalObligation;
    }

    /// @notice Offer id => offer.
    mapping(uint256 => Offer) public offers;
    /// @notice Sale listing id => listing.
    mapping(uint256 => SaleListing) public saleListings;
    /// @notice Loan id => loan.
    mapping(uint256 => Loan) public loans;
    /// @notice Pool id => Pool.
    mapping(uint256 => Pool) public pools;
    /// @notice Pool id => contributor => contributed amount.
    mapping(uint256 => mapping(address => uint128)) public poolContributions;
    /// @notice Pool id => accumulated ovrfloToken from closeLoan/repayLoan.
    mapping(uint256 => uint128) public poolProceeds;
    /// @notice Pool id => contributor => total received across both claim channels.
    mapping(uint256 => mapping(address => uint128)) public poolReceived;
    /// @notice Loan id => poolId (every loan belongs to a pool).
    mapping(uint256 => uint256) public loanPoolId;
    /// @notice Pool id => loanId (every pool has exactly one loan).
    mapping(uint256 => uint256) public poolLoanId;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when the owner changes the APR bounds.
    event AprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    /// @notice Emitted when the owner changes the protocol fee.
    event FeeSet(uint16 feeBps);
    /// @notice Emitted when the owner changes the fee treasury.
    event TreasurySet(address indexed treasury);
    /// @notice Emitted when an offer is posted (liquidity funded).
    event OfferPosted(
        uint256 indexed offerId, address indexed maker, address indexed market, uint16 aprBps, uint128 capacity
    );
    /// @notice Emitted when an offer is cancelled and its remaining capacity refunded.
    event OfferCancelled(uint256 indexed offerId, address indexed maker, uint128 refunded);
    /// @notice Emitted when a seller hits an offer, transferring the stream to the maker.
    event SaleOfferHit(
        uint256 indexed offerId,
        uint256 indexed streamId,
        address indexed seller,
        address buyer,
        uint256 grossPrice,
        uint256 fee,
        uint256 netToSeller
    );
    /// @notice Emitted when a stream is listed for sale.
    event SaleListingPosted(
        uint256 indexed listingId,
        address indexed maker,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps
    );
    /// @notice Emitted when a sale listing is cancelled and the stream returned.
    event SaleListingCancelled(uint256 indexed listingId, address indexed maker, uint256 streamId);
    /// @notice Emitted when a buyer takes a sale listing, paying the seller and receiving the stream.
    event SaleListingTaken(
        uint256 indexed listingId,
        uint256 indexed streamId,
        address indexed buyer,
        address seller,
        uint256 grossPrice,
        uint256 fee,
        uint256 netToSeller
    );
    /// @notice Emitted when a loan is closed by drawing the remainder and returning the stream.
    event LoanClosed(uint256 indexed loanId, address indexed borrower, address indexed lender, uint128 finalDraw);
    /// @notice Emitted when a borrower repays ovrfloToken toward a loan (and whether it closed).
    event LoanRepaid(
        uint256 indexed loanId, address indexed borrower, address indexed lender, uint128 amount, bool closed
    );
    /// @notice Emitted when a pool is created.
    event PoolCreated(
        uint256 indexed poolId, address indexed creator, address market, uint16 aprBps, uint128 totalContributed
    );
    /// @notice Emitted when a contributor claims ovrfloToken from pool proceeds.
    event PoolShareClaimed(uint256 indexed poolId, address indexed claimant, uint128 amount);
    /// @notice Emitted when a contributor draws directly from a pool loan's stream.
    event PoolLoanClaimed(uint256 indexed poolId, address indexed claimant, uint256 indexed loanId, uint128 amount);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploys an OVRFLOBook bound to one vault, Sablier instance, and fee config.
    /// @dev Pulls `treasury`, `underlying`, and `ovrfloToken` from the factory so they
    ///      stay consistent with the served vault. APR bounds initialize to the launch APR.
    /// @param factory_ The OVRFLOFactory registry address.
    /// @param core_ The OVRFLO core vault this book serves.
    /// @param sablier_ The Sablier V2 Lockup Linear address.
    constructor(address factory_, address core_, address sablier_) {
        require(factory_ != address(0), "OVRFLOBook: factory zero");
        require(core_ != address(0), "OVRFLOBook: core zero");
        require(sablier_ != address(0), "OVRFLOBook: sablier zero");

        (address treasury_, address underlying_, address ovrfloToken_) =
            IOVRFLOFactoryRegistry(factory_).ovrfloInfo(core_);
        require(treasury_ != address(0), "OVRFLOBook: unknown core");
        require(underlying_ != address(0), "OVRFLOBook: underlying zero");
        require(ovrfloToken_ != address(0), "OVRFLOBook: token zero");

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
    /// @dev Does not affect existing offers/listings. Enforced per-post via `_validateApr`.
    ///      Both bounds must be multiples of `APR_STEP_BPS`.
    /// @param aprMinBps_ New minimum APR in basis points.
    /// @param aprMaxBps_ New maximum APR in basis points.
    function setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        require(aprMaxBps_ >= aprMinBps_, "OVRFLOBook: bad apr bounds");
        require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOBook: apr too high");
        require(aprMinBps_ % APR_STEP_BPS == 0, "OVRFLOBook: aprMin not step-aligned");
        require(aprMaxBps_ % APR_STEP_BPS == 0, "OVRFLOBook: aprMax not step-aligned");

        aprMinBps = aprMinBps_;
        aprMaxBps = aprMaxBps_;

        emit AprBoundsSet(aprMinBps_, aprMaxBps_);
    }

    /// @notice Sets the protocol fee applied to offer fills and `quote`.
    /// @dev Does not affect listings, which snapshot `feeBps` at post time.
    /// @param feeBps_ New fee in basis points.
    function setFee(uint16 feeBps_) external onlyOwner {
        require(feeBps_ <= MAX_FEE_BPS, "OVRFLOBook: fee too high");

        feeBps = feeBps_;

        emit FeeSet(feeBps_);
    }

    /// @notice Sets the recipient of protocol fees.
    /// @param treasury_ New treasury address (must not be zero).
    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "OVRFLOBook: treasury zero");

        treasury = treasury_;

        emit TreasurySet(treasury_);
    }

    /*//////////////////////////////////////////////////////////////
                                OFFERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Posts a standing offer: fund `capacity` underlying to buy or lend against
    ///         any eligible stream from `market` at rate `aprBps`.
    /// @dev Pulls `capacity` underlying from the maker upfront. The market is gated
    ///      with `_requireMarketActive` (no stream is bound yet); full stream
    ///      eligibility is checked per-fill in `sellIntoOffer` and `createBorrowPool`.
    ///      The offer is consumable as either a sale or a loan; the maker cannot
    ///      restrict an offer to one path.
    /// @param market Pendle market streams must belong to.
    /// @param aprBps Discount/accrual rate used to price streams.
    /// @param capacity Underlying liquidity to fund.
    /// @return offerId The new offer id.
    function postOffer(address market, uint16 aprBps, uint128 capacity)
        external
        nonReentrant
        returns (uint256 offerId)
    {
        _validateApr(aprBps);
        _requireMarketActive(market);
        require(capacity > 0, "OVRFLOBook: capacity zero");

        offerId = nextOfferId++;
        offers[offerId] = Offer({maker: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

        _pullExact(IERC20(underlying), msg.sender, address(this), capacity);

        emit OfferPosted(offerId, msg.sender, market, aprBps, capacity);
    }

    /// @notice Cancels an offer and refunds its remaining capacity.
    /// @param offerId The offer to cancel.
    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "OVRFLOBook: offer inactive");
        require(offer.maker == msg.sender, "OVRFLOBook: not offer maker");

        uint128 refund = offer.capacity;
        offer.capacity = 0;
        offer.active = false;

        _payUnderlying(msg.sender, refund);

        emit OfferCancelled(offerId, msg.sender, refund);
    }

    /// @notice Sells a stream into a standing offer (taker side).
    /// @dev Prices `streamId` at the offer's `aprBps`, charges the global `feeBps`,
    ///      transfers the stream to the offer maker, and pays the seller (net of fee).
    ///      Reverts if the price exceeds remaining capacity or slips below `minNetOut`.
    /// @param offerId The offer to sell into.
    /// @param streamId The Sablier stream being sold.
    /// @param minNetOut Minimum underlying the seller must receive (slippage).
    function sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "OVRFLOBook: offer inactive");

        StreamPricing.Eligibility memory eligibility = _requireEligible(offer.market, streamId);
        uint256 grossPrice =
            StreamPricing.grossPrice(eligibility.remaining, offer.aprBps, _timeToMaturity(eligibility.seriesMaturity));
        require(grossPrice > 0, "OVRFLOBook: price zero");
        require(grossPrice <= offer.capacity, "OVRFLOBook: insufficient capacity");

        uint256 feeAmount = StreamPricing.fee(grossPrice, feeBps);
        uint256 netToSeller = grossPrice - feeAmount;
        require(netToSeller >= minNetOut, "OVRFLOBook: slippage");

        offer.capacity -= _toUint128(grossPrice);
        if (offer.capacity == 0) {
            offer.active = false;
        }

        sablier.transferFrom(msg.sender, offer.maker, streamId);
        _payUnderlying(msg.sender, netToSeller);
        _payUnderlying(treasury, feeAmount);

        emit SaleOfferHit(offerId, streamId, msg.sender, offer.maker, grossPrice, feeAmount, netToSeller);
    }

    /*//////////////////////////////////////////////////////////////
                              SALE LISTINGS
    //////////////////////////////////////////////////////////////*/

    /// @notice Lists a specific stream for sale at discount rate `aprBps`.
    /// @dev Escrows the stream (transferred to the book) and snapshots the current
    ///      `feeBps` so the maker is protected from later fee changes. Full stream
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
            maker: msg.sender, market: market, streamId: streamId, aprBps: aprBps, feeBps: feeBps, active: true
        });

        sablier.transferFrom(msg.sender, address(this), streamId);

        emit SaleListingPosted(listingId, msg.sender, market, streamId, aprBps, feeBps);
    }

    /// @notice Cancels a sale listing and returns the escrowed stream to the maker.
    /// @param listingId The listing to cancel.
    function cancelSaleListing(uint256 listingId) external nonReentrant {
        SaleListing storage listing = saleListings[listingId];
        require(listing.active, "OVRFLOBook: listing inactive");
        require(listing.maker == msg.sender, "OVRFLOBook: not listing maker");

        listing.active = false;
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit SaleListingCancelled(listingId, msg.sender, listing.streamId);
    }

    /// @notice Buys a sale listing (taker side).
    /// @dev Re-prices the stream at fill time (remaining may have changed since post),
    ///      charges the listing's snapshotted `feeBps`, pays the seller net, and
    ///      transfers the stream to the buyer. Reverts if the price exceeds `maxPriceIn`.
    /// @param listingId The listing to buy.
    /// @param maxPriceIn Maximum underlying the buyer will pay (slippage).
    function buyListing(uint256 listingId, uint256 maxPriceIn) external nonReentrant {
        SaleListing storage listing = saleListings[listingId];
        require(listing.active, "OVRFLOBook: listing inactive");

        StreamPricing.Eligibility memory eligibility = _requireEligible(listing.market, listing.streamId);
        uint256 grossPrice = StreamPricing.grossPrice(
            eligibility.remaining, listing.aprBps, _timeToMaturity(eligibility.seriesMaturity)
        );
        require(grossPrice > 0, "OVRFLOBook: price zero");
        require(grossPrice <= maxPriceIn, "OVRFLOBook: slippage");

        uint256 feeAmount = StreamPricing.fee(grossPrice, listing.feeBps);
        uint256 netToSeller = grossPrice - feeAmount;

        listing.active = false;

        _pullExact(IERC20(underlying), msg.sender, address(this), grossPrice);
        _payUnderlying(listing.maker, netToSeller);
        _payUnderlying(treasury, feeAmount);
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit SaleListingTaken(
            listingId, listing.streamId, msg.sender, listing.maker, grossPrice, feeAmount, netToSeller
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
        require(!loan.closed, "OVRFLOBook: loan closed");

        uint128 outstanding = _outstanding(loan);
        uint128 withdrawable = sablier.withdrawableAmountOf(loan.streamId);
        require(withdrawable >= outstanding, "OVRFLOBook: loan not closable");

        loan.closed = true;
        pools[loanPoolId[loanId]].active = false;
        if (outstanding > 0) {
            loan.drawn += outstanding;
            uint256 poolId = loanPoolId[loanId];
            sablier.withdraw(loan.streamId, address(this), outstanding);
            poolProceeds[poolId] += outstanding;
        }
        sablier.transferFrom(address(this), loan.borrower, loan.streamId);

        emit LoanClosed(loanId, loan.borrower, loan.lender, outstanding);
    }

    /// @notice Borrower repays ovrfloToken toward a loan to reduce or clear the obligation.
    /// @dev Repayment is in ovrfloToken (the stream's payout asset), credited to
    ///      `poolProceeds`. `amount` is capped at outstanding; when it equals outstanding
    ///      the loan closes and the stream is returned to the borrower. The equality is
    ///      safe from rounding bricks because `outstanding` is always an exact integer wei
    ///      and ovrfloToken has 18-decimal granularity (see
    ///      `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md`).
    /// @param loanId The loan to repay.
    /// @param amount ovrfloToken to repay (must be <= outstanding).
    function repayLoan(uint256 loanId, uint128 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        require(!loan.closed, "OVRFLOBook: loan closed");
        require(loan.borrower == msg.sender, "OVRFLOBook: not borrower");

        uint128 outstanding = _outstanding(loan);
        require(outstanding > 0, "OVRFLOBook: nothing outstanding");
        require(amount > 0, "OVRFLOBook: repay zero");
        require(amount <= outstanding, "OVRFLOBook: repay too much");

        loan.repaid += amount;
        bool closes = amount == outstanding;
        if (closes) {
            loan.closed = true;
            pools[loanPoolId[loanId]].active = false;
        }

        uint256 poolId = loanPoolId[loanId];
        _pullExact(IERC20(ovrfloToken), msg.sender, address(this), amount);
        poolProceeds[poolId] += amount;
        if (closes) {
            sablier.transferFrom(address(this), loan.borrower, loan.streamId);
        }

        emit LoanRepaid(loanId, msg.sender, loan.lender, amount, closes);
    }

    /*//////////////////////////////////////////////////////////////
                                POOLS
    //////////////////////////////////////////////////////////////*/

    /// @notice Creates a borrower pool: aggregates multiple offers into one loan.
    /// @dev The borrower pledges `streamId` and borrows from multiple offers in a
    ///      single atomic transaction. The pool becomes the virtual lender
    ///      (`loan.lender = address(this)`, `loanPoolId[loanId] = poolId`,
    ///      `poolLoanId[poolId] = loanId`). Each offer maker's consumed capacity is
    ///      recorded for pro-rata claims. All offers must share the same `market` and
    ///      `aprBps`. Self-match (borrower is an offer maker) is prevented. CEI: all
    ///      validation before any state mutation.
    /// @param offerIds Offer IDs to consume (must all match same market/aprBps).
    /// @param streamId The Sablier stream to pledge as collateral.
    /// @param targetBorrow Desired principal; actual may be less if capacity is insufficient.
    /// @param minAcceptable Minimum net proceeds the borrower will accept (after fees).
    /// @return poolId The new pool id.
    function createBorrowPool(uint256[] memory offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)
        external
        nonReentrant
        returns (uint256 poolId)
    {
        require(targetBorrow > 0, "OVRFLOBook: borrow zero");
        require(offerIds.length > 0, "OVRFLOBook: empty offers");

        address market;
        uint16 aprBps;
        {
            Offer storage firstOffer = offers[offerIds[0]];
            require(firstOffer.active, "OVRFLOBook: offer inactive");
            market = firstOffer.market;
            aprBps = firstOffer.aprBps;
        }

        uint128 obligation;
        uint128 actualBorrow128;
        uint256 netToBorrower;
        uint256 feeAmount;
        {
            StreamPricing.Eligibility memory eligibility = _requireEligible(market, streamId);
            uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);
            uint256 grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
            require(grossPrice > 0, "OVRFLOBook: price zero");

            uint256 totalAvailable = _validateOffers(offerIds, market, aprBps, msg.sender);
            uint256 actualBorrow = targetBorrow < totalAvailable ? uint256(targetBorrow) : totalAvailable;
            require(actualBorrow <= grossPrice, "OVRFLOBook: borrow above price");

            obligation = StreamPricing.obligationForFill(
                actualBorrow, grossPrice, eligibility.remaining, aprBps, timeToMaturity
            );
            feeAmount = StreamPricing.fee(actualBorrow, feeBps);
            netToBorrower = actualBorrow - feeAmount;
            require(netToBorrower >= minAcceptable, "OVRFLOBook: slippage");
            actualBorrow128 = _toUint128(actualBorrow);
        }

        poolId = nextPoolId++;
        pools[poolId] = Pool({
            creator: msg.sender,
            aprBps: aprBps,
            active: true,
            market: market,
            totalContributed: actualBorrow128,
            totalObligation: obligation
        });

        _consumeOffers(offerIds, poolId, actualBorrow128);

        uint256 loanId = _storeLoan(msg.sender, address(this), streamId, obligation);
        loanPoolId[loanId] = poolId;
        poolLoanId[poolId] = loanId;

        sablier.transferFrom(msg.sender, address(this), streamId);
        _payUnderlying(msg.sender, netToBorrower);
        _payUnderlying(treasury, feeAmount);

        emit PoolCreated(poolId, msg.sender, market, aprBps, actualBorrow128);
    }

    /// @notice Lets a pool contributor claim their pro-rata share from an open pool loan.
    /// @dev Claimable is capped at `contribution * (drawn + repaid) / totalContributed -
    ///      poolReceived`, ensuring every contributor gets their fair share regardless of
    ///      claim order. If `poolProceeds` is insufficient and the loan is open, harvests
    ///      only the deficit from the stream. Reverts when the loan is closed.
    /// @param poolId The pool the loan belongs to.
    /// @param amount Requested claim amount (capped at claimable).
    function poolClaimLoan(uint256 poolId, uint128 amount) external nonReentrant {
        require(poolContributions[poolId][msg.sender] > 0, "OVRFLOBook: not contributor");
        uint256 loanId = poolLoanId[poolId];
        require(loanId != 0, "OVRFLOBook: loan not in pool");

        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        require(!loan.closed, "OVRFLOBook: loan closed");

        uint128 payAmount = _claimFair(poolId, msg.sender, amount);
        emit PoolLoanClaimed(poolId, msg.sender, loanId, payAmount);
    }

    /// @notice Lets a pool contributor claim ovrfloToken from accumulated pool proceeds.
    /// @dev Proceeds accumulate from `closeLoan` and `repayLoan` on pool loans. Claimable
    ///      is capped at `contribution * (drawn + repaid) / totalContributed - poolReceived`,
    ///      ensuring pro-rata fairness. Works whether the loan is open or closed. When the
    ///      loan is open and `poolProceeds` is insufficient, harvests the deficit from the
    ///      stream.
    /// @param poolId The pool to claim from.
    /// @param amount Requested claim amount (capped at claimable).
    function claimPoolShare(uint256 poolId, uint128 amount) external nonReentrant {
        require(amount > 0, "OVRFLOBook: claim zero");
        uint128 payAmount = _claimFair(poolId, msg.sender, amount);
        emit PoolShareClaimed(poolId, msg.sender, payAmount);
    }

    /// @dev Shared claim logic for `poolClaimLoan` and `claimPoolShare`. Computes
    ///      claimable as `contribution * (drawn + repaid) / totalContributed - poolReceived`,
    ///      harvests only the deficit from the stream when `poolProceeds` is insufficient
    ///      and the loan is open, then pays from `poolProceeds`.
    function _claimFair(uint256 poolId, address account, uint128 amount) internal returns (uint128 payAmount) {
        uint128 contribution = poolContributions[poolId][account];
        require(contribution > 0, "OVRFLOBook: not contributor");

        Loan storage loan = loans[poolLoanId[poolId]];

        uint256 claimable = uint256(contribution) * (uint256(loan.drawn) + uint256(loan.repaid))
            / uint256(pools[poolId].totalContributed) - poolReceived[poolId][account];

        uint128 requestAmount = _minUint128(amount, _toUint128(claimable));

        if (!loan.closed && poolProceeds[poolId] < requestAmount) {
            uint128 harvestAmount = _minUint128(
                _toUint128(uint256(requestAmount) - uint256(poolProceeds[poolId])),
                _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan))
            );
            if (harvestAmount > 0) {
                sablier.withdraw(loan.streamId, address(this), harvestAmount);
                loan.drawn += harvestAmount;
                poolProceeds[poolId] += harvestAmount;
            }
        }

        payAmount = _minUint128(requestAmount, poolProceeds[poolId]);
        require(payAmount > 0, "OVRFLOBook: nothing claimable");

        poolReceived[poolId][account] += payAmount;
        poolProceeds[poolId] -= payAmount;
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
        StreamPricing.Eligibility memory eligibility = _requireEligible(market, streamId);
        _validateApr(aprBps);
        uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);

        grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
        require(grossPrice > 0, "OVRFLOBook: price zero");
        uint256 effectiveBorrowAmount = borrowAmount == 0 ? grossPrice : borrowAmount;
        require(effectiveBorrowAmount <= grossPrice, "OVRFLOBook: borrow above price");

        obligation = StreamPricing.obligationForFill(
            effectiveBorrowAmount, grossPrice, eligibility.remaining, aprBps, timeToMaturity
        );
        feeAmount = StreamPricing.fee(effectiveBorrowAmount, feeBps);
        netToBorrower = effectiveBorrowAmount - feeAmount;
        residual = eligibility.remaining - obligation;
    }

    /// @notice Returns the full state of a loan.
    /// @param loanId The loan id.
    /// @return borrower The borrower (stream owner).
    /// @return lender The lender.
    /// @return streamId The pledged Sablier stream.
    /// @return obligation Total ovrfloToken owed at maturity.
    /// @return drawn ovrfloToken drawn by the lender so far.
    /// @return repaid ovrfloToken repaid by the borrower so far.
    /// @return outstanding `obligation - drawn - repaid`.
    /// @return closed Whether the loan is closed.
    function loanState(uint256 loanId)
        external
        view
        returns (
            address borrower,
            address lender,
            uint256 streamId,
            uint128 obligation,
            uint128 drawn,
            uint128 repaid,
            uint128 outstanding,
            bool closed
        )
    {
        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        return (
            loan.borrower,
            loan.lender,
            loan.streamId,
            loan.obligation,
            loan.drawn,
            loan.repaid,
            _outstanding(loan),
            loan.closed
        );
    }

    /// @notice Returns the state of an offer.
    /// @param offerId The offer id.
    /// @return maker Offer owner.
    /// @return market Pendle market.
    /// @return aprBps Discount/accrual rate.
    /// @return capacity Remaining underlying.
    /// @return active Whether the offer is still live.
    function offerState(uint256 offerId)
        external
        view
        returns (address maker, address market, uint16 aprBps, uint128 capacity, bool active)
    {
        Offer storage offer = offers[offerId];
        require(offer.maker != address(0), "OVRFLOBook: unknown offer");
        return (offer.maker, offer.market, offer.aprBps, offer.capacity, offer.active);
    }

    /// @notice Returns the state of a sale listing.
    /// @param listingId The sale listing id.
    /// @return maker Listing owner.
    /// @return market Pendle market.
    /// @return streamId The Sablier stream.
    /// @return aprBps Ask discount rate.
    /// @return listingFeeBps Snapshotted fee at post time.
    /// @return active Whether the listing is still live.
    function saleListingState(uint256 listingId)
        external
        view
        returns (address maker, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active)
    {
        SaleListing storage listing = saleListings[listingId];
        require(listing.maker != address(0), "OVRFLOBook: unknown listing");
        return (listing.maker, listing.market, listing.streamId, listing.aprBps, listing.feeBps, listing.active);
    }

    /*//////////////////////////////////////////////////////////////
                          GATHER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Scans offers for matching capacity.
    /// @dev Gated by
    ///      `marketActive` (reverts on expired series). Returns IDs of active offers
    ///      matching `market` and `aprBps` with remaining capacity, stopping once
    ///      accumulated capacity meets `targetAmount`. Use `startId` to paginate if the
    ///      scan is large and `sufficient` is false.
    /// @param market Pendle market to match.
    /// @param aprBps Rate to match.
    /// @param targetAmount Minimum total capacity desired.
    /// @param startId First offer ID to scan (inclusive).
    /// @return ids Matching offer IDs.
    /// @return sufficient True if accumulated capacity >= `targetAmount`.
    function gatherOfferCapacities(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)
        external
        view
        returns (uint256[] memory ids, bool sufficient)
    {
        StreamPricing.marketActive(address(factory), core, market);
        if (startId >= nextOfferId) {
            return (new uint256[](0), false);
        }

        uint256 maxCount = nextOfferId - startId;
        ids = new uint256[](maxCount);

        uint256 count;
        uint256 gathered;
        for (uint256 i = startId; i < nextOfferId; i++) {
            Offer storage offer = offers[i];
            if (offer.active && offer.market == market && offer.aprBps == aprBps && offer.capacity > 0) {
                ids[count++] = i;
                gathered += offer.capacity;
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

    /// @dev Validates all offers in a borrower pool: active, same market, same aprBps,
    ///      no self-match. Returns total available capacity.
    function _validateOffers(uint256[] memory offerIds, address market, uint16 aprBps, address borrower)
        internal
        view
        returns (uint256 totalAvailable)
    {
        for (uint256 i = 0; i < offerIds.length; i++) {
            if (i > 0) require(offerIds[i] > offerIds[i - 1], "OVRFLOBook: duplicate or unsorted ids");
            Offer storage offer = offers[offerIds[i]];
            require(offer.active, "OVRFLOBook: offer inactive");
            require(offer.market == market, "OVRFLOBook: market mismatch");
            require(offer.aprBps == aprBps, "OVRFLOBook: apr mismatch");
            require(offer.maker != borrower, "OVRFLOBook: self-match");
            totalAvailable += offer.capacity;
        }
    }

    /// @dev Consumes offers up to `actualBorrow`, recording per-maker contributions.
    function _consumeOffers(uint256[] memory offerIds, uint256 poolId, uint256 actualBorrow) internal {
        uint256 toBorrow = actualBorrow;
        for (uint256 i = 0; i < offerIds.length; i++) {
            if (toBorrow == 0) break;
            Offer storage offer = offers[offerIds[i]];
            uint256 consumed = toBorrow < offer.capacity ? toBorrow : offer.capacity;
            offer.capacity -= _toUint128(consumed);
            if (offer.capacity == 0) {
                offer.active = false;
            }
            poolContributions[poolId][offer.maker] += _toUint128(consumed);
            toBorrow -= consumed;
        }
    }

    /// @dev Reverts if `aprBps` is outside the current `[aprMinBps, aprMaxBps]` bounds.
    function _validateApr(uint16 aprBps) internal view {
        require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOBook: apr out of bounds");
        require(aprBps % APR_STEP_BPS == 0, "OVRFLOBook: apr not whole");
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

    /// @dev Pulls `amount` of `token` from `from` to `to` with a strict balance-delta check.
    function _pullExact(IERC20 token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 balanceAfter = token.balanceOf(to);
        require(balanceAfter - balanceBefore == amount, "OVRFLOBook: transfer mismatch");
    }

    /// @dev Pays `amount` underlying to `to`, skipping the transfer when zero.
    function _payUnderlying(address to, uint256 amount) internal {
        if (amount > 0) {
            IERC20(underlying).safeTransfer(to, amount);
        }
    }

    /// @dev Allocates a new loan and returns its id.
    function _storeLoan(address borrower, address lender, uint256 streamId, uint128 obligation)
        internal
        returns (uint256 loanId)
    {
        loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: borrower,
            lender: lender,
            streamId: streamId,
            obligation: obligation,
            drawn: 0,
            repaid: 0,
            closed: false
        });
    }

    /// @dev Reverts if the loan slot is uninitialized.
    function _requireLoanExists(Loan storage loan) internal view {
        require(loan.borrower != address(0), "OVRFLOBook: unknown loan");
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
        require(amount <= type(uint128).max, "OVRFLOBook: uint128 overflow");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(amount);
    }
}
