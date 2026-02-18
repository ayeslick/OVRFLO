// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {OVRFLO} from "./OVRFLO.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";

/// @title OVRFLOFactory
/// @notice Factory and admin hub for deploying and managing OVRFLO vault systems
/// @dev Owned by a timelocked multisig. Deploys OVRFLO + OVRFLOToken and serves as
///      the adminContract for every vault it creates.
contract OVRFLOFactory {
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
        address ovrfloToken;
    }

    DeploymentConfig public pendingDeployment;

    uint256 public vaultCount;
    mapping(address => VaultInfo) public vaultInfo;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event DeploymentConfigured(address indexed treasury, address indexed underlying);
    event DeploymentCancelled();
    event VaultDeployed(address indexed ovrflo, address indexed ovrfloToken, address treasury, address underlying);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        require(msg.sender == owner, "OVRFLOFactory: not owner");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner) {
        require(_owner != address(0), "OVRFLOFactory: owner zero");
        owner = _owner;
    }

    /*//////////////////////////////////////////////////////////////
                          DEPLOYMENT (TWO-STEP)
    //////////////////////////////////////////////////////////////*/

    /// @notice Stage deployment parameters (called by multisig)
    /// @param treasury The treasury address for fee collection
    /// @param underlying The underlying asset address (e.g., WETH)
    function configureDeployment(address treasury, address underlying) external onlyOwner {
        require(treasury != address(0), "OVRFLOFactory: treasury zero");
        require(underlying != address(0), "OVRFLOFactory: underlying zero");

        pendingDeployment = DeploymentConfig({treasury: treasury, pending: true, underlying: underlying});

        emit DeploymentConfigured(treasury, underlying);
    }

    /// @notice Cancel a pending deployment
    function cancelDeployment() external onlyOwner {
        require(pendingDeployment.pending, "OVRFLOFactory: nothing pending");
        delete pendingDeployment;
        emit DeploymentCancelled();
    }

    /// @notice Execute deployment from stored config
    /// @return vault The deployed OVRFLO contract address
    /// @return ovrfloToken The deployed OVRFLOToken address
    function deploy() external onlyOwner returns (address vault, address ovrfloToken) {
        require(pendingDeployment.pending, "OVRFLOFactory: nothing pending");

        DeploymentConfig memory config = pendingDeployment;

        delete pendingDeployment;

        OVRFLO v = new OVRFLO(address(this), config.treasury);

        string memory tokenName = IERC20Metadata(config.underlying).name();
        string memory tokenSymbol = IERC20Metadata(config.underlying).symbol();
        OVRFLOToken token = new OVRFLOToken(
            string(abi.encodePacked("OVRFLO ", tokenName)),
            string(abi.encodePacked("ovrflo", tokenSymbol))
        );
        token.transferOwnership(address(v));

        vault = address(v);
        ovrfloToken = address(token);

        vaultCount += 1;
        vaultInfo[vault] = VaultInfo({treasury: config.treasury, underlying: config.underlying, ovrfloToken: ovrfloToken});

        emit VaultDeployed(vault, ovrfloToken, config.treasury, config.underlying);
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
        address ovrfloToken,
        uint32 twapDuration,
        uint256 expiry,
        uint16 feeBps
    ) external onlyOwner {
        _requireKnownVault(vault);
        OVRFLO(vault).setSeriesApproved(market, pt, underlying, ovrfloToken, twapDuration, expiry, feeBps);
    }

    /// @notice Set the deposit limit for a market on a vault
    function setMarketDepositLimit(address vault, address market, uint256 limit) external onlyOwner {
        _requireKnownVault(vault);
        OVRFLO(vault).setMarketDepositLimit(market, limit);
    }

    /// @notice Sweep excess PT tokens from a vault
    function sweepExcessPt(address vault, address ptToken, address to) external onlyOwner {
        _requireKnownVault(vault);
        OVRFLO(vault).sweepExcessPt(ptToken, to);
    }

    /// @notice Disable deposits for a market series on a vault
    function disableSeries(address vault, address market) external onlyOwner {
        _requireKnownVault(vault);
        OVRFLO(vault).disableSeries(market);
    }

    /// @notice Re-enable a previously configured market series on a vault
    function enableSeries(address vault, address market) external onlyOwner {
        _requireKnownVault(vault);
        OVRFLO(vault).enableSeries(market);
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
        require(newAdmin != address(0), "OVRFLOFactory: newAdmin zero");
        OVRFLO(vault).setAdminContract(newAdmin);
        delete vaultInfo[vault];
    }

    /// @notice Transfer factory ownership to a new address
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "OVRFLOFactory: newOwner zero");
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
        require(vaultInfo[vault].treasury != address(0), "OVRFLOFactory: unknown vault");
    }
}
