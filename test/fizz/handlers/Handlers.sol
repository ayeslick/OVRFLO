// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {OVRFLOHandler} from "./OVRFLOHandler.sol";
import {OVRFLOFactoryHandler} from "./OVRFLOFactoryHandler.sol";
import {LendingScenarios} from "./LendingScenarios.sol";

/// @notice Inherits from all the handlers to expose all entry points in a single contract.
///         Manages environment changes (e.g. current actor, current token, mocks setup, etc.).
abstract contract Handlers is OVRFLOHandler, OVRFLOFactoryHandler, LendingScenarios {
    function setCurrentActor(uint256 entropy) public {
        actor = actors[entropy % actors.length];
    }
}
