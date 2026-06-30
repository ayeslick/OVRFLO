# AUDIT.md — OVRFLO Auditor Onboarding

> You are an external auditor. This file is the front door. Read it top to bottom once, then drill into the linked companion docs and `x-ray/` backing evidence as needed. Everything here exists to get you to "I know what the protocol assumes, what to attack first, and what has already been settled" without reconstructing it from scattered sources.

## Prescribed reading order

1. **Scope snapshot** — `docs/audit/scope-snapshot.md` — confirm the commit, in-scope files, pinned dependencies, and code freeze before anything else.
2. **AI auditor methodology overlay** — `docs/audit/ai-auditor-methodology.md` — how to audit OVRFLO as an AI agent: conceptual lens, security patterns, multi-agent pipeline, domain routing, finding format. Internalize this before reading the protocol-specific context.
3. **Dependency interface contracts** — `docs/audit/pendle-interface-contract.md` and `docs/audit/sablier-interface-contract.md` — what OVRFLO assumes of Pendle and Sablier, each assumption with where it is enforced (or not) and what breaks if it fails.
4. **Internal protocol model** — `docs/audit/internal-model.md` — the dual-backing solvency tie-out and the self-repaying-loan economics, framed insolvency-first.
5. **Trust-assumption / not-enforced pre-flight ledger** — `docs/audit/trust-assumption-ledger.md` — the off-chain-trusted beliefs to ACCEPT or CHALLENGE. Start attack work here.
6. **Rejected-findings decision record + Q&A** — `docs/audit/rejected-findings-record.md` — what the internal review already settled. Consult before raising a finding.
7. **Reproduction notes** — in the scope snapshot; full runnable harness is deferred.

Background (not in the reading order): `README.md` (protocol spec), `CONCEPTS.md` (domain glossary), `BASE_SECURITY.md`, `4626_SECURITY.md`, `GUIDELINES.md`.

## Citation graph

The package reuses the stable IDs already in `x-ray/` — guard codes `G-1..G-18`, invariants `I-1..I-13`, cross-contract invariants `X-1..X-5`, economic invariants `E-1..E-3` (all in `x-ray/invariants.md`), and entry-point names (in `x-ray/entry-points.md`). Findings and questions should cite these IDs.

| Package doc | Backing evidence |
|-------------|---------------------------|
| `docs/audit/ai-auditor-methodology.md` | ethskills.com (concepts, security, audit, standards); evmresearch.io; `x-ray/invariants.md` (all IDs); `x-ray/entry-points.md` (all entry points) |
| `docs/audit/scope-snapshot.md` | `x-ray/x-ray.md` (contracts-in-scope, forked dependencies); `script/lib/OVRFLOTestFixtures.sol` (pinned addresses) |
| `docs/audit/pendle-interface-contract.md` | `x-ray/invariants.md` (X-1, I-9); `x-ray/multi-agent-audit-report.md` (M-4, audit-report I-1/I-2) |
| `docs/audit/sablier-interface-contract.md` | `x-ray/invariants.md` (X-5, X-2); `x-ray/multi-agent-audit-report.md` (verified v1.1 ACL table) |
| `docs/audit/internal-model.md` | `x-ray/invariants.md` (I-1, I-2, I-10, E-1, E-2, E-3); `CONCEPTS.md` |
| `docs/audit/trust-assumption-ledger.md` | `x-ray/invariants.md` (I-8, I-6, X-1, X-2); `x-ray/x-ray.md` (threat model, adversary ranking, trust boundaries) |
| `docs/audit/rejected-findings-record.md` | `x-ray/multi-agent-audit-report.md` (rejected H-2/M-5, downgrade H-1→L-1, resolved Q&A, consensus table) |

`x-ray/` retains its unique analysis as linked backing evidence: the entry-point map (`x-ray/entry-points.md`), invariant derivations (`x-ray/invariants.md`), git forensics and test analysis (`x-ray/x-ray.md`), and the audit severity summary / agent-coverage list (`x-ray/multi-agent-audit-report.md`).

## Scope-exclusion log

| Excluded | Why |
|----------|-----|
| Sablier V2 internals (beyond v1.1 ACL/withdrawability) | Bounded external dependency, trusted at v1.1; OVRFLO does not modify Sablier. Pinned address in scope snapshot. |
| Pendle YT / AMM mechanics | OVRFLO never trades YT or interacts with the Pendle AMM. |
| `test/`, `script/`, `lib/`, `web/`, `tools/`, `interfaces/` | Test harness, deploy scripts, vendored libs, frontend, tooling, interface stubs — not in-scope production logic. |
| Runnable audit harness (invariants-as-properties suite, one-command fork env, committed traces) | Deferred to a follow-up plan. This package is the doc/content layer. |
| Standalone lifecycle walkthrough doc | Deferred; minimal dynamic context (NFT ownership through the Book, oracle-split timing) is folded into the dependency contracts and internal-model docs. |
| New protocol features or contract code changes | This packages existing context only. No code changes. |

## One-screen triage map

