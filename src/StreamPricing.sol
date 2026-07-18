// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PRBMath} from "prb-math/PRBMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";

/// @notice Registry facet exposed by `OVRFLOFactory` for vault lookups and market approval.
interface IOVRFLOFactoryRegistry {
    /// @notice Returns the treasury, underlying, and ovrfloToken wired to a given OVRFLO core vault.
    /// @param ovrflo The OVRFLO core vault address.
    /// @return treasury Fee treasury for the vault.
    /// @return underlying Underlying ERC20 used for fee payment.
    /// @return ovrfloToken The vault's wrap token.
    function ovrfloInfo(address ovrflo)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken);
}

/// @notice Registry facet exposed by the OVRFLO core vault for per-market series config.
interface IOVRFLOSeriesRegistry {
    /// @notice Returns the cached series configuration for a Pendle market.
    /// @dev Fields are immutable once set via `setSeriesApproved`; claims depend on
    ///      `ptToken`/`ovrfloToken`/`expiryCached` never changing for a market. A series
    ///      is considered approved iff `ptToken != address(0)`.
    /// @param market The Pendle market address.
    /// @return twapDurationFixed TWAP window in seconds for oracle reads.
    /// @return feeBps Deposit fee in basis points.
    /// @return expiryCached Cached PT maturity timestamp (also the stream end time).
    /// @return ptToken The Pendle PT token address.
    /// @return ovrfloToken The series' ovrflo token address.
    /// @return underlying The underlying asset used for fee payment.
    /// @return oracle Oracle used for PT-to-SY rate lookups.
    function series(address market)
        external
        view
        returns (
            uint32 twapDurationFixed,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address ovrfloToken,
            address underlying,
            address oracle
        );
}

