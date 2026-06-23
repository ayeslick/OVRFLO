// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {OVRFLOTestFixtures} from "./OVRFLOTestFixtures.sol";

/// @notice Shared deployment + market-approval + dev-wallet seeding flow
///         used by both {SeedLocal} (anvil fork of mainnet) and
///         {SeedDevnet} (Tenderly Virtual Testnet). Inherits
///         {OVRFLOTestFixtures} for protocol constants and {StdCheats}
///         for the `deal` cheatcode used to populate Pendle PT balances
///         on the dev wallet.
///
///         Subclasses call {_runSeed} from inside
///         `vm.startBroadcast(ownerPk)` so every onlyOwner factory call
///         is a real transaction signed by the owner.
abstract contract OVRFLOSeedRunner is Script, StdCheats, OVRFLOTestFixtures {
    uint256 internal constant PT_SEED_AMOUNT = 1_000 ether;
    uint256 internal constant WSTETH_SEED_ETH = 10 ether;

    /// @dev Headroom over WSTETH_SEED_ETH so the owner retains gas-paying
    ///      ETH after minting and wrapping stETH. Set generously because on some anvil
    ///      versions dev accounts inherit their real mainnet balances
    ///      rather than the nominal 10,000 ETH default.
    uint256 internal constant OWNER_GAS_HEADROOM = 90 ether;

    /// @notice Fund `owner` on a Tenderly Virtual Testnet via
    ///         `tenderly_setBalance`. Two writes are required, not one:
    ///         1. `vm.rpc("tenderly_setBalance", ...)` mutates the live
    ///            node. Without it, Forge's broadcast phase re-validates
    ///            each transaction against the node's real balance and
    ///            rejects tx fees as `lack of funds`.
    ///         2. `vm.deal` mutates the in-memory simulator. Forge's
    ///            simulator reads RPC balances lazily and does NOT
    ///            re-read them after a `*_setBalance` RPC call.
    ///         Must be called BEFORE `vm.startBroadcast`. No-op when the
    ///         observed balance already meets the target.
    ///
    ///         Anvil (local fork) is not handled here — it is driven by
    ///         `script/seed-local.sh`, which sidesteps the
    ///         `eth_getAccountInfo` regression in foundry#11714 that
    ///         breaks `forge script --broadcast` against forked anvil.
    function _ensureTenderlyBroadcasterFunded(address owner, uint256 targetBalance) internal {
        if (owner.balance >= targetBalance) return;

        // tenderly_setBalance params: [[address], hex-encoded quantity]
        string memory params =
            string.concat('[["', vm.toString(owner), '"],"', vm.toString(bytes32(targetBalance)), '"]');
        vm.rpc("tenderly_setBalance", params);
        vm.deal(owner, targetBalance);
    }

    /// @notice Deploy + configure the factory, approve both wstETH
    ///         markets, and seed the dev wallet with PT (via `deal`) and
    ///         wstETH (owner submits ETH, wraps stETH, and transfers wstETH
    ///         to `devWallet`).
    /// @param  owner        Broadcasting account; must already hold the
    ///                      broadcaster role.
    /// @param  devWallet    EOA the UI will drive; receives PT + wstETH.
    /// @param  networkKey   File label for the output JSON
    ///                      (`deployments/<networkKey>.json`).
    function _runSeed(address owner, address devWallet, string memory networkKey)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        (factory, ovrflo, token) = _deployConfiguredSystemAs(owner);

        _prepareOracleAs(factory, PRIMARY_MARKET);
        _prepareOracleAs(factory, SECONDARY_MARKET);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, address(ORACLE), MIN_TWAP_DURATION, 25);
        factory.addMarket(address(ovrflo), SECONDARY_MARKET, address(ORACLE), MIN_TWAP_DURATION, 10);

        deal(PRIMARY_PT, devWallet, PT_SEED_AMOUNT);
        deal(SECONDARY_PT, devWallet, PT_SEED_AMOUNT);

        (bool submitted,) =
            payable(STETH).call{value: WSTETH_SEED_ETH}(abi.encodeWithSignature("submit(address)", address(0)));
        require(submitted, "OVRFLOSeedRunner: stETH submit failed");
        uint256 ownerStethBal = IERC20(STETH).balanceOf(owner);
        require(ownerStethBal > 0, "OVRFLOSeedRunner: zero stETH minted");
        require(IERC20(STETH).approve(WSTETH, ownerStethBal), "OVRFLOSeedRunner: stETH approve failed");
        (bool wrapped,) = WSTETH.call(abi.encodeWithSignature("wrap(uint256)", ownerStethBal));
        require(wrapped, "OVRFLOSeedRunner: wstETH wrap failed");
        uint256 ownerWstethBal = IERC20(WSTETH).balanceOf(owner);
        require(ownerWstethBal > 0, "OVRFLOSeedRunner: zero wstETH minted");
        require(IERC20(WSTETH).transfer(devWallet, ownerWstethBal), "OVRFLOSeedRunner: wstETH transfer failed");

        _writeDeployments(networkKey, factory, ovrflo, token, devWallet);
        _logSummary(networkKey, owner, devWallet, factory, ovrflo, token);
    }

    function _writeDeployments(
        string memory networkKey,
        OVRFLOFactory factory,
        OVRFLO ovrflo,
        OVRFLOToken token,
        address devWallet
    ) private {
        string memory obj = "ovrflo_deployments";
        vm.serializeAddress(obj, "factory", address(factory));
        vm.serializeAddress(obj, "ovrflo", address(ovrflo));
        vm.serializeAddress(obj, "token", address(token));
        vm.serializeAddress(obj, "devWallet", devWallet);
        string memory out = vm.serializeUint(obj, "chainId", block.chainid);
        vm.writeJson(out, string.concat("deployments/", networkKey, ".json"));
    }

    function _logSummary(
        string memory networkKey,
        address owner,
        address devWallet,
        OVRFLOFactory factory,
        OVRFLO ovrflo,
        OVRFLOToken token
    ) private view {
        console.log("=== OVRFLO seed complete ===");
        console.log("network:  ", networkKey);
        console.log("chainId:  ", block.chainid);
        console.log("owner:    ", owner);
        console.log("factory:  ", address(factory));
        console.log("ovrflo:   ", address(ovrflo));
        console.log("token:    ", address(token));
        console.log("devWallet:", devWallet);
    }
}
