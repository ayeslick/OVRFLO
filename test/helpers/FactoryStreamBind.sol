// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {MockSablier, MockSablierComptroller} from "../fizz/mocks/MockSablier.sol";

/// @notice Deploys a mock OVRFLO Stream whose factory/admin/comptroller.admin equal `factory`.
abstract contract FactoryStreamBind is Test {
    MockSablier internal canonicalStream;
    MockSablierComptroller internal canonicalComptroller;

    /// @dev Caller must be `factory.owner()`.
    function _bindCanonicalStream(OVRFLOFactory factory) internal returns (address stream) {
        canonicalComptroller = new MockSablierComptroller(address(factory));
        canonicalStream = new MockSablier(address(factory), address(factory), address(canonicalComptroller));
        vm.prank(factory.owner());
        factory.setOvrfloStream(address(canonicalStream));
        return address(canonicalStream);
    }
}
