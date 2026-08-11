# Fizz Suite

Regenerated 2026-08-10 for the OVRFLOLending **v1-lite** loan-only tick order book (plan
unit U7). The previous suite targeted the pre-rewrite sale-path ABI — sale listings, loan
pools, and `loanPoolContributions` — none of which exist any more. Its properties and
handlers are gone, not disabled; `PROPERTIES.md` at the repo root carries the current
Spec IDs.

## What Is Here

- `Base.sol`: shared setup, deployed contract references, actors, helpers, and ghost state
- `Snapshots.sol`: before/after state capture used by properties
- `Properties.sol`: global and function-specific invariants
- `handlers/`: protocol actions exposed to the fuzzers
- `harness/`: (optional) harness contracts that inherit from target contracts to expose private/internal state needed by properties
- `utils/`: shared helper libraries, assertions, clamping logic, logging, and mocks
- `mocks/`: Pendle, Sablier, and flash-borrower stand-ins used by `Base.setup()`
- `FuzzTester.sol`: main Echidna/Medusa fuzzing entry point
- `FoundryTester.sol`: Foundry harness for quick debugging and local repros

## Inheritance Chain

```
Base (is StringUtils, Clamp, Deployer, Math)
        └─► Snapshots (is Base)
              └─► Properties (is PropertiesAsserts, Snapshots)
                    └─► <Contract>Handler (is Properties)   — one per target contract
                          └─► Handlers (is OVRFLOHandler, OVRFLOFactoryHandler, OVRFLOLendingHandler)
                                ├─► FuzzTester (is Handlers)       — Echidna/Medusa entry point
                                └─► FoundryTester (is Test, Handlers) — Foundry quick debug/PoC entry point
```

## Setup Notes That Matter

`Base.setup()` reuses the repo's real deployment flow rather than inventing one: mock
tokens and Pendle/Sablier infrastructure, `vm.etch` of the mock Sablier onto the hardcoded
address the vault expects, then `OVRFLOFactory` → `configureDeployment`/`deploy` →
`prepareOracle`/`addMarket` → `deployLending`, with limits, APR bounds, fee, and tick
spacing set through the factory forwarders.

**`setLendingTickSpacing` is load-bearing.** Zero is the unset sentinel that gates both
`supply` and `borrow`, so without that call every fill reverts `SpacingUnset` and the whole
lending campaign covers nothing while still reporting a clean run. If lending coverage ever
collapses to near zero, check that line first.

Collateral comes from real vault deposits: the `ovrflo_deposit` handler records the stream
id it creates, and the borrow handler pledges those. A broken deposit handler silently
starves the entire borrow/repay/close/claim surface.

## Related Paths Outside This Directory

- `../../fizz_data/`: extracted ABI inventory, entry-point selection, protocol-understanding notes, corpora, logs, and coverage outputs
- `../../echidna.yaml`: Echidna config
- `../../medusa.json`: Medusa config

## How To Run

From the project root:

```bash
forge build
forge test --match-contract FoundryTester
echidna . --contract FuzzTester --config echidna.yaml
medusa fuzz --config medusa.json
```

## How To Read The Suite

Recommended order:

1. `README.md`
2. `Base.sol`
3. `handlers/Handlers.sol`
4. individual handler files under `handlers/`
5. `Snapshots.sol`
6. `Properties.sol`
7. `harness/` (if present) — to understand what private/internal state is exposed and why
8. `utils/` when you need to understand helper behavior or mocks
9. `FuzzTester.sol`
10. `FoundryTester.sol`
