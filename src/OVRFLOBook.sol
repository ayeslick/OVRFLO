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
contract OVRFLOBook is Ownable2Step, ReentrancyGuard, Multicall {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint16 public constant LAUNCH_APR_BPS = 1000;

    /*//////////////////////////////////////////////////////////////
                                IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    IOVRFLOFactoryRegistry public immutable factory;
    address public immutable core;
    address public immutable ovrfloToken;
    address public immutable underlying;
    ISablierV2LockupLinear public immutable sablier;
    uint16 public immutable APR_MAX_CEILING;
    uint16 public immutable MAX_FEE_BPS;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    uint16 public aprMinBps;
    uint16 public aprMaxBps;
    uint16 public feeBps;
    address public treasury;

    uint256 public nextSaleOfferId = 1;
    uint256 public nextSaleListingId = 1;
    uint256 public nextLendOfferId = 1;
    uint256 public nextBorrowListingId = 1;
    uint256 public nextLoanId = 1;

    struct SaleOffer {
        address maker;
        address market;
        uint16 aprBps;
        uint128 capacity;
        bool active;
    }

    struct SaleListing {
        address maker;
        address market;
        uint256 streamId;
        uint16 aprBps;
        uint16 feeBps;
        bool active;
    }

    struct LendOffer {
        address lender;
        address market;
        uint16 aprBps;
        uint128 capacity;
        bool active;
    }

    struct BorrowListing {
        address borrower;
        address market;
        uint256 streamId;
        uint16 aprBps;
        uint128 borrowAmount;
        uint16 feeBps;
        bool active;
    }

    struct Loan {
        address borrower;
        address lender;
        uint256 streamId;
        uint128 obligation;
        uint128 drawn;
        uint128 repaid;
        bool closed;
    }

    mapping(uint256 => SaleOffer) public saleOffers;
    mapping(uint256 => SaleListing) public saleListings;
    mapping(uint256 => LendOffer) public lendOffers;
    mapping(uint256 => BorrowListing) public borrowListings;
    mapping(uint256 => Loan) public loans;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event AprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    event FeeSet(uint16 feeBps);
    event TreasurySet(address indexed treasury);
    event SaleOfferPosted(
        uint256 indexed offerId, address indexed maker, address indexed market, uint16 aprBps, uint128 capacity
    );
    event SaleOfferCancelled(uint256 indexed offerId, address indexed maker, uint128 refunded);
    event SaleOfferHit(
        uint256 indexed offerId,
        uint256 indexed streamId,
        address indexed seller,
        address buyer,
        uint256 grossPrice,
        uint256 fee,
        uint256 netToSeller
    );
    event SaleListingPosted(
        uint256 indexed listingId,
        address indexed maker,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps
    );
    event SaleListingCancelled(uint256 indexed listingId, address indexed maker, uint256 streamId);
    event SaleListingTaken(
        uint256 indexed listingId,
        uint256 indexed streamId,
        address indexed buyer,
        address seller,
        uint256 grossPrice,
        uint256 fee,
        uint256 netToSeller
    );
    event LendOfferPosted(
        uint256 indexed offerId, address indexed lender, address indexed market, uint16 aprBps, uint128 capacity
    );
    event LendOfferCancelled(uint256 indexed offerId, address indexed lender, uint128 refunded);
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
    event BorrowListingPosted(
        uint256 indexed listingId,
        address indexed borrower,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps,
        uint128 borrowAmount
    );
    event BorrowListingCancelled(uint256 indexed listingId, address indexed borrower, uint256 streamId);
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
    event LoanClaimed(uint256 indexed loanId, address indexed lender, uint128 amount, uint128 drawn);
    event LoanClosed(uint256 indexed loanId, address indexed borrower, address indexed lender, uint128 finalDraw);
    event LoanRepaid(
        uint256 indexed loanId, address indexed borrower, address indexed lender, uint128 amount, bool closed
    );

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address factory_, address core_, address sablier_, uint16 aprMaxCeiling_, uint16 maxFeeBps_) {
        require(factory_ != address(0), "OVRFLOBook: factory zero");
        require(core_ != address(0), "OVRFLOBook: core zero");
        require(sablier_ != address(0), "OVRFLOBook: sablier zero");
        require(aprMaxCeiling_ >= LAUNCH_APR_BPS, "OVRFLOBook: apr ceiling below launch");

        (address treasury_, address underlying_, address ovrfloToken_) =
            IOVRFLOFactoryRegistry(factory_).ovrfloInfo(core_);
        require(treasury_ != address(0), "OVRFLOBook: unknown core");
        require(underlying_ != address(0), "OVRFLOBook: underlying zero");
        require(ovrfloToken_ != address(0), "OVRFLOBook: token zero");

        factory = IOVRFLOFactoryRegistry(factory_);
        core = core_;
        sablier = ISablierV2LockupLinear(sablier_);
        APR_MAX_CEILING = aprMaxCeiling_;
        MAX_FEE_BPS = maxFeeBps_;
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        aprMinBps = LAUNCH_APR_BPS;
        aprMaxBps = LAUNCH_APR_BPS;
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner nonReentrant {
        require(aprMaxBps_ >= aprMinBps_, "OVRFLOBook: bad apr bounds");
        require(aprMaxBps_ <= APR_MAX_CEILING, "OVRFLOBook: apr too high");

        aprMinBps = aprMinBps_;
        aprMaxBps = aprMaxBps_;

        emit AprBoundsSet(aprMinBps_, aprMaxBps_);
    }

    function setFee(uint16 feeBps_) external onlyOwner nonReentrant {
        require(feeBps_ <= MAX_FEE_BPS, "OVRFLOBook: fee too high");

        feeBps = feeBps_;

        emit FeeSet(feeBps_);
    }

    function setTreasury(address treasury_) external onlyOwner nonReentrant {
        require(treasury_ != address(0), "OVRFLOBook: treasury zero");

        treasury = treasury_;

        emit TreasurySet(treasury_);
    }

    /*//////////////////////////////////////////////////////////////
                              SALE OFFERS
    //////////////////////////////////////////////////////////////*/

    function postOffer(address market, uint16 aprBps, uint128 capacity)
        external
        nonReentrant
        returns (uint256 offerId)
    {
        _validateApr(aprBps);
        require(capacity > 0, "OVRFLOBook: capacity zero");

        offerId = nextSaleOfferId++;
        saleOffers[offerId] =
            SaleOffer({maker: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

        _pullExact(IERC20(underlying), msg.sender, address(this), capacity);

        emit SaleOfferPosted(offerId, msg.sender, market, aprBps, capacity);
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        SaleOffer storage offer = saleOffers[offerId];
        require(offer.active, "OVRFLOBook: offer inactive");
        require(offer.maker == msg.sender, "OVRFLOBook: not offer maker");

        uint128 refund = offer.capacity;
        offer.capacity = 0;
        offer.active = false;

        _payUnderlying(msg.sender, refund);

        emit SaleOfferCancelled(offerId, msg.sender, refund);
    }

    function hitOffer(uint256 offerId, uint256 streamId, uint256 minNetOut) external nonReentrant {
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

    function listStream(address market, uint256 streamId, uint16 aprBps)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        _validateApr(aprBps);
        _requireEligible(market, streamId);

        listingId = nextSaleListingId++;
        sablier.transferFrom(msg.sender, address(this), streamId);

        saleListings[listingId] =
            SaleListing({
                maker: msg.sender,
                market: market,
                streamId: streamId,
                aprBps: aprBps,
                feeBps: feeBps,
                active: true
            });

        emit SaleListingPosted(listingId, msg.sender, market, streamId, aprBps, feeBps);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        SaleListing storage listing = saleListings[listingId];
        require(listing.active, "OVRFLOBook: listing inactive");
        require(listing.maker == msg.sender, "OVRFLOBook: not listing maker");

        listing.active = false;
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit SaleListingCancelled(listingId, msg.sender, listing.streamId);
    }

    function takeListing(uint256 listingId, uint256 maxPriceIn) external nonReentrant {
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

    function postLendOffer(address market, uint16 aprBps, uint128 capacity)
        external
        nonReentrant
        returns (uint256 offerId)
    {
        _validateApr(aprBps);
        require(capacity > 0, "OVRFLOBook: capacity zero");

        offerId = nextLendOfferId++;
        lendOffers[offerId] =
            LendOffer({lender: msg.sender, market: market, aprBps: aprBps, capacity: capacity, active: true});

        _pullExact(IERC20(underlying), msg.sender, address(this), capacity);

        emit LendOfferPosted(offerId, msg.sender, market, aprBps, capacity);
    }

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

    function borrowAgainstOffer(uint256 offerId, uint256 streamId, uint128 borrowAmount, uint256 minNetOut)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        require(borrowAmount > 0, "OVRFLOBook: borrow zero");
        LendOffer storage offer = lendOffers[offerId];
        require(offer.active, "OVRFLOBook: lend offer inactive");

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
        sablier.transferFrom(msg.sender, address(this), streamId);

        borrowListings[listingId] = BorrowListing({
            borrower: msg.sender,
            market: market,
            streamId: streamId,
            aprBps: aprBps,
            borrowAmount: borrowAmount,
            feeBps: feeBps,
            active: true
        });

        emit BorrowListingPosted(listingId, msg.sender, market, streamId, aprBps, feeBps, borrowAmount);
    }

    function cancelBorrowListing(uint256 listingId) external nonReentrant {
        BorrowListing storage listing = borrowListings[listingId];
        require(listing.active, "OVRFLOBook: borrow listing inactive");
        require(listing.borrower == msg.sender, "OVRFLOBook: not borrower");

        listing.active = false;
        sablier.transferFrom(address(this), msg.sender, listing.streamId);

        emit BorrowListingCancelled(listingId, msg.sender, listing.streamId);
    }

    function lendAgainstListing(uint256 listingId, uint128 minObligationOut)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        BorrowListing storage listing = borrowListings[listingId];
        require(listing.active, "OVRFLOBook: borrow listing inactive");

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

    function claimLoan(uint256 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        _requireLoanExists(loan);
        require(!loan.closed, "OVRFLOBook: loan closed");
        require(loan.lender == msg.sender, "OVRFLOBook: not lender");

        uint128 amount = _minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan));
        require(amount > 0, "OVRFLOBook: nothing claimable");

        loan.drawn += amount;
        sablier.withdraw(loan.streamId, loan.lender, amount);

        emit LoanClaimed(loanId, loan.lender, amount, loan.drawn);
    }

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
            sablier.withdraw(loan.streamId, loan.lender, outstanding);
        }
        sablier.transferFrom(address(this), loan.borrower, loan.streamId);

        emit LoanClosed(loanId, loan.borrower, loan.lender, outstanding);
    }

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

        _pullExact(IERC20(ovrfloToken), msg.sender, loan.lender, amount);
        if (closes) {
            sablier.transferFrom(address(this), loan.borrower, loan.streamId);
        }

        emit LoanRepaid(loanId, msg.sender, loan.lender, amount, closes);
    }

    /*//////////////////////////////////////////////////////////////
                              VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

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

    function saleOfferState(uint256 offerId)
        external
        view
        returns (address maker, address market, uint16 aprBps, uint128 capacity, bool active)
    {
        SaleOffer storage offer = saleOffers[offerId];
        return (offer.maker, offer.market, offer.aprBps, offer.capacity, offer.active);
    }

    function saleListingState(uint256 listingId)
        external
        view
        returns (address maker, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active)
    {
        SaleListing storage listing = saleListings[listingId];
        return (listing.maker, listing.market, listing.streamId, listing.aprBps, listing.feeBps, listing.active);
    }

    function lendOfferState(uint256 offerId)
        external
        view
        returns (address lender, address market, uint16 aprBps, uint128 capacity, bool active)
    {
        LendOffer storage offer = lendOffers[offerId];
        return (offer.lender, offer.market, offer.aprBps, offer.capacity, offer.active);
    }

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

    function _validateApr(uint16 aprBps) internal view {
        require(aprBps >= aprMinBps && aprBps <= aprMaxBps, "OVRFLOBook: apr out of bounds");
    }

    function _requireEligible(address market, uint256 streamId)
        internal
        view
        returns (StreamPricing.Eligibility memory)
    {
        return StreamPricing.requireEligible(address(factory), address(sablier), core, market, streamId);
    }

    function _timeToMaturity(uint256 seriesMaturity) internal view returns (uint256) {
        return seriesMaturity - block.timestamp;
    }

    function _pullExact(IERC20 token, address from, address to, uint256 amount) internal {
        uint256 balanceBefore = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 balanceAfter = token.balanceOf(to);
        require(
            balanceAfter >= balanceBefore && balanceAfter - balanceBefore == amount, "OVRFLOBook: transfer mismatch"
        );
    }

    function _payUnderlying(address to, uint256 amount) internal {
        if (amount > 0) {
            IERC20(underlying).safeTransfer(to, amount);
        }
    }

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

    function _requireLoanExists(Loan storage loan) internal view {
        require(loan.borrower != address(0), "OVRFLOBook: unknown loan");
    }

    function _satisfied(Loan storage loan) internal view returns (uint256) {
        return uint256(loan.drawn) + loan.repaid;
    }

    function _outstanding(Loan storage loan) internal view returns (uint128) {
        return uint128(uint256(loan.obligation) - _satisfied(loan));
    }

    function _minUint128(uint128 a, uint128 b) internal pure returns (uint128) {
        return a < b ? a : b;
    }

    function _toUint128(uint256 amount) internal pure returns (uint128) {
        require(amount <= type(uint128).max, "OVRFLOBook: uint128 overflow");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(amount);
    }
}
