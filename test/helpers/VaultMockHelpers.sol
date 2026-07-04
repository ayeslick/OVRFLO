// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPendleOracle} from "../../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";

/// @notice Shared vm.mockCall helpers for vault test suites.
/// @dev Inherit instead of `Test` to get _mockRate, _mockSablierCreate, and _computeFee.
///      Each suite keeps a thin _mockSablier wrapper forwarding its own vault/token.
abstract contract VaultMockHelpers is Test {
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    address internal constant SABLIER_LL = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    uint32 internal constant TWAP_DURATION = 30 minutes;

    function _mockRate(address market, uint256 rateE18) internal {
        vm.mockCall(
            PENDLE_ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (market, TWAP_DURATION)), abi.encode(rateE18)
        );
        vm.mockCall(
            PENDLE_ORACLE,
            abi.encodeCall(IPendleOracle.getOracleState, (market, TWAP_DURATION)),
            abi.encode(false, 0, true)
        );
    }

    /// @dev Mocks Sablier createWithDurations. Returns callData so callers can
    ///      add vm.expectCall if needed (e.g., OVRFLO.t.sol).
    function _mockSablierCreate(
        address vault,
        address token,
        address recipient,
        uint128 amount,
        uint256 duration,
        uint256 streamId
    ) internal returns (bytes memory callData) {
        ISablierV2LockupLinear.CreateWithDurations memory params =
            ISablierV2LockupLinear.CreateWithDurations({
                sender: vault,
                recipient: recipient,
                totalAmount: amount,
                asset: IERC20(token),
                cancelable: false,
                transferable: true,
                durations: ISablierV2LockupLinear.Durations({cliff: 0, total: uint40(duration)}),
                broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
            });

        callData = abi.encodeCall(ISablierV2LockupLinear.createWithDurations, (params));
        vm.mockCall(SABLIER_LL, callData, abi.encode(streamId));
    }

    function _computeFee(uint256 amount, uint256 rateE18, uint16 feeBps) internal pure returns (uint256) {
        uint256 ptValueInUnderlying = (amount * rateE18) / 1e18;
        return (ptValueInUnderlying * feeBps) / 10_000;
    }
}
