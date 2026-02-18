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
}

