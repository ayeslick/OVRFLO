---
title: Halmos Formal Verification of Rounding & Pro-Rata Math - Plan
type: test
date: 2026-07-18
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

## Goal Capsule

- **Objective:** Add Tier-1 formal verification via Halmos symbolic testing: exhaustive-within-domain proofs of `StreamPricing`'s rounding math (obligation ceil, fee floor, grossPrice floor, obligationForFill fast path, round-trip no-brick doctrine) plus a bounded formula-level check of `_claimFair`'s pro-rata entitlement. Establish the toolchain (first Python tool in the repo), the run protocol, and a decision gate for a later Certora engagement (Tier 3: unbounded pro-rata conservation).
- **Authority:** AUDIT.md rows 48/123 already track "Formal verification (Halmos): Not yet implemented" — this plan implements that commitment. FV assessment discussed 2026-07-18.
- **Execution profile:** Five units, five commits, sequential U1→U5. No `src/` changes anywhere in this plan.
- **Stop conditions:** Any Halmos counterexample that survives concrete re-execution (see KTD7) is a potential protocol bug — STOP, log it as an AUDIT.md finding, do not adjust the property to pass.
- **Tail ownership:** Implementer runs the full gate protocol (U5) twice before declaring properties proven. User reviews before push.

---

## Product Contract

### Summary

Introduce `test/halmos/` with symbolic `check_` tests proving the rounding properties that the fuzz suite (SP-09/10/13/17/19/20/24, GL-74) currently only samples, over the protocol's real input domains. Pin Halmos 0.3.3 with a requirements file (OpenZeppelin's pattern), add `halmos.toml` + `[profile.halmos]`, document the run command, and update AUDIT.md — including fixing its stale `E-3` invariant citation.

### Problem Statement

The fuzz suite gives probabilistic confidence on the most rounding-sensitive code in the repo. The rounding doctrine (`grossPrice` floors, `obligation` ceils — "Do not flip either rounding direction", src/StreamPricing.sol:52-60) is load-bearing for loan solvency: the repayLoan-brick writeup (docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md) documents what a one-wei mistake costs. Symbolic proof over the bounded domain closes the gap between "sampled" and "exhaustive within the domain," at near-zero marginal cost per run once set up.

### Key Technical Decisions (resolve all spec-flow gaps)

KTD1. **Invariant ID correction.** The `I-4/E-3` citation in AUDIT.md:48,123 is stale — `x-ray/invariants.md` defines only E-1/E-2. `_claimFair` rests on **I-5 (proceeds conservation), I-6 (contributions sum), E-2 (pro-rata fairness)** per invariants.md:277. All new test NatSpec cites these; U5 fixes the AUDIT.md rows.

KTD2. **`_claimFair` is verified at the formula level, not the function level.** `_claimFair` is stateful with Sablier external calls — not a Halmos-friendly target. Tier 1 extracts the entitlement expression (src/OVRFLOLending.sol:617-618: `claimable = contribution * recovered / totalContributed - received`) into a pure harness function taking symbolic `contribution`, `recovered`, `totalContributed`, `received` directly. The deliverable docs must state this boundary explicitly so no reader assumes the full function is proven. Function-level, all-claimants conservation is the Tier-3 Certora scope.

KTD3. **No "invariant-depth" framing.** The bounded pro-rata check is one `check_` function that applies the entitlement formula **twice in sequence** (two claims by the same account, state threaded manually: `received += payAmount1` before call 2), asserting after each call that cumulative `received * totalContributed <= contribution * recovered` (SP-24's cross-multiplied shape). Single symbolic call frames only; no Halmos `invariant_` tests in Tier 1.

KTD4. **Dual mulDiv axiomatization, stated separately.** Two implementations are in play: PRB-Math `PRBMath.mulDiv` (used by `factor`, `grossPrice`, `fee`) and OZ `Math.mulDiv(..., Rounding.Up)` (used by `obligation`). Neither's 512-bit path is symbolically tractable (snekmate OOM'd z3 on exactly this). Both are **axiomatized as trusted** — but narrowly: every check constrains inputs so the 512-bit branch is dead (`prod1 == 0`, i.e. the product fits 256 bits — guaranteed by the uint128 amount domain × WAD-scale factors bounded per KTD5), so the trust is only in the linear `a*b/d` path each implementation shares. Provenance note in the harness NatSpec: Remco Bloemen's published derivation, OZ's fuzz suite, partial Lean 4 verification of the algorithm (Philogy/remco-mul) — and this repo's own differential fuzz test bridging the PRB and OZ implementations. The `Rounding.Up` `+1` branch of `obligation` is NOT axiomatized — it is exactly what the cross-multiplied ceil property proves.

