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

The package reuses the stable IDs in `x-ray/` — guard codes `G-1..G-68`, invariants `I-1..I-24`, cross-contract invariants `X-1..X-5`, economic invariants `E-1..E-5` (all in `x-ray/invariants.md`), and entry-point names (in `x-ray/entry-points.md`). Findings and questions should cite these IDs.

> **ID renumbering, 2026-08-10.** `x-ray/` was regenerated at `f0661ab` over the OVRFLOLending v1-lite rewrite. The old catalog described sale listings and loan pools, which no longer exist, so **every G/I/X/E ID was renumbered — old and new IDs are not comparable.** Qualify any citation from an earlier document with its commit (e.g. `X-2@01cad7b`). The full map is below; where each new invariant is *enforced* is the "Suite disposition" table at the top of `x-ray/invariants.md`.

### ID map (pre-rewrite → v1-lite)

Two pre-rewrite generations matter, because the package docs were written across both: **A** = `x-ray/invariants.md@17fd4f9` (the catalog live at `f0661ab`, 26 guards / I-1..I-9 / X-1..X-4 / E-1..E-2) and **B** = `@024753b` (35 guards / I-1..I-24 / X-1..X-5 / E-1..E-4, the generation most of `docs/audit/` cites). **Resolve an old ID by its statement, never by its number** — the two generations disagree with each other as well as with the current one. `—` means the property has no counterpart in that generation (it is new to the tape design, or it was folded into a neighbouring block).

| New | Statement | A `@17fd4f9` | B `@024753b` |
|---|---|---|---|
| I-1 | Loan intervals tile `[0, filled)` | — | — |
| I-2 | Frozen history below `filled` | — | — |
| I-3 | Lending escrow solvency | — | — |
| I-4 | Pot conservation per loan | I-5 | I-19 |
| I-5 | ovrfloToken custody == Σ proceeds | I-5 (same block) | I-19 (same block) |
| I-6 | Per-pair pro-rata claim cap | E-2 | I-20 |
| I-7 | `drawn + repaid ≤ obligation` | I-8 | I-16 |
| I-8 | Borrow atom (`fill ≥ MIN_LIQUIDITY_AMOUNT`) | — | — |
| I-9 | Supply atom — contradicted by design | — | — |
| I-10 | UNIT alignment of tape quantities | — | — |
| I-11 | `aprMin ≤ aprMax ≤ APR_MAX_CEILING` | I-9 (shared block) | I-11 |
| I-12 | `feeBps ≤ MAX_FEE_BPS` | I-9 (shared block) | I-12 |
| I-13 | TickTree node sums fit uint64 | — | — |
| I-14 | `loan.closed` one-way latch | I-7 | I-17 |
| I-15 | `tickSpacing` one-shot latch | — | — |
| I-16 | `oldestLiveEpoch ≤ currentEpoch`, monotone | — | — |
| I-17 | Epochs below the cursor are exhausted | — | — |
| I-18 | Tree height monotone | — | — |
| I-19 | `loansOf` claimable == claim payout | — | — |
| I-20 | `obligation ≤ remaining` | I-1 | I-21 / E-2 |
| I-21 | Closed-loan dust bound | E-2 (dust clause) | E-3 (dust clause) |
| I-22 | Maturity gates scoped per function | — | I-7 / I-23 |
| I-23 | `timeToMaturity` cannot underflow | — | — |
| I-24 | Vault dual-backing solvency | I-2 (with I-3, I-4) | E-1 (with I-1) |
| X-1 | Series config immutable, as lending assumes | X-4 | X-1 |
| X-2 | `tree.root() ≥ filled` | — | — |
| X-3 | Lending's cached vault wiring matches the factory | — | X-2 |
| X-4 | Lending treasury is mutable (On-chain=No) | — | X-2 (split out) |
| X-5 | Vault is sole minter/burner of its token | — | X-4 |
| E-1 | Lazy attribution is exact forever | I-6 (eager form) | I-18 (eager form) |
| E-2 | Pro-rata fairness under any claim ordering | E-2 | E-3 |
| E-3 | Every lender can always exit | E-1 (vault analogue) | — |
| E-4 | Collateral always covers debt | I-1 | E-2 |
| E-5 | Griefing is gas-bounded, not capital-bounded | — | — |

