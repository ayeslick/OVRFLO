// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPendleMarket} from "../../../interfaces/IPendleMarket.sol";

contract MockPendleMarket is IPendleMarket {
    uint256 public expiryTime;
    address public sy;
    address public pt;
    address public yt;

    constructor(uint256 _expiry, address _sy, address _pt, address _yt) {
        expiryTime = _expiry;
        sy = _sy;
        pt = _pt;
        yt = _yt;
    }

    function expiry() external view returns (uint256) { return expiryTime; }

    function readTokens() external view returns (address, address, address) {
        return (sy, pt, yt);
    }

    function increaseObservationsCardinalityNext(uint16) external {}
}