KTD5. **Properties stated in cross-multiplied (linear) form.** Never assert through a division. E.g. obligation-is-exact-ceil becomes: `q * WAD >= borrowAmount * f` AND `(q - 1) * WAD < borrowAmount * f` (for `q >= 1`). This is the pattern OZ uses to prove `ceilDiv` over full uint256 with `cvc5-int`.

KTD6. **SafeCast revert boundary via low-level call.** `vm.expectRevert` is unsupported in Halmos. The uint128 overflow boundary of `obligation` is proven with `(bool success,) = address(harness).call(abi.encodeCall(...))` + `assert(!success)` under the overflow precondition, and `assert(success)` under its complement — the standard OZ-suite idiom.

KTD7. **Counterexample triage protocol.** Halmos disables nonlinear reasoning by default and can emit invalid counterexamples. Every counterexample must be re-executed concretely (paste the model values into a Foundry test) before being treated as real. Real → STOP + AUDIT.md finding (same ID scheme as existing findings). Invalid → escalate solver (`cvc5-int`, then `bitwuzla-abs` per-test via `/// @custom:halmos --solver ...`).

KTD8. **Vacuity gate.** "0 counterexamples" and "assumptions unsatisfiable" are indistinguishable in output. Every `check_` function with a `vm.assume` chain gets a paired reachability check: same assumes, terminal `assert(false)` — which MUST report a counterexample. A `check_` is only "proven" when its reachability twin fails as expected. (Convention: `check_X` / `checkReach_X`; the reach twins run under a `--match-test` filter so the main gate excludes them.)

KTD9. **Halmos is additive, isolated, and pinned.** The existing fuzz/unit tests are kept unchanged — Halmos does not replace test/StreamPricing.math.t.sol. The suite lives in `test/halmos/`, compiled under `[profile.halmos]` so plain `forge test` performance is untouched. Halmos pinned `==0.3.3` in `fv-requirements.txt` (OZ pattern); solvers pinned via explicit `--solver` per test class (default yices; `cvc5-int` for div-heavy ceil/floor checks; `bitwuzla-abs` fallback). Explicit `--solver-timeout-assertion 300s` in halmos.toml — never solver defaults — and the U5 protocol requires two consecutive identical runs before AUDIT.md is updated (no CI exists to absorb nondeterminism).

### Scope Boundaries

**In scope:** toolchain files (`fv-requirements.txt`, `halmos.toml`, `[profile.halmos]`), `test/halmos/` suite, AGENTS.md dev-command entry, AUDIT.md row updates + E-3 citation fix, this plan.

**Out of scope / deferred:**
- Certora engagement (Tier 3) — see Decision Gate below; nothing in this plan buys or configures Certora.
- CI workflow — repo has no `.github/`; deliverable is the documented local command. Revisit when CI exists.
- Symbolic verification of `mulDiv` itself (axiomatized per KTD4); Kontrol; SMTChecker.
- Any change to `src/`, the fuzz suite, or existing tests.

---

## Implementation Units

### U1. Toolchain

- **Files:** `fv-requirements.txt` (new: `halmos==0.3.3`), `halmos.toml` (new, repo root), `foundry.toml` (add `[profile.halmos]`), `AGENTS.md` (dev-commands entry).
- **halmos.toml `[global]`:** `solver = "yices"`, `solver-timeout-assertion = "300s"`, `solver-timeout-branching = "1ms"`, `loop = 2`, `cache-solver = true`, `match-contract = "Halmos"`. Canonical key reference: a16z halmos `tests/regression/halmos.toml`.
- **`[profile.halmos]`:** copy of default profile plus `extra_output = ["storageLayout", "metadata"]` (prevents recompile churn between forge test and halmos). Match the existing `[profile.invariant]` precedent style.
- **AGENTS.md command:** `python3 -m venv .venv-fv && .venv-fv/bin/pip install -r fv-requirements.txt` (once), then `FOUNDRY_PROFILE=halmos .venv-fv/bin/halmos` (with `HALMOS_ALLOW_DOWNLOAD=1` on first run for solver download). Add `.venv-fv/` to `.gitignore`.
- **Verification:** `halmos --version` prints 0.3.3; `FOUNDRY_PROFILE=halmos halmos --match-contract NoSuchContract` exits cleanly (toolchain smoke, no tests yet).

### U2. StreamPricing symbolic suite

