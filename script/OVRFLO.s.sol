// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";

/// @notice Production factory deploy. This script deploys OVRFLOFactory only.
///
/// Operator runbook — Deploy sequence (binding). Production, local seed, and
/// devnet use this order. After each deploy, read the named getters and stop
/// on mismatch (SC23).
///
/// Anvil: `script/seed-local.sh` uses `forge create` + `cast send` for factory,
/// vault, and lending. It deploys the three fork contracts with
/// `cast send --create` from `artifacts/*.json`. Do not run this script with
/// `--broadcast` against Anvil (foundry#11714 / critical pattern #2).
/// Devnet (`bootstrap-devnet.sh`) may keep `forge script --broadcast`.
///
/// Do not pass the Safe or the deployer as `initialAdmin` on the lockup or the
/// comptroller. Pass the factory.
///
/// 1. Deploy `OVRFLOFactory(safe, pendleOracle)` — this script.
///    Read `owner() == safe` and `oracle() == pendleOracle`.
/// 2. Deploy the comptroller — Solidity `SablierV2Comptroller(factory)` —
///    from `artifacts/SablierV2Comptroller.json`. Fees stay 0.
///    Read `admin() == factory`.
/// 3. Deploy `OVRFLOStreamDescriptor()` from
///    `artifacts/OVRFLOStreamDescriptor.json`. Read `code.length > 0`.
///    The descriptor has no admin.
/// 4. Deploy the lockup — Solidity `SablierV2LockupLinear(factory, comptroller,
///    descriptor)`, deployed identity `OVRFLOStream` — from
///    `artifacts/OVRFLOStream.json`. Read `admin() == factory`,
///    `factory() == factory`, and `comptroller()` equals the deployed
///    comptroller.
/// 5. The Safe calls `setOvrfloStream(stream)`. Read
///    `factory.ovrfloStream() == stream`. A second call reverts.
/// 6. Deploy `OVRFLO`. Pass the factory as `admin`. Pass `stream` last.
///    Read `factory()` and `sablierLL()` on the vault. Do not add
///    `ovrfloStream()` on the vault.
/// 7. The Safe calls `registerOvrflo(vault)`. On-chain:
///    `vault.sablierLL() == factory.ovrfloStream()`. An address with treasury
///    zero calling `create*` reverts.
/// 8. Creation-wiring reads: `vault.reserve()`,
///    `reserve.ovrfloToken() == vault.ovrfloToken()`.
/// 9. Binding reads: `token.vault() == vault`, `token.reserve() == reserve`.
/// 10. Deploy `OVRFLOLending(factory, vault, stream)`. Read `owner() == factory`
///     and the stream binding equals `vault.sablierLL()`.
/// 11. The Safe calls `registerLending(lending)`. Do not re-check
///     `stream.factory()`, `stream.admin()`, or `comptroller.admin()`.
/// 12. The Safe calls `prepareOracle`, waits until the TWAP window is ready,
///     then `addMarket`, then `setLendingTickSpacing`.
/// 13. Write the deployment artifact. The writer derives the stream address
///     from the vault and cross-checks lending (SC24). The artifact's
///     `reserve` field follows the same paired-optional consume rule as
///     `ovrflo` and `lending`: both present or both derived. Frontend
///     `required()` on `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS` in both runtime
///     profiles. Do not add `NEXT_PUBLIC_OVRFLO_RESERVE`. The web learns
///     `reserve` from factory discovery.
///
/// Fork artifact create (lockup example):
/// ```
/// BYTECODE=$(jq -r .bytecode.object artifacts/OVRFLOStream.json)
/// ARGS=$(cast abi-encode "constructor(address,address,address)" \
///   "$FACTORY" "$COMPTROLLER" "$DESCRIPTOR")
/// cast send --rpc-url "$RPC" --private-key "$PK" --create "${BYTECODE}${ARGS#0x}"
/// ```
/// Comptroller: `constructor(address)` with the factory.
/// Descriptor: no constructor arguments.
///
/// Verify fork contracts from the OVRFLO-Streams repo. This repo does not
/// compile them. Pinned settings from artifact provenance:
/// solc 0.8.23, optimizer true, runs 1000, via_ir false, EVM paris,
/// `bytecode_hash = none`.
/// ```
/// forge verify-contract <addr> src/SablierV2LockupLinear.sol:SablierV2LockupLinear \
///   --compiler-version 0.8.23 --optimizer-runs 1000 --chain-id 1 \
///   --constructor-args $(cast abi-encode "constructor(address,address,address)" \
///     "$FACTORY" "$COMPTROLLER" "$DESCRIPTOR") \
///   --license GPL-3.0-or-later
/// ```
/// Comptroller: `src/SablierV2Comptroller.sol:SablierV2Comptroller`,
/// `constructor(address)`. Descriptor:
/// `src/OVRFLOStreamDescriptor.sol:OVRFLOStreamDescriptor`, no constructor args.
/// Same compiler flags and `--license GPL-3.0-or-later`.
///
/// Production `NEXT_PUBLIC_*` list (write-env / verify-deployment-input):
/// `NEXT_PUBLIC_RUNTIME_PROFILE`, `NEXT_PUBLIC_CHAIN_ID`,
/// `NEXT_PUBLIC_OVRFLO_FACTORY`, `NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK`,
/// `NEXT_PUBLIC_FACTORY_DEPLOYMENT_BLOCK_HASH`, `NEXT_PUBLIC_OVRFLO_ADDRESS`,
/// `NEXT_PUBLIC_OVRFLO_LENDING`, `NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK`,
/// `NEXT_PUBLIC_LENDING_DEPLOYMENT_BLOCK_HASH`,
/// `NEXT_PUBLIC_PROJECTION_SCHEMA_VERSION`, `NEXT_PUBLIC_ABI_VERSION`,
/// `NEXT_PUBLIC_SABLIER_LOCKUP_ADDRESS`, `NEXT_PUBLIC_RPC_URL`,
/// `NEXT_PUBLIC_RPC_FALLBACK_URLS`, `NEXT_PUBLIC_HISTORICAL_RPC_URL`,
/// `NEXT_PUBLIC_REOWN_PROJECT_ID`.
/// Do not add `NEXT_PUBLIC_OVRFLO_RESERVE`.
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

        // Partial manifest. The browser requires factory/lending block hashes
        // and a verified LendingRegistered identity. After steps 2–12 complete,
        // run write-deployment-artifact.mjs — it derives the stream address
        // (SC24) and the reserve address. Runtime/build config rejects this
        // partial file. Do not add NEXT_PUBLIC_OVRFLO_RESERVE.
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
