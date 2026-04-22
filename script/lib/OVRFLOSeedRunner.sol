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
    uint256 internal constant STETH_SEED_ETH = 10 ether;

    /// @notice Deploy + configure the factory, approve both wstETH
    ///         markets, and seed the dev wallet with PT (via `deal`) and
    ///         stETH (owner submits ETH and transfers the minted shares
    ///         to `devWallet`).
    /// @param  owner        Broadcasting account; must already hold the
    ///                      broadcaster role.
    /// @param  devWallet    EOA the UI will drive; receives PT + stETH.
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
            payable(STETH).call{value: STETH_SEED_ETH}(abi.encodeWithSignature("submit(address)", address(0)));
        require(submitted, "OVRFLOSeedRunner: stETH submit failed");
        uint256 ownerStethBal = IERC20(STETH).balanceOf(owner);
        require(ownerStethBal > 0, "OVRFLOSeedRunner: zero stETH minted");
        require(IERC20(STETH).transfer(devWallet, ownerStethBal), "OVRFLOSeedRunner: stETH transfer failed");

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
