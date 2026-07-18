---
title: Math Library Consolidation - Plan
type: refactor
date: 2026-07-18
topic: math-library-consolidation
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

- **Objective:** Consolidate the protocol's fixed-point math from two libraries (PRBMath + OpenZeppelin Math) down to OpenZeppelin Math only, eliminating the redundant PRBMath dependency.
- **Product authority:** User-directed security hardening — reduce attack surface by removing a third-party math library when an equivalent capability already exists in a dependency that is not removable (OpenZeppelin).
- **Open blockers:** None.
- **Stop conditions:** `forge build` clean, `forge test` all pass, `medusa fuzz --timeout 300` 0 failures and 0 warnings.
- **Execution profile:** Mechanical refactoring — no behavioral changes, no new tests needed.
- **Tail ownership:** Implementer commits, pushes, and confirms all verification gates green.

---

## Product Contract

*Product Contract unchanged.*

### Summary

Replace all `PRBMath.mulDiv` calls with `Math.mulDiv` from OpenZeppelin, remove PRBMath imports from source and test files, and remove the `prb-math` remapping from `foundry.toml`. No rounding behavior changes — all 5 PRBMath call sites are floor operations, and OZ `Math.mulDiv` defaults to floor.

### Requirements

**Source contracts**

- R1. All `PRBMath.mulDiv` calls in `src/StreamPricing.sol` (3 sites: `factor`, `grossPrice`, `fee`) are replaced with `Math.mulDiv` using default (floor) rounding.
- R2. All `PRBMath.mulDiv` calls in `src/OVRFLO.sol` (2 sites: deposit split, flash fee base) are replaced with `Math.mulDiv` using default (floor) rounding.
- R3. The `PRBMath` import is removed from `src/StreamPricing.sol` and `src/OVRFLO.sol`. The `Math` import from `@openzeppelin/contracts/utils/math/Math.sol` is present in both files.

**Test files**

- R4. The `PRBMath.mulDiv` call in `test/StreamPricing.math.t.sol` is replaced with `Math.mulDiv`, the import is updated, and comment references to PRBMath are updated to reference OZ Math.
- R5. Comment-only references to PRBMath in `test/fork/OVRFLOFlashLoanFork.t.sol` are updated to reference OZ Math.

**Build configuration**

- R6. The `prb-math` remapping is removed from `foundry.toml` if no remaining usage exists after the source and test changes.

**Verification**

- R7. `forge build` compiles cleanly with no new warnings.
- R8. `forge test` passes all existing tests with no regressions.
- R9. `medusa fuzz --timeout 300` passes with 0 failures and 0 warnings.

### Scope Boundaries

- Removing the `prb-math` git submodule itself is deferred — the remapping removal in R6 is sufficient to prove no usage remains; submodule cleanup is a separate git operation.
- No rounding behavior changes — floor operations stay floor, the existing ceil operation (obligation in `StreamPricing.sol`) already uses OZ `Math.mulDiv` with `Math.Rounding.Up` and is not touched.
- No changes to `StreamPricing.sol`'s NatSpec beyond removing PRBMath references — the directional rounding analysis and its "do not flip" warning stay intact.

### Dependencies / Assumptions

- OpenZeppelin `Math.mulDiv(uint256, uint256, uint256)` without a `Rounding` argument defaults to `Math.Rounding.Down` (floor), matching PRBMath's `mulDiv` behavior exactly.
- The `prb-math` library is used only via `PRBMath.mulDiv` — no other PRBMath functions (e.g. `PRBMathUD60x18`, typed variants) are called anywhere in `src/` or `test/`.

---

## Planning Contract

### Key Technical Decisions

- **KTD1. OZ `Math.mulDiv` 3-arg as drop-in for `PRBMath.mulDiv`.** Both functions compute `(a * b) / denominator` with floor rounding. OZ `Math.mulDiv` without a `Rounding` argument defaults to `Math.Rounding.Down`. The codebase already uses the 4-arg variant with `Math.Rounding.Up` for the obligation ceil in `StreamPricing.sol:127`, so the 3-arg floor variant is the same function with a different default. No semantic difference.

- **KTD2. `Math` import already present in `StreamPricing.sol`, needs adding to `OVRFLO.sol`.** `StreamPricing.sol` imports `Math` from OZ already (used by the obligation function). `OVRFLO.sol` does not import `Math` — it only imports `PRBMath`. The consolidation adds the `Math` import and removes the `PRBMath` import from `OVRFLO.sol`.

- **KTD3. Sequencing: source contracts before test and config cleanup.** The `prb-math` remapping in `foundry.toml` can only be removed after no file imports `prb-math`. Source files must be updated first, then test files, then the remapping. This is U1 before U2.

### Assumptions

