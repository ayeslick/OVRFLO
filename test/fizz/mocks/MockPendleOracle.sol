// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPendleOracle} from "../../../interfaces/IPendleOracle.sol";

contract MockPendleOracle is IPendleOracle {
    uint256 public rate = 0.95e18; // 5% discount by default

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function getPtToSyRate(address, uint32) external view returns (uint256) {
        return rate;
    }

    function getOracleState(address, uint32) external pure returns (bool, uint16, bool) {
        return (false, 0, true); // no cardinality increase needed, oldest observation satisfied
    }
}
