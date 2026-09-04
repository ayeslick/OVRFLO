// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOLending} from "./OVRFLOLending.sol";
import {StreamPricing} from "./StreamPricing.sol";

/// @dev Factory facet used only to bind `vault` at construction. The book is not
///      factory-registered (KD14).
interface ILendingVaultLookup {
    function lendingToOvrflo(address lending) external view returns (address);
}

/// @title OVRFLORequestBook
/// @notice Thin router that escrows an OVRFLO Stream until core `borrow` can fill
///         at the borrower's stored tick.
/// @dev The borrower picks `aprBps`. This contract never searches ticks, never
///      reads `tickDepths`, and never substitutes a cheaper tick. `post` learns
///      fill-or-rest from `previewBorrow`; core `borrow` is never inside `try/catch`.
///      Escrow uses plain `transferFrom` so `onERC721Received` is not a surface.
///      `nonReentrant` on the three entry points closes the window where a token
///      recipient could reenter the book while a core `borrow` is still paying.
contract OVRFLORequestBook is ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                  ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev A required constructor address argument was the zero address.
    error ZeroAddress();
    /// @dev `factory.lendingToOvrflo(lending)` is unset, so this book has no vault.
    error UnknownLending();
    /// @dev The supplied lockup is not `lending.sablier()`.
    error SablierMismatch();
    /// @dev `cancel` was called by an account other than the stored borrower.
    error NotBorrower(address caller, address borrower);
    /// @dev `requestId` is unknown, already filled, or already cancelled.
    error RequestMissing(uint256 requestId);
    /// @dev `lending.router()` is not this book, so on-behalf `borrow` is unsafe.
    error NotCurrentRouter(address current);

    /*//////////////////////////////////////////////////////////////
                                IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Factory that maps this book's lending market to its vault.
    address public immutable factory;
    /// @notice Lending market this book routes into.
    OVRFLOLending public immutable lending;
    /// @notice Lockup that holds posted stream NFTs.
    ISablierV2LockupLinear public immutable sablier;
    /// @notice Vault bound as `factory.lendingToOvrflo(lending)` at construction.
    address public immutable vault;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Next request id, monotonically increasing from 1.
    uint256 public nextRequestId = 1;

    /// @notice Resting borrow request. Empty after fill or cancel (`borrower == 0`).
    /// @dev Filled requests are deleted so the book holds nothing except resters.
    ///      There is no `loanId -> borrower` table. Close returns the stream to
    ///      `loan.borrower` on the market, which `onBehalfOf` set to the human.
    struct Request {
        address borrower;
        address market;
        uint16 aprBps;
        uint128 targetBorrow;
        uint128 minAcceptable;
        uint256 streamId;
    }

    /// @notice Request id => resting terms. Zeroed after fill or cancel.
    mapping(uint256 requestId => Request request) public requests;

    /// @notice Borrower => number of resting requests that borrower still holds.
    /// @dev Immediate fill never increments. Execute and cancel decrement.
    mapping(address borrower => uint256 count) public requestCount;

    /// @notice Borrower => zero-based index => resting request id.
    /// @dev Compacted on unlist. `requestAt(borrower, i)` for `i < requestCount`
    ///      is always a live `requests[id]` row for that borrower.
    mapping(address borrower => mapping(uint256 index => uint256 requestId)) public requestAt;

    /// @dev requestId => index in `requestAt[borrower]` plus one. Zero means unlisted.
    mapping(uint256 requestId => uint256 indexPlusOne) private requestIndex;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a borrower posts a stream. Fires on immediate fill and on rest.
    event RequestPosted(
        uint256 indexed requestId,
        address indexed borrower,
        address indexed market,
        uint256 streamId,
        uint16 aprBps,
        uint256 targetBorrow,
        uint256 minAcceptable
    );

    /// @notice Emitted when core `borrow` fills a request, at post time or on later `execute`.
    event RequestFilled(uint256 indexed requestId, uint256 indexed loanId, uint256 actualBorrow);

    /// @notice Emitted when the borrower reclaims a resting stream.
    event RequestCancelled(uint256 indexed requestId, address indexed borrower);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Binds factory, lending, and lockup. Approves the market to pull escrow.
    /// @dev Not factory-registered. `vault` is `lendingToOvrflo(lending)` so eligibility
    ///      uses the admitted column. `setApprovalForAll` is once, for this book as owner.
    /// @param factory_ Registry that maps the lending market to its vault.
    /// @param lending_ OVRFLOLending this book will call.
    /// @param sablier_ Lockup that must equal `lending.sablier()`.
    constructor(address factory_, address lending_, address sablier_) {
        if (factory_ == address(0)) revert ZeroAddress();
        if (lending_ == address(0)) revert ZeroAddress();
        if (sablier_ == address(0)) revert ZeroAddress();

        address vault_ = ILendingVaultLookup(factory_).lendingToOvrflo(lending_);
        if (vault_ == address(0)) revert UnknownLending();
        if (address(OVRFLOLending(lending_).sablier()) != sablier_) revert SablierMismatch();

        factory = factory_;
        lending = OVRFLOLending(lending_);
        sablier = ISablierV2LockupLinear(sablier_);
        vault = vault_;

        IERC721(sablier_).setApprovalForAll(lending_, true);
    }

    /*//////////////////////////////////////////////////////////////
                            REQUEST LIFECYCLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Posts a stream and terms. Fills immediately when the stored tick clears
    ///         `minAcceptable`; otherwise the request rests.
    /// @dev Fill-or-rest order (KD14): router gate, `requireEligible` plus
    ///      `MIN_STREAM_AMOUNT` (failure reverts `post`), `previewBorrow` in `try/catch`
    ///      that rests only on `EmptyTick` / `BelowMinimum` and re-reverts every other
    ///      error with the same data, then core `borrow` with `minAcceptable`. Core
    ///      `borrow` is never inside `try/catch`. The human must approve this book
    ///      on the lockup; approving only the lending market is not enough.
    /// @param streamId Stream NFT to escrow.
    /// @param market Pendle market identifying the collateral series.
    /// @param aprBps Exact tick the borrower chose. The book does not pick another.
    /// @param targetBorrow Desired principal in wei; core floors and caps live at fill.
    /// @param minAcceptable Minimum net proceeds the borrower accepts, in wei.
    /// @return requestId Newly allocated id. Filled ids keep no resting storage.
    function post(uint256 streamId, address market, uint16 aprBps, uint128 targetBorrow, uint128 minAcceptable)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (lending.router() != address(this)) revert NotCurrentRouter(lending.router());
        _requirePostEligible(market, streamId);

        requestId = nextRequestId++;
        Request memory req = Request({
            borrower: msg.sender,
            market: market,
            aprBps: aprBps,
            targetBorrow: targetBorrow,
            minAcceptable: minAcceptable,
            streamId: streamId
        });
        _postFillOrRest(requestId, req);
    }

    /// @notice Permissionless fill of a resting request at the stored `aprBps` only.
    /// @dev Safe as permissionless: proceeds, indexing, and the returned stream all
    ///      use the stored human via `onBehalfOf`. The caller earns no book fee.
    ///      Every core revert surfaces unchanged. No `try/catch`.
    /// @param requestId Resting request to fill.
    /// @return loanId Loan id originated by core `borrow`.
    function execute(uint256 requestId) external nonReentrant returns (uint256 loanId) {
        Request memory req = requests[requestId];
        if (req.borrower == address(0)) revert RequestMissing(requestId);
        if (lending.router() != address(this)) revert NotCurrentRouter(lending.router());

        loanId = lending.borrow(req.market, req.aprBps, req.targetBorrow, req.streamId, req.minAcceptable, req.borrower);
        delete requests[requestId];
        _unlist(requestId, req.borrower);
        emit RequestFilled(requestId, loanId, _actualBorrow(loanId));
    }

    /// @notice Borrower-only reclaim of a resting stream. Does not read the router slot.
    /// @dev After `setLendingRouter` moves or clears the slot, this is the only exit
    ///      for escrow this book still holds.
    /// @param requestId Resting request to cancel.
    function cancel(uint256 requestId) external nonReentrant {
        Request memory req = requests[requestId];
        if (req.borrower == address(0)) revert RequestMissing(requestId);
        if (msg.sender != req.borrower) revert NotBorrower(msg.sender, req.borrower);

        delete requests[requestId];
        _unlist(requestId, req.borrower);
        sablier.transferFrom(address(this), req.borrower, req.streamId);
        emit RequestCancelled(requestId, req.borrower);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Eligibility frame so `post` stays under the legacy pipeline stack limit.
    function _requirePostEligible(address market, uint256 streamId) internal view {
        StreamPricing.Eligibility memory eligibility =
            StreamPricing.requireEligible(address(sablier), vault, market, streamId);
        if (eligibility.remaining < lending.MIN_STREAM_AMOUNT()) revert OVRFLOLending.BelowMinimum();
    }

    /// @dev Preview-then-fill-or-rest frame. Core `borrow` stays outside `try/catch`.
    function _postFillOrRest(uint256 requestId, Request memory req) internal {
        try lending.previewBorrow(req.market, req.aprBps, req.targetBorrow, req.streamId) returns (
            uint128 actualBorrow, uint128 feeAmount, uint128
        ) {
            if (actualBorrow - feeAmount >= req.minAcceptable) {
                _escrowFrom(req.borrower, req.streamId);
                _emitPosted(requestId, req);
                _fill(requestId, req);
                return;
            }
            _rest(requestId, req);
        } catch (bytes memory revertData) {
            if (!_isDepthRest(revertData)) {
                _bubble(revertData);
            }
            _rest(requestId, req);
        }
    }

    /// @dev Pulls the stream with plain `transferFrom`. Never `safeTransferFrom`.
    function _escrowFrom(address from, uint256 streamId) internal {
        sablier.transferFrom(from, address(this), streamId);
    }

    /// @dev Writes resting storage, then pulls the stream (CEI). Emits `RequestPosted`.
    function _rest(uint256 requestId, Request memory req) internal {
        requests[requestId] = req;
        _list(requestId, req.borrower);
        _escrowFrom(req.borrower, req.streamId);
        _emitPosted(requestId, req);
    }

    /// @dev Append `requestId` to the borrower's resting list.
    function _list(uint256 requestId, address borrower) internal {
        uint256 index = requestCount[borrower];
        requestAt[borrower][index] = requestId;
        requestIndex[requestId] = index + 1;
        requestCount[borrower] = index + 1;
    }

    /// @dev Remove `requestId` from the borrower's resting list. Swap-compacts.
    ///      A missing index is a no-op so cancel still returns the stream if
    ///      the list and `requests` ever disagree.
    function _unlist(uint256 requestId, address borrower) internal {
        uint256 stored = requestIndex[requestId];
        if (stored == 0) return;
        uint256 index = stored - 1;
        uint256 last = requestCount[borrower] - 1;
        if (index != last) {
            uint256 moved = requestAt[borrower][last];
            requestAt[borrower][index] = moved;
            requestIndex[moved] = index + 1;
        }
        delete requestAt[borrower][last];
        delete requestIndex[requestId];
        requestCount[borrower] = last;
    }

    /// @dev Core `borrow` for an already-escrowed stream. `post` already checked
    ///      the router; the only call between that check and this fill is
    ///      `previewBorrow`, a view on the same lending contract. `execute` keeps
    ///      its own check. Never wrapped in `try/catch`.
    function _fill(uint256 requestId, Request memory req) internal {
        uint256 loanId =
            lending.borrow(req.market, req.aprBps, req.targetBorrow, req.streamId, req.minAcceptable, req.borrower);
        emit RequestFilled(requestId, loanId, _actualBorrow(loanId));
    }

    /// @dev Separate frame so `post` / `_rest` stay under the legacy stack limit.
    function _emitPosted(uint256 requestId, Request memory req) internal {
        emit RequestPosted(
            requestId, req.borrower, req.market, req.streamId, req.aprBps, req.targetBorrow, req.minAcceptable
        );
    }

    /// @dev `Borrowed.actualBorrow` equals the filled tape width in wei.
    function _actualBorrow(uint256 loanId) internal view returns (uint256 actualBorrow) {
        (,,,,,,, uint64 fillStart, uint64 fillEnd,,,) = lending.loans(loanId);
        actualBorrow = uint256(fillEnd - fillStart) * uint256(lending.UNIT());
    }

    /// @dev `previewBorrow` rest selectors only. Any other revert must surface.
    function _isDepthRest(bytes memory revertData) internal pure returns (bool) {
        if (revertData.length < 4) return false;
        bytes4 selector;
        assembly {
            selector := mload(add(revertData, 0x20))
        }
        return selector == OVRFLOLending.EmptyTick.selector || selector == OVRFLOLending.BelowMinimum.selector;
    }

    /// @dev Re-reverts `previewBorrow` data unchanged so InvalidTick / SpacingUnset /
    ///      ZeroTarget / eligibility errors never look like "waiting for liquidity."
    function _bubble(bytes memory revertData) internal pure {
        assembly {
            revert(add(revertData, 0x20), mload(revertData))
        }
    }
}
