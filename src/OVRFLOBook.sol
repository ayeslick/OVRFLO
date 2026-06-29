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
///      Lockup Linear instance. It supports four primitives, all priced off
///      `StreamPricing` using a linear APR discount to the series maturity:
///        1. Sale offers / sale listings — sell a stream now for underlying.
///        2. Lend offers / borrow listings — pledge a stream as collateral for a loan,
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
    /// @notice Hard ceiling on the maximum APR bound the owner may set (100%).
    uint16 public constant APR_MAX_CEILING = 10_000;
    /// @notice Hard ceiling on the protocol fee the owner may set (100%).
    uint16 public constant MAX_FEE_BPS = 10_000;

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

    /// @notice Next sale-offer id (monotonic from 1).
    uint256 public nextSaleOfferId = 1;
    /// @notice Next sale-listing id (monotonic from 1).
    uint256 public nextSaleListingId = 1;
    /// @notice Next lend-offer id (monotonic from 1).
    uint256 public nextLendOfferId = 1;
    /// @notice Next borrow-listing id (monotonic from 1).
    uint256 public nextBorrowListingId = 1;
    /// @notice Next loan id (monotonic from 1).
    uint256 public nextLoanId = 1;
    /// @notice Next pool id (monotonic from 1).
    uint256 public nextPoolId = 1;

    /// @notice Standing buy-side offer: liquidity in underlying waiting to buy any
    ///         eligible stream from `market` at `aprBps`.
    /// @param maker Offer owner who funded the capacity.
    /// @param market Pendle market streams must belong to.
    /// @param aprBps Discount rate used to price any stream sold into this offer.
    /// @param capacity Remaining underlying available (decremented on fill).
    /// @param active False once cancelled or fully consumed.
    struct SaleOffer {
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

    /// @notice Standing lend offer: liquidity in underlying waiting to lend against any
    ///         eligible stream from `market` at `aprBps`.
    /// @param lender Offer owner who funded the capacity.
    /// @param market Pendle market collateral streams must belong to.
    /// @param aprBps Rate used to price collateral and accrue obligation.
    /// @param capacity Remaining underlying available to lend (decremented on draw).
    /// @param active False once cancelled or fully consumed.
    struct LendOffer {
        address lender;
        address market;
        uint16 aprBps;
        uint128 capacity;
        bool active;
    }

    /// @notice Borrow-side listing: a specific stream pledged as collateral for a loan.
    /// @param borrower Listing owner (stream pledgor).
    /// @param market Pendle market the stream belongs to.
    /// @param streamId The Sablier stream pledged as collateral.
    /// @param aprBps Rate used to price collateral and accrue obligation.
    /// @param borrowAmount Principal the borrower wants advanced.
    /// @param feeBps Protocol fee snapshotted at post time (borrower-protective).
    /// @param active False once cancelled or lent against.
    struct BorrowListing {
        address borrower;
        address market;
        uint256 streamId;
        uint16 aprBps;
        uint128 borrowAmount;
        uint16 feeBps;
        bool active;
    }

    /// @notice A loan backed by a pledged Sablier stream.
    /// @dev Satisfied amount = `drawn + repaid`; outstanding = `obligation - satisfied`.
    ///      The lender recovers by drawing ovrfloToken from the stream (`claimLoan`/
    ///      `closeLoan`) or by the borrower repaying in ovrfloToken (`repayLoan`).
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

    /// @notice A pool aggregates multiple offers or listings into one atomic batch.
    /// @dev Borrower pools (isLend=false) batch borrowAgainstOffer across lend offers.
    ///      Lender pools (isLend=true) batch lendAgainstListing across borrow listings.
    ///      Claims are address-based (no NFTs) via poolContributions and poolReceived.
    /// @param creator Pool creator (borrower for borrower pools, lender for lender pools).
    /// @param aprBps Shared rate across all consumed offers/listings.
    /// @param isLend True = lender pool, false = borrower pool.
    /// @param active False once all loans settled and proceeds claimed.
    /// @param market Pendle market all offers/listings belong to.
    /// @param totalContributed Total capital contributed (borrowed or deployed).
    struct Pool {
        address creator;
        uint16 aprBps;
        bool isLend;
        bool active;
        address market;
        uint128 totalContributed;
    }

    /// @notice Sale offer id => offer.
    mapping(uint256 => SaleOffer) public saleOffers;
    /// @notice Sale listing id => listing.
    mapping(uint256 => SaleListing) public saleListings;
    /// @notice Lend offer id => offer.
    mapping(uint256 => LendOffer) public lendOffers;
    /// @notice Borrow listing id => listing.
    mapping(uint256 => BorrowListing) public borrowListings;
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
    /// @notice Loan id => poolId (0 = non-pool loan).
    mapping(uint256 => uint256) public loanPoolId;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when the owner changes the APR bounds.
    event AprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    /// @notice Emitted when the owner changes the protocol fee.
    event FeeSet(uint16 feeBps);
    /// @notice Emitted when the owner changes the fee treasury.
    event TreasurySet(address indexed treasury);
    /// @notice Emitted when a sale offer is posted (liquidity funded).
    event SaleOfferPosted(
        uint256 indexed offerId, address indexed maker, address indexed market, uint16 aprBps, uint128 capacity
    );
    /// @notice Emitted when a sale offer is cancelled and its remaining capacity refunded.
    event SaleOfferCancelled(uint256 indexed offerId, address indexed maker, uint128 refunded);
    /// @notice Emitted when a seller hits a sale offer, transferring the stream to the maker.
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
    /// @notice Emitted when a lend offer is posted (liquidity funded).
    event LendOfferPosted(
        uint256 indexed offerId, address indexed lender, address indexed market, uint16 aprBps, uint128 capacity
    );
    /// @notice Emitted when a lend offer is cancelled and its remaining capacity refunded.
    event LendOfferCancelled(uint256 indexed offerId, address indexed lender, uint128 refunded);
    /// @notice Emitted when a borrower pledges a stream against a lend offer, opening a loan.
    event BorrowedAgainstOffer(
        uint256 indexed offerId,
        uint256 indexed loanId,
        uint256 indexed streamId,
        address borrower,
        address lender,
        uint128 borrowAmount,
        uint128 obligation,
        uint256 fee,
        uint256 netToBorrower
    );
    /// @notice Emitted when a borrow listing is posted (stream pledged as collateral).
    event BorrowListingPosted(
        uint256 indexed listingId,
        address indexed borrower,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps,
        uint128 borrowAmount
    );
    /// @notice Emitted when a borrow listing is cancelled and the stream returned.
    event BorrowListingCancelled(uint256 indexed listingId, address indexed borrower, uint256 streamId);
    /// @notice Emitted when a lender fills a borrow listing, opening a loan.
    event LentAgainstListing(
        uint256 indexed listingId,
        uint256 indexed loanId,
        uint256 indexed streamId,
        address borrower,
        address lender,
        uint128 borrowAmount,
        uint128 obligation,
        uint256 fee,
        uint256 netToBorrower
    );
    /// @notice Emitted when a lender draws ovrfloToken from a loan's pledged stream.
    event LoanClaimed(uint256 indexed loanId, address indexed lender, uint128 amount, uint128 drawn);
    /// @notice Emitted when a loan is closed by drawing the remainder and returning the stream.
    event LoanClosed(uint256 indexed loanId, address indexed borrower, address indexed lender, uint128 finalDraw);
    /// @notice Emitted when a borrower repays ovrfloToken toward a loan (and whether it closed).
    event LoanRepaid(
        uint256 indexed loanId, address indexed borrower, address indexed lender, uint128 amount, bool closed
    );
    /// @notice Emitted when a pool is created (borrower or lender).
    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        address market,
        uint16 aprBps,
        bool isLend,
        uint128 totalContributed
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
    /// @param aprMinBps_ New minimum APR in basis points.
    /// @param aprMaxBps_ New maximum APR in basis points.
    function setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        require(aprMaxBps_ >= aprMinBps_, "OVRFLOBook: bad apr bounds");
        require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOBook: apr too high");

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
                              SALE OFFERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Posts a standing sale offer: fund `capacity` underlying to buy any
    ///         eligible stream from `market` at discount rate `aprBps`.
    /// @dev Pulls `capacity` underlying from the maker upfront. The market is gated
    ///      with `_requireMarketActive` (no stream is bound yet); full stream
    ///      eligibility is checked per-fill in `sellIntoOffer`.
    /// @param market Pendle market streams must belong to.
    /// @param aprBps Discount rate used to price streams sold into this offer.
    /// @param capacity Underlying liquidity to fund.
    /// @return offerId The new sale offer id.
    function postSaleOffer(address market, uint16 aprBps, uint128 capacity)
        external
        nonReentrant
        returns (uint256 offerId)
    {
        _validateApr(aprBps);
        _requireMarketActive(market);
        require(capacity > 0, "OVRFLOBook: capacity zero");

        offerId = nextSaleOfferId++;
        saleOffers[offerId] =
            SaleOffer({maker: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

        _pullExact(IERC20(underlying), msg.sender, address(this), capacity);

        emit SaleOfferPosted(offerId, msg.sender, market, aprBps, capacity);
    }

    /// @notice Cancels a sale offer and refunds its remaining capacity.
    /// @param offerId The offer to cancel.
    function cancelSaleOffer(uint256 offerId) external nonReentrant {
        SaleOffer storage offer = saleOffers[offerId];
        require(offer.active, "OVRFLOBook: offer inactive");
        require(offer.maker == msg.sender, "OVRFLOBook: not offer maker");

        uint128 refund = offer.capacity;
        offer.capacity = 0;
        offer.active = false;

        _payUnderlying(msg.sender, refund);

        emit SaleOfferCancelled(offerId, msg.sender, refund);
    }

    /// @notice Sells a stream into a standing sale offer (taker side).
    /// @dev Prices `streamId` at the offer's `aprBps`, charges the global `feeBps`,
    ///      transfers the stream to the offer maker, and pays the seller (net of fee).
    ///      Reverts if the price exceeds remaining capacity or slips below `minNetOut`.
    /// @param offerId The offer to sell into.
    /// @param streamId The Sablier stream being sold.
    /// @param minNetOut Minimum underlying the seller must receive (slippage).
    function sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut) external nonReentrant {
        SaleOffer storage offer = saleOffers[offerId];
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
                              LEND OFFERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Posts a standing lend offer: fund `capacity` underlying to lend against
    ///         any eligible stream from `market` at rate `aprBps`.
    /// @dev Pulls `capacity` underlying upfront. Market-gated via `_requireMarketActive`
    ///      (no stream bound yet); full eligibility is checked per-draw in
    ///      `borrowAgainstOffer`.
    /// @param market Pendle market collateral streams must belong to.
    /// @param aprBps Rate used to price collateral and accrue obligation.
    /// @param capacity Underlying liquidity to fund.
    /// @return offerId The new lend offer id.
    function postLendOffer(address market, uint16 aprBps, uint128 capacity)
        external
        nonReentrant
        returns (uint256 offerId)
    {
        _validateApr(aprBps);
        _requireMarketActive(market);
        require(capacity > 0, "OVRFLOBook: capacity zero");

        offerId = nextLendOfferId++;
        lendOffers[offerId] =
            LendOffer({lender: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

        _pullExact(IERC20(underlying), msg.sender, address(this), capacity);

        emit LendOfferPosted(offerId, msg.sender, market, aprBps, capacity);
    }

    /// @notice Cancels a lend offer and refunds its remaining capacity.
    /// @param offerId The offer to cancel.
    function cancelLendOffer(uint256 offerId) external nonReentrant {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "OVRFLOBook: lend offer inactive");
        require(offer.lender == msg.sender, "OVRFLOBook: not lender");

        uint128 refund = offer.capacity;
        offer.capacity = 0;
        offer.active = false;

        _payUnderlying(msg.sender, refund);

        emit LendOfferCancelled(offerId, msg.sender, refund);
    }

    /// @notice Borrows against a standing lend offer (taker side).
    /// @dev Pledges `streamId` as collateral, receives `borrowAmount` underlying (net of
    ///      the global `feeBps`), and opens a loan owed to the offer's lender. The
    ///      obligation is computed via `StreamPricing.obligationForFill`. The stream is
    ///      escrowed by the book. Reverts if `borrowAmount` exceeds the discounted price
    ///      or remaining capacity, or if the net slips below `minNetOut`.
    /// @param offerId The lend offer to borrow against.
    /// @param streamId The Sablier stream to pledge.
    /// @param borrowAmount Principal to advance.
    /// @param minNetOut Minimum underlying the borrower must receive (slippage).
    /// @return loanId The new loan id.
    function borrowAgainstOffer(uint256 offerId, uint256 streamId, uint128 borrowAmount, uint256 minNetOut)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        require(borrowAmount > 0, "OVRFLOBook: borrow zero");
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "OVRFLOBook: lend offer inactive");
        require(msg.sender != offer.lender, "OVRFLOBook: self-match");

        StreamPricing.Eligibility memory eligibility = _requireEligible(offer.market, streamId);
        uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);
        uint256 grossPrice = StreamPricing.grossPrice(eligibility.remaining, offer.aprBps, timeToMaturity);
        require(grossPrice > 0, "OVRFLOBook: price zero");
        require(borrowAmount <= grossPrice, "OVRFLOBook: borrow above price");
        require(borrowAmount <= offer.capacity, "OVRFLOBook: insufficient capacity");

        uint256 feeAmount = StreamPricing.fee(borrowAmount, feeBps);
        uint256 netToBorrower = borrowAmount - feeAmount;
        require(netToBorrower >= minNetOut, "OVRFLOBook: slippage");
        uint128 obligation = StreamPricing.obligationForFill(
            borrowAmount, grossPrice, eligibility.remaining, offer.aprBps, timeToMaturity
        );

        offer.capacity -= borrowAmount;
        if (offer.capacity == 0) {
            offer.active = false;
        }

        loanId = _storeLoan(msg.sender, offer.lender, streamId, obligation);

        sablier.transferFrom(msg.sender, address(this), streamId);
        _payUnderlying(msg.sender, netToBorrower);
        _payUnderlying(treasury, feeAmount);

        emit BorrowedAgainstOffer(
            offerId, loanId, streamId, msg.sender, offer.lender, borrowAmount, obligation, feeAmount, netToBorrower
        );
    }

    /*//////////////////////////////////////////////////////////////
                            BORROW LISTINGS
    //////////////////////////////////////////////////////////////*/

    /// @notice Posts a borrow listing: pledge `streamId` to borrow `borrowAmount`.
    /// @dev Escrows the stream and validates eligibility now. Snapshots `feeBps` to
    ///      protect the borrower from later fee changes. Reverts if `borrowAmount`
    ///      exceeds the discounted collateral price.
    /// @param market Pendle market the stream belongs to.
    /// @param streamId The Sablier stream to pledge.
    /// @param aprBps Rate used to price collateral and accrue obligation.
    /// @param borrowAmount Principal the borrower wants advanced.
    /// @return listingId The new borrow listing id.
    function postBorrowListing(address market, uint256 streamId, uint16 aprBps, uint128 borrowAmount)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        _validateApr(aprBps);
        require(borrowAmount > 0, "OVRFLOBook: borrow zero");

        StreamPricing.Eligibility memory eligibility = _requireEligible(market, streamId);
        uint256 grossPrice =
            StreamPricing.grossPrice(eligibility.remaining, aprBps, _timeToMaturity(eligibility.seriesMaturity));
        require(grossPrice > 0, "OVRFLOBook: price zero");
        require(borrowAmount <= grossPrice, "OVRFLOBook: borrow above price");

        listingId = nextBorrowListingId++;
        borrowListings[listingId] = BorrowListing({
            borrower: msg.sender,
            market: market,
            streamId: streamId,
            aprBps: aprBps,
            borrowAmount: borrowAmount,
            feeBps: feeBps,
            active: true
        });

        sablier.transferFrom(msg.sender, address(this), streamId);

        emit BorrowListingPosted(listingId, msg.sender, market, streamId, aprBps, feeBps, borrowAmount);
    }

    /// @notice Cancels a borrow listing and returns the escrowed stream to the borrower.
    /// @param listingId The listing to cancel.
    function cancelBorrowListing(uint256 listingId) external nonReentrant {
        BorrowListing storage listing = borrowListings[listingId];
        require(listing.active, "OVRFLOBook: borrow listing inactive");
        require(listing.borrower == msg.sender, "OVRFLOBook: not borrower");

        listing.active = false;
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit BorrowListingCancelled(listingId, msg.sender, listing.streamId);
    }

    /// @notice Fills a borrow listing (lender side).
    /// @dev Re-prices the collateral at fill time, computes the obligation via
    ///      `StreamPricing.obligationForFill`, charges the listing's snapshotted
    ///      `feeBps`, advances `borrowAmount` underlying (net of fee) to the borrower,
    ///      and opens a loan owed to the caller. Reverts if the obligation slips below
    ///      `minObligationOut`.
    /// @param listingId The borrow listing to fill.
    /// @param minObligationOut Minimum obligation the lender will accept (slippage).
    /// @return loanId The new loan id.
    function lendAgainstListing(uint256 listingId, uint128 minObligationOut)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        BorrowListing storage listing = borrowListings[listingId];
        require(listing.active, "OVRFLOBook: borrow listing inactive");
        require(msg.sender != listing.borrower, "OVRFLOBook: self-match");

        StreamPricing.Eligibility memory eligibility = _requireEligible(listing.market, listing.streamId);
        uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);
        uint256 grossPrice = StreamPricing.grossPrice(eligibility.remaining, listing.aprBps, timeToMaturity);
        require(grossPrice > 0, "OVRFLOBook: price zero");
        require(listing.borrowAmount <= grossPrice, "OVRFLOBook: borrow above price");

        uint128 obligation = StreamPricing.obligationForFill(
            listing.borrowAmount, grossPrice, eligibility.remaining, listing.aprBps, timeToMaturity
        );
        require(obligation >= minObligationOut, "OVRFLOBook: slippage");
        uint256 feeAmount = StreamPricing.fee(listing.borrowAmount, listing.feeBps);
        uint256 netToBorrower = uint256(listing.borrowAmount) - feeAmount;

        listing.active = false;
        loanId = _storeLoan(listing.borrower, msg.sender, listing.streamId, obligation);

        _pullExact(IERC20(underlying), msg.sender, address(this), listing.borrowAmount);
        _payUnderlying(listing.borrower, netToBorrower);
        _payUnderlying(treasury, feeAmount);

        emit LentAgainstListing(
            listingId,
            loanId,
            listing.streamId,
            listing.borrower,
            msg.sender,
            listing.borrowAmount,
            obligation,
            feeAmount,
            netToBorrower
        );
    }

    /*//////////////////////////////////////////////////////////////
                              LOAN SERVICING
    //////////////////////////////////////////////////////////////*/

    /// @notice Lender draws accrued ovrfloToken from a loan's pledged stream.
    /// @dev Draw is capped at the smaller of the stream's withdrawable amount and the
    ///      loan's current outstanding, so the lender can never over-claim past the
    ///      obligation. Increases `drawn` and emits the cumulative draw.
    /// @param loanId The loan to claim against.
    function claimLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        require(loanPoolId[loanId] == 0, "OVRFLOBook: use poolClaimLoan");
        require(!loan.closed, "OVRFLOBook: loan closed");
        require(loan.lender == msg.sender, "OVRFLOBook: not lender");

        uint128 amount = _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan));
        require(amount > 0, "OVRFLOBook: nothing claimable");

        loan.drawn += amount;
        sablier.withdraw(loan.streamId, loan.lender, amount);

        emit LoanClaimed(loanId, loan.lender, amount, loan.drawn);
    }

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
        if (outstanding > 0) {
            loan.drawn += outstanding;
            uint256 poolId = loanPoolId[loanId];
            if (poolId != 0) {
                sablier.withdraw(loan.streamId, address(this), outstanding);
                poolProceeds[poolId] += outstanding;
            } else {
                sablier.withdraw(loan.streamId, loan.lender, outstanding);
            }
        }
        sablier.transferFrom(address(this), loan.borrower, loan.streamId);

        emit LoanClosed(loanId, loan.borrower, loan.lender, outstanding);
    }

    /// @notice Borrower repays ovrfloToken toward a loan to reduce or clear the obligation.
    /// @dev Repayment is in ovrfloToken (the stream's payout asset), sent directly to the
    ///      lender. `amount` is capped at outstanding; when it equals outstanding the loan
    ///      closes and the stream is returned to the borrower. The equality is safe from
    ///      rounding bricks because `outstanding` is always an exact integer wei and
    ///      ovrfloToken has 18-decimal granularity (see
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
        }

        uint256 poolId = loanPoolId[loanId];
        if (poolId != 0) {
            _pullExact(IERC20(ovrfloToken), msg.sender, address(this), amount);
            poolProceeds[poolId] += amount;
        } else {
            _pullExact(IERC20(ovrfloToken), msg.sender, loan.lender, amount);
        }
        if (closes) {
            sablier.transferFrom(address(this), loan.borrower, loan.streamId);
        }

        emit LoanRepaid(loanId, msg.sender, loan.lender, amount, closes);
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
        uint256 timeToMaturity = _timeToMaturity(eligibility.seriesMaturity);

        grossPrice = StreamPricing.grossPrice(eligibility.remaining, aprBps, timeToMaturity);
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

    /// @notice Returns the state of a sale offer.
    /// @param offerId The sale offer id.
    /// @return maker Offer owner.
    /// @return market Pendle market.
    /// @return aprBps Discount rate.
    /// @return capacity Remaining underlying.
    /// @return active Whether the offer is still live.
    function saleOfferState(uint256 offerId)
        external
        view
        returns (address maker, address market, uint16 aprBps, uint128 capacity, bool active)
    {
        SaleOffer storage offer = saleOffers[offerId];
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

    /// @notice Returns the state of a lend offer.
    /// @param offerId The lend offer id.
    /// @return lender Offer owner.
    /// @return market Pendle market.
    /// @return aprBps Accrual rate.
    /// @return capacity Remaining underlying.
    /// @return active Whether the offer is still live.
    function lendOfferState(uint256 offerId)
        external
        view
        returns (address lender, address market, uint16 aprBps, uint128 capacity, bool active)
    {
        LendOffer storage offer = lendOffers[offerId];
        require(offer.lender != address(0), "OVRFLOBook: unknown offer");
        return (offer.lender, offer.market, offer.aprBps, offer.capacity, offer.active);
    }

    /// @notice Returns the state of a borrow listing.
    /// @param listingId The borrow listing id.
    /// @return borrower Listing owner.
    /// @return market Pendle market.
    /// @return streamId The pledged Sablier stream.
    /// @return aprBps Accrual rate.
    /// @return borrowAmount Requested principal.
    /// @return listingFeeBps Snapshotted fee at post time.
    /// @return active Whether the listing is still live.
    function borrowListingState(uint256 listingId)
        external
        view
        returns (
            address borrower,
            address market,
            uint256 streamId,
            uint16 aprBps,
            uint128 borrowAmount,
            uint16 listingFeeBps,
            bool active
        )
    {
        BorrowListing storage listing = borrowListings[listingId];
        require(listing.borrower != address(0), "OVRFLOBook: unknown listing");
        return (
            listing.borrower,
            listing.market,
            listing.streamId,
            listing.aprBps,
            listing.borrowAmount,
            listing.feeBps,
            listing.active
        );
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

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

    /// @dev Total ovrfloToken already applied to the obligation (stream draws + repayments).
    function _satisfied(Loan storage loan) internal view returns (uint256) {
        return uint256(loan.drawn) + loan.repaid;
    }

    /// @dev Remaining ovrfloToken owed: `obligation - (drawn + repaid)`.
    function _outstanding(Loan storage loan) internal view returns (uint128) {
        return uint128(uint256(loan.obligation) - _satisfied(loan));
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
