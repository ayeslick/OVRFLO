// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

/// @notice Mainnet deployability gate: every deployable artifact must fit the EIP-3860
///         initcode cap and the EIP-170 runtime cap. Foundry's test EVM does not enforce
///         these limits, so the caps are asserted explicitly — the tier-3 regression gate
///         for the 2026-08-10 factory-size finding
///         (docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md).
/// @dev Adversarial-strength criterion: temporarily lowering any cap constant by one
///      below the corresponding measured size must turn this suite red (verified once
///      at authoring time; do not commit the mutation). `vm.getCode` returns creation
///      code without constructor args — encoded args add bytes at deploy time, covered
///      by the ~34 KB margin every artifact keeps under EIP-3860.
contract DeploySizeTest is Test {
    uint256 internal constant EIP170_RUNTIME_CAP = 24_576;
    uint256 internal constant EIP3860_INITCODE_CAP = 49_152;

    /// @dev deliberate-ceiling: 512 B EIP-170 headroom reserve for OVRFLOLending;
    ///      revisit when this assertion fires — shrink the contract or bump the
    ///      ceiling with a recorded reason, never silently.
    uint256 internal constant LENDING_RUNTIME_CANARY = 24_064;

    function _artifacts() internal pure returns (string[4] memory a) {
        a = [
            string("OVRFLOFactory.sol:OVRFLOFactory"),
            "OVRFLO.sol:OVRFLO",
            "OVRFLOLending.sol:OVRFLOLending",
            "OVRFLOToken.sol:OVRFLOToken"
        ];
    }

    function test_AllDeployables_FitEip3860InitcodeCap() public view {
        string[4] memory a = _artifacts();
        for (uint256 i = 0; i < a.length; i++) {
            assertLe(vm.getCode(a[i]).length, EIP3860_INITCODE_CAP, a[i]);
        }
    }

    function test_AllDeployables_FitEip170RuntimeCap() public view {
        string[4] memory a = _artifacts();
        for (uint256 i = 0; i < a.length; i++) {
            assertLe(vm.getDeployedCode(a[i]).length, EIP170_RUNTIME_CAP, a[i]);
        }
    }

    function test_Lending_RetainsRuntimeHeadroomCanary() public view {
        assertLe(vm.getDeployedCode("OVRFLOLending.sol:OVRFLOLending").length, LENDING_RUNTIME_CANARY);
    }
}
