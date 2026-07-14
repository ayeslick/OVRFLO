# AUDIT.md — OVRFLO Auditor Onboarding

> You are an external auditor. This file is the front door. Read it top to bottom once, then drill into the linked companion docs and `x-ray/` backing evidence as needed. Everything here exists to get you to "I know what the protocol assumes, what to attack first, and what has already been settled" without reconstructing it from scattered sources.

## Prescribed reading order

0. **Think in graphs, not checklists**: trace how state flows across contracts, how one function's writes become another function's preconditions, and how invariant assumptions propagate through call chains. A checklist finds isolated issues; a mental graph of state dependencies, value flows, and trust boundaries finds the interactions that cause real exploits.
1. **Scope snapshot** — `docs/audit/scope-snapshot.md` — confirm the commit, in-scope files, pinned dependencies, and snapshot date before anything else.
2. **AI auditor methodology overlay** — `docs/audit/ai-auditor-methodology.md` — how to audit OVRFLO as an AI agent: conceptual lens, security patterns, multi-agent pipeline, domain routing, finding format. Internalize this before reading the protocol-specific context.
3. **Dependency interface contracts** — `docs/audit/pendle-interface-contract.md` and `docs/audit/sablier-interface-contract.md` — what OVRFLO assumes of Pendle and Sablier, each assumption with where it is enforced (or not) and what breaks if it fails.
4. **Internal protocol model** — `docs/audit/internal-model.md` — the dual-backing solvency tie-out and the self-repaying-loan economics, framed insolvency-first.
5. **Trust-assumption / not-enforced pre-flight ledger** — `docs/audit/trust-assumption-ledger.md` — the off-chain-trusted beliefs to ACCEPT or CHALLENGE. Start attack work here.
6. **Rejected-findings decision record + Q&A** — `docs/audit/rejected-findings-record.md` — what the internal review already settled. Consult before raising a finding.
7. **Audit findings** — `docs/audit/audit-findings.md` — 5 findings (M-01 through L-02) from the internal audit campaign, all fixed. Read before raising a duplicate.
8. **Critical security patterns** — `docs/solutions/patterns/ovrflo-critical-patterns.md` — 17 enforceable rules extracted from past problem writeups (self-match prevention, strictly-increasing IDs, pro-rata claim caps, CEI ordering, fee snapshots, sweepExcessPt input validation, etc.). Required reading before probing; these encode hard-won lessons about what has already broken and been fixed.
9. **Reproduction notes** — in the scope snapshot; full runnable harness is deferred.

Background (not in the reading order): `README.md` (protocol spec), `CONCEPTS.md` (domain glossary), `BASE_SECURITY.md`, `4626_SECURITY.md`, `GUIDELINES.md`.

## Citation graph

The package reuses the stable IDs already in `x-ray/` — guard codes `G-1..G-56`, invariants `I-1..I-17`, cross-contract invariants `X-1..X-3`, economic invariants `E-1..E-3` (all in `x-ray/invariants.md`), and entry-point names (in `x-ray/entry-points.md`). Findings and questions should cite these IDs.

| Package doc | Backing evidence |
|-------------|---------------------------|
| `docs/audit/ai-auditor-methodology.md` | ethskills.com (concepts, security, audit, standards); evmresearch.io; `x-ray/invariants.md` (all IDs); `x-ray/entry-points.md` (all entry points) |
| `docs/audit/scope-snapshot.md` | `x-ray/x-ray.md` (contracts-in-scope, forked dependencies); `script/lib/OVRFLOTestFixtures.sol` (pinned addresses) |
| `docs/audit/pendle-interface-contract.md` | `x-ray/invariants.md` (X-1, I-11, I-17); `x-ray/multi-agent-audit-report.md` (M-4) |
| `docs/audit/sablier-interface-contract.md` | `x-ray/invariants.md` (X-3, I-7); `x-ray/multi-agent-audit-report.md` (verified v1.1 ACL table) |
| `docs/audit/internal-model.md` | `x-ray/invariants.md` (I-1, I-7, I-9, I-13, E-1, E-2); `CONCEPTS.md` |
| `docs/audit/trust-assumption-ledger.md` | `x-ray/invariants.md` (X-1, X-2); `x-ray/x-ray.md` (threat model, adversary ranking, trust boundaries) |
| `docs/audit/rejected-findings-record.md` | `x-ray/multi-agent-audit-report.md` (rejected H-2/M-5, downgrade H-1→L-1, resolved Q&A, consensus table) |
| `docs/audit/audit-findings.md` | `x-ray/invariants.md` (I-4, I-6, I-7, I-17, G-5, G-24/25, G-27, G-42, G-46); `docs/solutions/best-practices/triage-fix-and-document-audit-findings.md` |

