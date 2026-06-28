// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPendleOracle {
    function getPtToSyRate(address market, uint32 twapDuration) external view returns (uint256);

    function getOracleState(address market, uint32 duration)
        external
        view
        returns (bool increaseCardinalityRequired, uint16 cardinalityRequired, bool oldestObservationSatisfied);
}

