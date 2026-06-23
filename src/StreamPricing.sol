// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PRBMath} from "prb-math/PRBMath.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

interface IOVRFLOFactoryRegistry {
    function ovrfloInfo(address ovrflo)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken);

    function isMarketApproved(address ovrflo, address market) external view returns (bool);
}

interface IOVRFLOSeriesRegistry {
    function series(address market)
        external
        view
        returns (
            bool approved,
            uint32 twapDurationFixed,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address ovrfloToken,
            address underlying,
            address oracle
        );
}

library StreamPricing {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant BASIS_POINTS = 10_000;

    error CoreNotRegistered();
    error MarketNotApproved();
    error SeriesNotApproved();
    error WrongSender();
    error WrongAsset();
    error WrongEndTime();
    error SeriesMatured();
    error CliffPresent();
    error CancelableStream();
    error RemainingZero();

    struct Eligibility {
        uint256 seriesMaturity;
        address ovrfloToken;
        uint128 remaining;
    }

    function factor(uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
        return WAD + PRBMath.mulDiv(timeToMaturity, uint256(aprBps) * WAD, YEAR * BASIS_POINTS);
    }

    function grossPrice(uint128 remaining, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
        return PRBMath.mulDiv(uint256(remaining), WAD, factor(aprBps, timeToMaturity));
    }

    function obligation(uint256 borrowAmount, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint128) {
        uint256 f = factor(aprBps, timeToMaturity);
        uint256 value = PRBMath.mulDiv(borrowAmount, f, WAD);
        if (mulmod(borrowAmount, f, WAD) != 0) {
            value += 1;
        }
        require(value <= type(uint128).max, "StreamPricing: obligation overflow");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(value);
    }

    function obligationForFill(
        uint256 borrowAmount,
        uint256 grossPrice_,
        uint128 remaining,
        uint16 aprBps,
        uint256 timeToMaturity
    ) internal pure returns (uint128) {
        if (borrowAmount == grossPrice_) {
            return remaining;
        }
        return obligation(borrowAmount, aprBps, timeToMaturity);
    }

    function fee(uint256 borrowAmount, uint16 feeBps) internal pure returns (uint256) {
        return PRBMath.mulDiv(borrowAmount, feeBps, BASIS_POINTS);
    }

    function requireEligible(address factory, address sablier, address core, address market, uint256 streamId)
        internal
        view
        returns (Eligibility memory eligibility)
    {
        IOVRFLOFactoryRegistry registry = IOVRFLOFactoryRegistry(factory);
        ISablierV2LockupLinear lockup = ISablierV2LockupLinear(sablier);

        (address treasury,, address registeredToken) = registry.ovrfloInfo(core);
        if (treasury == address(0) || registeredToken == address(0)) revert CoreNotRegistered();
        if (!registry.isMarketApproved(core, market)) revert MarketNotApproved();

        (bool approved,,, uint256 expiryCached,, address ovrfloToken,,) = IOVRFLOSeriesRegistry(core).series(market);
        if (!approved) revert SeriesNotApproved();
        if (block.timestamp >= expiryCached) revert SeriesMatured();
        if (lockup.getSender(streamId) != core) revert WrongSender();
        if (address(lockup.getAsset(streamId)) != ovrfloToken) revert WrongAsset();
        if (expiryCached > type(uint40).max) revert WrongEndTime();
        // forge-lint: disable-next-line(unsafe-typecast)
        if (lockup.getEndTime(streamId) != uint40(expiryCached)) revert WrongEndTime();
        if (lockup.getCliffTime(streamId) != 0) revert CliffPresent();
        if (lockup.isCancelable(streamId)) revert CancelableStream();

        uint128 deposited = lockup.getDepositedAmount(streamId);
        uint128 withdrawn = lockup.getWithdrawnAmount(streamId);
        if (deposited <= withdrawn) revert RemainingZero();

        eligibility =
            Eligibility({seriesMaturity: expiryCached, ovrfloToken: ovrfloToken, remaining: deposited - withdrawn});
    }
}
