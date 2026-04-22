// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {OVRFLOSeedRunner} from "./lib/OVRFLOSeedRunner.sol";

/// @notice Deploy + approve + seed a Tenderly Virtual Testnet so the UI
///         can be exercised against a shared devnet. Tenderly VTNs honor
///         foundry cheatcodes (`deal`, `vm.writeJson`) and broadcast
///         transactions over their standard JSON-RPC endpoint.
///
///         Required env:
///         - PRIVATE_KEY   — hex private key for the deployer/owner.
///                           Must be pre-funded with >= STETH_SEED_ETH
///                           plus gas headroom on the VTN.
///         - DEV_WALLET    — address receiving PT + stETH for UI testing.
///         - TENDERLY_RPC_URL — passed to `--rpc-url` on the CLI, not
///                              read here, but documented for operators.
///
/// Usage:
///     forge script script/SeedDevnet.s.sol \
///         --rpc-url $TENDERLY_RPC_URL \
///         --broadcast \
///         --slow
contract SeedDevnet is OVRFLOSeedRunner {
    function run() external {
        uint256 ownerPk = vm.envUint("PRIVATE_KEY");
        address devWallet = vm.envAddress("DEV_WALLET");

        require(block.chainid == 1, "SeedDevnet: Tenderly VTN must alias mainnet chain id");

        vm.startBroadcast(ownerPk);
        _runSeed(vm.addr(ownerPk), devWallet, "devnet");
        vm.stopBroadcast();
    }
}
