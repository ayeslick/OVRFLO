// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {OVRFLOSeedRunner} from "./lib/OVRFLOSeedRunner.sol";

/// @notice Deploy + approve + seed a fresh anvil fork of mainnet for the
///         local UI loop. Run against an anvil fork that was started
///         with the same pinned MAINNET_FORK_BLOCK and --chain-id 1 so
///         the frontend (which enforces mainnet chain id) can connect.
///
///         Defaults are wired to anvil's standard mnemonic accounts:
///         - Owner / broadcaster: account #0 (0xf39F...2266)
///         - Dev wallet:          account #1 (0x7099...79C8)
///
///         Override either with PRIVATE_KEY / DEV_WALLET env vars.
///
/// Usage:
///     forge script script/SeedLocal.s.sol \
///         --rpc-url http://localhost:8545 \
///         --broadcast
contract SeedLocal is OVRFLOSeedRunner {
    uint256 internal constant ANVIL_ACCOUNT_0_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        uint256 ownerPk = vm.envOr("PRIVATE_KEY", ANVIL_ACCOUNT_0_PK);
        address devWallet = vm.envOr("DEV_WALLET", ANVIL_ACCOUNT_1);

        require(block.chainid == 1, "SeedLocal: anvil must run with --chain-id 1");

        vm.startBroadcast(ownerPk);
        _runSeed(vm.addr(ownerPk), devWallet, "local");
        vm.stopBroadcast();
    }
}