Retired with the sale/pool design (no successor block): A's `X-1`/`X-2`/`X-3` (unguarded `setSeriesApproved` writes — now guard-level facts, `G-21`/`G-22`); B's `I-13`/`I-14`/`I-15`/`I-24` and `E-4` (ID monotonicity, liquidity/listing state machines, sale price conservation — the mechanisms they described are deleted).

| Package doc | Backing evidence |
|-------------|---------------------------|
| `docs/audit/ai-auditor-methodology.md` | ethskills.com (concepts, security, audit, standards); evmresearch.io; `x-ray/invariants.md` (all IDs); `x-ray/entry-points.md` (all entry points) |
| `docs/audit/scope-snapshot.md` | `x-ray/x-ray.md` (contracts-in-scope, forked dependencies); `script/lib/OVRFLOTestFixtures.sol` (pinned addresses) |
| `docs/audit/pendle-interface-contract.md` | `x-ray/invariants.md` (G-11, I-24); `x-ray/multi-agent-audit-report.md` (M-4) |
| `docs/audit/sablier-interface-contract.md` | `x-ray/invariants.md` (G-43, G-67, G-68, I-20); `x-ray/multi-agent-audit-report.md` (verified v1.1 ACL table) |
| `docs/audit/internal-model.md` | `x-ray/invariants.md` (I-3, I-4, I-20, I-24, E-3, E-4); `CONCEPTS.md` |
| `docs/audit/trust-assumption-ledger.md` | `x-ray/invariants.md` (X-1, X-3, X-4); `x-ray/x-ray.md` (threat model, adversary ranking, trust boundaries) |
| `docs/audit/rejected-findings-record.md` | `x-ray/multi-agent-audit-report.md` (rejected H-2/M-5, downgrade H-1→L-1, resolved Q&A, consensus table) |
| `docs/audit/audit-findings.md` | `x-ray/invariants.md` (I-6, I-11, I-12, I-20, G-9, G-11, G-18, G-48/49); `docs/solutions/best-practices/triage-fix-and-document-audit-findings.md` |

`x-ray/` retains its unique analysis as linked backing evidence: the entry-point map (`x-ray/entry-points.md`), invariant derivations (`x-ray/invariants.md`), git forensics and test analysis (`x-ray/x-ray.md`), and the audit severity summary / agent-coverage list (`x-ray/multi-agent-audit-report.md`).

> **Stale-ID notice — seven documents.** Every ID in the bodies of `x-ray/multi-agent-audit-report.md`, `x-ray/flash-loan-invariant-check.md`, `docs/audit/internal-model.md`, `docs/audit/trust-assumption-ledger.md`, `docs/audit/audit-findings.md`, `docs/audit/sablier-interface-contract.md`, and `docs/audit/pendle-interface-contract.md` predates the 2026-08-10 regeneration, and the seven were written against **different** pre-rewrite generations (see the ID map above — resolve by statement, not by number). Each of those files now carries a one-line banner saying so. `multi-agent-audit-report.md` additionally analyses the deleted sale/pool lending design. Trust `x-ray/invariants.md`, `x-ray/entry-points.md`, and `x-ray/x-ray.md` when they conflict. Their vault-side and Sablier-ACL content remains valid — the vault was untouched by the rewrite.

## Scope-exclusion log

