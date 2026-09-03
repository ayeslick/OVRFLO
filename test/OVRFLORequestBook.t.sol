// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {OVRFLORequestBook} from "../src/OVRFLORequestBook.sol";
import {StreamPricing} from "../src/StreamPricing.sol";
import {LendingMockFixture} from "./helpers/LendingMockFixture.sol";

contract OVRFLORequestBookTest is LendingMockFixture {
    event RequestPosted(
        uint256 indexed requestId,
        address indexed borrower,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint256 targetBorrow,
        uint256 minAcceptable
    );
    event RequestFilled(uint256 indexed requestId, uint256 indexed loanId, uint256 actualBorrow);
    event RequestCancelled(uint256 indexed requestId, address indexed borrower);
    event Borrowed(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed market,
        uint16 aprBps,
        uint32 epoch,
        uint64 seq,
        uint64 fillStart,
        uint64 fillEnd,
        uint128 actualBorrow,
        uint128 feeAmount,
        uint128 obligation,
        uint256 streamId
    );

    OVRFLORequestBook internal book;

    address internal constant HUMAN = address(0xB0B);
    address internal constant OTHER = address(0x0DD);
    address internal constant LENDER = address(0xA11CE);
    uint256 internal constant STREAM_ONE = 1;
    uint16 internal constant CHEAP_APR = 500;

    function setUp() public {
        _deployLendingSystem();
        factory.setLendingToOvrflo(address(lending), address(core));
        book = new OVRFLORequestBook(address(factory), address(lending), address(sablier));
        vm.prank(address(factory));
        lending.setRouter(address(book));
        _fundLender(LENDER, 1_000 ether);
    }

    function test_Constructor_ApprovesLendingOnLockupAndBindsVault() public view {
        assertTrue(sablier.isApprovedForAll(address(book), address(lending)));
        assertEq(book.vault(), address(core));
        assertEq(address(book.lending()), address(lending));
        assertEq(address(book.sablier()), address(sablier));
        assertEq(book.factory(), address(factory));
    }

    function test_Constructor_UnknownLendingReverts() public {
        vm.expectRevert(OVRFLORequestBook.UnknownLending.selector);
        new OVRFLORequestBook(address(factory), address(0xDEAD), address(sablier));
    }

    function test_Constructor_SablierMismatchReverts() public {
        vm.expectRevert(OVRFLORequestBook.SablierMismatch.selector);
        new OVRFLORequestBook(address(factory), address(lending), address(0xBEEF));
    }

    function test_Post_FillableDepthPaysHumanAndEmitsFilled() public {
        _supply(LENDER, 10 ether, APR);
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.expectEmit(true, true, true, true, address(book));
        emit RequestPosted(1, HUMAN, MARKET, STREAM_ONE, APR, 5 ether, 5 ether);
        vm.expectEmit(true, true, true, true, address(lending));
        emit Borrowed(1, HUMAN, MARKET, APR, 0, 0, 0, 5_000_000, 5 ether, 0, 5.1 ether, STREAM_ONE);
        vm.expectEmit(true, true, false, true, address(book));
        emit RequestFilled(1, 1, 5 ether);

        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        (address borrower,,,,,) = book.requests(requestId);
        (address loanBorrower,,,,,,,,,,,) = lending.loans(1);
        assertEq(borrower, address(0));
        assertEq(loanBorrower, HUMAN);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
        assertEq(ovrfloToken.balanceOf(HUMAN), 5 ether);
        assertEq(ovrfloToken.balanceOf(address(book)), 0);
        assertEq(lending.borrowerLoanCount(HUMAN), 1);
        assertEq(lending.borrowerLoanAt(HUMAN, 0), 1);
        assertEq(lending.borrowerLoanCount(address(book)), 0);
        assertEq(book.requestCount(HUMAN), 0);

        sablier.setWithdrawable(STREAM_ONE, 5.1 ether);
        lending.close(1);
        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
    }

    function test_Post_EmptyTickRestsThenExecuteFillsAtStoredTick() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.expectEmit(true, true, true, true, address(book));
        emit RequestPosted(1, HUMAN, MARKET, STREAM_ONE, APR, 5 ether, 5 ether);

        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        (address borrower,, uint16 aprBps, uint128 targetBorrow, uint128 minAcceptable, uint256 streamId) =
            _request(requestId);
        assertEq(borrower, HUMAN);
        assertEq(aprBps, APR);
        assertEq(targetBorrow, 5 ether);
        assertEq(minAcceptable, 5 ether);
        assertEq(streamId, STREAM_ONE);
        assertEq(sablier.ownerOf(STREAM_ONE), address(book));
        assertEq(ovrfloToken.balanceOf(HUMAN), 0);
        assertEq(book.requestCount(HUMAN), 1);
        assertEq(book.requestAt(HUMAN, 0), requestId);

        _supply(LENDER, 10 ether, APR);

        vm.expectEmit(true, true, false, true, address(book));
        emit RequestFilled(requestId, 1, 5 ether);

        uint256 loanId = book.execute(requestId);

        (borrower,,,,,) = book.requests(requestId);
        assertEq(borrower, address(0));
        assertEq(loanId, 1);
        (address loanBorrower,,,,,,,,,,,) = lending.loans(loanId);
        assertEq(loanBorrower, HUMAN);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
        assertEq(ovrfloToken.balanceOf(HUMAN), 5 ether);
        assertEq(ovrfloToken.balanceOf(address(book)), 0);
        assertEq(book.requestCount(HUMAN), 0);
    }

    function test_Execute_RetiredRouterRevertsAndCancelReturnsStream() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);
        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        vm.prank(address(factory));
        lending.setRouter(address(0));

        vm.expectRevert(abi.encodeWithSelector(OVRFLORequestBook.NotCurrentRouter.selector, address(0)));
        book.execute(requestId);

        vm.expectRevert(abi.encodeWithSelector(OVRFLORequestBook.NotCurrentRouter.selector, address(0)));
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        vm.expectEmit(true, true, false, true, address(book));
        emit RequestCancelled(requestId, HUMAN);
        vm.prank(HUMAN);
        book.cancel(requestId);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
        (address borrower,,,,,) = book.requests(requestId);
        assertEq(borrower, address(0));
        assertEq(book.requestCount(HUMAN), 0);
    }

    function test_Execute_CheaperTickDepthDoesNotFill() public {
        _supply(LENDER, 10 ether, CHEAP_APR);
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), address(book));

        vm.expectRevert(OVRFLOLending.EmptyTick.selector);
        book.execute(requestId);

        (address borrower,, uint16 aprBps,,,) = _request(requestId);
        assertEq(borrower, HUMAN);
        assertEq(aprBps, APR);
        assertEq(sablier.ownerOf(STREAM_ONE), address(book));
        assertEq(ovrfloToken.balanceOf(HUMAN), 0);
        assertEq(lending.borrowerLoanCount(HUMAN), 0);
        assertEq(book.requestCount(HUMAN), 1);
        assertEq(book.requestAt(HUMAN, 0), requestId);
    }

    function test_Cancel_NonBorrowerRevertsAndBorrowerRegainsStream() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);
        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        vm.expectRevert(abi.encodeWithSelector(OVRFLORequestBook.NotBorrower.selector, OTHER, HUMAN));
        vm.prank(OTHER);
        book.cancel(requestId);

        vm.prank(HUMAN);
        book.cancel(requestId);
        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
        assertEq(book.requestCount(HUMAN), 0);
    }

    function test_Post_OnBehalfOfIsHumanNeverTheBook() public {
        _supply(LENDER, 10 ether, APR);
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        (address loanBorrower,,,,,,,,,,,) = lending.loans(1);
        assertEq(loanBorrower, HUMAN);
        assertEq(lending.borrowerLoanCount(address(book)), 0);
        assertEq(ovrfloToken.balanceOf(address(book)), 0);
        assertEq(ovrfloToken.balanceOf(HUMAN), 5 ether);
        assertEq(book.requestCount(HUMAN), 0);
    }

    function test_Post_TargetAboveRemainingFaceFillsAtLivePriceCap() public {
        _supply(LENDER, 20 ether, APR);
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.expectEmit(true, true, false, true, address(book));
        emit RequestFilled(1, 1, 10 ether);

        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 20 ether, 10 ether);

        (address loanBorrower,,,,,,, uint64 fillStart, uint64 fillEnd,,,) = lending.loans(1);
        assertEq(loanBorrower, HUMAN);
        assertEq(uint256(fillEnd - fillStart) * uint256(lending.UNIT()), 10 ether);
        assertEq(ovrfloToken.balanceOf(HUMAN), 10 ether);
        (address resting,,,,,) = book.requests(1);
        assertEq(resting, address(0));
        assertEq(book.requestCount(HUMAN), 0);
    }

    function test_Execute_DoesNotDrawEscrowedStream() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);
        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        sablier.setWithdrawable(STREAM_ONE, 1 ether);
        uint128 withdrawnBefore = sablier.getWithdrawnAmount(STREAM_ONE);
        uint128 remainingBefore = _remaining(STREAM_ONE);
        assertEq(withdrawnBefore, 0);
        assertGt(remainingBefore, 0);

        _supply(LENDER, 10 ether, APR);
        book.execute(requestId);

        assertEq(sablier.getWithdrawnAmount(STREAM_ONE), withdrawnBefore);
        assertEq(_remaining(STREAM_ONE), remainingBefore);
        assertEq(ovrfloToken.balanceOf(address(book)), 0);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
    }

    function test_Post_RetiredRouterRevertsWithNoEscrow() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);
        vm.prank(address(factory));
        lending.setRouter(address(0));

        vm.expectRevert(abi.encodeWithSelector(OVRFLORequestBook.NotCurrentRouter.selector, address(0)));
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
    }

    function test_Post_WrongSenderNeverRests() public {
        sablier.setStream(
            STREAM_ONE, HUMAN, HUMAN, IERC20(address(ovrfloToken)), uint40(expiry), 0, false, 10.2 ether, 0
        );
        vm.prank(HUMAN);
        sablier.approve(address(book), STREAM_ONE);

        vm.expectRevert(StreamPricing.WrongSender.selector);
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
        (address borrower,,,,,) = book.requests(1);
        assertEq(borrower, address(0));
    }

    function test_Post_DustRemainingNeverRests() public {
        _createBookStream(STREAM_ONE, HUMAN, uint128(lending.MIN_STREAM_AMOUNT() - 1));

        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 0);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
    }

    function test_Post_InvalidTickRevertsAndNothingRests() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.expectRevert(OVRFLOLending.InvalidTick.selector);
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, 1025, 5 ether, 5 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
        (address borrower,,,,,) = book.requests(1);
        assertEq(borrower, address(0));
    }

    function test_Post_ZeroTargetRevertsAndNothingRests() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.expectRevert(OVRFLOLending.ZeroTarget.selector);
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 0, 0);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
    }

    function test_Post_SpacingUnsetRevertsAndNothingRests() public {
        address bareMarket = address(0xB0B0);
        core.setSeries(bareMarket, expiry, address(ovrfloToken), address(underlying));
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.expectRevert(OVRFLOLending.SpacingUnset.selector);
        vm.prank(HUMAN);
        book.post(STREAM_ONE, bareMarket, APR, 5 ether, 5 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
    }

    function test_Post_NetBelowMinAcceptableRestsWithoutBorrow() public {
        _supply(LENDER, 10 ether, APR);
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);

        vm.recordLogs();
        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether + 1);

        (address borrower,,,,,) = book.requests(requestId);
        assertEq(borrower, HUMAN);
        assertEq(sablier.ownerOf(STREAM_ONE), address(book));
        assertEq(lending.borrowerLoanCount(HUMAN), 0);
        assertEq(ovrfloToken.balanceOf(HUMAN), 0);
        _assertNoRequestFilled();
    }

    function test_Execute_SeriesMaturedRevertsAndCancelReturnsStream() public {
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);
        vm.prank(HUMAN);
        uint256 requestId = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        uint128 remainingBefore = _remaining(STREAM_ONE);
        vm.prank(OTHER);
        vm.expectRevert(bytes("not authorized"));
        sablier.withdraw(STREAM_ONE, OTHER, 1);
        assertEq(_remaining(STREAM_ONE), remainingBefore);

        _supply(LENDER, 10 ether, APR);
        vm.warp(expiry);

        vm.expectRevert(StreamPricing.SeriesMatured.selector);
        book.execute(requestId);

        vm.prank(HUMAN);
        book.cancel(requestId);
        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);
        assertEq(_remaining(STREAM_ONE), remainingBefore);
    }

    function test_Post_ApprovalForLendingOnlyCannotPost() public {
        _supply(LENDER, 10 ether, APR);
        sablier.setStream(
            STREAM_ONE, HUMAN, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, 10.2 ether, 0
        );
        vm.prank(HUMAN);
        sablier.approve(address(lending), STREAM_ONE);

        vm.expectRevert(bytes("not approved"));
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);

        assertEq(sablier.ownerOf(STREAM_ONE), HUMAN);

        vm.prank(HUMAN);
        sablier.approve(address(book), STREAM_ONE);
        vm.prank(HUMAN);
        book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);
        assertEq(sablier.ownerOf(STREAM_ONE), address(lending));
        assertEq(ovrfloToken.balanceOf(HUMAN), 5 ether);
    }

    function test_Execute_MissingRequestReverts() public {
        vm.expectRevert(abi.encodeWithSelector(OVRFLORequestBook.RequestMissing.selector, 1));
        book.execute(1);
    }

    function test_RequestList_CancelCompactsAndLeavesTheOtherResting() public {
        uint256 streamTwo = 2;
        _createBookStream(STREAM_ONE, HUMAN, 10.2 ether);
        _createBookStream(streamTwo, HUMAN, 10.2 ether);

        vm.startPrank(HUMAN);
        uint256 first = book.post(STREAM_ONE, MARKET, APR, 5 ether, 5 ether);
        uint256 second = book.post(streamTwo, MARKET, APR, 5 ether, 5 ether);
        vm.stopPrank();

        assertEq(book.requestCount(HUMAN), 2);
        assertEq(book.requestAt(HUMAN, 0), first);
        assertEq(book.requestAt(HUMAN, 1), second);

        vm.prank(HUMAN);
        book.cancel(first);

        assertEq(book.requestCount(HUMAN), 1);
        assertEq(book.requestAt(HUMAN, 0), second);
        assertEq(book.requestAt(HUMAN, 1), 0);
        (address remaining,,,,,) = book.requests(second);
        assertEq(remaining, HUMAN);
        (address gone,,,,,) = book.requests(first);
        assertEq(gone, address(0));
    }

    function _createBookStream(uint256 streamId, address owner, uint128 deposited) internal {
        sablier.setStream(
            streamId, owner, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, deposited, 0
        );
        vm.prank(owner);
        sablier.approve(address(book), streamId);
    }

    function _supply(address who, uint128 amount, uint16 aprBps) internal {
        vm.prank(who);
        lending.supply(MARKET, aprBps, amount);
    }

    function _request(uint256 requestId)
        internal
        view
        returns (
            address borrower,
            address market,
            uint16 aprBps,
            uint128 targetBorrow,
            uint128 minAcceptable,
            uint256 streamId
        )
    {
        return book.requests(requestId);
    }

    function _remaining(uint256 streamId) internal view returns (uint128) {
        return sablier.getDepositedAmount(streamId) - sablier.getWithdrawnAmount(streamId);
    }

    function _assertNoRequestFilled() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 filled = keccak256("RequestFilled(uint256,uint256,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != filled, "RequestFilled must not fire");
        }
    }
}