`x-ray/` retains its unique analysis as linked backing evidence: the entry-point map (`x-ray/entry-points.md`), invariant derivations (`x-ray/invariants.md`), git forensics and test analysis (`x-ray/x-ray.md`), and the audit severity summary / agent-coverage list (`x-ray/multi-agent-audit-report.md`).

> **Note on `multi-agent-audit-report.md`:** This file predates the latest `x-ray/` regeneration and may contain invariant IDs from the old numbering. Trust the IDs in `x-ray/invariants.md` when they conflict.

## Scope-exclusion log

| Excluded | Why |
|----------|-----|
| Sablier V2 internals (beyond v1.1 ACL/withdrawability) | Bounded external dependency, trusted at v1.1; OVRFLO does not modify Sablier. Pinned address in scope snapshot. |
| Pendle YT / AMM mechanics | OVRFLO never trades YT or interacts with the Pendle AMM. |
| `test/`, `script/`, `lib/`, `web/`, `tools/`, `interfaces/` | Test harness, deploy scripts, vendored libs, frontend, tooling, interface stubs — not in-scope production logic. |
| Runnable audit harness (invariants-as-properties suite, one-command fork env, committed traces) | Deferred to a follow-up plan. This package is the doc/content layer. |
| Standalone lifecycle walkthrough doc | Deferred; minimal dynamic context is folded into the dependency contracts and internal-model docs. |
| Formal verification (Halmos) | Not yet implemented. Three properties identified: I-7 (rounding invariant), I-4/E-3 (pool pro-rata fairness), I-2/I-3 (pool conservation). |
| Fuzz campaign re-run after audit fixes | Medusa/Echidna configs have 133 properties. 5 violations found and fixed (M-01 through L-02); re-run to confirm zero violations is pending. |

## One-screen triage map

