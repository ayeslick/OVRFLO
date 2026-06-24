// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {OVRFLO} from "./OVRFLO.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {IStandardizedYield} from "../interfaces/IStandardizedYield.sol";

/// @title OVRFLOFactory
/// @notice Factory and admin hub for deploying and managing OVRFLO systems
/// @dev Owned by a timelocked multisig. Deploys OVRFLO + OVRFLOToken and serves as
///      the adminContract for every OVRFLO it creates. Ownership uses the OZ
///      two-step pattern (`transferOwnership` -> `acceptOwnership`).
contract OVRFLOFactory is Ownable2Step {
    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 public constant FEE_MAX_BPS = 100;
    uint32 public constant MIN_TWAP_DURATION = 15 minutes;
    uint32 public constant MAX_TWAP_DURATION = 30 minutes;

    struct DeploymentConfig {
        address treasury;
        bool pending;
        address underlying;
        string nameSuffix;
        string symbolSuffix;
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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner) {
        require(_owner != address(0), "OVRFLOFactory: owner zero");
        _transferOwnership(_owner);
    }

    /*//////////////////////////////////////////////////////////////
                          DEPLOYMENT (TWO-STEP)
    //////////////////////////////////////////////////////////////*/

    /// @notice Stage deployment parameters (called by multisig)
    /// @param treasury The treasury address for fee collection
    /// @param underlying The underlying asset address (e.g., WETH)
    /// @param nameSuffix Asset-specific portion of the token name (factory prepends "OVRFLO ")
    /// @param symbolSuffix Asset-specific portion of the token symbol (factory prepends "ovrflo")
    function configureDeployment(
        address treasury,
        address underlying,
        string calldata nameSuffix,
        string calldata symbolSuffix
    ) external onlyOwner {
        require(treasury != address(0), "OVRFLOFactory: treasury zero");
        require(underlying != address(0), "OVRFLOFactory: underlying zero");
        require(bytes(nameSuffix).length != 0 && bytes(nameSuffix).length <= 64, "OVRFLOFactory: bad name");
        require(bytes(symbolSuffix).length != 0 && bytes(symbolSuffix).length <= 32, "OVRFLOFactory: bad symbol");

        pendingDeployment = DeploymentConfig({
            treasury: treasury,
            pending: true,
            underlying: underlying,
            nameSuffix: nameSuffix,
            symbolSuffix: symbolSuffix
        });

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

        OVRFLOToken token = new OVRFLOToken(
            string(abi.encodePacked("OVRFLO ", config.nameSuffix)),
            string(abi.encodePacked("ovrflo", config.symbolSuffix))
        );
        ovrfloToken = address(token);

        OVRFLO v = new OVRFLO(address(this), config.treasury, config.underlying, ovrfloToken);
        ovrflo = address(v);

        token.transferOwnership(ovrflo);

        ovrflos[ovrfloCount] = ovrflo;
        ovrfloCount += 1;
        ovrfloInfo[ovrflo] =
            OvrfloInfo({treasury: config.treasury, underlying: config.underlying, ovrfloToken: ovrfloToken});

        emit OvrfloDeployed(ovrflo, ovrfloToken, config.treasury, config.underlying);
    }

    /*//////////////////////////////////////////////////////////////
                     MARKET DEPLOYMENT (PER-SERIES)
    //////////////////////////////////////////////////////////////*/

    /// @notice Add a PT maturity to an OVRFLO (reads pt/expiry from Pendle market automatically)
    /// @param ovrflo The OVRFLO contract address
    /// @param market The Pendle market address
    /// @param oracle Oracle used for PT-to-SY rate lookups (Pendle native or IPendleOracle-compatible wrapper)
    /// @param twapDuration TWAP duration in seconds
    /// @param feeBps Fee in basis points (max FEE_MAX_BPS)
    function addMarket(address ovrflo, address market, address oracle, uint32 twapDuration, uint16 feeBps)
        external
        onlyOwner
    {
        _requireKnownOvrflo(ovrflo);
        require(oracle != address(0), "OVRFLOFactory: oracle zero");
        require(twapDuration <= MAX_TWAP_DURATION, "OVRFLOFactory: twap too long");
        require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
        require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high");

        {
            (bool increaseCardinalityRequired,, bool oldestObservationSatisfied) =
                IPendleOracle(oracle).getOracleState(market, twapDuration);
            require(!increaseCardinalityRequired, "OVRFLOFactory: oracle cardinality");
            require(oldestObservationSatisfied, "OVRFLOFactory: oracle not ready");
        }

        OvrfloInfo memory info = ovrfloInfo[ovrflo];
        address pt;
        {
            address sy;
            (sy, pt,) = IPendleMarket(market).readTokens();
            require(IStandardizedYield(sy).yieldToken() == info.underlying, "OVRFLOFactory: underlying mismatch");
        }

        OVRFLO(ovrflo)
            .setSeriesApproved(
                market,
                pt,
                info.underlying,
                info.ovrfloToken,
                oracle,
                twapDuration,
                IPendleMarket(market).expiry(),
                feeBps
            );

        isMarketApproved[ovrflo][market] = true;
        approvedMarketAt[ovrflo][approvedMarketCount[ovrflo]] = market;
        approvedMarketCount[ovrflo]++;
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

    /// @notice Sweep excess underlying from an OVRFLO
    function sweepExcessUnderlying(address ovrflo, address to) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).sweepExcessUnderlying(to);
    }

    /// @notice Increase Pendle oracle cardinality for a market (must be done before addMarket)
    /// @param market The Pendle market address
    /// @param oracle Oracle used for readiness/cardinality inspection (IPendleOracle-compatible)
    /// @param twapDuration TWAP duration in seconds
    function prepareOracle(address market, address oracle, uint32 twapDuration) external onlyOwner {
        require(oracle != address(0), "OVRFLOFactory: oracle zero");
        require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) =
            IPendleOracle(oracle).getOracleState(market, twapDuration);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }
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