37 entry points (11 permissionless, 6 role-gated, 20 admin) per `x-ray/entry-points.md`; the 10 value-moving permissionless paths below are the attack surface (`multicall` is a batch helper that inherits the delegated functions' checks). ◆ = touches a **not-enforced-on-chain** invariant (probe first). Reentrancy guard column: ✓ = `nonReentrant`, ✗ = none. Adversary rank from `x-ray/x-ray.md` (#1 oracle, #2 stream/MEV trader, #3 admin, #4 external drift).

### Permissionless — the attack surface

| Entry point | Invariant IDs | Adv | Reentrancy | ◆ |
|-------------|---------------|-----|------------|---|
| `OVRFLO.deposit()` | G-4/5/6/7/8, I-1, X-1 | #1 | ✗ | ◆ X-1 |
| `OVRFLO.claim()` | G-9/10, I-1 | #2 | ✗ | |
| `OVRFLO.wrap()` | G-11, I-2, E-3, X-3 | #2 | ✗ | |
| `OVRFLO.unwrap()` | G-12, I-2, E-3, X-3 | #2 | ✗ | |
| `OVRFLOBook.postOffer()` | G-16, I-6, I-13 | #2 | ✓ | |
| `OVRFLOBook.sellIntoOffer()` | X-5 | #2 | ✓ | |
| `OVRFLOBook.postSaleListing()` | X-5 | #2 | ✓ | |
| `OVRFLOBook.buyListing()` | X-5 | #2 | ✓ | |
| `OVRFLOBook.createBorrowPool()` | X-5, I-10, E-2, X-2 | #2/#4 | ✓ | ◆ X-2 |
| `OVRFLOBook.closeLoan()` | G-18, I-10, X-2 | #2/#4 | ✓ | ◆ X-2 |

> `deposit()` and `closeLoan()` are the two costliest flows. `deposit()` carries the oracle split (◆ X-1, adversary #1). `closeLoan()` is permissionless and Sablier-withdrawability-gated (◆ X-2, adversaries #2/#4). Both lack a reentrancy guard on the vault side (`deposit`); book paths are `nonReentrant`. X-5 is enforced — but probe for bypass/stale-cache of `requireEligible` (see `sablier-interface-contract.md`).

### Role-gated — maker/lender/borrower only

| Entry point | Gate | Invariant IDs |
|-------------|------|---------------|
| `OVRFLOBook.cancelOffer()` | `offer.maker` | I-13 |
| `OVRFLOBook.cancelSaleListing()` | `listing.maker` | I-13 |
| `OVRFLOBook.poolClaimLoan()` | pool contributor | I-10, X-2 |
| `OVRFLOBook.repayLoan()` | `loan.borrower` | G-17, I-10 |
| `OVRFLOFactory.acceptOwnership()` | `pendingOwner` | — |
| `OVRFLOBook.acceptOwnership()` | `pendingOwner` | — |

### Admin-only — multisig → factory → vault

| Entry point | Invariant IDs | ◆ |
|-------------|---------------|---|
| `OVRFLOFactory.configureDeployment()` / `cancelDeployment()` / `deploy()` | — | |
| `OVRFLOFactory.addMarket()` | I-7, I-9 | |
| `OVRFLOFactory.setMarketDepositLimit()` | I-8 | ◆ I-8 |
| `OVRFLOFactory.prepareOracle()` | I-7 | |
| `OVRFLOFactory.sweepExcessPt()` / `sweepExcessUnderlying()` | I-1, I-2 | |
| `OVRFLOFactory.transferOwnership()` | — | |
| `OVRFLO.setSeriesApproved()` | G-2/3, I-9 | |
| `OVRFLO.setMarketDepositLimit()` | I-8 | ◆ I-8 |
| `OVRFLO.sweepExcessPt()` / `sweepExcessUnderlying()` | I-1, I-2 | |
| `OVRFLOToken.transferOwnership()` / `mint()` / `burn()` | — | |
| `OVRFLOBook.setAprBounds()` | I-6 | ◆ I-6 |
| `OVRFLOBook.setFee()` | G-15, I-4 | |
| `OVRFLOBook.setTreasury()` | — | |

> Note: counts match `x-ray/entry-points.md` (11 permissionless / 6 role-gated / 20 admin = 37). `OVRFLOToken` standard ERC20 (`transfer`/`transferFrom`/`approve`) are inherited and not listed.

## Where to start

1. Read the scope snapshot. Confirm the pin.
2. Read the AI auditor methodology overlay — internalize the conceptual lens, security patterns, and multi-agent pipeline before diving into protocol-specific context.
3. Skim the two dependency contracts — note every row where "Enforced?" says **No** or **Onboarding only**.
4. Read the internal model — tie out the dual-backing identity and the loan `outstanding` relation.
5. Open the trust-assumption ledger. The four ◆ not-enforced invariants (I-8, I-6, X-1, X-2) are your first targets.
6. Before raising a finding, check the rejected-findings record — especially H-2 (Sablier v1.1 ACL) and M-5 (cross-market fungibility).
7. Drill into `x-ray/invariants.md` and `x-ray/entry-points.md` for derivations and full call chains.
