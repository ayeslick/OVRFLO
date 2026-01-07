// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {OVFL} from "./OVFL.sol";
import {OVFLToken} from "./OVFLToken.sol";
import {IPendleMarket} from "../interfaces/IPendleMarket.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";

contract Admin is AccessControl {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    uint256 public constant FEE_MAX_BPS = 100;
    uint256 public constant TIMELOCK_DELAY = 24 hours;
    uint256 public constant MIN_TWAP_DURATION = 15 minutes;
    uint256 public constant MAX_TWAP_DURATION = 30 minutes;

    OVFL public ovfl;
    IPendleOracle public constant PENDLE_ORACLE = IPendleOracle(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);

    mapping(address => address) public underlyingToOvfl;
    mapping(address => PendingMarket) public pendingMarkets;

    struct PendingMarket {
        bool queued;
        uint32 twapDuration;
        uint16 feeBps;
        uint256 eta;
        address underlying;
    }

    event OVFLSet(address indexed ovflAddress);
    event UnderlyingApproved(address indexed underlying, address indexed ovflToken);
    event MarketQueued(address indexed market, uint256 eta);
    event MarketCancelled(address indexed market);
    event MarketApproved(address indexed market, address indexed ptToken, address indexed underlying);
    event MarketDepositLimitSet(address indexed market, uint256 limit);
    event MinPtAmountSet(uint256 newMin);

    constructor(address admin) {
        require(admin != address(0), "Admin: zero address");
        _grantRole(ADMIN_ROLE, admin);
    }

    function setOVFL(address ovflAddress) external onlyRole(ADMIN_ROLE) {
        require(address(ovfl) == address(0), "Admin: ovfl already set");
        require(ovflAddress != address(0), "Admin: zero address");
        ovfl = OVFL(ovflAddress);
        emit OVFLSet(ovflAddress);
    }

    function approveUnderlying(
        address underlying,
        string calldata name,
        string calldata symbol
    ) external onlyRole(ADMIN_ROLE) {
        require(address(ovfl) != address(0), "Admin: ovfl not set");
        require(underlying != address(0), "Admin: zero address");
        require(underlyingToOvfl[underlying] == address(0), "Admin: already approved");

        OVFLToken token = new OVFLToken(name, symbol);
        token.transferOwnership(address(ovfl));
        underlyingToOvfl[underlying] = address(token);
        emit UnderlyingApproved(underlying, address(token));
    }

    function queueAddMarket(
        address market,
        uint32 twapSeconds,
        address underlying,
        uint16 feeBps
    ) external onlyRole(ADMIN_ROLE) {
        require(market != address(0), "Admin: zero address");
        require(twapSeconds >= MIN_TWAP_DURATION && twapSeconds <= MAX_TWAP_DURATION, "Admin: twap bounds");
        require(underlyingToOvfl[underlying] != address(0), "Admin: underlying not approved");
        require(feeBps <= FEE_MAX_BPS, "Admin: fee too high");
        require(!pendingMarkets[market].queued, "Admin: already queued");

        (bool approved,,,,,,) = ovfl.series(market);
        require(!approved, "Admin: already approved");

        // Increase oracle cardinality if needed
        (bool increaseCardinalityRequired, uint16 cardinalityRequired,) = PENDLE_ORACLE.getOracleState(market, twapSeconds);
        if (increaseCardinalityRequired) {
            IPendleMarket(market).increaseObservationsCardinalityNext(cardinalityRequired);
        }

        uint256 eta = block.timestamp + TIMELOCK_DELAY;
        pendingMarkets[market] = PendingMarket({
            queued: true,
            twapDuration: twapSeconds,
            feeBps: feeBps,
            eta: eta,
            underlying: underlying
        });
        emit MarketQueued(market, eta);
    }

    function executeAddMarket(address market) external onlyRole(ADMIN_ROLE) {
        PendingMarket memory pending = pendingMarkets[market];
        require(pending.queued, "Admin: not queued");
        require(block.timestamp >= pending.eta, "Admin: timelock not passed");

        _checkOracleReady(market, pending.twapDuration);

        (, address pt,) = IPendleMarket(market).readTokens();
        address ovflToken = underlyingToOvfl[pending.underlying];
        uint256 expiry = IPendleMarket(market).expiry();

        ovfl.setSeriesApproved(
            market,
            pt,
            pending.underlying,
            ovflToken,
            pending.twapDuration,
            expiry,
            pending.feeBps
        );

        delete pendingMarkets[market];
        emit MarketApproved(market, pt, pending.underlying);
    }

    function cancelPendingMarket(address market) external onlyRole(ADMIN_ROLE) {
        require(pendingMarkets[market].queued, "Admin: not queued");
        delete pendingMarkets[market];
        emit MarketCancelled(market);
    }

    function setMarketDepositLimit(address market, uint256 limit) external onlyRole(ADMIN_ROLE) {
        (bool approved,,,,,,) = ovfl.series(market);
        require(approved, "Admin: market not approved");
        ovfl.setMarketDepositLimit(market, limit);
        emit MarketDepositLimitSet(market, limit);
    }

    function setMinPtAmount(uint256 newMin) external onlyRole(ADMIN_ROLE) {
        ovfl.setMinPtAmount(newMin);
        emit MinPtAmountSet(newMin);
    }

    function sweepExcessPt(address ptToken, address to) external onlyRole(ADMIN_ROLE) {
        ovfl.sweepExcessPt(ptToken, to);
    }

    function _checkOracleReady(address market, uint32 duration) internal view {
        (bool increaseCardinalityRequired,, bool oldestObservationSatisfied) = PENDLE_ORACLE.getOracleState(market, duration);
        require(!increaseCardinalityRequired, "Admin: oracle cardinality");
        require(oldestObservationSatisfied, "Admin: oracle not ready");
    }

    function ovflTokenForUnderlying(address underlying) external view returns (address) {
        return underlyingToOvfl[underlying];
    }
}