/// @title StreamPricing
/// @notice Pure/shared pricing and eligibility primitives for the OVRFLOLending secondary market.
/// @dev All discounting uses a linear APR factor `f = 1 + apr * ttm / (YEAR * BPS)` in WAD.
///      Rounding is directional and load-bearing:
///        - `grossPrice` floors (buyer pays the lower discounted value; seller-favorable
///          cap is enforced via `borrowAmount <= grossPrice` at the call site).
///        - `obligation` ceils (lender is owed the rounded-up accrued amount).
///      This keeps `obligation <= remaining` in the partial-borrow path so the pledged
///      stream can always cover the debt; see
///      `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md`.
///      Do not flip either rounding direction without re-checking that analysis.
library StreamPricing {
    /// @notice WAD scale (1e18) used for fixed-point math.
    uint256 internal constant WAD = 1e18;
    /// @notice Seconds in a year, used to annualize the APR.
    uint256 internal constant YEAR = 365 days;
    /// @notice Basis-points denominator (100% = 10_000).
    uint256 internal constant BASIS_POINTS = 10_000;

    /// @dev The Pendle market is not approved for this vault.
    error MarketNotApproved();
    /// @dev The stream's Sablier sender is not the OVRFLO core vault.
    error WrongSender();
    /// @dev The stream's payout asset does not match the series' ovrfloToken.
    error WrongAsset();
    /// @dev The stream end time does not equal the cached series expiry, or expiry overflows uint40.
    error WrongEndTime();
    /// @dev The series has reached or passed its maturity timestamp.
    error SeriesMatured();
    /// @dev The stream has a non-zero cliff (disallowed).
    error CliffPresent();
    /// @dev The stream is cancelable (disallowed; pledged streams must be non-cancelable).
    error CancelableStream();
    /// @dev The stream has no remaining balance to price (`deposited <= withdrawn`).
    error RemainingZero();

    /// @notice Result of validating a stream against a series.
    /// @param seriesMaturity The cached series expiry timestamp (also the stream end time).
    /// @param remaining `deposited - withdrawn`; the undiscounted face value still payable.
    struct Eligibility {
        uint256 seriesMaturity;
        uint128 remaining;
    }

    /// @notice Linear accrual factor `f = 1 + apr * ttm / (YEAR * BPS)`, in WAD.
    /// @dev `f >= WAD` always (time-to-maturity and APR are non-negative), so obligations
    ///      grow monotonically with time/rate and prices discount toward zero as `ttm` grows.
    /// @param aprBps Annualized rate in basis points.
    /// @param timeToMaturity Seconds remaining until series maturity.
    /// @return f The WAD-scale factor.
    function factor(uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
        return WAD + PRBMath.mulDiv(timeToMaturity, uint256(aprBps) * WAD, YEAR * BASIS_POINTS);
    }

    /// @notice Discounted present value of a stream's remaining face value.
    /// @dev Floors (truncates) via `mulDiv`. This is the most a buyer/lender will pay
    ///      today for `remaining` face settling at maturity under `aprBps`.
    /// @param remaining Undiscounted remaining face value (`deposited - withdrawn`).
    /// @param aprBps Annualized discount rate in basis points.
    /// @param timeToMaturity Seconds remaining until series maturity.
    /// @return price The discounted gross price, in ovrfloToken units.
    function grossPrice(uint128 remaining, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint256) {
        return PRBMath.mulDiv(uint256(remaining), WAD, factor(aprBps, timeToMaturity));
    }

    /// @notice Future value (at maturity) of a borrowed amount under `aprBps`.
    /// @dev Ceils: rounds up by 1 wei when the division has a remainder, so the lender
    ///      is owed at least the accrual. This is the debt denomination in ovrfloToken.
    ///      Uses OpenZeppelin `Math.mulDiv` with `Rounding.Up` (replacing the hand-rolled
    ///      ceiling add-one) and `SafeCast.toUint128` for the uint128 downcast (reverting
    ///      on overflow with the OZ error message).
    /// @param borrowAmount Principal advanced today.
    /// @param aprBps Annualized rate in basis points.
    /// @param timeToMaturity Seconds remaining until series maturity.
    /// @return obligation The rounded-up amount owed at maturity.
    function obligation(uint256 borrowAmount, uint16 aprBps, uint256 timeToMaturity) internal pure returns (uint128) {
        uint256 f = factor(aprBps, timeToMaturity);
        return SafeCast.toUint128(Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up));
    }

    /// @notice Obligation for a lending fill, fast-pathing the full-borrow case.
    /// @dev When `borrowAmount == grossPrice_` the borrower takes the entire discounted
    ///      value, so the lender is owed the whole stream (`remaining`) and no separate
    ///      accrual is computed (avoids any floor/ceil mismatch at the boundary).
    ///      Otherwise the standard ceiling `obligation` is used.
    /// @param borrowAmount Principal advanced today.
    /// @param grossPrice_ The discounted price of the full stream (must be >= borrowAmount).
    /// @param remaining Undiscounted remaining face value of the stream.
    /// @param aprBps Annualized rate in basis points.
    /// @param timeToMaturity Seconds remaining until series maturity.
    /// @return obligation The amount owed at maturity, in ovrfloToken units.
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

    /// @notice Protocol fee on a fill, `amount * feeBps / BPS`.
    /// @param borrowAmount The amount the fee is charged on (price or principal).
    /// @param feeBps Fee in basis points.
    /// @return feeAmount The fee, in the same units as `borrowAmount`.
    function fee(uint256 borrowAmount, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps == 0) return 0;
        return PRBMath.mulDiv(borrowAmount, feeBps, BASIS_POINTS);
    }

    /// @notice Validates that a market has a configured series and has not matured.
    /// @dev Lightweight, stream-agnostic check used to front-load rejection at liquidity-post
    ///      time (liquidityPositions carry no `streamId`). The full stream-level validation lives in
    ///      `requireEligible`, which calls this internally; both share this single source
    ///      of truth for the market/maturity gating. Market approval is now derived from
    ///      the core's series config (`ptToken != address(0)`); the factory's
    ///      `isMarketApproved` mapping is no longer consulted on-chain.
    /// @param factory The OVRFLOFactory registry address (unused here; retained for `requireEligible`).
    /// @param core The OVRFLO core vault address.
    /// @param market The Pendle market address.
    /// @return expiryCached The cached series maturity timestamp.
    /// @return ovrfloToken The series' ovrflo token address.
    function marketActive(address factory, address core, address market)
        internal
        view
        returns (uint256 expiryCached, address ovrfloToken)
    {
        (,, uint256 expiryCached_, address ptToken_, address ovrfloToken_,,) =
            IOVRFLOSeriesRegistry(core).series(market);
        if (ptToken_ == address(0)) revert MarketNotApproved();
        if (block.timestamp >= expiryCached_) revert SeriesMatured();
        return (expiryCached_, ovrfloToken_);
    }

    /// @notice Full eligibility check for pledging/selling a specific Sablier stream.
    /// @dev Combines `marketActive` (market + series + maturity) with stream-level
    ///      invariants: sender must be the core vault, asset must be the series'
    ///      ovrfloToken, end time must equal the cached expiry (and fit uint40),
    ///      no cliff, non-cancelable, and `deposited > withdrawn`. Returns the
    ///      validated `remaining` so callers can price without re-reading Sablier.
    /// @param factory The OVRFLOFactory registry address.
    /// @param sablier The Sablier V2 Lockup Linear contract.
    /// @param core The OVRFLO core vault address.
    /// @param market The Pendle market address.
    /// @param streamId The Sablier stream id being pledged/sold.
    /// @return eligibility The validated maturity, ovrfloToken, and remaining face value.
    function requireEligible(address factory, address sablier, address core, address market, uint256 streamId)
        internal
        view
        returns (Eligibility memory eligibility)
    {
        ISablierV2LockupLinear lockup = ISablierV2LockupLinear(sablier);

        (uint256 expiryCached, address ovrfloToken) = marketActive(factory, core, market);
        ISablierV2LockupLinear.Stream memory stream = lockup.getStream(streamId);

        if (stream.sender != core) revert WrongSender();
        if (address(stream.asset) != ovrfloToken) revert WrongAsset();
        // forge-lint: disable-next-line(unsafe-typecast)
        if (stream.endTime != uint40(expiryCached)) revert WrongEndTime();
        if (stream.cliffTime != stream.startTime) revert CliffPresent();
        if (stream.isCancelable) revert CancelableStream();
        if (stream.amounts.deposited <= stream.amounts.withdrawn) revert RemainingZero();

        eligibility =
            Eligibility({seriesMaturity: expiryCached, remaining: stream.amounts.deposited - stream.amounts.withdrawn});
    }
}