| Excluded | Why |
|----------|-----|
| Sablier V2 internals (beyond v1.1 ACL/withdrawability) | Bounded external dependency, trusted at v1.1; OVRFLO does not modify Sablier. Pinned address in scope snapshot. |
| Pendle YT / AMM mechanics | OVRFLO never trades YT or interacts with the Pendle AMM. |
| `test/`, `script/`, `lib/`, `web/`, `tools/`, `interfaces/` | Test harness, deploy scripts, vendored libs, frontend, tooling, interface stubs — not in-scope production logic. |
| Runnable audit harness (invariants-as-properties suite, one-command fork env, committed traces) | Deferred to a follow-up plan. This package is the doc/content layer. |
| Standalone lifecycle walkthrough doc | Deferred; minimal dynamic context is folded into the dependency contracts and internal-model docs. |
| Formal verification (Halmos) | Not yet implemented. Three properties identified: I-7 (rounding invariant), I-4/E-3 (pool pro-rata fairness), I-2/I-3 (pool conservation). |
| Fuzz campaign re-run after audit fixes | Complete: 198 properties in Medusa/Echidna configs. 5 violations found and fixed (M-01 through L-02). Re-run: 140 Medusa tests passed, 0 violations. 1 harness false positive (SP-99) found and fixed. See `fizz_data/report.md`. |

## One-screen triage map

