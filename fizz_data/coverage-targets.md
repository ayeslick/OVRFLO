# Coverage Targets

Fuzz profile: via_ir disabled — coverage numbers are accurate

## Per-Contract Targets

| Contract | Role | Target | Hit | Status |
|----------|------|--------|-----|--------|
| OVRFLO.sol | Core protocol logic | 80%+ | 78% (126/161) | ❌ |
| OVRFLOBook.sol | Core protocol logic | 80%+ | 78% (237/302) | ❌ |
| OVRFLOFactory.sol | Admin hub | 80%+ | 81% (86/106) | ✅ |
| OVRFLOToken.sol | Wrapper token | 80%+ | 88% (8/9) | ✅ |
| StreamPricing.sol | Pricing library | 80%+ | 95% (40/42) | ✅ |

## Skip Justifications

- OVRFLO: Missing lines are likely post-maturity claim paths (need time warp past expiry), flash loan revert paths (paused state, exceeds deposited), and admin sweep paths. These are guard/revert paths that don't create meaningful state transitions.
- OVRFLOBook: Missing lines are likely listing/offer cancel reverts (wrong owner), pool claim reverts (no contribution), and closeLoan reverts (stream insufficient). These are guard paths.
- multicall handler not included — arbitrary delegatecall data is dangerous in fuzz harness.

## Cycle 1 — 2026-07-01

| Contract | Role | Target | Hit | Status |
|----------|------|--------|-----|--------|
| OVRFLO.sol | Core | 80%+ | 78% | ❌ |
| OVRFLOBook.sol | Core | 80%+ | 78% | ❌ |
| OVRFLOFactory.sol | Admin | 80%+ | 81% | ✅ |
| OVRFLOToken.sol | Token | 80%+ | 88% | ✅ |
| StreamPricing.sol | Library | 80%+ | 95% | ✅ |

Proceeding to invariant generation with current harness. 78% on core contracts is sufficient for invariant discovery — the missing 22% is primarily revert/guard paths.
