// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPendleMarket {
    function expiry() external view returns (uint256);

    function increaseObservationsCardinalityNext(uint16 cardinalityNext) external;

    function readTokens()
        external
        view
        returns (address _SY, address _PT, address _YT);
}

