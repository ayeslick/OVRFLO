# AUDIT.md — OVRFLO Auditor Onboarding

> You are an external auditor. This file is the front door. Read it top to bottom once, then drill into the linked companion docs and `x-ray/` backing evidence as needed. Everything here exists to get you to "I know what the protocol assumes, what to attack first, and what has already been settled" without reconstructing it from scattered sources.

## Prescribed reading order

0. **Think in graphs, not checklists**: trace how state flows across contracts, how one function's writes become another function's preconditions, and how invariant assumptions propagate through call chains. A checklist finds isolated issues; a mental graph of state dependencies, value flows, and trust boundaries finds the interactions that cause real exploits.
1. **Scope snapshot** — `docs/audit/scope-snapshot.md` — confirm the commit, in-scope files, pinned dependencies, and code freeze before anything else.
2. **AI auditor methodology overlay** — `docs/audit/ai-auditor-methodology.md` — how to audit OVRFLO as an AI agent: conceptual lens, security patterns, multi-agent pipeline, domain routing, finding format. Internalize this before reading the protocol-specific context.
3. **Dependency interface contracts** — `docs/audit/pendle-interface-contract.md` and `docs/audit/sablier-interface-contract.md` — what OVRFLO assumes of Pendle and Sablier, each assumption with where it is enforced (or not) and what breaks if it fails.
4. **Internal protocol model** — `docs/audit/internal-model.md` — the dual-backing solvency tie-out and the self-repaying-loan economics, framed insolvency-first.
5. **Trust-assumption / not-enforced pre-flight ledger** — `docs/audit/trust-assumption-ledger.md` — the off-chain-trusted beliefs to ACCEPT or CHALLENGE. Start attack work here.
6. **Rejected-findings decision record + Q&A** — `docs/audit/rejected-findings-record.md` — what the internal review already settled. Consult before raising a finding.
7. **Critical security patterns** — `docs/solutions/patterns/ovrflo-critical-patterns.md` — 12 enforceable rules extracted from past problem writeups (self-match prevention, strictly-increasing IDs, pro-rata claim caps, CEI ordering, fee snapshots, etc.). Required reading before probing; these encode hard-won lessons about what has already broken and been fixed.
8. **Reproduction notes** — in the scope snapshot; full runnable harness is deferred.

Background (not in the reading order): `README.md` (protocol spec), `CONCEPTS.md` (domain glossary), `BASE_SECURITY.md`, `4626_SECURITY.md`, `GUIDELINES.md`.

## Citation graph

The package reuses the stable IDs already in `x-ray/` — guard codes `G-1..G-32`, invariants `I-1..I-18`, cross-contract invariants `X-1..X-4`, economic invariants `E-1..E-4` (all in `x-ray/invariants.md`), and entry-point names (in `x-ray/entry-points.md`). Findings and questions should cite these IDs.

| Package doc | Backing evidence |
|-------------|---------------------------|
| `docs/audit/ai-auditor-methodology.md` | ethskills.com (concepts, security, audit, standards); evmresearch.io; `x-ray/invariants.md` (all IDs); `x-ray/entry-points.md` (all entry points) |
| `docs/audit/scope-snapshot.md` | `x-ray/x-ray.md` (contracts-in-scope, forked dependencies); `script/lib/OVRFLOTestFixtures.sol` (pinned addresses) |
| `docs/audit/pendle-interface-contract.md` | `x-ray/invariants.md` (X-1, I-9); `x-ray/multi-agent-audit-report.md` (M-4) |
| `docs/audit/sablier-interface-contract.md` | `x-ray/invariants.md` (X-2, I-13); `x-ray/multi-agent-audit-report.md` (verified v1.1 ACL table) |
| `docs/audit/internal-model.md` | `x-ray/invariants.md` (I-1, I-7, I-11, I-13, E-1, E-2); `CONCEPTS.md` |
| `docs/audit/trust-assumption-ledger.md` | `x-ray/invariants.md` (I-6, X-1, X-2, X-4); `x-ray/x-ray.md` (threat model, adversary ranking, trust boundaries) |
| `docs/audit/rejected-findings-record.md` | `x-ray/multi-agent-audit-report.md` (rejected H-2/M-5, downgrade H-1→L-1, resolved Q&A, consensus table) |

`x-ray/` retains its unique analysis as linked backing evidence: the entry-point map (`x-ray/entry-points.md`), invariant derivations (`x-ray/invariants.md`), git forensics and test analysis (`x-ray/x-ray.md`), and the audit severity summary / agent-coverage list (`x-ray/multi-agent-audit-report.md`).

