Ticket 08 approved and merged at 738bed7 (impl 7e723ad). Two non-blocking residuals:

1. test/StorageLayout.t.sol:_assertMatchesGolden compares only top-level label/slot/offset.
   Nested Epoch/Tick/Tree packing is enforced by tools/scripts/check-storage-layout.sh and
   the vm.load packed-slot test, not by forge test. Do not treat a green StorageLayout suite
   as nested-layout proof. Follow-up later if we want forge test to assert type/encoding too.

2. test/DeploySize.t.sol comment still cites ~22,806 / ~24,149. Measured: via-IR 22,827
   (1,237 under 24,064), legacy 24,193 (383 under 24,576). Comment-only; canary asserts
   the live artifact.

Do not reopen commit-flag, BelowMinAcceptable, or ABI_VERSION as part of fixing these.
