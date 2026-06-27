// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";

contract BookInvMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BookInvMockFactory {
    struct Info {
        address treasury;
        address underlying;
        address ovrfloToken;
    }

    mapping(address => Info) internal infos;
    mapping(address => mapping(address => bool)) public isMarketApproved;

    function setInfo(address core, address treasury, address underlying, address ovrfloToken) external {
        infos[core] = Info({treasury: treasury, underlying: underlying, ovrfloToken: ovrfloToken});
    }

    function setMarketApproved(address core, address market, bool approved) external {
        isMarketApproved[core][market] = approved;
    }

    function ovrfloInfo(address core)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken)
    {
        Info memory info = infos[core];
        return (info.treasury, info.underlying, info.ovrfloToken);
    }
}

contract BookInvMockCore {
    struct Series {
        bool approved;
        uint32 twapDurationFixed;
        uint16 feeBps;
        uint256 expiryCached;
        address ptToken;
        address ovrfloToken;
        address underlying;
        address oracle;
    }

    mapping(address => Series) internal seriesInfo;

    function setSeries(address market, bool approved, uint256 expiryCached, address ovrfloToken, address underlying)
        external
    {
        seriesInfo[market] = Series({
            approved: approved,
            twapDurationFixed: 30 minutes,
            feeBps: 0,
            expiryCached: expiryCached,
            ptToken: address(0xAAAA),
            ovrfloToken: ovrfloToken,
            underlying: underlying,
            oracle: address(0xBBBB)
        });
    }

    function series(address market)
        external
        view
        returns (
            bool approved,
            uint32 twapDurationFixed,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address ovrfloToken,
            address underlying,
            address oracle
        )
    {
        Series memory info = seriesInfo[market];
        return (
            info.approved,
            info.twapDurationFixed,
            info.feeBps,
            info.expiryCached,
            info.ptToken,
            info.ovrfloToken,
            info.underlying,
            info.oracle
        );
    }
}

contract BookInvMockSablier {
    struct Stream {
        address sender;
        IERC20 asset;
        uint40 startTime;
        uint40 endTime;
        uint40 cliffTime;
        bool cancelable;
        uint128 deposited;
        uint128 withdrawn;
        uint128 withdrawable;
    }

    mapping(uint256 => Stream) internal streams;
    mapping(uint256 => address) internal owners;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function setStream(
        uint256 streamId,
        address owner,
        address sender,
        IERC20 asset,
        uint40 endTime,
        uint40 cliffTime,
        bool cancelable,
        uint128 deposited,
        uint128 withdrawn
    ) external {
        uint40 startTime = uint40(block.timestamp);
        if (cliffTime == 0) cliffTime = startTime;
        owners[streamId] = owner;
        streams[streamId] = Stream({
            sender: sender,
            asset: asset,
            startTime: startTime,
            endTime: endTime,
            cliffTime: cliffTime,
            cancelable: cancelable,
            deposited: deposited,
            withdrawn: withdrawn,
            withdrawable: 0
        });
    }

    function setWithdrawable(uint256 streamId, uint128 withdrawable) external {
        streams[streamId].withdrawable = withdrawable;
    }

    function approve(address to, uint256 streamId) external {
        require(owners[streamId] == msg.sender, "not owner");
        getApproved[streamId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 streamId) external {
        address owner = owners[streamId];
        require(owner == from, "wrong from");
        require(
            msg.sender == from || getApproved[streamId] == msg.sender || isApprovedForAll[from][msg.sender],
            "not approved"
        );
        require(to != address(0), "zero to");
        owners[streamId] = to;
        delete getApproved[streamId];
    }

    function ownerOf(uint256 streamId) external view returns (address) {
        return owners[streamId];
    }

    function getSender(uint256 streamId) external view returns (address) {
        return streams[streamId].sender;
    }

    function getAsset(uint256 streamId) external view returns (IERC20) {
        return streams[streamId].asset;
    }

    function getEndTime(uint256 streamId) external view returns (uint40) {
        return streams[streamId].endTime;
    }

    function getStartTime(uint256 streamId) external view returns (uint40) {
        return streams[streamId].startTime;
    }

    function getCliffTime(uint256 streamId) external view returns (uint40) {
        return streams[streamId].cliffTime;
    }

    function isCancelable(uint256 streamId) external view returns (bool) {
        return streams[streamId].cancelable;
    }

    function getDepositedAmount(uint256 streamId) external view returns (uint128) {
        return streams[streamId].deposited;
    }

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128) {
        return streams[streamId].withdrawn;
    }

    function withdrawableAmountOf(uint256 streamId) external view returns (uint128) {
        Stream memory stream = streams[streamId];
        uint128 remaining = stream.deposited - stream.withdrawn;
        return stream.withdrawable < remaining ? stream.withdrawable : remaining;
    }

    function withdraw(uint256 streamId, address to, uint128 amount) external {
        require(amount > 0, "amount zero");
        uint128 withdrawable = this.withdrawableAmountOf(streamId);
        require(amount <= withdrawable, "amount too high");
        streams[streamId].withdrawn += amount;
        streams[streamId].withdrawable = withdrawable - amount;
        BookInvMockERC20(address(streams[streamId].asset)).mint(to, amount);
    }
}