## Scope-exclusion log

| Excluded | Why |
|----------|-----|
| Sablier V2 internals (beyond v1.1 ACL/withdrawability) | Bounded external dependency, trusted at v1.1; OVRFLO does not modify Sablier. Pinned address in scope snapshot. |
| Pendle YT / AMM mechanics | OVRFLO never trades YT or interacts with the Pendle AMM. |
| `test/`, `script/`, `lib/`, `web/`, `tools/`, `interfaces/` | Test harness, deploy scripts, vendored libs, frontend, tooling, interface stubs — not in-scope production logic. |
| Runnable audit harness (invariants-as-properties suite, one-command fork env, committed traces) | Deferred to a follow-up plan. This package is the doc/content layer. |
| Standalone lifecycle walkthrough doc | Deferred; minimal dynamic context (address-based pool claims through the Book, oracle-split timing) is folded into the dependency contracts and internal-model docs. |
| New protocol features or contract code changes | This packages existing context only. No code changes. |

## One-screen triage map

45 entry points (12 permissionless, 7 role-gated, 26 admin) per `x-ray/entry-points.md`; the 12 value-moving permissionless paths below are the attack surface (`multicall` is a batch helper that inherits the delegated functions' checks). ◆ = touches a **not-enforced-on-chain** invariant (probe first). Reentrancy guard column: ✓ = `nonReentrant`, ✗ = none. Adversary rank from `x-ray/x-ray.md` (#1 oracle/flash, #2 pool claim accounting, #3 admin, #4 order book griefing).

### Permissionless — the attack surface

| Entry point | Invariant IDs | Adv | Reentrancy | ◆ |
|-------------|---------------|-----|------------|---|
| `OVRFLO.deposit()` | G-4/5/6/7/8, I-1, X-1 | #1 | ✗ | ◆ X-1 |
| `OVRFLO.claim()` | G-10/11, I-1 | #2 | ✗ | |
| `OVRFLO.wrap()` | G-15/16, I-7, E-1, X-3 | #2 | ✗ | |
| `OVRFLO.unwrap()` | G-15, I-7, E-1, X-3 | #2 | ✗ | |
| `OVRFLO.flashLoan()` | G-12/13/14, I-8 | #1 | ✓ | |
| `OVRFLOBook.postOffer()` | G-20/21, I-4/5, I-17 | #2 | ✓ | |
| `OVRFLOBook.sellIntoOffer()` | X-1 | #2 | ✓ | |
| `OVRFLOBook.postSaleListing()` | G-20/21, I-17, X-1 | #2 | ✓ | |
| `OVRFLOBook.buyListing()` | X-1 | #2 | ✓ | |
| `OVRFLOBook.closeLoan()` | G-23, I-11, I-13 | #2/#4 | ✓ | ◆ I-13 |
| `OVRFLOBook.createBorrowPool()` | G-22/26/27, I-13, I-18, E-2, X-1 | #2/#4 | ✓ | |
| `OVRFLOBook.multicall()` | (inherits) | #2 | ✗ | |

> `deposit()` and `closeLoan()` are the two costliest flows. `deposit()` carries the oracle split (◆ X-1, adversary #1). `closeLoan()` is permissionless and Sablier-withdrawability-gated (◆ I-13, adversaries #2/#4). Both lack a reentrancy guard on the vault side (`deposit`); book paths are `nonReentrant`. `flashLoan()` is `nonReentrant` but the callback can call unguarded `deposit`/`wrap`/`unwrap` — see `x-ray/x-ray.md` attack surface "Flash loan reentrancy via unguarded vault functions". X-1 is enforced — but probe for bypass/stale-cache of `requireEligible` (see `sablier-interface-contract.md`).

### Role-gated — maker/lender/borrower only

| Entry point | Gate | Invariant IDs |
|-------------|------|---------------|
| `OVRFLOBook.cancelOffer()` | `offer.maker` | I-17 |
| `OVRFLOBook.cancelSaleListing()` | `listing.maker` | I-17 |
| `OVRFLOBook.poolClaimLoan()` | pool contributor | I-14, I-16, I-18 |
| `OVRFLOBook.claimPoolShare()` | pool contributor | I-14, I-15, I-16 |
| `OVRFLOBook.repayLoan()` | `loan.borrower` | G-24, I-11, I-13 |
| `OVRFLOFactory.acceptOwnership()` | `pendingOwner` | — |
| `OVRFLOBook.acceptOwnership()` | `pendingOwner` | — |

### Admin-only — multisig → factory → vault

| Entry point | Invariant IDs | ◆ |
|-------------|---------------|---|
| `OVRFLOFactory.configureDeployment()` / `cancelDeployment()` / `deploy()` | G-28, I-10 | |
| `OVRFLOFactory.deployBook()` | G-31 | |
| `OVRFLOFactory.addMarket()` | G-29/30, I-9, X-1 | |
| `OVRFLOFactory.setMarketDepositLimit()` | I-6, X-4 | ◆ I-6, X-4 |
| `OVRFLOFactory.prepareOracle()` | G-29 | |
| `OVRFLOFactory.sweepExcessPt()` / `sweepExcessUnderlying()` | I-8, I-7 | |
| `OVRFLOFactory.setFlashFeeBps()` / `setFlashLoanPaused()` | G-14, I-2 | |
| `OVRFLOFactory.setBookAprBounds()` | G-17/18, I-4/5 | |
| `OVRFLOFactory.setBookFee()` / `setBookTreasury()` | G-19, I-3 | |
| `OVRFLO.setSeriesApproved()` | G-2/3, I-9 | |
| `OVRFLO.setMarketDepositLimit()` | I-6, X-4 | ◆ I-6, X-4 |
| `OVRFLO.sweepExcessPt()` / `sweepExcessUnderlying()` | I-8, I-7 | |
| `OVRFLO.setFlashFeeBps()` / `setFlashLoanPaused()` | G-14, I-2 | |
| `OVRFLOToken.transferOwnership()` / `mint()` / `burn()` | X-3 | |
| `OVRFLOBook.setAprBounds()` | G-17/18, I-4/5 | |
| `OVRFLOBook.setFee()` | G-19, I-3 | |
| `OVRFLOBook.setTreasury()` | — | |

> Note: counts match `x-ray/entry-points.md` (12 permissionless / 7 role-gated / 26 admin = 45). `OVRFLOToken` standard ERC20 (`transfer`/`transferFrom`/`approve`) are inherited and not listed.

## Testing baseline

19 test files, 296 test functions total. **Coverage metrics are unavailable** — `forge coverage` timed out after 180s (twice); the background run completed tests (67 passed, 0 failed) but did not produce a coverage table. A previous x-ray run reported 88.35% line coverage (100% for src/ files), but that predates the unified offer merge (`aed261d`, 548 lines changed) and may not reflect current code. Treat the current code as having no coverage baseline.

| Category | Count | Notes |
|----------|-------|-------|
| Unit tests | 13 files | All in-scope contracts covered |
| Mainnet fork tests | 6 files | Vault, book, factory, flash loan, wrap/unwrap |
| Stateless fuzz | 1 suite (1000 runs) | OVRFLOFuzz |
| Stateful fuzz (Foundry) | 3 suites (500 runs, depth 25) | OVRFLOBook invariant, OVRFLO invariant, wrap/unwrap invariant |
| Attack scenarios | 1 suite | Flash-loan griefing, wrap/claim/redeem loops |
| Math stress | 1 suite | StreamPricing rounding, overflow, boundary |
| Stateful fuzz (Echidna) | 0 | Not run — highest-priority gap for pool claim accounting |
| Stateful fuzz (Medusa) | 0 | Not run |
| Formal verification | 0 | Not run — StreamPricing math would benefit most |

## Where to start

1. Read the scope snapshot. Confirm the pin.
2. Read the AI auditor methodology overlay — internalize the conceptual lens, security patterns, and multi-agent pipeline before diving into protocol-specific context.
3. Skim the two dependency contracts — note every row where "Enforced?" says **No** or **Onboarding only**.
4. Read the internal model — tie out the dual-backing identity and the loan `outstanding` relation.
5. Open the trust-assumption ledger. The two ◆ not-enforced-on-chain invariants (I-6 deposit limit, X-4 setter-vs-invariant mismatch) are your first targets. Also probe I-13 (obligation <= remaining) at the closeLoan boundary and the flash loan reentrancy path via unguarded `deposit`/`wrap`/`unwrap`.
6. Before raising a finding, check the rejected-findings record — especially H-2 (Sablier v1.1 ACL) and M-5 (cross-market fungibility). Also check `docs/solutions/patterns/ovrflo-critical-patterns.md` — if your probe target intersects a documented pattern, the fix may already be in place.
7. Drill into `x-ray/invariants.md` and `x-ray/entry-points.md` for derivations and full call chains.
