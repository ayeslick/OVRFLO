// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISablierV2LockupLinear {
    struct Durations {
        uint40 cliff;
        uint40 total;
    }

    struct Broker {
        address account;
        uint256 fee; // UD60x18 formatted
    }

    struct CreateWithDurations {
        address sender;
        address recipient;
        uint128 totalAmount;
        IERC20 asset;
        bool cancelable;
        bool transferable;
        Durations durations;
        Broker broker;
    }

    /// @notice Amounts sub-struct nested inside `Stream`. Mirrors `Lockup.Amounts`
    ///         from the deployed SablierV2LockupLinear exactly.
    struct Amounts {
        uint128 deposited;
        uint128 withdrawn;
        uint128 refunded;
    }

    /// @notice Full stream record returned by `getStream`. Mirrors the deployed
    ///         SablierV2LockupLinear `LockupLinear.Stream` struct exactly (field order
    ///         and types), verified via `cast call` against the mainnet contract at
    ///         `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (13-word return). The
    ///         `wasCanceled`/`isDepleted`/`isStream`/`isTransferable` fields and
    ///         `amounts.refunded` are ignored by `requireEligible`.
    struct Stream {
        address sender;
        uint40 startTime;
        uint40 cliffTime;
        bool isCancelable;
        bool wasCanceled;
        IERC20 asset;
        uint40 endTime;
        bool isDepleted;
        bool isStream;
        bool isTransferable;
        Amounts amounts;
    }

    function createWithDurations(CreateWithDurations calldata params) external returns (uint256 streamId);

    function getSender(uint256 streamId) external view returns (address sender);

    function getAsset(uint256 streamId) external view returns (IERC20 asset);

    function getEndTime(uint256 streamId) external view returns (uint40 endTime);

    function getStartTime(uint256 streamId) external view returns (uint40 startTime);

    function getCliffTime(uint256 streamId) external view returns (uint40 cliffTime);

    function isCancelable(uint256 streamId) external view returns (bool result);

    function getDepositedAmount(uint256 streamId) external view returns (uint128 depositedAmount);

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128 withdrawnAmount);

    function getStream(uint256 streamId) external view returns (Stream memory stream);

    function withdrawableAmountOf(uint256 streamId) external view returns (uint128 withdrawableAmount);

    function withdraw(uint256 streamId, address to, uint128 amount) external;

    function withdrawMultiple(uint256[] calldata streamIds, address to, uint128[] calldata amounts) external;

    function transferFrom(address from, address to, uint256 tokenId) external;

    function ownerOf(uint256 tokenId) external view returns (address owner);
}

