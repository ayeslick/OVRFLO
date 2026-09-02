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

    /// @dev deliberate-ceiling: 512 B EIP-170 headroom reserve for OVRFLOLending
    ///      (cap 24_576 − 512 = 24_064). Shipping (via-IR + previewBorrow) measures
    ///      ~22,806 B, 1,258 B under this canary. Dual-pipeline carve-out: the
    ///      legacy pipeline measures ~24,149 B, which is OVER this canary by
    ///      design once previewBorrow lands. `FOUNDRY_PROFILE=legacy` skips this
    ///      test and keeps the EIP-170 cap (`test_AllDeployables_FitEip170RuntimeCap`).
    ///      Do not weaken the via-IR canary. Revisit when this assertion fires —
    ///      shrink the contract or bump the ceiling with a recorded reason, never
    ///      silently.
    uint256 internal constant LENDING_RUNTIME_CANARY = 24_064;

    function _artifacts() internal pure returns (string[6] memory a) {
        a = [
            string("OVRFLOFactory.sol:OVRFLOFactory"),
            "OVRFLO.sol:OVRFLO",
            "OVRFLOLending.sol:OVRFLOLending",
            "OVRFLOToken.sol:OVRFLOToken",
            "OVRFLOReserve.sol:OVRFLOReserve",
            "OVRFLORequestBook.sol:OVRFLORequestBook"
        ];
    }

    function test_AllDeployables_FitEip3860InitcodeCap() public view {
        string[6] memory a = _artifacts();
        for (uint256 i = 0; i < a.length; i++) {
            assertLe(vm.getCode(a[i]).length, EIP3860_INITCODE_CAP, a[i]);
        }
    }

    function test_AllDeployables_FitEip170RuntimeCap() public view {
        string[6] memory a = _artifacts();
        for (uint256 i = 0; i < a.length; i++) {
            assertLe(vm.getDeployedCode(a[i]).length, EIP170_RUNTIME_CAP, a[i]);
        }
    }

    function test_Lending_RetainsRuntimeHeadroomCanary() public {
        if (_legacyPipeline()) {
            vm.skip(true, "legacy pipeline: EIP-170 only; via-IR keeps the 24,064 canary");
            return;
        }
        assertLe(vm.getDeployedCode("OVRFLOLending.sol:OVRFLOLending").length, LENDING_RUNTIME_CANARY);
    }

    /// @dev Dual-pipeline skip discriminator. Foundry selects `[profile.legacy]`
    ///      through `FOUNDRY_PROFILE`; size-based skip would also hide a via-IR
    ///      canary breach that landed in the same byte range as the legacy artifact.
    function _legacyPipeline() internal view returns (bool) {
        bytes32 profile = keccak256(bytes(vm.envOr("FOUNDRY_PROFILE", string(""))));
        return profile == keccak256("legacy") || profile == keccak256("invariant-legacy");
    }
}
