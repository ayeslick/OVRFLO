// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with OVRFLOFactory. Every selected entry point here
///         is tier `secondary`, so they are grouped behind one dispatcher handler and
///         reached only occasionally, rather than dominating the call sequence.
abstract contract OVRFLOFactoryHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    /// @dev Single admin-tier entry point covering all 8 secondary OVRFLOFactory
    ///      forwarders. `selector` picks which one fires; every call is pranked as the
    ///      factory owner (`admin`) exactly once.
    function handler_factoryAdmin(uint8 selector, uint256 arg0, uint256 arg1, address addr0, bool flag0)
        public
        asAdmin
    {
        selector = uint8(selector % 8);
        if (selector == 0) {
            _factory_setFlashFeeBps(uint16(clampBetween(arg0, 0, vault.FLASH_FEE_MAX_BPS())));
        } else if (selector == 1) {
            _factory_setFlashLoanPaused(flag0);
        } else if (selector == 2) {
            // forge-lint: disable-next-line(divide-before-multiply) — flooring to a spacing multiple is the point.
            uint16 aprMin = uint16((clampBetween(arg0, 0, lending.APR_MAX_CEILING()) / TICK_SPACING) * TICK_SPACING);
            uint16 aprMax =
            // forge-lint: disable-next-line(divide-before-multiply) — flooring to a spacing multiple is the point.
            uint16((clampBetween(arg1, aprMin, lending.APR_MAX_CEILING()) / TICK_SPACING) * TICK_SPACING);
            if (aprMax < aprMin) aprMax = aprMin;
            _factory_setLendingAprBounds(aprMin, aprMax);
        } else if (selector == 3) {
            _factory_setLendingFee(uint16(clampBetween(arg0, 0, lending.MAX_FEE_BPS())));
        } else if (selector == 4) {
            _factory_setLendingTreasury(toActor(addr0));
        } else if (selector == 5) {
            _factory_setMarketDepositLimit(clampBetween(arg0, 0, type(uint256).max));
        } else if (selector == 6) {
            _factory_sweepExcessPt(toActor(addr0));
        } else {
            _factory_sweepExcessUnderlying(toActor(addr0));
        }
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――
    // Secondary-tier calls are internal-only; the dispatcher above is the sole fuzz
    // entry point and already applies the `asAdmin` caller context.

    function _factory_setFlashFeeBps(uint16 feeBps) internal {
        factory.setFlashFeeBps(address(vault), feeBps);
    }

    function _factory_setFlashLoanPaused(bool paused) internal {
        factory.setFlashLoanPaused(address(vault), paused);
    }

    function _factory_setLendingAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) internal {
        factory.setLendingAprBounds(address(lending), aprMinBps_, aprMaxBps_);
    }

    function _factory_setLendingFee(uint16 feeBps_) internal {
        factory.setLendingFee(address(lending), feeBps_);
    }

    function _factory_setLendingTreasury(address treasury_) internal {
        factory.setLendingTreasury(address(lending), treasury_);
    }

    function _factory_setMarketDepositLimit(uint256 limit) internal {
        factory.setMarketDepositLimit(address(vault), market, limit);
    }

    function _factory_sweepExcessPt(address to) internal {
        factory.sweepExcessPt(address(vault), address(ptToken), to);
    }

    function _factory_sweepExcessUnderlying(address to) internal {
        factory.sweepExcessUnderlying(address(vault), to);
    }
}
