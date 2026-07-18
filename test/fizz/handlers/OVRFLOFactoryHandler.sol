// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with OVRFLOFactory
abstract contract OVRFLOFactoryHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function oVRFLOFactory_secondary(uint8 selector, uint256 arg0, uint256 arg1, address) public {
        // setLendingTreasury removed: changing treasury to an actor corrupts SP-99's
        // balance-delta check (actor receives sale proceeds, not just fees).
        selector = uint8(selector % 5);
        if (selector == 0) {
            _oVRFLOFactory_setFlashFeeBps(uint16(arg0 % (uint256(vault.FLASH_FEE_MAX_BPS()) + 1)));
        } else if (selector == 1) {
            _oVRFLOFactory_setFlashLoanPaused(arg0 > 0);
        } else if (selector == 2) {
            uint16 minApr = uint16(arg0 % 101) * lending.APR_STEP_BPS();
            uint16 maxApr = uint16(arg1 % 101) * lending.APR_STEP_BPS();
            if (minApr > maxApr) (minApr, maxApr) = (maxApr, minApr);
            _oVRFLOFactory_setLendingAprBounds(minApr, maxApr);
        } else if (selector == 3) {
            _oVRFLOFactory_setLendingFee(uint16(arg0 % (uint256(lending.MAX_FEE_BPS()) + 1)));
        } else {
            _oVRFLOFactory_setMarketDepositLimit(arg0);
        }
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function _oVRFLOFactory_setFlashFeeBps(uint16 feeBps) internal asAdmin {
        factory.setFlashFeeBps(address(vault), feeBps);
    }

    function _oVRFLOFactory_setFlashLoanPaused(bool paused) internal asAdmin {
        factory.setFlashLoanPaused(address(vault), paused);
    }

    function _oVRFLOFactory_setLendingAprBounds(uint16 aprMinBps_, uint16 aprMaxBps_) internal asAdmin {
        factory.setLendingAprBounds(address(lending), aprMinBps_, aprMaxBps_);
    }

    function _oVRFLOFactory_setLendingFee(uint16 feeBps_) internal asAdmin {
        factory.setLendingFee(address(lending), feeBps_);
    }

    function _oVRFLOFactory_setMarketDepositLimit(uint256 limit) internal asAdmin {
        factory.setMarketDepositLimit(address(vault), market, limit);
        property_setDepositLimitEcho(market, limit);
    }
}
