// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {OVRFLO} from "./OVRFLO.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";

/// @title OVRFLOFactory
/// @notice Factory and admin hub for deploying and managing OVRFLO systems
/// @dev Owned by a timelocked multisig. Deploys OVRFLO + OVRFLOToken and serves as
///      the adminContract for every OVRFLO it creates.
contract OVRFLOFactory {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public owner;

    IPendleOracle public constant PENDLE_ORACLE = IPendleOracle(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);

    uint256 public constant FEE_MAX_BPS = 100;
    uint32 public constant MIN_TWAP_DURATION = 15 minutes;

    struct DeploymentConfig {
        address treasury;
        bool pending;
        address underlying;
    }

    struct OvrfloInfo {
        address treasury;
        address underlying;
        address ovrfloToken;
    }

    DeploymentConfig public pendingDeployment;

    uint256 public ovrfloCount;
    mapping(uint256 => address) public ovrflos;
    mapping(address => OvrfloInfo) public ovrfloInfo;

    mapping(address ovrflo => uint256) public approvedMarketCount;
    mapping(address ovrflo => mapping(uint256 index => address)) public approvedMarketAt;
    mapping(address ovrflo => mapping(address market => bool)) public isMarketApproved;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event DeploymentConfigured(address indexed treasury, address indexed underlying);
    event DeploymentCancelled();
    event OvrfloDeployed(address indexed ovrflo, address indexed ovrfloToken, address treasury, address underlying);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OvrfloAdminTransferred(address indexed ovrflo, address indexed newAdmin);

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
    /// @return ovrflo The deployed OVRFLO contract address
    /// @return ovrfloToken The deployed OVRFLOToken address
    function deploy() external onlyOwner returns (address ovrflo, address ovrfloToken) {
        require(pendingDeployment.pending, "OVRFLOFactory: nothing pending");

        DeploymentConfig memory config = pendingDeployment;

        delete pendingDeployment;

        OVRFLO v = new OVRFLO(address(this), config.treasury);

        string memory tokenName = IERC20Metadata(config.underlying).name();
        string memory tokenSymbol = IERC20Metadata(config.underlying).symbol();
        uint8 tokenDecimals = IERC20Metadata(config.underlying).decimals();
        OVRFLOToken token = new OVRFLOToken(
            string(abi.encodePacked("OVRFLO ", tokenName)), string(abi.encodePacked("ovrflo", tokenSymbol)), tokenDecimals
        );
        token.transferOwnership(address(v));

        ovrflo = address(v);
        ovrfloToken = address(token);

        ovrflos[ovrfloCount] = ovrflo;
        ovrfloCount += 1;
        ovrfloInfo[ovrflo] =
            OvrfloInfo({treasury: config.treasury, underlying: config.underlying, ovrfloToken: ovrfloToken});

        emit OvrfloDeployed(ovrflo, ovrfloToken, config.treasury, config.underlying);
    }

    /*//////////////////////////////////////////////////////////////
                     ADMIN FORWARDING (PER-OVRFLO)
    //////////////////////////////////////////////////////////////*/

    /// @notice Add a PT maturity to an OVRFLO (reads pt/expiry from Pendle market automatically)
    /// @param ovrflo The OVRFLO contract address
    /// @param market The Pendle market address
    /// @param twapDuration TWAP duration in seconds
    /// @param feeBps Fee in basis points (max FEE_MAX_BPS)
    function addMarket(address ovrflo, address market, uint32 twapDuration, uint16 feeBps) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
        require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high");

        (bool increaseCardinalityRequired,, bool oldestObservationSatisfied) =
            PENDLE_ORACLE.getOracleState(market, twapDuration);
        require(!increaseCardinalityRequired, "OVRFLOFactory: oracle cardinality");
        require(oldestObservationSatisfied, "OVRFLOFactory: oracle not ready");

        OvrfloInfo memory info = ovrfloInfo[ovrflo];
        (, address pt,) = IPendleMarket(market).readTokens();
        uint256 expiry = IPendleMarket(market).expiry();

        OVRFLO(ovrflo).setSeriesApproved(market, pt, info.underlying, info.ovrfloToken, twapDuration, expiry, feeBps);

        if (!isMarketApproved[ovrflo][market]) {
            isMarketApproved[ovrflo][market] = true;
            approvedMarketAt[ovrflo][approvedMarketCount[ovrflo]] = market;
            approvedMarketCount[ovrflo]++;
        }
    }

    /// @notice Set the deposit limit for a market on an OVRFLO
    function setMarketDepositLimit(address ovrflo, address market, uint256 limit) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).setMarketDepositLimit(market, limit);
    }

    /// @notice Sweep excess PT tokens from an OVRFLO
    function sweepExcessPt(address ovrflo, address ptToken, address to) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).sweepExcessPt(ptToken, to);
    }

    /// @notice Increase Pendle oracle cardinality for a market (must be done before addMarket)
    function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
        require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) =
            PENDLE_ORACLE.getOracleState(market, twapDuration);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }
    }

    /*//////////////////////////////////////////////////////////////
                            UPGRADEABILITY
    //////////////////////////////////////////////////////////////*/

    /// @notice Transfer admin of a specific OVRFLO to a new address (e.g., a new factory)
    function transferOvrfloAdmin(address ovrflo, address newAdmin) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        require(newAdmin != address(0), "OVRFLOFactory: newAdmin zero");
        OVRFLO(ovrflo).setAdminContract(newAdmin);
        delete ovrfloInfo[ovrflo];
        emit OvrfloAdminTransferred(ovrflo, newAdmin);
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

    function getOvrfloInfo(address ovrflo) external view returns (OvrfloInfo memory) {
        return ovrfloInfo[ovrflo];
    }

    function getApprovedMarket(address ovrflo, uint256 index) external view returns (address) {
        return approvedMarketAt[ovrflo][index];
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _requireKnownOvrflo(address ovrflo) internal view {
        require(ovrfloInfo[ovrflo].treasury != address(0), "OVRFLOFactory: unknown ovrflo");
    }
}
