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

        // This manifest is intentionally not deployable yet: the browser
        // requires factory/lending block hashes and a verified LendingDeployed
        // identity. After the vault + lending transactions complete — which
        // includes the multisig calling factory.setLendingTickSpacing(lending,
        // market, spacing) per market before supply/borrow become callable
        // (KTD5; spacing is set-once, so onboarding must set it correctly the
        // first time) — add their addresses (or let the verifier derive the
        // single pair) and run:
        // DEPLOYMENT_RPC_URL=... node tools/scripts/write-deployment-artifact.mjs \
        //   deployments/production.json
        // Runtime/build config rejects this partial file, so a factory address
        // alone can never become an implicit discovery anchor.
        string memory objectKey = "ovrflo_production_deployment";
        vm.serializeUint(objectKey, "formatVersion", 1);
        vm.serializeUint(objectKey, "projectionSchemaVersion", 1);
        vm.serializeUint(objectKey, "abiVersion", 1);
        vm.serializeBool(objectKey, "freshGeneration", true);
        vm.serializeUint(objectKey, "chainId", block.chainid);
        string memory pending = vm.serializeAddress(objectKey, "factory", address(factory));
        vm.writeJson(pending, "deployments/production.json");
    }
}
