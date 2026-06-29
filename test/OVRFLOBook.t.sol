// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";

contract OVRFLOBookMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract OVRFLOBookMockFactory {
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

contract OVRFLOBookMockCore {
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

contract OVRFLOBookMockSablier {
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
        // Mimic real Sablier: cliff duration of 0 → cliffTime = startTime
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
        require(owners[streamId] == msg.sender, "MockSablier: not owner");
        getApproved[streamId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 streamId) external {
        address owner = owners[streamId];
        require(owner == from, "MockSablier: wrong from");
        require(
            msg.sender == from || getApproved[streamId] == msg.sender || isApprovedForAll[from][msg.sender],
            "MockSablier: not approved"
        );
        require(to != address(0), "MockSablier: zero to");

        owners[streamId] = to;
        delete getApproved[streamId];
    }

    function ownerOf(uint256 streamId) external view returns (address owner) {
        return owners[streamId];
    }

    function getSender(uint256 streamId) external view returns (address sender) {
        return streams[streamId].sender;
    }

    function getAsset(uint256 streamId) external view returns (IERC20 asset) {
        return streams[streamId].asset;
    }

    function getEndTime(uint256 streamId) external view returns (uint40 endTime) {
        return streams[streamId].endTime;
    }

    function getStartTime(uint256 streamId) external view returns (uint40 startTime) {
        return streams[streamId].startTime;
    }

    function getCliffTime(uint256 streamId) external view returns (uint40 cliffTime) {
        return streams[streamId].cliffTime;
    }

    function isCancelable(uint256 streamId) external view returns (bool result) {
        return streams[streamId].cancelable;
    }

    function getDepositedAmount(uint256 streamId) external view returns (uint128 depositedAmount) {
        return streams[streamId].deposited;
    }

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128 withdrawnAmount) {
        return streams[streamId].withdrawn;
    }

    function withdrawableAmountOf(uint256 streamId) external view returns (uint128 withdrawableAmount) {
        Stream memory stream = streams[streamId];
        uint128 remaining = stream.deposited - stream.withdrawn;
        return stream.withdrawable < remaining ? stream.withdrawable : remaining;
    }

    function withdraw(uint256 streamId, address to, uint128 amount) external {
        require(amount > 0, "MockSablier: amount zero");
        uint128 withdrawable = this.withdrawableAmountOf(streamId);
        require(amount <= withdrawable, "MockSablier: amount too high");

        streams[streamId].withdrawn += amount;
        streams[streamId].withdrawable = withdrawable - amount;
        OVRFLOBookMockERC20(address(streams[streamId].asset)).mint(to, amount);
    }
}

contract OVRFLOBookTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant NEW_TREASURY = address(0xCAFE);
    address internal constant STRANGER = address(0x3333);
    address internal constant NEW_OWNER = address(0x4444);
    address internal constant MARKET = address(0x5555);
    address internal constant BUYER = address(0xB0B);
    address internal constant SELLER = address(0xA11CE);

    event AprBoundsSet(uint16 aprMinBps, uint16 aprMaxBps);
    event FeeSet(uint16 feeBps);
    event TreasurySet(address indexed treasury);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event SaleListingPosted(
        uint256 indexed listingId,
        address indexed maker,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint16 feeBps
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

    OVRFLOBookMockFactory internal factory;
    OVRFLOBookMockCore internal core;
    OVRFLOBookMockSablier internal sablier;
    OVRFLOBookMockERC20 internal underlying;
    OVRFLOBookMockERC20 internal ovrfloToken;
    OVRFLOBook internal book;
    uint256 internal expiry;

    function setUp() public {
        factory = new OVRFLOBookMockFactory();
        core = new OVRFLOBookMockCore();
        sablier = new OVRFLOBookMockSablier();
        underlying = new OVRFLOBookMockERC20("Underlying", "UND");
        ovrfloToken = new OVRFLOBookMockERC20("OVRFLO Underlying", "ovrfloUND");
        expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        factory.setMarketApproved(address(core), MARKET, true);
        core.setSeries(MARKET, true, expiry, address(ovrfloToken), address(underlying));

        book = new OVRFLOBook(address(factory), address(core), address(sablier));
    }

    function test_Constructor_CachesRegistryInfoAndLaunchSettings() public view {
        assertEq(address(book.factory()), address(factory));
        assertEq(book.core(), address(core));
        assertEq(book.ovrfloToken(), address(ovrfloToken));
        assertEq(book.underlying(), address(underlying));
        assertEq(address(book.sablier()), address(sablier));
        assertEq(book.APR_MAX_CEILING(), 10_000);
        assertEq(book.MAX_FEE_BPS(), 10_000);
        assertEq(book.treasury(), TREASURY);
        assertEq(book.aprMinBps(), book.LAUNCH_APR_BPS());
        assertEq(book.aprMaxBps(), book.LAUNCH_APR_BPS());
        assertEq(book.owner(), address(this));
    }

    function test_Constructor_RevertsForZeroAddressesOrUnregisteredCore() public {
        vm.expectRevert("OVRFLOBook: factory zero");
        new OVRFLOBook(address(0), address(core), address(sablier));

        vm.expectRevert("OVRFLOBook: core zero");
        new OVRFLOBook(address(factory), address(0), address(sablier));

        vm.expectRevert("OVRFLOBook: sablier zero");
        new OVRFLOBook(address(factory), address(core), address(0));

        vm.expectRevert("OVRFLOBook: unknown core");
        new OVRFLOBook(address(factory), address(0xDEAD), address(sablier));
    }

    function test_Admin_SetAprBounds() public {
        vm.expectEmit(address(book));
        emit AprBoundsSet(1000, 1000);
        book.setAprBounds(1000, 1000);

        vm.expectEmit(address(book));
        emit AprBoundsSet(500, 2500);
        book.setAprBounds(500, 2500);

        assertEq(book.aprMinBps(), 500);
        assertEq(book.aprMaxBps(), 2500);

        vm.expectRevert("OVRFLOBook: bad apr bounds");
        book.setAprBounds(2501, 2500);

        vm.expectRevert("OVRFLOBook: apr too high");
        book.setAprBounds(0, 10_001);
    }

    function test_Admin_SetFeeAndTreasury() public {
        vm.expectEmit(address(book));
        emit FeeSet(100);
        book.setFee(100);
        assertEq(book.feeBps(), 100);

        vm.expectRevert("OVRFLOBook: fee too high");
        book.setFee(10_001);

        vm.expectEmit(true, false, false, true, address(book));
        emit TreasurySet(NEW_TREASURY);
        book.setTreasury(NEW_TREASURY);
        assertEq(book.treasury(), NEW_TREASURY);

        vm.expectRevert("OVRFLOBook: treasury zero");
        book.setTreasury(address(0));
    }

    function test_Admin_RevertsForNonOwner() public {
        vm.startPrank(STRANGER);

        vm.expectRevert("Ownable: caller is not the owner");
        book.setAprBounds(500, 2500);

        vm.expectRevert("Ownable: caller is not the owner");
        book.setFee(1);

        vm.expectRevert("Ownable: caller is not the owner");
        book.setTreasury(NEW_TREASURY);

        vm.stopPrank();
    }

    function test_Ownership_UsesTwoStepTransfer() public {
        vm.expectEmit(true, true, false, true, address(book));
        emit OwnershipTransferStarted(address(this), NEW_OWNER);
        book.transferOwnership(NEW_OWNER);

        assertEq(book.pendingOwner(), NEW_OWNER);
        assertEq(book.owner(), address(this));

        vm.prank(STRANGER);
        vm.expectRevert("Ownable2Step: caller is not the new owner");
        book.acceptOwnership();

        vm.prank(NEW_OWNER);
        book.acceptOwnership();
        assertEq(book.owner(), NEW_OWNER);
        assertEq(book.pendingOwner(), address(0));
    }

    function test_Multicall_BatchesAdminCallsAndBubblesRevert() public {
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(OVRFLOBook.setFee, (50));
        data[1] = abi.encodeCall(OVRFLOBook.setTreasury, (NEW_TREASURY));

        book.multicall(data);

        assertEq(book.feeBps(), 50);
        assertEq(book.treasury(), NEW_TREASURY);

        data[0] = abi.encodeCall(OVRFLOBook.setFee, (10_001));
        vm.expectRevert("OVRFLOBook: fee too high");
        book.multicall(data);
    }

    function test_Multicall_IsNonPayable() public {
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeCall(OVRFLOBook.setFee, (1));

        vm.deal(address(this), 1 ether);
        (bool success,) = address(book).call{value: 1}(abi.encodeWithSignature("multicall(bytes[])", data));
        assertFalse(success);
    }

    function test_PostOffer_RejectsOutOfBandAprAndEscrowsCapacity() public {
        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(book), 100 ether);

        vm.expectRevert("OVRFLOBook: apr out of bounds");
        book.postSaleOffer(MARKET, 999, 100 ether);

        uint256 offerId = book.postSaleOffer(MARKET, 1000, 100 ether);
        vm.stopPrank();

        (address maker, address market, uint16 aprBps, uint128 capacity, bool active) = book.saleOffers(offerId);
        assertEq(maker, BUYER);
        assertEq(market, MARKET);
        assertEq(aprBps, 1000);
        assertEq(capacity, 100 ether);
        assertTrue(active);
        assertEq(underlying.balanceOf(address(book)), 100 ether);
        assertEq(underlying.balanceOf(BUYER), 0);
    }

    function test_HitOffer_SettlesSaleAndConsumesCapacity() public {
        book.setFee(100);
        uint256 offerId = _postSaleOffer(BUYER, 100 ether);
        _mintEligibleStream(1, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(book), 1);

        vm.prank(SELLER);
        book.sellIntoOffer(offerId, 1, 99 ether);

        (,,,, bool active) = book.saleOffers(offerId);
        assertFalse(active);
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(1), BUYER);
    }

    function test_HitOffer_PricesFromRemainingAfterPriorWithdrawals() public {
        uint256 offerId = _postSaleOffer(BUYER, 100 ether);
        _mintEligibleStream(28, SELLER, 150 ether, 40 ether);

        vm.prank(SELLER);
        sablier.approve(address(book), 28);
        vm.prank(SELLER);
        book.sellIntoOffer(offerId, 28, 0);

        (,,, uint128 capacity,) = book.saleOffers(offerId);
        assertEq(capacity, 0);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(sablier.ownerOf(28), BUYER);
    }

    function test_HitOffer_RespectsSlippageCapacityDeadIdsDustAndMaturity() public {
        book.setFee(100);

        uint256 slippageOfferId = _postSaleOffer(BUYER, 100 ether);
        _mintEligibleStream(2, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 2);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: slippage");
        book.sellIntoOffer(slippageOfferId, 2, 100 ether);

        uint256 smallOfferId = _postSaleOffer(BUYER, 50 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: insufficient capacity");
        book.sellIntoOffer(smallOfferId, 2, 0);

        vm.prank(BUYER);
        book.cancelSaleOffer(slippageOfferId);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: offer inactive");
        book.sellIntoOffer(slippageOfferId, 2, 0);

        uint256 dustOfferId = _postSaleOffer(BUYER, 1 ether);
        _mintEligibleStream(3, SELLER, 1, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 3);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: price zero");
        book.sellIntoOffer(dustOfferId, 3, 0);

        uint256 maturedOfferId = _postSaleOffer(BUYER, 100 ether);
        _mintEligibleStream(4, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 4);
        vm.warp(expiry);
        vm.prank(SELLER);
        vm.expectRevert();
        book.sellIntoOffer(maturedOfferId, 4, 0);
    }

    function test_HitOffer_AllowsPartialFillsAndCancelRefundsRemainder() public {
        uint256 offerId = _postSaleOffer(BUYER, 250 ether);
        _mintEligibleStream(5, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(book), 5);
        vm.prank(SELLER);
        book.sellIntoOffer(offerId, 5, 0);

        (,,, uint128 capacity, bool active) = book.saleOffers(offerId);
        assertEq(capacity, 150 ether);
        assertTrue(active);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(address(book)), 150 ether);
        assertEq(sablier.ownerOf(5), BUYER);

        vm.prank(BUYER);
        book.cancelSaleOffer(offerId);

        (,,, capacity, active) = book.saleOffers(offerId);
        assertEq(capacity, 0);
        assertFalse(active);
        assertEq(underlying.balanceOf(BUYER), 150 ether);
    }

    function test_ListStream_RejectsInvalidAprAndEscrowsNft() public {
        _mintEligibleStream(6, SELLER, 110 ether, 0);

        vm.startPrank(SELLER);
        sablier.approve(address(book), 6);
        vm.expectRevert("OVRFLOBook: apr out of bounds");
        book.postSaleListing(MARKET, 6, 999);
        vm.stopPrank();

        book.setFee(42);

        vm.expectEmit(true, true, true, true, address(book));
        emit SaleListingPosted(1, SELLER, MARKET, 6, 1000, 42);
        vm.startPrank(SELLER);
        uint256 listingId = book.postSaleListing(MARKET, 6, 1000);
        vm.stopPrank();

        (address maker, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active) =
            book.saleListings(listingId);
        assertEq(maker, SELLER);
        assertEq(market, MARKET);
        assertEq(streamId, 6);
        assertEq(aprBps, 1000);
        assertEq(listingFeeBps, 42);
        assertTrue(active);
        assertEq(sablier.ownerOf(6), address(book));
    }

    function test_CancelListing_ReturnsExactNftWithoutDrawing() public {
        _mintEligibleStream(7, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 7);

        vm.prank(SELLER);
        book.cancelSaleListing(listingId);

        (,,,,, bool active) = book.saleListings(listingId);
        assertFalse(active);
        assertEq(sablier.ownerOf(7), SELLER);
        assertEq(sablier.getWithdrawnAmount(7), 0);
    }

    function test_TakeListing_SettlesSale() public {
        book.setFee(100);
        _mintEligibleStream(8, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 8);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        book.buyListing(listingId, 100 ether);
        vm.stopPrank();

        (,,,,, bool active) = book.saleListings(listingId);
        assertFalse(active);
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(8), BUYER);
    }

    function test_TakeListing_UsesSnapshottedFeeWhenGlobalFeeChanges() public {
        book.setFee(0);
        _mintEligibleStream(32, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 32);
        book.setFee(100);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        book.buyListing(listingId, 100 ether);
        vm.stopPrank();

        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(32), BUYER);
    }

    function test_TakeListing_RespectsSlippageDustAndDeadIds() public {
        _mintEligibleStream(9, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 9);

        underlying.mint(BUYER, 200 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 200 ether);
        vm.expectRevert("OVRFLOBook: slippage");
        book.buyListing(listingId, 99 ether);
        vm.stopPrank();

        vm.prank(SELLER);
        book.cancelSaleListing(listingId);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: listing inactive");
        book.buyListing(listingId, 100 ether);

        _mintEligibleStream(10, SELLER, 1, 0);
        uint256 dustListingId = _postSaleListing(SELLER, 10);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: price zero");
        book.buyListing(dustListingId, 1);
    }

    function test_BorrowAgainstOffer_OriginatesLoanAndKeepsRemainderCancellable() public {
        book.setFee(100);
        uint256 offerId = _postLendOffer(BUYER, 250 ether);
        _mintEligibleStream(11, SELLER, 110 ether, 0);

        vm.prank(SELLER);
        sablier.approve(address(book), 11);
        vm.prank(SELLER);
        uint256 loanId = book.borrowAgainstOffer(offerId, 11, 100 ether, 99 ether);

        (
            address borrower,
            address lender,
            uint256 streamId,
            uint128 obligation,
            uint128 drawn,
            uint128 repaid,
            bool closed
        ) = book.loans(loanId);
        assertEq(borrower, SELLER);
        assertEq(lender, BUYER);
        assertEq(streamId, 11);
        assertEq(obligation, 110 ether);
        assertEq(drawn, 0);
        assertEq(repaid, 0);
        assertFalse(closed);
        assertEq(sablier.ownerOf(11), address(book));
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 150 ether);

        (,,, uint128 capacity, bool active) = book.lendOffers(offerId);
        assertEq(capacity, 150 ether);
        assertTrue(active);

        vm.prank(BUYER);
        book.cancelLendOffer(offerId);
        assertEq(underlying.balanceOf(BUYER), 150 ether);
    }

    function test_BorrowAgainstOffer_MaxBorrowUsesFullRemainingDespiteRoundingDust() public {
        uint256 offerId = _postLendOffer(BUYER, 100 ether);
        _mintEligibleStream(29, SELLER, 100 ether, 0);

        (uint256 grossPrice,,,,) = book.quote(MARKET, 29, 1000, 0);
        assertEq(grossPrice, 90_909_090_909_090_909_090);

        vm.prank(SELLER);
        sablier.approve(address(book), 29);
        vm.prank(SELLER);
        uint256 loanId = book.borrowAgainstOffer(offerId, 29, uint128(grossPrice), 0);

        (,,, uint128 obligation,,,) = book.loans(loanId);
        assertEq(obligation, 100 ether);
        assertEq(underlying.balanceOf(SELLER), grossPrice);
        assertEq(underlying.balanceOf(address(book)), 100 ether - grossPrice);
    }

    function test_BorrowAgainstOffer_RevertsForBoundsSlippageIneligibleAndDeadOffer() public {
        uint256 offerId = _postLendOffer(BUYER, 100 ether);
        _mintEligibleStream(12, SELLER, 110 ether, 0);
        vm.prank(SELLER);
        sablier.approve(address(book), 12);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: borrow above price");
        book.borrowAgainstOffer(offerId, 12, 101 ether, 0);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: borrow zero");
        book.borrowAgainstOffer(offerId, 12, 0, 0);

        book.setFee(100);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: slippage");
        book.borrowAgainstOffer(offerId, 12, 100 ether, 100 ether);

        uint256 smallOfferId = _postLendOffer(BUYER, 50 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: insufficient capacity");
        book.borrowAgainstOffer(smallOfferId, 12, 100 ether, 0);

        vm.prank(BUYER);
        book.cancelLendOffer(offerId);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: lend offer inactive");
        book.borrowAgainstOffer(offerId, 12, 100 ether, 0);

        _mintEligibleStream(13, SELLER, 110 ether, 0);
        uint256 ineligibleOfferId = _postLendOffer(BUYER, 100 ether);
        factory.setMarketApproved(address(core), MARKET, false);
        vm.prank(SELLER);
        sablier.approve(address(book), 13);
        vm.prank(SELLER);
        vm.expectRevert();
        book.borrowAgainstOffer(ineligibleOfferId, 13, 100 ether, 0);
    }

    function test_PostBorrowListing_RejectsBoundsAndEscrowsNft() public {
        _mintEligibleStream(14, SELLER, 110 ether, 0);

        vm.startPrank(SELLER);
        sablier.approve(address(book), 14);
        vm.expectRevert("OVRFLOBook: apr out of bounds");
        book.postBorrowListing(MARKET, 14, 999, 100 ether);

        vm.expectRevert("OVRFLOBook: borrow above price");
        book.postBorrowListing(MARKET, 14, 1000, 101 ether);

        vm.expectRevert("OVRFLOBook: borrow zero");
        book.postBorrowListing(MARKET, 14, 1000, 0);
        vm.stopPrank();

        book.setFee(35);

        vm.expectEmit(true, true, true, true, address(book));
        emit BorrowListingPosted(1, SELLER, MARKET, 14, 1000, 35, 100 ether);
        vm.startPrank(SELLER);
        uint256 listingId = book.postBorrowListing(MARKET, 14, 1000, 100 ether);
        vm.stopPrank();

        (
            address borrower,
            address market,
            uint256 streamId,
            uint16 aprBps,
            uint128 borrowAmount,
            uint16 listingFeeBps,
            bool active
        ) = book.borrowListings(listingId);
        assertEq(borrower, SELLER);
        assertEq(market, MARKET);
        assertEq(streamId, 14);
        assertEq(aprBps, 1000);
        assertEq(borrowAmount, 100 ether);
        assertEq(listingFeeBps, 35);
        assertTrue(active);
        assertEq(sablier.ownerOf(14), address(book));
    }

    function test_LendAgainstListing_OriginatesLoan() public {
        book.setFee(100);
        _mintEligibleStream(15, SELLER, 110 ether, 0);
        uint256 listingId = _postBorrowListing(SELLER, 15, 100 ether);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        uint256 loanId = book.lendAgainstListing(listingId, 110 ether);
        vm.stopPrank();

        (
            address borrower,
            address lender,
            uint256 streamId,
            uint128 obligation,
            uint128 drawn,
            uint128 repaid,
            bool closed
        ) = book.loans(loanId);
        assertEq(borrower, SELLER);
        assertEq(lender, BUYER);
        assertEq(streamId, 15);
        assertEq(obligation, 110 ether);
        assertEq(drawn, 0);
        assertEq(repaid, 0);
        assertFalse(closed);
        assertEq(sablier.ownerOf(15), address(book));
        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(underlying.balanceOf(address(book)), 0);

        (,,,,,, bool active) = book.borrowListings(listingId);
        assertFalse(active);
    }

    function test_LendAgainstListing_UsesSnapshottedFeeWhenGlobalFeeChanges() public {
        book.setFee(0);
        _mintEligibleStream(33, SELLER, 110 ether, 0);
        uint256 listingId = _postBorrowListing(SELLER, 33, 100 ether);
        book.setFee(100);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        uint256 loanId = book.lendAgainstListing(listingId, 110 ether);
        vm.stopPrank();

        (,,, uint128 obligation,,,) = book.loans(loanId);
        assertEq(obligation, 110 ether);
        assertEq(underlying.balanceOf(SELLER), 100 ether);
        assertEq(underlying.balanceOf(TREASURY), 0);
        assertEq(underlying.balanceOf(BUYER), 0);
        assertEq(underlying.balanceOf(address(book)), 0);
    }

    function test_BorrowListing_CancelAndDeadIdAndObligationSlippage() public {
        _mintEligibleStream(16, SELLER, 110 ether, 0);
        uint256 listingId = _postBorrowListing(SELLER, 16, 100 ether);

        vm.prank(SELLER);
        book.cancelBorrowListing(listingId);
        assertEq(sablier.ownerOf(16), SELLER);

        underlying.mint(BUYER, 100 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 100 ether);
        vm.expectRevert("OVRFLOBook: borrow listing inactive");
        book.lendAgainstListing(listingId, 0);
        vm.stopPrank();

        _mintEligibleStream(17, SELLER, 110 ether, 0);
        uint256 slippageListingId = _postBorrowListing(SELLER, 17, 100 ether);
        vm.startPrank(BUYER);
        vm.expectRevert("OVRFLOBook: slippage");
        book.lendAgainstListing(slippageListingId, 111 ether);
        uint256 loanId = book.lendAgainstListing(slippageListingId, 99 ether);
        vm.stopPrank();

        (,,, uint128 obligation,,,) = book.loans(loanId);
        assertEq(obligation, 110 ether);
    }

    function test_LendAgainstListing_RevertsWhenTimeDriftDropsObligationBelowMin() public {
        _mintEligibleStream(34, SELLER, 110 ether, 0);
        uint256 listingId = _postBorrowListing(SELLER, 34, 80 ether);
        (, uint128 preWarpObligation,,,) = book.quote(MARKET, 34, 1000, 80 ether);

        vm.warp(block.timestamp + 180 days);

        underlying.mint(BUYER, 80 ether);
        vm.startPrank(BUYER);
        underlying.approve(address(book), 80 ether);
        vm.expectRevert("OVRFLOBook: slippage");
        book.lendAgainstListing(listingId, preWarpObligation);
        uint256 loanId = book.lendAgainstListing(listingId, 0);
        vm.stopPrank();

        (,,, uint128 loanObligation,,,) = book.loans(loanId);
        assertLt(loanObligation, preWarpObligation);
    }

    function test_ClaimLoan_CapsAtOutstandingAndRequiresLender() public {
        uint256 loanId = _originateLoanViaOffer(18, 100 ether);
        sablier.setWithdrawable(18, 200 ether);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: not lender");
        book.claimLoan(loanId);

        vm.prank(BUYER);
        book.claimLoan(loanId);

        (,,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(obligation, 110 ether);
        assertEq(drawn, 110 ether);
        assertEq(repaid, 0);
        assertFalse(closed);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(18), 110 ether);
        assertEq(sablier.ownerOf(18), address(book));

        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: nothing claimable");
        book.claimLoan(loanId);
    }

    function test_ClaimLoan_AllowsMultiplePartials() public {
        uint256 loanId = _originateLoanViaOffer(19, 100 ether);

        sablier.setWithdrawable(19, 40 ether);
        vm.prank(BUYER);
        book.claimLoan(loanId);

        sablier.setWithdrawable(19, 30 ether);
        vm.prank(BUYER);
        book.claimLoan(loanId);

        (,,,, uint128 drawn,,) = book.loans(loanId);
        assertEq(drawn, 70 ether);
        assertEq(ovrfloToken.balanceOf(BUYER), 70 ether);
        assertEq(sablier.getWithdrawnAmount(19), 70 ether);
        assertEq(sablier.ownerOf(19), address(book));

        (,,,,, uint128 repaid, uint128 outstanding,) = book.loanState(loanId);
        assertEq(repaid, 0);
        assertEq(outstanding, 40 ether);
    }

    function test_CloseLoan_RevertsUntilClosableThenPaysAndReturnsNft() public {
        uint256 loanId = _originateLoanViaOffer(20, 100 ether);

        sablier.setWithdrawable(20, 109 ether);
        vm.expectRevert("OVRFLOBook: loan not closable");
        book.closeLoan(loanId);

        sablier.setWithdrawable(20, 110 ether);
        vm.prank(STRANGER);
        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(20), 110 ether);
        assertEq(sablier.ownerOf(20), SELLER);

        vm.expectRevert("OVRFLOBook: loan closed");
        book.closeLoan(loanId);
    }

    function test_CloseLoan_AfterPartialClaimDrawsOnlyOutstanding() public {
        uint256 loanId = _originateLoanViaOffer(30, 100 ether);

        sablier.setWithdrawable(30, 40 ether);
        vm.prank(BUYER);
        book.claimLoan(loanId);

        sablier.setWithdrawable(30, 100 ether);
        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(30), 110 ether);
        assertEq(sablier.ownerOf(30), SELLER);
    }

    function test_CloseLoan_ReturnsNftWhenAlreadySatisfiedByClaims() public {
        uint256 loanId = _originateLoanViaOffer(21, 100 ether);
        sablier.setWithdrawable(21, 110 ether);

        vm.prank(BUYER);
        book.claimLoan(loanId);

        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closed) = book.loans(loanId);
        assertEq(drawn, 110 ether);
        assertTrue(closed);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(21), 110 ether);
        assertEq(sablier.ownerOf(21), SELLER);
    }

    function test_RepayLoan_FullRepaymentAfterPartialClaimClosesAndReturnsNft() public {
        uint256 loanId = _originateLoanViaOffer(22, 100 ether);
        sablier.setWithdrawable(22, 40 ether);

        vm.prank(BUYER);
        book.claimLoan(loanId);

        ovrfloToken.mint(SELLER, 70 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 70 ether);
        book.repayLoan(loanId, 70 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(drawn, 40 ether);
        assertEq(repaid, 70 ether);
        assertTrue(closed);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(ovrfloToken.balanceOf(SELLER), 0);
        assertEq(sablier.getWithdrawnAmount(22), 40 ether);
        assertEq(sablier.ownerOf(22), SELLER);
    }

    function test_RepayLoan_PartialRepaymentAdvancesClosableTime() public {
        uint256 loanId = _originateLoanViaOffer(23, 100 ether);

        ovrfloToken.mint(SELLER, 25 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 25 ether);
        book.repayLoan(loanId, 25 ether);
        vm.stopPrank();

        (,,,,, uint128 repaid, bool closed) = book.loans(loanId);
        assertEq(repaid, 25 ether);
        assertFalse(closed);
        assertEq(sablier.ownerOf(23), address(book));
        assertEq(ovrfloToken.balanceOf(BUYER), 25 ether);

        sablier.setWithdrawable(23, 84 ether);
        vm.expectRevert("OVRFLOBook: loan not closable");
        book.closeLoan(loanId);

        sablier.setWithdrawable(23, 85 ether);
        book.closeLoan(loanId);

        (,,,, uint128 drawn,, bool closedAfter) = book.loans(loanId);
        assertEq(drawn, 85 ether);
        assertTrue(closedAfter);
        assertEq(ovrfloToken.balanceOf(BUYER), 110 ether);
        assertEq(sablier.getWithdrawnAmount(23), 85 ether);
        assertEq(sablier.ownerOf(23), SELLER);
    }

    function test_RepayLoan_RevertsForInvalidCallerAmountsAndClosedLoan() public {
        uint256 loanId = _originateLoanViaOffer(24, 100 ether);

        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: not borrower");
        book.repayLoan(loanId, 1);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: repay zero");
        book.repayLoan(loanId, 0);

        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: repay too much");
        book.repayLoan(loanId, 111 ether);

        ovrfloToken.mint(SELLER, 110 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 110 ether);
        book.repayLoan(loanId, 110 ether);
        vm.expectRevert("OVRFLOBook: loan closed");
        book.repayLoan(loanId, 1);
        vm.stopPrank();

        vm.expectRevert("OVRFLOBook: loan closed");
        book.closeLoan(loanId);
    }

    function test_Quote_EqualsLoanSettlementAndLoanStateReflectsRepayment() public {
        book.setFee(100);
        _mintEligibleStream(25, SELLER, 110 ether, 0);

        (uint256 grossPrice, uint128 quotedObligation, uint256 quotedFee, uint256 quotedNet, uint128 quotedResidual) =
            book.quote(MARKET, 25, 1000, 100 ether);
        assertEq(grossPrice, 100 ether);
        assertEq(quotedObligation, 110 ether);
        assertEq(quotedFee, 1 ether);
        assertEq(quotedNet, 99 ether);
        assertEq(quotedResidual, 0);

        uint256 offerId = _postLendOffer(BUYER, 100 ether);
        vm.startPrank(SELLER);
        sablier.approve(address(book), 25);
        uint256 loanId = book.borrowAgainstOffer(offerId, 25, 100 ether, 99 ether);
        vm.stopPrank();

        assertEq(underlying.balanceOf(SELLER), 99 ether);
        assertEq(underlying.balanceOf(TREASURY), 1 ether);
        assertEq(underlying.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(25), address(book));

        (,,, uint128 obligation,,,, bool closed) = book.loanState(loanId);
        assertEq(obligation, quotedObligation);
        assertFalse(closed);

        ovrfloToken.mint(SELLER, 25 ether);
        vm.startPrank(SELLER);
        ovrfloToken.approve(address(book), 25 ether);
        book.repayLoan(loanId, 25 ether);
        vm.stopPrank();

        (,,,, uint128 drawn, uint128 repaid, uint128 outstanding,) = book.loanState(loanId);
        assertEq(drawn, 0);
        assertEq(repaid, 25 ether);
        assertEq(outstanding, 85 ether);
    }

    function test_Quote_WithZeroBorrowAmountPreviewsSaleSettlement() public {
        book.setFee(100);
        _mintEligibleStream(31, SELLER, 110 ether, 0);

        (uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual) =
            book.quote(MARKET, 31, 1000, 0);

        assertEq(grossPrice, 100 ether);
        assertEq(obligation, 110 ether);
        assertEq(feeAmount, 1 ether);
        assertEq(netToBorrower, 99 ether);
        assertEq(residual, 0);
    }

    function test_OrderStateViewsReflectCurrentState() public {
        uint256 saleOfferId = _postSaleOffer(BUYER, 100 ether);
        (address saleMaker, address saleMarket, uint16 saleApr, uint128 saleCapacity, bool saleActive) =
            book.saleOfferState(saleOfferId);
        assertEq(saleMaker, BUYER);
        assertEq(saleMarket, MARKET);
        assertEq(saleApr, 1000);
        assertEq(saleCapacity, 100 ether);
        assertTrue(saleActive);

        _mintEligibleStream(26, SELLER, 110 ether, 0);
        uint256 saleListingId = _postSaleListing(SELLER, 26);
        (
            address listingMaker,
            address listingMarket,
            uint256 listingStreamId,
            uint16 listingApr,
            uint16 listingFeeBps,
            bool listingActive
        ) = book.saleListingState(saleListingId);
        assertEq(listingMaker, SELLER);
        assertEq(listingMarket, MARKET);
        assertEq(listingStreamId, 26);
        assertEq(listingApr, 1000);
        assertEq(listingFeeBps, 0);
        assertTrue(listingActive);

        uint256 lendOfferId = _postLendOffer(BUYER, 100 ether);
        (address lender, address lendMarket, uint16 lendApr, uint128 lendCapacity, bool lendActive) =
            book.lendOfferState(lendOfferId);
        assertEq(lender, BUYER);
        assertEq(lendMarket, MARKET);
        assertEq(lendApr, 1000);
        assertEq(lendCapacity, 100 ether);
        assertTrue(lendActive);

        _mintEligibleStream(27, SELLER, 110 ether, 0);
        uint256 borrowListingId = _postBorrowListing(SELLER, 27, 100 ether);
        (
            address borrower,
            address borrowMarket,
            uint256 borrowStreamId,
            uint16 borrowApr,
            uint128 borrowAmount,
            uint16 borrowFeeBps,
            bool borrowActive
        ) = book.borrowListingState(borrowListingId);
        assertEq(borrower, SELLER);
        assertEq(borrowMarket, MARKET);
        assertEq(borrowStreamId, 27);
        assertEq(borrowApr, 1000);
        assertEq(borrowAmount, 100 ether);
        assertEq(borrowFeeBps, 0);
        assertTrue(borrowActive);
    }

    function _postSaleOffer(address maker, uint128 capacity) internal returns (uint256 offerId) {
        underlying.mint(maker, capacity);
        vm.startPrank(maker);
        underlying.approve(address(book), capacity);
        offerId = book.postSaleOffer(MARKET, 1000, capacity);
        vm.stopPrank();
    }

    function _postLendOffer(address lender, uint128 capacity) internal returns (uint256 offerId) {
        underlying.mint(lender, capacity);
        vm.startPrank(lender);
        underlying.approve(address(book), capacity);
        offerId = book.postLendOffer(MARKET, 1000, capacity);
        vm.stopPrank();
    }

    function _postBorrowListing(address borrower, uint256 streamId, uint128 borrowAmount)
        internal
        returns (uint256 listingId)
    {
        vm.startPrank(borrower);
        sablier.approve(address(book), streamId);
        listingId = book.postBorrowListing(MARKET, streamId, 1000, borrowAmount);
        vm.stopPrank();
    }

    function _originateLoanViaOffer(uint256 streamId, uint128 borrowAmount) internal returns (uint256 loanId) {
        uint256 offerId = _postLendOffer(BUYER, borrowAmount);
        _mintEligibleStream(streamId, SELLER, 110 ether, 0);
        vm.startPrank(SELLER);
        sablier.approve(address(book), streamId);
        loanId = book.borrowAgainstOffer(offerId, streamId, borrowAmount, 0);
        vm.stopPrank();
    }

    function _postSaleListing(address maker, uint256 streamId) internal returns (uint256 listingId) {
        vm.startPrank(maker);
        sablier.approve(address(book), streamId);
        listingId = book.postSaleListing(MARKET, streamId, 1000);
        vm.stopPrank();
    }

    function _mintEligibleStream(uint256 streamId, address owner, uint128 deposited, uint128 withdrawn) internal {
        sablier.setStream(streamId, owner, address(core), ovrfloToken, uint40(expiry), 0, false, deposited, withdrawn);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: UNCOVERED BRANCH TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Constructor_RevertForZeroUnderlying() public {
        OVRFLOBookMockFactory badFactory = new OVRFLOBookMockFactory();
        badFactory.setInfo(address(core), TREASURY, address(0), address(ovrfloToken));
        vm.expectRevert("OVRFLOBook: underlying zero");
        new OVRFLOBook(address(badFactory), address(core), address(sablier));
    }

    function test_Constructor_RevertForZeroToken() public {
        OVRFLOBookMockFactory badFactory = new OVRFLOBookMockFactory();
        badFactory.setInfo(address(core), TREASURY, address(underlying), address(0));
        vm.expectRevert("OVRFLOBook: token zero");
        new OVRFLOBook(address(badFactory), address(core), address(sablier));
    }

    function test_CancelSaleOffer_RevertForWrongMaker() public {
        uint256 offerId = _postSaleOffer(BUYER, 100 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: not offer maker");
        book.cancelSaleOffer(offerId);
    }

    function test_CancelSaleListing_RevertForWrongMaker() public {
        _mintEligibleStream(40, SELLER, 110 ether, 0);
        uint256 listingId = _postSaleListing(SELLER, 40);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: not listing maker");
        book.cancelSaleListing(listingId);
    }

    function test_CancelLendOffer_RevertForWrongLender() public {
        uint256 offerId = _postLendOffer(BUYER, 100 ether);
        vm.prank(SELLER);
        vm.expectRevert("OVRFLOBook: not lender");
        book.cancelLendOffer(offerId);
    }

    function test_CancelBorrowListing_RevertForWrongBorrower() public {
        _mintEligibleStream(41, SELLER, 110 ether, 0);
        uint256 listingId = _postBorrowListing(SELLER, 41, 100 ether);
        vm.prank(BUYER);
        vm.expectRevert("OVRFLOBook: not borrower");
        book.cancelBorrowListing(listingId);
    }

    function test_PostSaleOffer_RevertForZeroCapacity() public {
        vm.expectRevert("OVRFLOBook: capacity zero");
        book.postSaleOffer(MARKET, 1000, 0);
    }

    function test_PostLendOffer_RevertForZeroCapacity() public {
        vm.expectRevert("OVRFLOBook: capacity zero");
        book.postLendOffer(MARKET, 1000, 0);
    }

    function test_ClaimLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOBook: unknown loan");
        book.claimLoan(999);
    }

    function test_CloseLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOBook: unknown loan");
        book.closeLoan(999);
    }

    function test_RepayLoan_RevertForUnknownLoan() public {
        vm.expectRevert("OVRFLOBook: unknown loan");
        book.repayLoan(999, 1);
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: SELF-MATCH PREVENTION
    //////////////////////////////////////////////////////////////*/

    function test_BorrowAgainstOffer_RevertsForSelfMatch() public {
        uint256 offerId = _postLendOffer(BUYER, 100 ether);
        _mintEligibleStream(50, BUYER, 110 ether, 0);

        vm.startPrank(BUYER);
        sablier.approve(address(book), 50);
        vm.expectRevert("OVRFLOBook: self-match");
        book.borrowAgainstOffer(offerId, 50, 100 ether, 0);
        vm.stopPrank();

        assertEq(sablier.ownerOf(50), BUYER, "stream should not be escrowed");
        (,,, uint128 capacity, bool active) = book.lendOffers(offerId);
        assertTrue(active, "offer should still be active");
        assertEq(capacity, 100 ether, "capacity should be unchanged");
    }

    function test_LendAgainstListing_RevertsForSelfMatch() public {
        _mintEligibleStream(51, SELLER, 110 ether, 0);
        uint256 listingId = _postBorrowListing(SELLER, 51, 100 ether);

        underlying.mint(SELLER, 100 ether);
        vm.startPrank(SELLER);
        underlying.approve(address(book), 100 ether);
        vm.expectRevert("OVRFLOBook: self-match");
        book.lendAgainstListing(listingId, 0);
        vm.stopPrank();

        assertEq(sablier.ownerOf(51), address(book), "stream should remain escrowed");
        (,,,,,, bool active) = book.borrowListings(listingId);
        assertTrue(active, "listing should still be active");
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: WHOLE-NUMBER RATE CONSTRAINT
    //////////////////////////////////////////////////////////////*/

    function test_Apr_RejectsNonWholeRateOnLendOffer() public {
        book.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(book), 100 ether);
        vm.expectRevert("OVRFLOBook: apr not whole");
        book.postLendOffer(MARKET, 550, 100 ether);
        vm.stopPrank();
    }

    function test_Apr_AcceptsBoundaryWholeRates() public {
        book.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 300 ether);
        underlying.approve(address(book), 300 ether);
        uint256 id0 = book.postLendOffer(MARKET, 0, 100 ether);
        uint256 id500 = book.postLendOffer(MARKET, 500, 100 ether);
        uint256 id9900 = book.postLendOffer(MARKET, 9900, 100 ether);
        vm.stopPrank();

        (, , uint16 apr0, , ) = book.lendOffers(id0);
        assertEq(apr0, 0);
        (, , uint16 apr500, , ) = book.lendOffers(id500);
        assertEq(apr500, 500);
        (, , uint16 apr9900, , ) = book.lendOffers(id9900);
        assertEq(apr9900, 9900);
    }

    function test_Apr_RejectsNonWholeRateOnBorrowListing() public {
        book.setAprBounds(0, 9900);
        _mintEligibleStream(60, SELLER, 110 ether, 0);

        vm.startPrank(SELLER);
        sablier.approve(address(book), 60);
        vm.expectRevert("OVRFLOBook: apr not whole");
        book.postBorrowListing(MARKET, 60, 550, 100 ether);
        vm.stopPrank();
    }

    function test_Apr_RejectsNonWholeRateOnSaleOffer() public {
        book.setAprBounds(0, 9900);

        vm.startPrank(BUYER);
        underlying.mint(BUYER, 100 ether);
        underlying.approve(address(book), 100 ether);
        vm.expectRevert("OVRFLOBook: apr not whole");
        book.postSaleOffer(MARKET, 333, 100 ether);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                    COVERAGE: POOL DATA STRUCTURES
    //////////////////////////////////////////////////////////////*/

    function test_Pool_NextPoolIdStartsAtOne() public view {
        assertEq(book.nextPoolId(), 1);
    }

    function test_Pool_LoanPoolIdDefaultsToZero() public {
        uint256 loanId = _originateLoanViaOffer(70, 100 ether);
        assertEq(book.loanPoolId(loanId), 0, "non-pool loan should have poolId 0");
    }
}
