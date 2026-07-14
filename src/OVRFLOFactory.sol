// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {OVRFLO} from "./OVRFLO.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";
import {OVRFLOLending} from "./OVRFLOLending.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {IStandardizedYield} from "../interfaces/IStandardizedYield.sol";

/// @title OVRFLOFactory
/// @notice Factory and admin hub for deploying and managing OVRFLO systems
/// @dev Owned by a timelocked multisig. Deploys OVRFLO + OVRFLOToken and serves as
///      the immutable `factory` (admin) for every OVRFLO it creates. Ownership uses the OZ
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

    /// @notice Maps an OVRFLO vault to its deployed OVRFLOLending (1:1).
    mapping(address => address) public ovrfloToLending;

    /// @notice Reverse lookup: OVRFLOLending address => OVRFLO vault address.
    mapping(address => address) public lendingToOvrflo;

    /// @notice Total number of OVRFLOLending markets deployed by this factory.
    uint256 public lendingCount;

    /// @notice Enumerable list of all OVRFLOLending addresses deployed by this factory.
    mapping(uint256 => address) public lendings;

    /// @notice Maps an underlying asset to its deployed OVRFLO vault (1:1, prevents duplicates).
    mapping(address => address) public underlyingToOvrflo;

    /// @notice Pendle TWAP oracle address (singleton, same for all markets)
    address public immutable oracle;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event DeploymentConfigured(address indexed treasury, address indexed underlying);
    event DeploymentCancelled();
    event OvrfloDeployed(address indexed ovrflo, address indexed ovrfloToken, address treasury, address underlying);
    event LendingDeployed(address indexed ovrflo, address indexed lending);
    event LendingAprBoundsSet(address indexed lending, uint16 aprMinBps, uint16 aprMaxBps);
    event LendingFeeSet(address indexed lending, uint16 feeBps);
    event LendingTreasurySet(address indexed lending, address treasury);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner, address _oracle) {
        require(_owner != address(0), "OVRFLOFactory: owner zero");
        require(_oracle != address(0), "OVRFLOFactory: oracle zero");
        _transferOwnership(_owner);
        oracle = _oracle;
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
        require(underlyingToOvrflo[underlying] == address(0), "OVRFLOFactory: underlying already deployed");
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

        OVRFLO v = new OVRFLO(address(this), config.treasury, config.underlying, ovrfloToken, oracle);
        ovrflo = address(v);

        token.transferOwnership(ovrflo);

        ovrflos[ovrfloCount] = ovrflo;
        ovrfloCount += 1;
        ovrfloInfo[ovrflo] =
            OvrfloInfo({treasury: config.treasury, underlying: config.underlying, ovrfloToken: ovrfloToken});
        underlyingToOvrflo[config.underlying] = ovrflo;

        emit OvrfloDeployed(ovrflo, ovrfloToken, config.treasury, config.underlying);
    }

    /// @notice Deploy an OVRFLOLending for an existing vault (1:1, one lending market per vault)
    /// @dev Reads the Sablier address from the vault's sablierLL immutable.
    ///      The factory remains the lending market's owner so all lending admin calls flow through
    ///      the factory (consistent with the vault admin model).
    /// @param ovrflo The OVRFLO core vault address
    /// @return lending The deployed OVRFLOLending address
    function deployLending(address ovrflo) external onlyOwner returns (address lending) {
        _requireKnownOvrflo(ovrflo);
        require(ovrfloToLending[ovrflo] == address(0), "OVRFLOFactory: lending exists");

        address sablierAddr = address(OVRFLO(ovrflo).sablierLL());
        OVRFLOLending lendingMarket = new OVRFLOLending(address(this), ovrflo, sablierAddr);
        lending = address(lendingMarket);

        ovrfloToLending[ovrflo] = lending;
        lendingToOvrflo[lending] = ovrflo;
        lendings[lendingCount] = lending;
        lendingCount += 1;

        emit LendingDeployed(ovrflo, lending);
    }

    /*//////////////////////////////////////////////////////////////
                     MARKET DEPLOYMENT (PER-SERIES)
    //////////////////////////////////////////////////////////////*/

    /// @notice Add a PT maturity to an OVRFLO (reads pt/expiry from Pendle market automatically)
    /// @param ovrflo The OVRFLO contract address
    /// @param market The Pendle market address
    /// @param twapDuration TWAP duration in seconds
    /// @param feeBps Fee in basis points (max FEE_MAX_BPS)
    function addMarket(address ovrflo, address market, uint32 twapDuration, uint16 feeBps) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        _validateTwapBounds(twapDuration);
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

        OVRFLO(ovrflo).setSeriesApproved(market, pt, twapDuration, IPendleMarket(market).expiry(), feeBps);

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
    /// @dev `to` is trusted: the caller is the multisig (factory owner), so zero-address
    ///      validation is intentionally omitted per the project's stance of trusting what
    ///      the multisig already validates.
    function sweepExcessPt(address ovrflo, address ptToken, address to) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).sweepExcessPt(ptToken, to);
    }

    /// @notice Sweep excess underlying from an OVRFLO
    /// @dev `to` is trusted: the caller is the multisig (factory owner), so zero-address
    ///      validation is intentionally omitted per the project's stance of trusting what
    ///      the multisig already validates.
    function sweepExcessUnderlying(address ovrflo, address to) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).sweepExcessUnderlying(to);
    }

    /// @notice Set the flash loan fee on an OVRFLO vault
    /// @param ovrflo The OVRFLO contract address
    /// @param feeBps The flash loan fee in basis points (max OVRFLO.FLASH_FEE_MAX_BPS)
    function setFlashFeeBps(address ovrflo, uint16 feeBps) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).setFlashFeeBps(feeBps);
    }

    /// @notice Pause or unpause flash loans on an OVRFLO vault
    /// @param ovrflo The OVRFLO contract address
    /// @param paused True to pause, false to unpause
    function setFlashLoanPaused(address ovrflo, bool paused) external onlyOwner {
        _requireKnownOvrflo(ovrflo);
        OVRFLO(ovrflo).setFlashLoanPaused(paused);
    }

    /// @notice Increase Pendle oracle cardinality for a market (must be done before addMarket)
    /// @param market The Pendle market address
    /// @param twapDuration TWAP duration in seconds
    function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
        _validateTwapBounds(twapDuration);
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) =
            IPendleOracle(oracle).getOracleState(market, twapDuration);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }
    }

    /*//////////////////////////////////////////////////////////////
                  LENDING ADMIN (FACTORY-FORWARDED)
    //////////////////////////////////////////////////////////////*/

    /// @notice Set the APR bounds on an OVRFLOLending (factory is the lending market's owner)
    /// @param lending The OVRFLOLending address
    /// @param aprMinBps_ New minimum APR in basis points
    /// @param aprMaxBps_ New maximum APR in basis points
    function setLendingAprBounds(address lending, uint16 aprMinBps_, uint16 aprMaxBps_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setAprBounds(aprMinBps_, aprMaxBps_);
        emit LendingAprBoundsSet(lending, aprMinBps_, aprMaxBps_);
    }

    /// @notice Set the protocol fee on an OVRFLOLending
    /// @param lending The OVRFLOLending address
    /// @param feeBps_ New fee in basis points
    function setLendingFee(address lending, uint16 feeBps_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setFee(feeBps_);
        emit LendingFeeSet(lending, feeBps_);
    }

    /// @notice Set the fee treasury on an OVRFLOLending
    /// @param lending The OVRFLOLending address
    /// @param treasury_ New treasury address
    function setLendingTreasury(address lending, address treasury_) external onlyOwner {
        _requireKnownLending(lending);
        OVRFLOLending(lending).setTreasury(treasury_);
        emit LendingTreasurySet(lending, treasury_);
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

    function _requireKnownLending(address lending) internal view {
        require(lendingToOvrflo[lending] != address(0), "OVRFLOFactory: unknown lending");
    }

    function _validateTwapBounds(uint32 twapDuration) internal pure {
        require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
        require(twapDuration <= MAX_TWAP_DURATION, "OVRFLOFactory: twap too long");
    }
}
