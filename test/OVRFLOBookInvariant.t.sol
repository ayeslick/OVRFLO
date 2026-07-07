// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockBookFactory, MockBookCore, MockBookSablier} from "./mocks/BookMocks.sol";

/// @notice Handler that randomly calls Book operations to test loan/offer invariants.
contract OVRFLOBookInvariantHandler is Test {
    OVRFLOBook internal book;
    MockBookSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    MockBookFactory internal factory;
    MockBookCore internal core;

    address internal constant MARKET = address(0x5555);
    uint256 internal expiry;
    uint16 internal constant APR = 1000;

    address[3] internal actors;
    uint256 internal nextStreamId = 10_000;

    // Ghost state: track escrowed offer capacity (unified offers)
    uint256 public totalActiveOfferCapacity;

    // Ghost state for R6/R7/R8: per-loan tracking
    struct LoanGhost {
        uint128 obligation;
        uint128 remainingAtOrigination;
        uint128 lenderReceived;
        address borrower;
        address lender;
        uint256 streamId;
        bool closed;
    }
    mapping(uint256 => LoanGhost) public loanGhosts;

    constructor(
        OVRFLOBook book_,
        MockBookSablier sablier_,
        TestERC20 underlying_,
        TestERC20 ovrfloToken_,
        MockBookFactory factory_,
        MockBookCore core_,
        uint256 expiry_
    ) {
        book = book_;
        sablier = sablier_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        factory = factory_;
        core = core_;
        expiry = expiry_;

        actors = [makeAddr("bookActorA"), makeAddr("bookActorB"), makeAddr("bookActorC")];

        for (uint256 i = 0; i < 3; i++) {
            underlying.mint(actors[i], 10_000 ether);
            ovrfloToken.mint(actors[i], 10_000 ether);
            vm.startPrank(actors[i]);
            underlying.approve(address(book), type(uint256).max);
            ovrfloToken.approve(address(book), type(uint256).max);
            sablier.setApprovalForAll(address(book), true);
            vm.stopPrank();
        }
    }

    /*//////////////////////////////////////////////////////////////
                            OFFERS
    //////////////////////////////////////////////////////////////*/

    function postOffer(uint256 actorSeed, uint256 capSeed) public {
        address actor = _actor(actorSeed);
        uint128 capacity = uint128(bound(capSeed, 1, 50 ether));

        vm.prank(actor);
        book.postOffer(MARKET, APR, capacity);

        totalActiveOfferCapacity += capacity;
    }

    function cancelOffer(uint256 offerIdSeed) public {
        if (book.nextOfferId() == 1) return;
        uint256 offerId = bound(offerIdSeed, 1, book.nextOfferId() - 1);
        (address maker,,, uint128 capacity, bool active) = book.offers(offerId);
        if (!active) return;

        vm.prank(maker);
        book.cancelOffer(offerId);

        totalActiveOfferCapacity -= capacity;
    }

    function sellIntoOffer(uint256 offerIdSeed) public {
        if (book.nextOfferId() == 1) return;
        uint256 offerId = bound(offerIdSeed, 1, book.nextOfferId() - 1);
        (, address market, uint16 aprBps, uint128 capacity, bool active) = book.offers(offerId);
        if (!active || capacity == 0) return;

        address actor = _actor(offerIdSeed);
        uint256 streamId = _createStream(actor);

        (uint256 grossPrice,,,,) = book.quote(market, streamId, aprBps, 0);
        if (grossPrice == 0 || grossPrice > capacity) return;

        vm.prank(actor);
        book.sellIntoOffer(offerId, streamId, 0);

        totalActiveOfferCapacity -= grossPrice;
    }

    /*//////////////////////////////////////////////////////////////
                        SALE LISTINGS
    //////////////////////////////////////////////////////////////*/

    function postSaleListing(uint256 actorSeed) public {
        address actor = _actor(actorSeed);
        uint256 streamId = _createStream(actor);

        vm.prank(actor);
        book.postSaleListing(MARKET, streamId, APR);
    }

    function cancelSaleListing(uint256 listingIdSeed) public {
        if (book.nextSaleListingId() == 1) return;
        uint256 listingId = bound(listingIdSeed, 1, book.nextSaleListingId() - 1);
        (address maker,,,,, bool active) = book.saleListings(listingId);
        if (!active) return;

        vm.prank(maker);
        book.cancelSaleListing(listingId);
    }

    function buyListing(uint256 listingIdSeed, uint256 actorSeed) public {
        if (book.nextSaleListingId() == 1) return;
        uint256 listingId = bound(listingIdSeed, 1, book.nextSaleListingId() - 1);
        (,,,,, bool active) = book.saleListings(listingId);
        if (!active) return;

        address buyer = _actor(actorSeed);
        vm.prank(buyer);
        try book.buyListing(listingId, type(uint256).max) {} catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        BORROW POOLS
    //////////////////////////////////////////////////////////////*/

    /// @dev R13: posts offers from a non-borrower actor, pledges an eligible stream,
    ///      and borrows against a subset. A different actor posts the offers than the
    ///      one calling `createBorrowPool` to avoid the self-match guard (pattern #4).
    ///      Offer IDs are strictly increasing by construction (pattern #11). Ghost
    ///      variables track escrowed offer capacity and total pool obligations.
    function createBorrowPool(
        uint256 borrowerSeed,
        uint256 numOffersSeed,
        uint256 capSeed,
        uint256 targetSeed,
        uint256 minSeed
    ) public {
        address borrower = _actor(borrowerSeed);

        uint256[] memory offerIds;
        uint256 totalCapacity;
        {
            address maker = actors[((borrowerSeed % actors.length) + 1) % actors.length];
            uint256 numOffers = bound(numOffersSeed, 1, 3);
            uint128 capacity = uint128(bound(capSeed, 1, 50 ether));
            offerIds = new uint256[](numOffers);
            for (uint256 i = 0; i < numOffers; i++) {
                if (underlying.balanceOf(maker) < capacity) return;
                vm.prank(maker);
                offerIds[i] = book.postOffer(MARKET, APR, capacity);
                totalCapacity += capacity;
                totalActiveOfferCapacity += capacity;
            }
        }

        uint256 streamId = _createStream(borrower);

        uint128 targetBorrow;
        uint128 minAcceptable;
        {
            (uint256 grossPrice,,,,) = book.quote(MARKET, streamId, APR, 0);
            if (grossPrice == 0) return;
            uint256 maxBorrow = _min(totalCapacity, grossPrice);
            if (maxBorrow == 0) return;
            targetBorrow = uint128(bound(targetSeed, 1, maxBorrow));
            minAcceptable = uint128(bound(minSeed, 1, uint256(targetBorrow)));
        }

        vm.prank(borrower);
        try book.createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable) returns (uint256 poolId) {
            (,,, uint128 totalContributed,) = book.pools(poolId);
            totalActiveOfferCapacity -= totalContributed;

            uint256 loanId = book.poolLoanId(poolId);
            (,,, uint128 obligation,,,) = book.loans(loanId);
            _recordLoanGhost(loanId, borrower, streamId, obligation);
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        LOAN SERVICING
    //////////////////////////////////////////////////////////////*/

    function repayLoan(uint256 loanIdSeed, uint256 amountSeed) public {
        if (book.nextLoanId() == 1) return;
        uint256 loanId = bound(loanIdSeed, 1, book.nextLoanId() - 1);
        (address borrower,,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = book.loans(loanId);
        if (borrower == address(0) || closed) return;

        uint128 outstanding = obligation - drawn - repaid;
        if (outstanding == 0) return;

        uint128 amount = uint128(bound(amountSeed, 1, outstanding));

        vm.prank(borrower);
        try book.repayLoan(loanId, amount) {
            (,,,,,, bool closed2) = book.loans(loanId);
            if (closed2) {
                loanGhosts[loanId].closed = true;
            }
        } catch {}
    }

    function closeLoan(uint256 loanIdSeed) public {
        if (book.nextLoanId() == 1) return;
        uint256 loanId = bound(loanIdSeed, 1, book.nextLoanId() - 1);
        (
            address borrower,
            ,
            uint256 streamId,
            uint128 obligation,
            uint128 drawn,
            uint128 repaid,
            bool closed
        ) = book.loans(loanId);
        if (borrower == address(0) || closed) return;

        uint128 outstanding = obligation - drawn - repaid;
        // Set withdrawable so close can succeed
        sablier.setWithdrawable(streamId, outstanding);

        try book.closeLoan(loanId) {
            loanGhosts[loanId].closed = true;
            loanGhosts[loanId].lenderReceived += outstanding;
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/

    function _recordLoanGhost(uint256 loanId, address borrower, uint256 streamId, uint128 obligation) internal {
        LoanGhost storage ghost = loanGhosts[loanId];
        ghost.obligation = obligation;
        ghost.remainingAtOrigination = sablier.getDepositedAmount(streamId) - sablier.getWithdrawnAmount(streamId);
        ghost.lenderReceived = 0;
        ghost.borrower = borrower;
        ghost.lender = address(book);
        ghost.streamId = streamId;
        ghost.closed = false;
    }

    function _createStream(address owner) internal returns (uint256 streamId) {
        streamId = nextStreamId++;
        sablier.setStream(
            streamId, owner, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, 100 ether, 0
        );
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract OVRFLOBookInvariantTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x5555);

    MockBookFactory internal factory;
    MockBookCore internal core;
    MockBookSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    OVRFLOBook internal book;
    uint256 internal expiry;

    OVRFLOBookInvariantHandler internal handler;

    function setUp() public {
        factory = new MockBookFactory();
        core = new MockBookCore();
        sablier = new MockBookSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO", "ovrfloUND");
        expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        factory.setMarketApproved(address(core), MARKET, true);
        core.setSeries(MARKET, true, expiry, address(ovrfloToken), address(underlying));

        book = new OVRFLOBook(address(factory), address(core), address(sablier));

        handler = new OVRFLOBookInvariantHandler(book, sablier, underlying, ovrfloToken, factory, core, expiry);
        targetContract(address(handler));
    }

    /*//////////////////////////////////////////////////////////////
                        INVARIANTS (R6-R9)
    //////////////////////////////////////////////////////////////*/

    /// @notice R6: loan obligation <= stream remaining at origination
    function invariant_ObligationNeverExceedsRemaining() public view {
        uint256 nextLoan = book.nextLoanId();
        for (uint256 i = 1; i < nextLoan; i++) {
            (uint128 obligation, uint128 remainingAtOrigination,,,,,) = handler.loanGhosts(i);
            if (obligation == 0 && remainingAtOrigination == 0) continue;
            assertLe(obligation, remainingAtOrigination, "obligation exceeds remaining at origination");
        }
    }

    /// @notice R7: lender total received <= obligation
    function invariant_LenderReceivedNeverExceedsObligation() public view {
        uint256 nextLoan = book.nextLoanId();
        for (uint256 i = 1; i < nextLoan; i++) {
            (uint128 obligation,, uint128 lenderReceived,,,,) = handler.loanGhosts(i);
            if (obligation == 0) continue;
            assertLe(lenderReceived, obligation, "lender received exceeds obligation");
        }
    }

    /// @notice R8: stream NFT with borrower when loan is closed
    function invariant_NftReturnedToBorrowerOnClose() public view {
        uint256 nextLoan = book.nextLoanId();
        for (uint256 i = 1; i < nextLoan; i++) {
            (,,, address borrower,, uint256 streamId, bool closed) = handler.loanGhosts(i);
            if (!closed) continue;
            assertEq(sablier.ownerOf(streamId), borrower, "NFT not returned to borrower on close");
        }
    }

    /// @notice book underlying balance == escrowed offer capacity
    function invariant_BookBalanceEqualsEscrowedCapacity() public view {
        uint256 expected = handler.totalActiveOfferCapacity();
        assertEq(underlying.balanceOf(address(book)), expected, "book balance != escrowed offer capacity");
    }
}
