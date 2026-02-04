// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Admin} from "./Admin.sol";
import {OVFL} from "./OVFL.sol";

/// @title OVFLFactory
/// @notice Factory contract for deploying complete OVFL vault systems
/// @dev Atomically deploys Admin + OVFL + OVFLToken in a single transaction
contract OVFLFactory is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    struct VaultInfo {
        address adminContract;
        address treasury;
        address underlying;
        address ovflToken;
        address deployer;
    }

    uint256 public vaultCount;
    mapping(address => VaultInfo) public vaultInfoByVault;

    event VaultDeployed(
        address indexed deployer,
        address indexed ovfl,
        address indexed adminContract,
        address treasury,
        address underlying,
        address ovflToken
    );

    constructor(address owner) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(DEPLOYER_ROLE, owner);
    }
 
    /// @notice Deploys a complete OVFL vault system
    /// @param treasury The treasury address for fee collection
    /// @param underlying The underlying asset address (e.g., WETH)
    /// @param tokenName The name for the OVFLToken
    /// @param tokenSymbol The symbol for the OVFLToken
    /// @return adminContract The deployed Admin contract address
    /// @return ovfl The deployed OVFL contract address
    /// @return ovflToken The deployed OVFLToken address
    function deploy(
        address treasury,
        address underlying,
        string calldata tokenName,
        string calldata tokenSymbol
    ) external onlyRole(DEPLOYER_ROLE) returns (address adminContract, address ovfl, address ovflToken) {
        require(treasury != address(0), "OVFLFactory: treasury zero");
        require(underlying != address(0), "OVFLFactory: underlying zero");

        // 1. Deploy Admin with factory as temp admin
        Admin admin = new Admin(address(this));

        // 2. Deploy OVFL with Admin as adminContract
        OVFL vault = new OVFL(address(admin), treasury);

        // // 3. Link Admin to OVFL (required before approveUnderlying)
        admin.setOVFL(address(vault)); 

        // 4. Approve underlying and deploy OVFLToken (ownership transferred to OVFL)
        admin.approveUnderlying(underlying, tokenName, tokenSymbol);
        ovflToken = admin.underlyingToOvfl(underlying);

        // 5. Transfer admin role to deployer
        admin.grantRole(admin.ADMIN_ROLE(), msg.sender);

        // 6. Factory renounces admin role
        admin.renounceRole(admin.ADMIN_ROLE(), address(this));

        vaultCount += 1;
        vaultInfoByVault[address(vault)] = VaultInfo({
            adminContract: address(admin),
            treasury: treasury,
            underlying: underlying,
            ovflToken: ovflToken,
            deployer: msg.sender
        });

        emit VaultDeployed(msg.sender, address(vault), address(admin), treasury, underlying, ovflToken);
        return (address(admin), address(vault), ovflToken);
    }

    function vaultsLength() external view returns (uint256) {
        return vaultCount;
    }

    function getVaultInfo(address vault) external view returns (VaultInfo memory) {
        return vaultInfoByVault[vault];
    }

}
