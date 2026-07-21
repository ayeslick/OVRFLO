// SPDX-License-Identifier: Unlicense
pragma solidity >=0.6.2 <0.9.0;

import {Logger} from "./Logger.sol";
import {StringUtils} from "./StringUtils.sol";

/// @author Modified from Crytic (https://github.com/crytic/properties/blob/main/contracts/util/PropertiesAsserts.sol)
contract Clamp is StringUtils {
    /// @notice Clamps value to be between low and high, both inclusive
    function clampBetween(uint256 value, uint256 low, uint256 high) internal returns (uint256) {
        if (value < low || value > high) {
            uint256 range = high - low;
            uint256 ans = low + (value % (range + 1));
            // When range == type(uint256).max (low=0, high=max), range+1 overflows
            // to 0 causing division by zero. In that case any value is already in
            // range, so this branch is only reachable when range < type(uint256).max.
            string memory valueStr = toString(value);
            string memory ansStr = toString(ans);
            bytes memory message = abi.encodePacked("Clamping value ", valueStr, " to ", ansStr);
            Logger.logString(string(message));
            return ans;
        }
        return value;
    }
}