41 entry points (11 permissionless, 4 role-gated, 26 admin) per `x-ray/entry-points.md`; the 11 value-moving permissionless paths below are the attack surface. ◆ = touches a **not-enforced-on-chain** invariant (probe first). Reentrancy guard column: ✓ = `nonReentrant`, ✗ = none. Adversary rank from `x-ray/x-ray.md` (#1 flash loan, #2 oracle, #3 pool claim, #4 admin).

### Permissionless — the attack surface

| Entry point | Invariant IDs | Adv | Reentrancy | ◆ |
|-------------|---------------|-----|------------|---|
| `OVRFLO.deposit()` | G-5/6/7/8/9/10/11, I-1, I-12, I-15, I-17, X-1 | #2 | ✗ | |
| `OVRFLO.claim()` | G-12/13/14, I-1, I-12 | #1 | ✗ | |
| `OVRFLO.wrap()` | G-2/3, I-1, I-13, E-1 | #1 | ✗ | |
| `OVRFLO.unwrap()` | G-4, I-1, I-13, E-1 | #1 | ✗ | |
| `OVRFLO.flashLoan()` | G-5/15/16/17, I-5, I-17 | #1 | ✓ | |
| `OVRFLOLending.supplyLiquidity()` | G-28/29, I-6, I-8 | #3 | ✓ | ◆ X-2 |
| `OVRFLOLending.sellStreamToLiquidity()` | G-30/32/33, I-7, I-8, X-3 | #3 | ✓ | ◆ X-2 |
| `OVRFLOLending.postSaleListing()` | G-28/29, I-6, I-10, X-3 | #3 | ✓ | ◆ X-2 |
| `OVRFLOLending.buyListing()` | G-34/36, I-7, I-10, X-3 | #3 | ✓ | ◆ X-2 |
| `OVRFLOLending.closeLoan()` | G-37/38, I-7, I-9, X-3 | #3 | ✓ | ◆ X-2 |
| `OVRFLOLending.createBorrowerLoanPool()` | G-41/42/43/44, I-2, I-4, I-7, I-8, I-9, E-2, E-3, X-3 | #3 | ✓ | ◆ X-2 |

> `deposit()` and `closeLoan()` are the two costliest flows. `deposit()` carries the oracle split (adversary #2 — Pendle TWAP rate determines value distribution; I-17 now enforces freshness at runtime). `closeLoan()` is permissionless and Sablier-withdrawability-gated (adversary #3). `deposit()` lacks a reentrancy guard; lending paths are `nonReentrant`. `flashLoan()` is `nonReentrant` but the callback can call unguarded `deposit`/`wrap`/`unwrap` — see `x-ray/x-ray.md` attack surface "Flash loan wrap-claim-redeem cycle". X-3 (requireEligible) is enforced — but probe for bypass/stale-cache. X-2 (lending cached immutables: treasury, underlying, ovrfloToken) is not re-validated post-construction — all lending fund flows depend on it.

### Role-gated — lender/lender/borrower only

| Entry point | Gate | Invariant IDs |
|-------------|------|---------------|
| `OVRFLOLending.withdrawLiquidity()` | `liquidity.lender` (G-30/31) | I-8 |
| `OVRFLOLending.cancelSaleListing()` | `listing.lender` (G-34/35) | I-10 |
| `OVRFLOLending.claimLoanPoolShare()` | pool lender (G-45/46) | I-3, I-4, E-3 |
| `OVRFLOLending.repayLoan()` | `loan.borrower` (G-39) | G-37/40, I-3, I-9 |

### Admin-only — multisig → factory → vault

| Entry point | Invariant IDs | ◆ |
|-------------|---------------|---|
| `OVRFLOFactory.configureDeployment()` / `cancelDeployment()` / `deploy()` | G-49, I-16 | |
| `OVRFLOFactory.deployLending()` | — | |
| `OVRFLOFactory.addMarket()` | G-50/51/52/53/54/55, I-11, I-15, X-1 | |
| `OVRFLOFactory.setMarketDepositLimit()` | G-9 | |
| `OVRFLOFactory.prepareOracle()` | G-50/51 | |
| `OVRFLOFactory.sweepExcessPt()` / `sweepExcessUnderlying()` | G-18, I-1, I-13 | |
| `OVRFLOFactory.setFlashFeeBps()` / `setFlashLoanPaused()` | G-21, I-5 | |
| `OVRFLOFactory.setLendingAprBounds()` | G-22/23/24/25, I-6 | |
| `OVRFLOFactory.setLendingFee()` / `setLendingTreasury()` | G-26/27, I-14 | ◆ X-2 |
| `OVRFLO.setSeriesApproved()` | G-19/20, I-11 | |
| `OVRFLO.setMarketDepositLimit()` | G-9 | |
| `OVRFLO.sweepExcessPt()` / `sweepExcessUnderlying()` | G-18, I-1, I-13 | |
| `OVRFLO.setFlashFeeBps()` / `setFlashLoanPaused()` | G-21, I-5 | |
| `OVRFLOToken.transferOwnership()` / `mint()` / `burn()` | — | |
| `OVRFLOLending.setAprBounds()` | G-22/23/24/25, I-6 | |
| `OVRFLOLending.setFee()` | G-26, I-14 | |
| `OVRFLOLending.setTreasury()` | G-27 | ◆ X-2 |

> Note: counts match `x-ray/entry-points.md` (11 permissionless / 4 role-gated / 26 admin = 41). `OVRFLOToken` standard ERC20 (`transfer`/`transferFrom`/`approve`) are inherited and not listed.

## Testing baseline

19 test files, 195 test functions. **Coverage now available** — `forge coverage` succeeds with 100% line coverage and 99.6% branch coverage on source files (1 uncovered branch in `OVRFLOLending.sol`). All 167 test functions in the coverage run passed (0 failed). 195 tests pass (92 unit, 6 attack, 13 fuzz, 52 pricing, 4 invariant/100 runs, 28 fork).

| Category | Count | Notes |
|----------|-------|-------|
| Unit tests | ~25 files | All in-scope contracts covered |
| Mainnet fork tests | 6 files | Vault, lending, factory, flash loan, wrap/unwrap |
| Stateless fuzz | 1 suite (1000 runs) | OVRFLOFuzz |
| Stateful fuzz (Foundry) | 3 suites (500 runs, depth 25) | OVRFLOLending invariant, OVRFLO invariant, wrap/unwrap invariant |
| Attack scenarios | 1 suite | Flash-loan griefing, wrap/claim/redeem loops |
| Math stress | 1 suite | StreamPricing rounding, overflow, boundary |
| Audit fix tests | 7 files (U1-U7) | Guard tests, boundary reverts, edge cases, fork self-skip, defensive branch harness |
| Stateful fuzz (Echidna) | 1 config (`echidna.yaml`) | 133 properties across 5 contracts |
| Stateful fuzz (Medusa) | 1 config (`medusa.json`) | 133 properties, 500K test limit, 10 workers |
| Fuzz campaign results | 5 violations found and fixed | M-01 (claimLoanPoolShare pro-rata cap removed), M-02 (net slippage), M-03 (oracle freshness), L-01 (quote validation), L-02 (step-aligned APR bounds). All fixed test-first. See `docs/audit/audit-findings.md`. |
| Line coverage | 100% (source files) | 593/593 instrumented lines hit |
| Branch coverage | 99.6% (source files) | 267/268 branches hit (1 uncovered in OVRFLOLending) |
| Formal verification | 0 | Not yet implemented. Three properties identified: I-7, I-4/E-3, I-2/I-3. Halmos recommended. |

## Where to start

1. Read the scope snapshot. Confirm the pin (`01cad7b`).
2. Read the AI auditor methodology overlay — internalize the conceptual lens, security patterns, and multi-agent pipeline before diving into protocol-specific context.
3. Skim the two dependency contracts — note every row where "Enforced?" says **No** or **Onboarding only**.
4. Read the internal model — tie out the dual-backing identity (I-1 + I-13) and the loan `outstanding` relation (I-7 + G-38).
5. Read `docs/audit/audit-findings.md` — 5 findings were found and fixed in the internal campaign. Understand what was found before raising a duplicate.
6. Open the trust-assumption ledger. X-2 (lending cached immutables, not re-validated post-construction) is the only On-chain=No invariant — all lending fund flows depend on it. Also probe I-7 (obligation <= remaining) at the closeLoan boundary and the flash loan reentrancy path via unguarded `deposit`/`wrap`/`unwrap`.
7. Before raising a finding, check the rejected-findings record — especially H-2 (Sablier v1.1 ACL) and M-5 (cross-market fungibility). Also check `docs/solutions/patterns/ovrflo-critical-patterns.md` — if your probe target intersects a documented pattern (13 rules), the fix may already be in place.
8. Drill into `x-ray/invariants.md` and `x-ray/entry-points.md` for derivations and full call chains.

---

## Definition of Done

- A complete state-dependency graph has been constructed: every storage variable's write sites mapped, every function's preconditions traced to their writers, every cross-contract assumption identified — this graph (not the triage map) is the primary audit artifact
- Every invariant in `x-ray/invariants.md` has been attacked, not just confirmed — for each, the auditor has either produced a counterexample (finding) or articulated why no sequence of calls can violate it
- The 11 permissionless entry points have been composed into multi-step attack paths, not audited in isolation — at minimum: flash loan → deposit → wrap/unwrap → claim cycles, pool creation → claim races, and oracle-dependent deposit splits under adversarial conditions
- Every "Enforced? No" or "Onboarding only" row in the dependency interface contracts has been challenged with a concrete failure scenario or confirmed with reasoning
- The ◆ X-2 invariant (lending cached immutables, On-chain=No) has been probed for construction-time mismatch and post-deployment drift
- Trust assumptions in the trust-assumption ledger have been independently evaluated, not just read — each is either ACCEPTED with stated reasoning or CHALLENGED with a finding
- The 5 fixed audit findings in `docs/audit/audit-findings.md` have been reviewed — no finding raised that duplicates a fixed issue without new evidence
- Findings cite invariant IDs and entry-point names, duplicate no settled rejection without new evidence, and are scored against the severity rubric in the methodology overlay
- The auditor can articulate, without referencing the docs, how value flows through the system end-to-end and where the system's security breaks down if each trust boundary is crossed
