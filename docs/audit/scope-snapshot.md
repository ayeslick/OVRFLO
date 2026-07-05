# Audit Scope Snapshot

> OVRFLO auditor onboarding package — pinned scope. Companion to `AUDIT.md`.

## In-scope commit

- **Branch:** `main`
- **Commit:** `01cad7b` (2026-07-05)
- **Last updated:** This snapshot was last regenerated on 2026-07-05 against the commit above. Findings are reproducible against this commit; any post-snapshot change should be re-verified before relying on it.

> **Line-number caveat:** The `x-ray/` suite was regenerated at the current HEAD. Companion docs in this package cite **function names and invariant IDs** (e.g. `OVRFLO.deposit()`, invariant `X-1`) rather than brittle line numbers. Where a `file:line` is given, re-verify it against the pinned commit's source before relying on it.

## In-scope files

| Subsystem | File | Role |
|-----------|------|------|
| Core vault | `src/OVRFLO.sol` | PT deposit/claim, wrap/unwrap reserve accounting, Sablier stream creation |
| Wrapper token | `src/OVRFLOToken.sol` | Per-underlying ERC20, owner-gated mint/burn |
| Admin hub | `src/OVRFLOFactory.sol` | Timelocked-multisig-owned deployment, market onboarding, admin forwarding |
| Secondary market | `src/OVRFLOBook.sol` | Stream sale + stream-collateralized self-repaying loans via unified offers and pools |
| Pricing | `src/StreamPricing.sol` | APR/discount math + `requireEligible` cross-contract gate |

1,395 nSLOC across the three subsystems (per `x-ray/x-ray.md`).

## Excluded paths

- `test/` — test harness, not in-scope production code (referenced for verification context only).
- `script/` — deployment/seed scripts; cited as the source of pinned addresses, not audited logic.
- `lib/` — vendored dependencies (see submodule pins below); consumed as trusted, reviewed libraries.
- `web/`, `tools/`, `interfaces/` — frontend, tooling, and interface stubs; not production contract logic.
- `x-ray/` — this package's own backing evidence; not audited code.

## Pinned dependencies

| Dependency | Address / version | Source |
|------------|-------------------|--------|
| Sablier V2 Lockup Linear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (tag `v1.1`) | `x-ray/multi-agent-audit-report.md` (verified against `sablier-labs/v2-core` tag `v1.1`) |
| Pendle Oracle (PT→SY TWAP) | `0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2` | `script/lib/OVRFLOTestFixtures.sol` (`ORACLE`) |
| Pendle PT market — primary (wstETH) | `0xcFD848b9f6fEf552204014ac67901223AD6bf679` | `script/lib/OVRFLOTestFixtures.sol` (`PRIMARY_MARKET`); PT `0x9cE6478EF45bB1BAAC69EFd8A3eA0ed110a43042` |
| Pendle PT market — secondary (wstETH) | `0x34280882267ffa6383B363E278B027Be083bBe3b` | `script/lib/OVRFLOTestFixtures.sol` (`SECONDARY_MARKET`); PT `0xb253Eff1104802b97aC7E3aC9FdD73AecE295a2c` |
| Standardized Yield (wstETH SY) | `0xcbC72d92b2dc8187414F6734718563898740C0BC` | `script/lib/OVRFLOTestFixtures.sol` (`WSTETH_SY`); `yieldToken()` == wstETH `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` |

Both deployed Pendle markets share the same underlying (wstETH) and the same oracle; both are pinned so the auditor can validate either series.

## Vendored library submodule commits

| Library | Path | Commit | Tag |
|---------|------|--------|-----|
| forge-std | `lib/forge-std` | `8bbcf6e3f8f62f419e5429a0bd89331c85c37824` | v1.10.0 |
| openzeppelin-contracts | `lib/openzeppelin-contracts` | `54b3f14346da01ba0d159114b399197fea8b7cda` | v4.9.0 |
| prb-math | `lib/prb-math` | `8fc0c1a6944af02619a8c0757d480eea1d239331` | v2.5.0 |

## Reproduction notes

- Build: `forge build`. Tests: `forge test`. Fork suites require `MAINNET_RPC_URL` (an Ethereum mainnet RPC) to be set in the environment; without it, fork tests are skipped. `forge coverage` now succeeds — 100% line coverage and 99.6% branch coverage on source files (1 uncovered branch in `OVRFLOBook.sol`). Environment automation (one-command reproducible fork env, invariants-as-properties suite) is deferred to a follow-up plan.
- License: MIT across all contracts.
