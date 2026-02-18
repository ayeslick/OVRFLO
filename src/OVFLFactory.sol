// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {OVFL} from "./OVFL.sol";
import {OVFLToken} from "./OVFLToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";

/// @title OVFLFactory
/// @notice Factory and admin hub for deploying and managing OVFL vault systems
/// @dev Owned by a timelocked multisig. Deploys OVFL + OVFLToken and serves as
///      the adminContract for every vault it creates.
contract OVFLFactory {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public owner;

    IPendleOracle public constant PENDLE_ORACLE = IPendleOracle(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);

    struct DeploymentConfig {
        address treasury;
        bool pending;
        address underlying;
    }

    struct VaultInfo {
        address treasury;
        address underlying;
        address ovflToken;
    }

    DeploymentConfig public pendingDeployment;

    uint256 public vaultCount;
    mapping(address => VaultInfo) public vaultInfo;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event DeploymentConfigured(address indexed treasury, address indexed underlying);
    event DeploymentCancelled();
    event VaultDeployed(address indexed ovfl, address indexed ovflToken, address treasury, address underlying);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        require(msg.sender == owner, "OVFLFactory: not owner");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner) {
        require(_owner != address(0), "OVFLFactory: owner zero");
        owner = _owner;
    }

    /*//////////////////////////////////////////////////////////////
                          DEPLOYMENT (TWO-STEP)
    //////////////////////////////////////////////////////////////*/

    /// @notice Stage deployment parameters (called by multisig)
    /// @param treasury The treasury address for fee collection
    /// @param underlying The underlying asset address (e.g., WETH)
    function configureDeployment(address treasury, address underlying) external onlyOwner {
        require(treasury != address(0), "OVFLFactory: treasury zero");
        require(underlying != address(0), "OVFLFactory: underlying zero");

        pendingDeployment = DeploymentConfig({treasury: treasury, pending: true, underlying: underlying});

        emit DeploymentConfigured(treasury, underlying);
    }

    /// @notice Cancel a pending deployment
    function cancelDeployment() external onlyOwner {
        require(pendingDeployment.pending, "OVFLFactory: nothing pending");
        delete pendingDeployment;
        emit DeploymentCancelled();
    }

    /// @notice Execute deployment from stored config
    /// @return vault The deployed OVFL contract address
    /// @return ovflToken The deployed OVFLToken address
    function deploy() external onlyOwner returns (address vault, address ovflToken) {
        require(pendingDeployment.pending, "OVFLFactory: nothing pending");

        DeploymentConfig memory config = pendingDeployment;

        delete pendingDeployment;

        OVFL v = new OVFL(address(this), config.treasury);

        string memory tokenName = IERC20Metadata(config.underlying).name();
        string memory tokenSymbol = IERC20Metadata(config.underlying).symbol();
        OVFLToken token = new OVFLToken(
            string(abi.encodePacked("OVRFLO ", tokenName)),
            string(abi.encodePacked("ovrflo", tokenSymbol))
        );
        token.transferOwnership(address(v));

        vault = address(v);
        ovflToken = address(token);

        vaultCount += 1;
        vaultInfo[vault] = VaultInfo({treasury: config.treasury, underlying: config.underlying, ovflToken: ovflToken});

        emit VaultDeployed(vault, ovflToken, config.treasury, config.underlying);
    }

    /*//////////////////////////////////////////////////////////////
                     ADMIN FORWARDING (PER-VAULT)
    //////////////////////////////////////////////////////////////*/

    /// @notice Approve a market series on a vault
    function setSeriesApproved(
        address vault,
        address market,
        address pt,
        address underlying,
        address ovflToken,
        uint32 twapDuration,
        uint256 expiry,
        uint16 feeBps
    ) external onlyOwner {
        _requireKnownVault(vault);
        OVFL(vault).setSeriesApproved(market, pt, underlying, ovflToken, twapDuration, expiry, feeBps);
    }

    /// @notice Set the deposit limit for a market on a vault
    function setMarketDepositLimit(address vault, address market, uint256 limit) external onlyOwner {
        _requireKnownVault(vault);
        OVFL(vault).setMarketDepositLimit(market, limit);
    }

    /// @notice Sweep excess PT tokens from a vault
    function sweepExcessPt(address vault, address ptToken, address to) external onlyOwner {
        _requireKnownVault(vault);
        OVFL(vault).sweepExcessPt(ptToken, to);
    }

    /// @notice Increase Pendle oracle cardinality for a market (must be done before series approval)
    function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) =
            PENDLE_ORACLE.getOracleState(market, twapDuration);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }
    }

    /*//////////////////////////////////////////////////////////////
                            UPGRADEABILITY
    //////////////////////////////////////////////////////////////*/

    /// @notice Transfer admin of a specific vault to a new address (e.g., a new factory)
    function transferVaultAdmin(address vault, address newAdmin) external onlyOwner {
        _requireKnownVault(vault);
        require(newAdmin != address(0), "OVFLFactory: newAdmin zero");
        OVFL(vault).setAdminContract(newAdmin);
        delete vaultInfo[vault];
    }

    /// @notice Transfer factory ownership to a new address
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OVFLFactory: newOwner zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getVaultInfo(address vault) external view returns (VaultInfo memory) {
        return vaultInfo[vault];
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _requireKnownVault(address vault) internal view {
        require(vaultInfo[vault].treasury != address(0), "OVFLFactory: unknown vault");
    }
}