/// @notice Handler that randomly calls Book operations to test loan/offer invariants.
contract OVRFLOBookInvariantHandler is Test {
    OVRFLOBook internal book;
    BookInvMockSablier internal sablier;
    BookInvMockERC20 internal underlying;
    BookInvMockERC20 internal ovrfloToken;
    BookInvMockFactory internal factory;
    BookInvMockCore internal core;

    address internal constant MARKET = address(0x5555);
    uint256 internal expiry;
    uint16 internal constant APR = 1000;

    address[3] internal actors;
    uint256 internal nextStreamId = 10_000;

    // Ghost state for R9: track escrowed offer capacity
    uint256 public totalActiveSaleOfferCapacity;
    uint256 public totalActiveLendOfferCapacity;

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
        BookInvMockSablier sablier_,
        BookInvMockERC20 underlying_,
        BookInvMockERC20 ovrfloToken_,
        BookInvMockFactory factory_,
        BookInvMockCore core_,
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
                        SALE OFFERS
    //////////////////////////////////////////////////////////////*/

    function postSaleOffer(uint256 actorSeed, uint256 capSeed) public {
        address actor = _actor(actorSeed);
        uint128 capacity = uint128(bound(capSeed, 1, 50 ether));

        vm.prank(actor);
        uint256 offerId = book.postSaleOffer(MARKET, APR, capacity);

        totalActiveSaleOfferCapacity += capacity;
    }

    function cancelSaleOffer(uint256 offerIdSeed) public {
        uint256 offerId = bound(offerIdSeed, 1, book.nextSaleOfferId() - 1);
        (address maker,,, uint128 capacity, bool active) = book.saleOffers(offerId);
        if (!active) return;

        vm.prank(maker);
        book.cancelSaleOffer(offerId);

        totalActiveSaleOfferCapacity -= capacity;
    }

    function sellIntoOffer(uint256 offerIdSeed) public {
        if (book.nextSaleOfferId() == 1) return;
        uint256 offerId = bound(offerIdSeed, 1, book.nextSaleOfferId() - 1);
        (, address market, uint16 aprBps, uint128 capacity, bool active) = book.saleOffers(offerId);
        if (!active || capacity == 0) return;

        address actor = _actor(offerIdSeed);
        uint256 streamId = _createStream(actor);

        (uint256 grossPrice,,,,) = book.quote(market, streamId, aprBps, 0);
        if (grossPrice == 0 || grossPrice > capacity) return;

        vm.prank(actor);
        book.sellIntoOffer(offerId, streamId, 0);

        totalActiveSaleOfferCapacity -= grossPrice;
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
        (address maker,,,,, bool active) = book.saleListings(listingId);
        if (!active) return;

        address buyer = _actor(actorSeed);
        vm.prank(buyer);
        try book.buyListing(listingId, type(uint256).max) {} catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        LEND OFFERS
    //////////////////////////////////////////////////////////////*/

    function postLendOffer(uint256 actorSeed, uint256 capSeed) public {
        address actor = _actor(actorSeed);
        uint128 capacity = uint128(bound(capSeed, 1, 50 ether));

        vm.prank(actor);
        book.postLendOffer(MARKET, APR, capacity);

        totalActiveLendOfferCapacity += capacity;
    }

    function cancelLendOffer(uint256 offerIdSeed) public {
        if (book.nextLendOfferId() == 1) return;
        uint256 offerId = bound(offerIdSeed, 1, book.nextLendOfferId() - 1);
        (address lender,,, uint128 capacity, bool active) = book.lendOffers(offerId);
        if (!active) return;

        vm.prank(lender);
        book.cancelLendOffer(offerId);

        totalActiveLendOfferCapacity -= capacity;
    }

    function borrowAgainstOffer(uint256 offerIdSeed, uint256 borrowSeed) public {
        if (book.nextLendOfferId() == 1) return;
        uint256 offerId = bound(offerIdSeed, 1, book.nextLendOfferId() - 1);
        (, address market, uint16 aprBps, uint128 capacity, bool active) = book.lendOffers(offerId);
        if (!active || capacity == 0) return;

        address borrower = _actor(offerIdSeed);
        uint256 streamId = _createStream(borrower);

        (uint256 grossPrice,,,,) = book.quote(market, streamId, aprBps, 0);
        if (grossPrice == 0) return;

        uint128 borrowAmount = uint128(bound(borrowSeed, 1, _min(grossPrice, capacity)));
        if (borrowAmount > grossPrice || borrowAmount > capacity) return;

        vm.prank(borrower);
        try book.borrowAgainstOffer(offerId, streamId, borrowAmount, 0) returns (uint256 loanId) {
            totalActiveLendOfferCapacity -= borrowAmount;
            _trackNewLoan(loanId, borrower, market, streamId, aprBps, grossPrice);
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        BORROW LISTINGS
    //////////////////////////////////////////////////////////////*/

    function postBorrowListing(uint256 actorSeed, uint256 borrowSeed) public {
        address borrower = _actor(actorSeed);
        uint256 streamId = _createStream(borrower);
        uint128 borrowAmount = uint128(bound(borrowSeed, 1, 50 ether));

        vm.prank(borrower);
        try book.postBorrowListing(MARKET, streamId, APR, borrowAmount) {} catch {}
    }

    function cancelBorrowListing(uint256 listingIdSeed) public {
        if (book.nextBorrowListingId() == 1) return;
        uint256 listingId = bound(listingIdSeed, 1, book.nextBorrowListingId() - 1);
        (address borrower,,,,,, bool active) = book.borrowListings(listingId);
        if (!active) return;

        vm.prank(borrower);
        book.cancelBorrowListing(listingId);
    }

    function lendAgainstListing(uint256 listingIdSeed, uint256 actorSeed) public {
        if (book.nextBorrowListingId() == 1) return;
        uint256 listingId = bound(listingIdSeed, 1, book.nextBorrowListingId() - 1);
        (address borrower,,,,,, bool active) = book.borrowListings(listingId);
        if (!active) return;

        address lender = _actor(actorSeed);
        vm.prank(lender);
        try book.lendAgainstListing(listingId, 0) returns (uint256 loanId) {
            (, address market, uint256 streamId, uint16 aprBps, uint128 borrowAmount,,) = book.borrowListings(listingId);
            (uint256 grossPrice,,,,) = book.quote(market, streamId, aprBps, 0);
            _trackNewLoanFromListing(loanId, borrower, lender, streamId, borrowAmount, grossPrice);
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        LOAN SERVICING
    //////////////////////////////////////////////////////////////*/

    function claimLoan(uint256 loanIdSeed) public {
        if (book.nextLoanId() == 1) return;
        uint256 loanId = bound(loanIdSeed, 1, book.nextLoanId() - 1);
        (
            address borrower,
            address lender,
            uint256 streamId,
            uint128 obligation,
            uint128 drawn,
            uint128 repaid,
            bool closed
        ) = book.loans(loanId);
        if (borrower == address(0) || closed) return;

        // Set withdrawable so claim can succeed
        uint128 outstanding = obligation - drawn - repaid;
        if (outstanding == 0) return;
        sablier.setWithdrawable(streamId, outstanding);

        vm.prank(lender);
        try book.claimLoan(loanId) {
            // Read updated drawn
            (,,, uint128 obligation2, uint128 drawn2, uint128 repaid2,) = book.loans(loanId);
            uint128 claimed = drawn2 - drawn;
            loanGhosts[loanId].lenderReceived += claimed;
        } catch {}
    }

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
            (,,, uint128 obligation2, uint128 drawn2, uint128 repaid2, bool closed2) = book.loans(loanId);
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
            address lender,
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

    function _createStream(address owner) internal returns (uint256 streamId) {
        streamId = nextStreamId++;
        sablier.setStream(
            streamId, owner, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, 100 ether, 0
        );
    }

    function _trackNewLoan(
        uint256 loanId,
        address borrower,
        address market,
        uint256 streamId,
        uint16 aprBps,
        uint256 grossPrice
    ) internal {
        (,,, uint128 obligation,,,) = book.loans(loanId);
        (uint128 deposited, uint128 withdrawn) =
            (sablier.getDepositedAmount(streamId), sablier.getWithdrawnAmount(streamId));
        loanGhosts[loanId] = LoanGhost({
            obligation: obligation,
            remainingAtOrigination: deposited - withdrawn,
            lenderReceived: 0,
            borrower: borrower,
            lender: address(0), // set from loan state
            streamId: streamId,
            closed: false
        });
        // Read lender from loan
        (, address lender,,,,,) = book.loans(loanId);
        loanGhosts[loanId].lender = lender;
    }

    function _trackNewLoanFromListing(
        uint256 loanId,
        address borrower,
        address lender,
        uint256 streamId,
        uint128 borrowAmount,
        uint256 grossPrice
    ) internal {
        (,,, uint128 obligation,,,) = book.loans(loanId);
        (uint128 deposited, uint128 withdrawn) =
            (sablier.getDepositedAmount(streamId), sablier.getWithdrawnAmount(streamId));
        loanGhosts[loanId] = LoanGhost({
            obligation: obligation,
            remainingAtOrigination: deposited - withdrawn,
            lenderReceived: 0,
            borrower: borrower,
            lender: lender,
            streamId: streamId,
            closed: false
        });
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

    BookInvMockFactory internal factory;
    BookInvMockCore internal core;
    BookInvMockSablier internal sablier;
    BookInvMockERC20 internal underlying;
    BookInvMockERC20 internal ovrfloToken;
    OVRFLOBook internal book;
    uint256 internal expiry;

    OVRFLOBookInvariantHandler internal handler;

    function setUp() public {
        factory = new BookInvMockFactory();
        core = new BookInvMockCore();
        sablier = new BookInvMockSablier();
        underlying = new BookInvMockERC20("Underlying", "UND");
        ovrfloToken = new BookInvMockERC20("OVRFLO", "ovrfloUND");
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

    /// @notice R9: book underlying balance == escrowed offer capacity
    function invariant_BookBalanceEqualsEscrowedCapacity() public view {
        uint256 expected = handler.totalActiveSaleOfferCapacity() + handler.totalActiveLendOfferCapacity();
        assertEq(underlying.balanceOf(address(book)), expected, "book balance != escrowed offer capacity");
    }
}
