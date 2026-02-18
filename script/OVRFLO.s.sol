// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";

contract OVRFLOScript is Script {
    OVRFLOFactory public factory;

    function setUp() public {}

    function run() public {
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        vm.startBroadcast();

        factory = new OVRFLOFactory(multisig);

        console.log("OVRFLOFactory deployed to:", address(factory));
        console.log("Owner (multisig):", multisig);

        vm.stopBroadcast();
    }
}