- The OZ version in `lib/openzeppelin-contracts` exposes the 3-arg `Math.mulDiv` overload (confirmed by the existing 4-arg call in `StreamPricing.sol:127` — the 3-arg variant is the base function in OZ 5.x).
- No other files in the repo (scripts, interfaces, libraries) use PRBMath — verified by repo-wide grep showing only `src/StreamPricing.sol`, `src/OVRFLO.sol`, `test/StreamPricing.math.t.sol`, and `test/fork/OVRFLOFlashLoanFork.t.sol`.

---

## Implementation Units

### U1. Replace PRBMath with OZ Math in source contracts

- **Goal:** Swap all `PRBMath.mulDiv` calls to `Math.mulDiv` in the two source contracts that use PRBMath, and fix their imports.
- **Requirements:** R1, R2, R3
- **Dependencies:** None — this is the first unit.
- **Files:** `src/StreamPricing.sol`, `src/OVRFLO.sol`
- **Approach:** In `src/StreamPricing.sol`, remove the `PRBMath` import (line 4), replace 3 `PRBMath.mulDiv(...)` calls with `Math.mulDiv(...)` at the `factor` (line 101), `grossPrice` (line 112), and `fee` (line 160) functions. The `Math` import is already present (line 5). In `src/OVRFLO.sol`, replace the `PRBMath` import (line 7) with `import {Math} from "@openzeppelin/contracts/utils/math/Math.sol"`, then replace 2 `PRBMath.mulDiv(...)` calls with `Math.mulDiv(...)` at `_computeSplit` (line 352) and the flash fee base (line 470).
- **Patterns to follow:** The existing `Math.mulDiv(borrowAmount, f, WAD, Math.Rounding.Up)` call in `StreamPricing.sol:127` — the 3-arg variant drops the `Rounding` argument for default floor behavior.
- **Test scenarios:**
  - `test/StreamPricing.math.t.sol` factor/grossPrice/fee tests produce identical values after the swap (floor rounding is preserved).
  - `test/StreamPricing.t.sol` deposit and flash loan fee tests produce identical values.
  - `test/OVRFLO.t.sol` deposit split and flash loan tests pass unchanged.
  - Edge case: zero `aprBps` factor returns `WAD` (no mulDiv overflow or division by zero).
  - Edge case: large `timeToMaturity` does not overflow (existing fuzz bounds apply).
- **Verification:** `forge build` with no new warnings, `forge test --match-contract StreamPricing` passes, `forge test --match-contract OVRFLO` passes.

### U2. Update test files and remove prb-math remapping

- **Goal:** Update all test-file PRBMath references to OZ Math and remove the `prb-math` remapping from `foundry.toml`.
- **Requirements:** R4, R5, R6
- **Dependencies:** U1 — source contracts must no longer import `prb-math` before the remapping can be removed.
- **Files:** `test/StreamPricing.math.t.sol`, `test/fork/OVRFLOFlashLoanFork.t.sol`, `foundry.toml`
- **Approach:** In `test/StreamPricing.math.t.sol`, replace the `PRBMath` import (line 5) with `import {Math} from "@openzeppelin/contracts/utils/math/Math.sol"`, replace the `PRBMath.mulDiv(borrowAmount, f, WAD)` call (line 198) with `Math.mulDiv(borrowAmount, f, WAD)`, and update 4 comment references from "PRBMath mulDiv" to "Math.mulDiv" (lines 51, 90, 132, 213). In `test/fork/OVRFLOFlashLoanFork.t.sol`, update 2 forge-lint suppression comments from "matches PRBMath.mulDiv order" to "matches Math.mulDiv order" (lines 172, 197). In `foundry.toml`, remove the `"prb-math/=lib/prb-math/contracts/"` entry from the `remappings` array.
- **Patterns to follow:** Same 3-arg `Math.mulDiv` pattern as U1.
- **Test scenarios:**
  - `test/StreamPricing.math.t.sol` obligation test (line 198) produces identical values with `Math.mulDiv` replacing `PRBMath.mulDiv`.
  - `test/fork/OVRFLOFlashLoanFork.t.sol` compiles (comment-only changes, no behavioral impact).
  - `forge build` succeeds after `prb-math` remapping removal — proves no remaining PRBMath imports.
- **Verification:** `forge build` clean (proves remapping removal is safe), `forge test` all pass, `medusa fuzz --config medusa.json --timeout 300` 0 failures and 0 warnings.

---

## Verification Contract

| Gate | Command | Expected |
|------|---------|----------|
| Compile | `forge build` | Clean, no new warnings |
| Unit tests | `forge test` | All tests pass, no regressions |
| Fuzz suite | `medusa fuzz --config medusa.json --timeout 300` | 0 failures, 0 warnings |
| Echidna smoke (optional) | `./script/fizz_echidna.sh smoke` | 0 failures |

---

## Definition of Done

- All R1-R9 satisfied.
- No `PRBMath` or `prb-math` references remain in `src/` or `test/` (grep-verifiable).
- `prb-math` remapping removed from `foundry.toml`.
- `forge build`, `forge test`, and `medusa fuzz --timeout 300` all green.
- No abandoned or experimental code left in the diff.