- **Files:** `test/halmos/HalmosStreamPricing.t.sol` (new). Harness mirrors `MathHarness` (test/StreamPricing.math.t.sol:9-33): external wrappers for `factor`, `grossPrice`, `obligation`, `obligationForFill`, `fee`. Contract inherits `SymTest` (forge install a16z/halmos-cheatcodes → new submodule + remapping) and `Test`.
- **Domains (via `vm.assume`, never `bound`):** amounts `<= type(uint128).max`; `aprBps <= 10_000` for realistic checks, full `uint16` for robustness variants where tractable; `ttm <= 1000 * 365 days` (the repo's established PRBMath overflow bound, test/StreamPricing.math.t.sol:51); `feeBps <= 100` (FEE_MAX_BPS) realistic / full uint16 robustness. Product-fits-256-bit assumes per KTD4.
- **Checks (exact names — the acceptance list):**

| Check | Property (cross-multiplied form) | Fuzz/audit ID |
|---|---|---|
| `check_factor_geWad_monotonic` | `f >= WAD`; `f(apr, t2) >= f(apr, t1)` for `t2 >= t1`; same in aprBps | I-7 |
| `check_obligation_exactCeil` | `q*WAD >= b*f` and `(q-1)*WAD < b*f` | I-7, SP-09 |
| `check_obligation_geBorrow` | `q >= b` (follows from f >= WAD; independent statement) | SP-09 |
| `check_obligation_uint128Boundary` | low-level call: reverts iff ceil > uint128.max (KTD6) | — |
| `check_fee_exactFloor` | `fee*BPS <= x*feeBps < (fee+1)*BPS`; `fee <= x` | SP-17, SP-19 |
| `check_fee_zeroBps` | forced `feeBps = 0` → `fee == 0` (branch-pinned per spec-flow gap 8) | SP-17 |
| `check_grossPrice_floorLeRemaining` | `gp*f <= r*WAD < (gp+1)*f`; `gp <= r` | I-7 |
| `check_obligationForFill_fastPath` | forced `b == gp` → result `== remaining` | SP-13 |
| `check_obligationForFill_partialLeRemaining` | `b < gp` → `obligationForFill <= remaining` | SP-10 |
| `check_obligationForFill_monotonic` | non-decreasing in `b` on `[0, gp]`, upward-only jump at the fast-path boundary (spec-flow gap 7) | SP-13 |
| `check_roundTrip_noBrick` | `obligation(grossPrice(r)) <= r` — the doctrine invariant | I-7, no-brick writeup |
| `check_zeroInputs` | forced `ttm=0`, `aprBps=0`, `b=0` branch pins: `factor==WAD`, `obligation(0)==0`, `grossPrice` identity at f==WAD | — |

- **Solver annotations:** ceil/floor checks get `/// @custom:halmos --solver cvc5-int` (OZ's proven-tractable choice for ceilDiv); escalate individual stragglers to `bitwuzla-abs`. Every check gets its `checkReach_` twin (KTD8).
- **Verification:** `FOUNDRY_PROFILE=halmos halmos --match-contract HalmosStreamPricing --match-test '^check_'` → all pass, no `counterexample-unknown`; `--match-test '^checkReach_'` → all report counterexamples (vacuity gate).

### U3. Pro-rata entitlement formula suite (bounded)

- **Files:** `test/halmos/HalmosClaimFair.t.sol` (new). Pure harness function replicating src/OVRFLOLending.sol:617-620 exactly: `claimable = contribution * recovered / totalContributed - received; request = min(amount, claimable)` (uint256 intermediate, uint128 casts via the same SafeCast path).
- **Checks:**
  - `check_entitlement_proRataCap` — single application: after paying `p <= request`, `(received + p) * totalContributed <= contribution * recovered` (SP-24 shape, cross-multiplied). Preconditions: `contribution <= totalContributed`, `totalContributed > 0`, `received * totalContributed <= contribution * recovered` (inductive hypothesis).
  - `check_entitlement_twoSequentialClaims` — the KTD3 two-call chain; cumulative cap holds after each.
  - `check_entitlement_noUnderflow` — the line-618 subtraction cannot underflow given the inductive precondition (this IS SP-24's guarantee; a counterexample here would reproduce the claimable-underflow class).
- **NatSpec must state (KTD2):** formula-level proof only; function-level/all-claimants conservation (I-5, I-6, E-2 unbounded) is deferred to Certora — do not cite these checks as proving `_claimFair`.
- **Verification:** same gate as U2 for this contract.

### U4. Run protocol + triage doc

- **Files:** `test/halmos/README.md` (new, short): the run command, per-check expected status table, KTD7 counterexample triage steps, KTD8 vacuity gate explanation, solver/timeout pins, "two consecutive identical runs" rule, wall-clock budget (**target: full suite < 30 minutes on a dev laptop; any single check > 10 minutes gets a per-test timeout annotation and a README note**, so the suite stays run-able — spec-flow acceptance gap).
- **Verification:** README's command, run verbatim from a clean checkout + venv, reproduces the recorded statuses.

### U5. AUDIT.md + decision gate

- **Files:** `AUDIT.md`, `x-ray/invariants.md` (only if the E-3 fix requires a cross-ref note).
- Update both formal-verification rows (AUDIT.md:48,123): "Not yet implemented" → implemented-for-Tier-1 with the check list and the KTD2 boundary statement; **fix `I-4/E-3` → `I-5/I-6/E-2`** (KTD1).
- **Certora decision gate (documented in AUDIT.md, decided later, not in this plan):** commission a Certora engagement scoped to `_claimFair` + ghost-sum conservation (`Σ loanPoolReceived + loanPoolProceeds == drawn + repaid`, unbounded claimants — the CVL Tracking-Sums pattern) **when** mainnet deployment with external TVL is scheduled, **or** any Tier-1 counterexample survives triage. Until then, the fuzz suite's GL-74/SP-25 remain the conservation check. (Supporting data point: Morpho removed its Halmos suite in Jan 2026 but kept Certora CI — the tools settle into exactly this split.)
- **Verification:** `rg "E-3" AUDIT.md x-ray/` → zero stale hits; AUDIT.md rows reflect reality after two identical passing runs.

---

## Acceptance Criteria

- [ ] `fv-requirements.txt` pins `halmos==0.3.3`; venv command documented in AGENTS.md; `.venv-fv/` gitignored
- [ ] All U2 checks listed in the table exist with those exact names and pass; every one has a passing (i.e. counterexample-producing) `checkReach_` twin
- [ ] All U3 checks pass with the KTD2 boundary stated in NatSpec
- [ ] No check reports `counterexample-unknown`/timeout in the recorded runs; per-check statuses recorded in test/halmos/README.md
- [ ] Full suite wall-clock under 30 minutes; two consecutive runs produce identical results
- [ ] `forge test` (default profile) runtime and results unchanged — Halmos suite invisible to it
- [ ] AUDIT.md rows updated; `E-3` citation fixed to `I-5/I-6/E-2`; Certora decision gate documented
- [ ] Zero changes under `src/`

## Dependencies & Risks

- **Python ≥ 3.11 required** on the dev machine (first Python tool in repo). Docker fallback: `ghcr.io/a16z/halmos:latest`.
- **Solver tractability risk:** if a ceil/floor check times out even on `cvc5-int`/`bitwuzla-abs` with the uint128 domain, the fallback ladder is: tighten to the realistic envelope (aprBps ≤ 10_000, ttm ≤ 2y — matching test/StreamPricing.math.t.sol:355), then case-split on `mulmod == 0`. Record any domain narrowing in the README status table — never silently.
- **halmos-cheatcodes submodule** is a new dependency; pin the commit in `.gitmodules` like the existing libs.
- **No CI** means discipline is procedural (two-run rule). Acceptable for now; noted for the future.

## References

### Internal
- Targets: src/StreamPricing.sol:100-161 (five functions + doctrine comment 52-60); src/OVRFLOLending.sol:601-640 (`_claimFair`), 617-618 (entitlement)
- Spec source: test/fizz/Properties.sol SP-09/10/13/17/19/20/24, GL-74; test/StreamPricing.math.t.sol (MathHarness 9-33, bounds idioms 51/136/213-222, envelope 343-346)
- Tracking: AUDIT.md:48,123; x-ray/invariants.md I-5/I-6/I-7/E-2 (:277); docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md

### External
- Halmos: https://github.com/a16z/halmos (v0.3.3), getting-started.md, wiki/warnings (nonlinear + invalid-counterexample caveats), tests/regression/halmos.toml (config reference)
- Cheatcodes: https://github.com/a16z/halmos-cheatcodes
- OZ precedent: openzeppelin-contracts fv-requirements.txt + .github/workflows/formal-verification.yml + test/utils/math/Math.t.sol (`testSymbolicCeilDiv` with `cvc5-int`)
- Cross-multiplication pattern: a16z halmos examples/simple/test/Vault.t.sol
- mulDiv provenance (KTD4): https://xn--2-umb.com/21/muldiv/ (Remco derivation); https://reservoir.lean-lang.org/@Philogy/remco-mul (partial Lean proof); snekmate commit 459ec3f (z3 OOM data point)
- Certora ghost sums (Tier 3): https://docs.certora.com/en/latest/docs/user-guide/patterns/sums.html
