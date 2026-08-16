// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

/// @notice Current-pipeline storage-layout identity against committed goldens.
/// @dev Dual-pipeline identity (legacy vs via-IR) cannot run inside `forge test`
///      because `foundry.toml` leaves ffi off. `tools/scripts/check-storage-layout.sh`
///      rebuilds both pipelines, canonicalizes away AST-id suffixes, and diffs.
///      This suite still fails `forge test` when the current compile drifts from
///      the golden slot/label/offset map — the packing canary for 0.8.36's
///      inheritance-order analysis fix.
contract StorageLayoutTest is Test {
    using stdJson for string;

    function test_StorageLayout_OVRFLOFactory_MatchesGolden() public view {
        _assertMatchesGolden(
            "out/OVRFLOFactory.sol/OVRFLOFactory.json", "artifacts/tests/storage-layout/OVRFLOFactory.json"
        );
    }

    function test_StorageLayout_OVRFLO_MatchesGolden() public view {
        _assertMatchesGolden("out/OVRFLO.sol/OVRFLO.json", "artifacts/tests/storage-layout/OVRFLO.json");
    }

    function test_StorageLayout_OVRFLOLending_MatchesGolden() public view {
        _assertMatchesGolden(
            "out/OVRFLOLending.sol/OVRFLOLending.json", "artifacts/tests/storage-layout/OVRFLOLending.json"
        );
    }

    function test_StorageLayout_OVRFLOToken_MatchesGolden() public view {
        _assertMatchesGolden("out/OVRFLOToken.sol/OVRFLOToken.json", "artifacts/tests/storage-layout/OVRFLOToken.json");
    }

    function _assertMatchesGolden(string memory artifactRel, string memory goldenRel) internal view {
        string memory artifact = vm.readFile(artifactRel);
        string memory golden = vm.readFile(goldenRel);
        uint256 i;
        for (;;) {
            string memory goldenLabelKey = string.concat(".storage[", vm.toString(i), "].label");
            if (!vm.keyExistsJson(golden, goldenLabelKey)) break;
            string memory prefix = string.concat(".storage[", vm.toString(i), "]");
            string memory artifactPrefix = string.concat(".storageLayout.storage[", vm.toString(i), "]");
            assertEq(
                artifact.readString(string.concat(artifactPrefix, ".label")),
                golden.readString(string.concat(prefix, ".label"))
            );
            assertEq(
                artifact.readString(string.concat(artifactPrefix, ".slot")),
                golden.readString(string.concat(prefix, ".slot"))
            );
            assertEq(
                artifact.readUint(string.concat(artifactPrefix, ".offset")),
                golden.readUint(string.concat(prefix, ".offset"))
            );
            unchecked {
                ++i;
            }
        }
        assertGt(i, 0, artifactRel);
        assertFalse(
            vm.keyExistsJson(artifact, string.concat(".storageLayout.storage[", vm.toString(i), "].label")),
            "artifact has extra storage entries"
        );
    }
}
