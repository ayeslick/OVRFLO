// SPDX-License-Identifier: UNLICENSED
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

    function createWithDurations(CreateWithDurations calldata params) external returns (uint256 streamId);

    function getSender(uint256 streamId) external view returns (address sender);

    function getAsset(uint256 streamId) external view returns (IERC20 asset);

    function getEndTime(uint256 streamId) external view returns (uint40 endTime);

    function getCliffTime(uint256 streamId) external view returns (uint40 cliffTime);

    function isCancelable(uint256 streamId) external view returns (bool result);

    function getDepositedAmount(uint256 streamId) external view returns (uint128 depositedAmount);

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128 withdrawnAmount);

    function withdrawableAmountOf(uint256 streamId) external view returns (uint128 withdrawableAmount);

    function withdraw(uint256 streamId, address to, uint128 amount) external;

    function withdrawMultiple(uint256[] calldata streamIds, address to, uint128[] calldata amounts) external;

    function transferFrom(address from, address to, uint256 tokenId) external;

    function ownerOf(uint256 tokenId) external view returns (address owner);
}

