// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OVFLFactory} from "../src/OVFLFactory.sol";

contract OVFLScript is Script {
    OVFLFactory public factory;

    function setUp() public {}

    function run() public {
        address multisig = vm.envAddress("MULTISIG_ADDRESS");

        vm.startBroadcast();

        factory = new OVFLFactory(multisig);

        console.log("OVFLFactory deployed to:", address(factory));
        console.log("Owner (multisig):", multisig);

        vm.stopBroadcast();
    }
}
