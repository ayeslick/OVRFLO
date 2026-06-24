// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";

contract OVRFLOScript is Script {
    OVRFLOFactory public factory;

    /// @dev Pendle TWAP oracle — singleton at the same address on all chains.
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;

    function setUp() public {}

    function run() public {
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        vm.startBroadcast();

        factory = new OVRFLOFactory(multisig, PENDLE_ORACLE);

        console.log("OVRFLOFactory deployed to:", address(factory));
        console.log("Owner (multisig):", multisig);

        vm.stopBroadcast();
    }
}
