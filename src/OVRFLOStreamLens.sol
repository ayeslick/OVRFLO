// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

/// @title OVRFLOStreamLens
/// @notice Stateless read-only periphery that hydrates an owner's OVRFLO Streams in one call.
/// @dev Deployless by design: the frontend ships creation bytecode and calls via `eth_call`
///      with no `to`. This contract holds no storage, has no admin, and is never in a
///      transaction path. `lockup` is a call argument so the address stays in the query key.
///
///      Ownership invariant: this contract returns what it read. It does not filter rows
///      whose `owner` differs from the requested owner. The client maps an `ok` row with
///      a mismatched owner to unavailable.
///
///      `hydrateOne` is an external view so a reverting id can be wrapped in `try/catch`.
///      That helper enters the ABI. Callers must use the three batch reads, not `hydrateOne`.
contract OVRFLOStreamLens {
    /// @notice One hydrated stream. Flattened `getStream` amounts plus owner, withdrawable,
    ///         status, and status-derived flags.
    /// @dev `isDepleted` is `status == DEPLETED`. `wasCanceled` is `status == CANCELED`.
    ///      `isStream` is omitted: a non-stream id fails hydration and surfaces as `ok: false`.
    ///      `isTransferable` is omitted as unused. On `ok: false`, `streamId` is the requested
    ///      id and every other field is zero so callers correlate failures by id.
    struct StreamView {
        uint256 streamId;
        address owner;
        address sender;
        IERC20 asset;
        uint40 startTime;
        uint40 cliffTime;
        uint40 endTime;
        uint128 deposited;
        uint128 withdrawn;
        uint128 refunded;
        uint128 withdrawableAmount;
        uint8 status;
        bool isCancelable;
        bool isDepleted;
        bool wasCanceled;
        bool ok;
    }

    /*//////////////////////////////////////////////////////////////
                               READS
    //////////////////////////////////////////////////////////////*/

    /// @notice Complete set for `owner`. One call, no paging.
    /// @dev Returns empty when `balanceOf` is zero. Does not call `tokensOfOwnerIn(0, 0)`,
    ///      which reverts `SablierV2Lockup_InvalidQueryRange`.
    function streamsOfOwner(ISablierV2LockupLinear lockup, address owner) external view returns (StreamView[] memory) {
        uint256 n = lockup.balanceOf(owner);
        if (n == 0) {
            return new StreamView[](0);
        }
        return _hydrateIds(lockup, lockup.tokensOfOwnerIn(owner, 0, n));
    }

    /// @notice Windowed hydration for enumeration indices `[start, stop)`.
    /// @dev Passes `(owner, start, stop)` straight to `lockup.tokensOfOwnerIn`. This
    ///      function does not clamp or catch. `SablierV2Lockup_InvalidQueryRange`
    ///      bubbles when `start >= stop`. Lockup clamps `stop` to `balanceOf` and
    ///      returns empty when `start` is at or past that balance.
    function streamsOfOwnerIn(ISablierV2LockupLinear lockup, address owner, uint256 start, uint256 stop)
        external
        view
        returns (StreamView[] memory)
    {
        return _hydrateIds(lockup, lockup.tokensOfOwnerIn(owner, start, stop));
    }

    /// @notice Hydrate caller-supplied ids. No enumeration.
    /// @dev The only surface where `ok: false` is reachable today: a burned or never-minted
    ///      id reverts `ownerOf` / `getStream` inside `hydrateOne`. Neighbours keep their data.
    function streamsByIds(ISablierV2LockupLinear lockup, uint256[] calldata ids)
        external
        view
        returns (StreamView[] memory)
    {
        return _hydrateIds(lockup, ids);
    }

    /// @notice Hydrate one stream. Enters the ABI so `try this.hydrateOne` can catch a revert.
    /// @dev Not a product API. A revert here becomes `ok: false` in the batch reads. Bare
    ///      `catch` is required: the lockup reverts with custom errors, which
    ///      `catch Error(string)` does not catch.
    function hydrateOne(ISablierV2LockupLinear lockup, uint256 streamId) external view returns (StreamView memory row) {
        ISablierV2LockupLinear.Stream memory stream = lockup.getStream(streamId);
        uint8 status = uint8(lockup.statusOf(streamId));
        row.streamId = streamId;
        row.owner = lockup.ownerOf(streamId);
        row.sender = stream.sender;
        row.asset = stream.asset;
        row.startTime = stream.startTime;
        row.cliffTime = stream.cliffTime;
        row.endTime = stream.endTime;
        row.deposited = stream.amounts.deposited;
        row.withdrawn = stream.amounts.withdrawn;
        row.refunded = stream.amounts.refunded;
        row.withdrawableAmount = lockup.withdrawableAmountOf(streamId);
        row.status = status;
        row.isCancelable = stream.isCancelable;
        row.isDepleted = status == uint8(ISablierV2LockupLinear.Status.DEPLETED);
        row.wasCanceled = status == uint8(ISablierV2LockupLinear.Status.CANCELED);
        row.ok = true;
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Pre-allocates `new StreamView[](n)` and assigns by index. One extra CALL
    ///      per id is the try/catch tax: Solidity `try` binds to one external call.
    function _hydrateIds(ISablierV2LockupLinear lockup, uint256[] memory ids)
        internal
        view
        returns (StreamView[] memory views)
    {
        uint256 n = ids.length;
        views = new StreamView[](n);
        for (uint256 i; i < n; ++i) {
            try this.hydrateOne(lockup, ids[i]) returns (StreamView memory row) {
                views[i] = row;
            } catch {
                views[i].streamId = ids[i];
                views[i].ok = false;
            }
        }
    }
}
