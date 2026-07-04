// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OVRFLO} from "../../src/OVRFLO.sol";

/// @notice Shared mock OVRFLO admin registry for invariant and wrap/unwrap tests.
/// @dev Superset of all InvariantOvrfloAdmin and MockOvrfloAdmin variants.
///      Constructor allows deploy-time config; setInfo allows updates.
contract MockOvrfloAdmin {
    address public treasury;
    address public underlying;
    address public ovrfloToken;

    constructor(address treasury_, address underlying_, address ovrfloToken_) {
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
    }

    function setInfo(address treasury_, address underlying_, address ovrfloToken_) external {
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
    }

    function approveSeries(OVRFLO ovrflo, address market, address pt, uint32 twapDuration, uint256 expiry) external {
        ovrflo.setSeriesApproved(market, pt, twapDuration, expiry, 0);
    }

    function sweepExcessUnderlying(OVRFLO ovrflo, address to) external {
        ovrflo.sweepExcessUnderlying(to);
    }

    function setFlashFeeBps(OVRFLO ovrflo, uint16 feeBps) external {
        ovrflo.setFlashFeeBps(feeBps);
    }

    function setFlashLoanPaused(OVRFLO ovrflo, bool paused) external {
        ovrflo.setFlashLoanPaused(paused);
    }

    function ovrfloInfo(address) external view returns (address, address, address) {
        return (treasury, underlying, ovrfloToken);
    }
}