40 entry points (10 permissionless, 2 role-gated, 28 admin) per `x-ray/entry-points.md`; the 12 value-moving permissionless and role-gated paths below are the attack surface. ◆ = touches a **not-enforced-on-chain** invariant (probe first). Reentrancy guard column: ✓ = `nonReentrant`, ✗ = none. Adversary rank from `x-ray/x-ray.md` (#1 tape/attribution, #2 claim-race, #3 oracle, #4 flash-loan compositor, #5 book griefer, #6 admin).

### Permissionless — the attack surface

| Entry point | Invariant IDs | Adv | Reentrancy | ◆ |
|-------------|---------------|-----|------------|---|
| `OVRFLOLending.borrow()` | G-32/33/34/35/36/37, I-1, I-8, I-10, I-20, I-22, X-1, X-2 | #1 | ✓ | ◆ I-1, E-1 |
| `OVRFLOLending.supply()` | G-25/26/27/28/29, I-3, I-9, I-10, I-16, I-22, X-2 | #5 | ✓ | ◆ I-3 |
| `OVRFLOLending.close()` | G-41/42/43, I-7, I-14, I-20, E-4 | #2 | ✓ | ◆ I-4 |
| `OVRFLOLending.repay()` | G-39/40/41/42, I-4, I-7, I-14 | #2 | ✓ | ◆ I-4, I-5 |
| `OVRFLOLending.advanceEpochCursor()` | G-38, I-16, I-17 | #5 | ✓ | |
| `OVRFLO.deposit()` | G-5/6/7/8/9/10/11, I-24, X-1, X-5 | #3 | ✗ | ◆ I-24 |
| `OVRFLO.claim()` | G-12/13/14, I-24, X-5 | #4 | ✗ | ◆ I-24 |
| `OVRFLO.wrap()` | G-2/3, I-24, X-5, E-3 | #4 | ✗ | ◆ I-24 |
| `OVRFLO.unwrap()` | G-4, I-24, X-5, E-3 | #4 | ✗ | ◆ I-24 |
| `OVRFLO.flashLoan()` | G-15/16/17/23, I-24 | #4 | ✓ | ◆ I-24 |

> `borrow()` and `claim()` are the two costliest flows. `borrow()` is the blind fill — it advances `filled` and freezes an interval every future claim reads, so I-1, I-2, and E-1 are all downstream of it. `claim()` carries the pro-rata cap and the `min(withdrawable, outstanding)` harvest clamp (I-6) that stops a claimer on an over-vested open loan from draining co-lenders. Vault paths (`deposit`/`wrap`/`unwrap`/`claim`) lack reentrancy guards; every lending path is individually `nonReentrant`. `flashLoan()` is `nonReentrant` but the callback can call unguarded `deposit`/`wrap`/`unwrap` — see `x-ray/x-ray.md` attack surface "Flash loan callback re-enters unguarded vault paths". The tape invariants I-1/I-2/I-3 and E-1 are **deliberately test-enforced, not runtime-enforced** — validating them on-chain would need an unbounded scan, which the implementation discipline forbids. Their executable form is `test/OVRFLOLendingInvariant.t.sol`.

### Role-gated — position lender only

| Entry point | Gate | Invariant IDs |
|-------------|------|---------------|
| `OVRFLOLending.withdraw()` | `position.lender` (G-30/31) | I-2, I-3, I-9, X-2 |
| `OVRFLOLending.claim()` | `position.lender` (G-44/45/46/47) | I-4, I-5, I-6, I-19, I-21, E-2 |

### Admin-only — multisig → factory → vault

| Entry point | Invariant IDs | ◆ |
|-------------|---------------|---|
| `OVRFLOFactory.registerOvrflo()` | X-3, X-5 | |
| `OVRFLOFactory.registerLending()` | X-3 | |
| `OVRFLOFactory.addMarket()` | G-11/21/22, I-24, X-1 | |
| `OVRFLOFactory.setMarketDepositLimit()` | G-8 | |
| `OVRFLOFactory.prepareOracle()` | G-11 | |
| `OVRFLOFactory.sweepExcessPt()` / `sweepExcessUnderlying()` | G-18/19/20, I-24 | |
| `OVRFLOFactory.setFlashFeeBps()` / `setFlashLoanPaused()` | G-15/23 | |
| `OVRFLOFactory.setLendingAprBounds()` | G-48/49, I-11 | |
| `OVRFLOFactory.setLendingFee()` / `setLendingTreasury()` | G-52/53, I-12 | ◆ X-4 |
| `OVRFLOFactory.setLendingTickSpacing()` | G-50/51, I-15 | |
| `OVRFLO.setSeriesApproved()` | G-21/22, X-1 | |
| `OVRFLO.setMarketDepositLimit()` | G-8 | |
| `OVRFLO.sweepExcessPt()` / `sweepExcessUnderlying()` | G-18/19/20, I-24 | |
| `OVRFLO.setFlashFeeBps()` / `setFlashLoanPaused()` | G-15/23 | |
| `OVRFLOToken.mint()` / `burn()` | X-5 | |
| `OVRFLOLending.setAprBounds()` | G-48/49, I-11 | |
| `OVRFLOLending.setTickSpacing()` | G-50/51, I-15 | |
| `OVRFLOLending.setFee()` | G-52, I-12 | |
| `OVRFLOLending.setTreasury()` | G-53 | ◆ X-4 |

> Note: counts match `x-ray/entry-points.md` (10 permissionless / 2 role-gated / 28 admin = 40). `OVRFLOToken` standard ERC20 (`transfer`/`transferFrom`/`approve`), OZ `Ownable2Step`, and OZ `Multicall` are inherited and not listed — see that file's "Inherited Surfaces" section.

## Testing baseline

34 test files, 323 test functions (file scan at `f0661ab`). Source line coverage is 98.51%–100% per file. Counts below reflect the v1-lite rewrite; figures from the pre-rewrite campaign are marked as historical.

| Category | Count | Notes |
|----------|-------|-------|
| Unit tests | ~300 | All in-scope contracts covered |
| Mainnet fork tests | 5 files | Vault, lending, factory, flash loan; self-skip without `MAINNET_RPC_URL` |
| Stateless fuzz | 20 functions (1000 runs) | OVRFLOFuzz, StreamPricing math, TickTree differential-vs-reference-model |
| Stateful fuzz (Foundry) | 7 invariant functions (500 runs, depth 40) | OVRFLO invariant, wrap/unwrap invariant, OVRFLOLending invariant |
| Attack scenarios | 1 suite | Flash-loan griefing, wrap/claim/redeem loops |
| Math stress | 1 suite | StreamPricing rounding, overflow, boundary |
| Stateful fuzz (Echidna / Medusa) | 1 config each | **Historical** — 198 properties written against the pre-rewrite sale/pool ABI |
| Fuzz campaign results | **Historical** — 5 violations found and fixed (M-01..L-02) | Ran against the pre-rewrite contract. M-01 (pro-rata cap), M-02 (net slippage), M-03 (oracle freshness), L-01 (quote validation), L-02 (step-aligned APR bounds). See `docs/audit/audit-findings.md`. The pro-rata cap lesson survives the rewrite as I-6. |
| Line coverage | 98.51% OVRFLOLending; 100% TickTree, StreamPricing, OVRFLO, Factory, Token | `forge coverage --ir-minimum` |
| Branch coverage | Not measurable | Default `forge coverage` fails stack-too-deep; the IR-minimum fallback distorts branch instrumentation |
| Formal verification | 0 | Not yet implemented. Highest-value targets are now I-2 / E-1 (frozen history and lazy-attribution exactness) — stated precisely enough in `x-ray/invariants.md` to hand to an engagement — plus I-6 (pro-rata cap) and I-20 (obligation ≤ remaining). |

## Where to start

1. Read the scope snapshot. Confirm the pin (`01cad7b`).
2. Read the AI auditor methodology overlay — internalize the conceptual lens, security patterns, and multi-agent pipeline before diving into protocol-specific context.
3. Skim the two dependency contracts — note every row where "Enforced?" says **No** or **Onboarding only**.
4. Read the internal model — tie out the dual-backing identity (I-24) and the loan `outstanding` relation (I-7 + G-40).
5. Read `docs/audit/audit-findings.md` — 5 findings were found and fixed in the internal campaign. Understand what was found before raising a duplicate.
6. Open the trust-assumption ledger. Start with the On-chain=No invariants: the tape properties **I-1, I-2, I-3 and E-1** (deliberately test-enforced, not runtime-enforced — an unbounded scan is forbidden by the implementation discipline), plus **X-4** (mutable lending treasury). Also probe **I-6** (the `min(withdrawable, outstanding)` clamp) on an over-vested open loan, **I-20** (obligation ≤ remaining) at the `close` boundary, and the flash-loan reentrancy path via unguarded `deposit`/`wrap`/`unwrap`.
7. Before raising a finding, check the rejected-findings record — especially H-2 (Sablier v1.1 ACL) and M-5 (cross-market fungibility). Also check `docs/solutions/patterns/ovrflo-critical-patterns.md` — if your probe target intersects a documented pattern (13 rules), the fix may already be in place.
8. Drill into `x-ray/invariants.md` and `x-ray/entry-points.md` for derivations and full call chains.

---

## Definition of Done

- A complete state-dependency graph has been constructed: every storage variable's write sites mapped, every function's preconditions traced to their writers, every cross-contract assumption identified — this graph (not the triage map) is the primary audit artifact
- Every invariant in `x-ray/invariants.md` has been attacked, not just confirmed — for each, the auditor has either produced a counterexample (finding) or articulated why no sequence of calls can violate it
- The 10 permissionless entry points have been composed into multi-step attack paths, not audited in isolation — at minimum: flash loan → deposit → wrap/unwrap → claim cycles, supply → borrow → withdraw interleavings that attempt to move a position's interval under a settled loan, and multi-contributor claim races on an over-vested open stream
- Every "Enforced? No" or "Onboarding only" row in the dependency interface contracts has been challenged with a concrete failure scenario or confirmed with reasoning
- The ◆ On-chain=No invariants have been probed: the tape properties (I-1, I-2, I-3, E-1) against adversarial supply/withdraw/borrow orderings, and X-4 (mutable lending treasury) for post-deployment drift
- Trust assumptions in the trust-assumption ledger have been independently evaluated, not just read — each is either ACCEPTED with stated reasoning or CHALLENGED with a finding
- The 5 fixed audit findings in `docs/audit/audit-findings.md` have been reviewed — no finding raised that duplicates a fixed issue without new evidence
- Findings cite invariant IDs and entry-point names, duplicate no settled rejection without new evidence, and are scored against the severity rubric in the methodology overlay
- The auditor can articulate, without referencing the docs, how value flows through the system end-to-end and where the system's security breaks down if each trust boundary is crossed
