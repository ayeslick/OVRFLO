# AI Auditor Methodology Overlay for OVRFLO

> This doc tells you **how** to audit OVRFLO as an AI agent. `AUDIT.md` tells you **what** the protocol is and where risk concentrates. Read this before the dependency contracts and internal model so you internalize the methodology first. The recon stage is already complete: `x-ray/` (entry-point map, invariant derivations, git forensics, test analysis) and the `AUDIT.md` package (scope snapshot, interface contracts, internal model, trust ledger, rejected findings) serve as your recon input. Start at the routing table.

---

## Conceptual lens

Three mental models from [ethskills.com/concepts](https://ethskills.com/concepts/SKILL.md) that frame how to think about OVRFLO. Each maps to a concrete OVRFLO surface and a probe direction.

| Model | OVRFLO mapping | Probe direction |
|-------|---------------|-----------------|
| **Nothing is automatic** — contracts are state machines; every transition needs a caller with incentive to pay gas | `closeLoan()` is permissionless and liveness-critical: anyone can call it because the lender benefits from drawing the remaining stream value (G-18). But oracle freshness is not rechecked per deposit (X-1) — no one pokes the oracle between onboarding and deposit, so a stale TWAP persists unchallenged. | For every state transition in the system, verify someone has incentive to call it. Flag any transition that depends on an admin or an external actor with no profit motive. |
| **CROPS** — Censorship Resistance, Open Source, Privacy, Security | **Censorship resistance**: no on-chain timelock or pause; the multisig can freeze a market by setting its deposit limit to 0 but cannot pause claims, wraps, or unwraps. **Open source**: yes (MIT, verified). **Privacy**: all flows are public onchain. **Security**: audited (point-in-time, not ongoing). | What can the multisig do unilaterally without delay? Can they front-run a user by changing config mid-transaction? What happens if the multisig disappears — do any liveness-critical paths break? |
| **Hyperstructure test** — could this run forever with no team? | OVRFLO is a **service**, not a hyperstructure. The multisig admin can change deposit limits (I-8), APR bounds (I-6), fees, and treasury. If the multisig disappears, existing deposits, claims, wraps, unwraps, and loan servicing continue (they are permissionless or role-gated), but no new markets can be onboarded. | Identify which functions require the multisig and which are permissionless. The permissionless paths must be incentive-aligned to be liveness-safe. |

---

## Security-pattern checklist

Curated from [ethskills.com/security](https://ethskills.com/security/SKILL.md). Only patterns that apply to OVRFLO are inlined, each mapped to a concrete surface and invariant ID. Full external checklist linked for depth.

| Pattern | OVRFLO surface | Status / probe | Invariant ID |
|---------|---------------|----------------|--------------|
| **Token decimals vary** | PT tokens assumed 18 decimals; `MIN_PT_AMOUNT = 1e6` and all deposit/claim math hardcodes 18-decimal scaling | Enforced indirectly: `addMarket` onboards canonical Pendle PTs only. Probe: confirm no non-18-decimal PT can be onboarded; verify `StreamPricing` math is 18-decimal-consistent. | I-9 |
| **No floating point / precision** | `StreamPricing` uses PRB-Math `mulDiv`; fees and APR in basis points; obligation/price rounding is directional (floor price, ceil obligation) | Enforced: mulDiv avoids precision loss. Probe: verify multiply-before-divide in every calculation path; confirm rounding directions in `obligationForFill` favor the protocol, not the borrower. | I-4, I-5, E-2 |
| **Reentrancy (CEI)** | `OVRFLOBook` uses `nonReentrant` on all entry points. `OVRFLO` vault (`deposit`, `claim`, `wrap`, `unwrap`) does **not**. | Partial: Book is guarded; vault is not. Probe: trace external calls in vault paths (`safeTransferFrom`, `createWithDurations`) — can a malicious PT or Sablier callback re-enter? State updates before or after external calls? | — (gap) |
| **SafeERC20** | All token transfers use `safeTransfer` / `safeTransferFrom` (OpenZeppelin SafeERC20) | Enforced. Probe: grep for raw `transfer` / `transferFrom` / `approve` calls that bypass SafeERC20. | — |
| **Fee-on-transfer** | `deposit()` pulls PT with `safeTransferFrom` but no balance-delta check (uses user-supplied `ptAmount`). `wrap()` has G-11 balance-delta check; `OVRFLOBook._pullExact` also checks. | Gap on deposit path: `marketTotalDeposited` advances by `ptAmount` regardless of received amount. Probe: confirm canonical Pendle PTs are exact-transfer; assess impact of a fee-on-transfer PT. | I-1, audit-report I-1 |
| **Oracle safety (no DEX spot)** | Uses Pendle TWAP (`getPtToSyRate`) with `twapDurationFixed` in `[15m, 30m]` (I-7). Not a DEX spot price. | TWAP is manipulation-resistant over the window. But freshness/cardinality checked at onboarding only — not revalidated per deposit (X-1). Probe: flash loan manipulation across the TWAP window; staleness if oracle stops updating. | X-1 |
| **Vault inflation** | OVRFLO is **not** ERC-4626, but `wrap()`/`unwrap()` have a reserve model: `wrappedUnderlying` tracks exact deposits (G-11 balance-delta). Donating underlying directly to the vault increases `balanceOf` but not `wrappedUnderlying`. | Donation does not inflate shares: `unwrap` is bounded by `wrappedUnderlying` (G-12), not raw balance. `sweepExcessUnderlying` removes the excess. Probe: confirm no path lets a donor inflate the claimable reserve. | I-2, E-1 |
| **Access control** | Multisig → `OVRFLOFactory` → `OVRFLO` vault (`onlyAdmin`, G-1). `OVRFLOBook` has `onlyOwner`. Two-step ownership on factory and book. No on-chain timelock. | Enforced via ownership chain. But `setMarketDepositLimit` can lower below current deposits (I-8) and `setAprBounds` does not revalidate existing orders (I-6). Probe: what can the multisig do without delay that harms users? | I-8, I-6, G-1 |
| **MEV / sandwich** | Book pricing is time-dependent (`block.timestamp` vs `expiryCached`). Deposit split depends on oracle rate. | Deposit is not a swap (no AMM slippage), but the `toUser`/`toStream` split depends on the TWAP rate. Probe: can a sandwich attacker manipulate the rate within a block to skew the split? | X-1 |
| **Input validation** | Guards G-4 (dust gate), G-5/G-9 (maturity gates), G-6 (deposit limit), G-7/G-8 (slippage), G-13/G-14 (APR bounds), G-15 (fee ceiling), G-16 (per-post APR) | Enforced at call sites. Probe: check for missing zero-address or zero-amount validation on admin paths (`setTreasury`, `setSeriesApproved` parameters). | various G-* |
| **Infinite approvals** | `OVRFLOBook` approves Sablier for `transferFrom` (escrow of stream NFTs). | Probe: check whether the approval to Sablier is `type(uint256).max` or scoped. If max, a Sablier vulnerability could drain escrowed NFTs. | — |

### Patterns considered but not applicable

| Pattern | Why not applicable |
|---------|-------------------|
| **Delegatecall** | `multicall` uses `delegatecall` to self only; no external delegatecall targets. Not a vulnerability. |
| **UUPS proxies** | No upgradeable contracts. All contracts are immutable (no proxy pattern, no initializer, no storage layout concerns). |
| **Standard ERC-4626 share inflation** | OVRFLO is not ERC-4626 (no `deposit`/`redeem`/`convertToShares`). The wrap-reserve donation angle above is the analogous surface, and it is mitigated by G-11 (balance-delta) and G-12 (reserve bound). |

---

## Standards context

Light reference to [ethskills.com/standards](https://ethskills.com/standards/SKILL.md) for live EIP awareness.

- **ERC-20**: `ovrfloToken` is a standard OpenZeppelin ERC20. PT and underlying tokens are ERC20. `mint`/`burn` are owner-restricted (vault only). Standard `transfer`/`transferFrom`/`approve` are inherited.
- **ERC-721**: Sablier Lockup Linear streams are ERC721 NFTs. `transferFrom` moves custody into/out of the Book escrow. Eligibility checks (`StreamPricing.requireEligible`, X-5) validate stream properties at pledge time.
- **ERC-4626**: **Not used.** OVRFLO's vault uses a custom `deposit`/`claim`/`wrap`/`unwrap` model, not the 4626 `deposit`/`redeem`/`convertToShares` interface. The vault-inflation attack pattern still applies via the wrap reserve (see security-pattern table above), but the standard 4626 share-price manipulation does not because `wrap()` uses a balance-delta check (G-11) and `unwrap()` is bounded by `wrappedUnderlying` (G-12), not by `totalSupply`-to-`totalAssets` ratio.

---

## evmresearch drill-down

[evmresearch.io](https://evmresearch.io/index) is a 400+-note linked knowledge graph across seven areas. The four most relevant to OVRFLO:

- **vulnerability-patterns** — general catalog of vulnerability classes; use to cross-check the security-pattern table above.
- **exploit-analyses** — post-mortems of real exploits; focus on lending, oracle-manipulation, and NFT-custody exploits.
- **economic-security** — economic attack vectors; directly relevant to the self-repaying-loan no-liquidation design and the dual-backing solvency model.
- **protocol-mechanics** — how lending and vault protocols work; use to validate assumptions about Pendle PT behavior and Sablier stream mechanics.

---

## Multi-agent audit pipeline

Prescribed by [ethskills.com/audit](https://ethskills.com/audit/SKILL.md). Adapted for OVRFLO below.

```mermaid
flowchart TB
  R[Recon stage<br/>x-ray/ + AUDIT.md package<br/>already complete] --> S
  S[Spawn parallel domain sub-agents<br/>per routing table — 11 domains] --> F1
  S --> F2
  S --> F3
  S --> FN[... domain N]
  F1[Domain agent: oracles<br/>X-1, deposit split] --> SY
  F2[Domain agent: defi-lending<br/>I-10, E-2, closeLoan] --> SY
  F3[Domain agent: erc721<br/>X-5, Sablier NFT custody] --> SY
  FN --> SY
  SY[Synthesize findings<br/>deduplicate, severity-rank] --> GI
  GI[File Medium+ as GitHub issues<br/>using finding format template<br/>with baseline-diff field]
```

1. **Recon** — already complete. The `x-ray/` package (entry-point map, invariant derivations, git forensics, test analysis) and the `AUDIT.md` package (scope snapshot, interface contracts, internal model, trust ledger, rejected findings) are your recon input. Do not re-derive what is already documented.
2. **Spawn** — dispatch one sub-agent per applicable domain from the routing table below (11 domains). Each agent receives its OVRFLO focus and the invariant/entry-point IDs to hand it. Each agent walks its ethskills checklist against the OVRFLO source.
3. **Synthesize** — collect findings from all agents. Deduplicate across domains (the same invariant may be probed by multiple agents). Severity-rank using the definitions below.
4. **File** — file Medium-and-above findings as GitHub issues using the finding-format template. Include the baseline-diff field.

**Single-process fallback**: if your runtime cannot spawn parallel sub-agents, walk the routing table as a linear checklist. The 11 domains are ordered by priority (oracles and lending first, governance last).

---

## OVRFLO domain routing table

19 specialized audit domains from [ethskills.com/audit](https://ethskills.com/audit/SKILL.md). 11 apply to OVRFLO; 8 are excluded.

### Applicable domains — spawn one sub-agent each

| Domain | OVRFLO focus | Invariant / entry-point IDs to hand |
|--------|-------------|-------------------------------------|
| `evm-audit-general` | Overall code quality, event emission, error handling, state-machine completeness | All 42 entry points; I-9, I-10, I-11, I-13 |
| `evm-audit-precision-math` | `StreamPricing` mulDiv, rounding direction in `obligationForFill` and `grossPrice`, basis-point math, `MIN_PT_AMOUNT` | I-4, I-5, E-2; G-13, G-14, G-15, G-16 |
| `evm-audit-erc20` | `ovrfloToken` mint/burn, PT transfers, SafeERC20 usage, fee-on-transfer gap on `deposit()`, `sweepExcess` correctness | I-1, I-2; audit-report I-1, I-2; G-10, G-11, G-12 |
| `evm-audit-defi-lending` | Self-repaying loans, no health check, no liquidation, `borrowAgainstOffer`/`lendAgainstListing`/`repayLoan`/`closeLoan` lifecycle, `outstanding` relation | I-10, E-2; G-17, G-18; `closeLoan()`, `claimLoan()`, `repayLoan()` |
| `evm-audit-erc4626` | Vault-inflation via wrap-reserve donation (not standard 4626), `wrap()`/`unwrap()` reserve model, `sweepExcessUnderlying` | I-2, E-1; G-11, G-12; `wrap()`, `unwrap()`, `sweepExcessUnderlying()` |
| `evm-audit-oracles` | Pendle TWAP freshness, flash loan manipulation, `getPtToSyRate` consumption, `twapDurationFixed` bounds, deposit split skewing | X-1; I-7; G-5, G-6, G-7, G-8; `deposit()` |
| `evm-audit-erc721` | Sablier stream NFT custody, `transferFrom` escrow, `requireEligible` checks, NFT ownership through loan lifecycle | X-5, X-2; `sellIntoOffer()`, `postSaleListing()`, `buyListing()`, `borrowAgainstOffer()`, `closeLoan()` |
| `evm-audit-access-control` | Multisig → factory → vault chain, `onlyAdmin`/`onlyOwner`/`onlyOwner` gating, two-step ownership, no on-chain timelock, `setMarketDepositLimit` lowering, `setAprBounds` non-retroactivity | I-8, I-6, I-9; G-1, G-2, G-3; admin entry points |
| `evm-audit-flashloans` | Flash loan manipulation of Pendle TWAP, deposit split skewing within a single transaction, cross-market flash loan paths | X-1; `deposit()` |
| `evm-audit-dos` | Unbounded offer/listing/loan ID growth, dust griefing via `MIN_PT_AMOUNT`, gas limits in `multicall` loops, stale-order accumulation | I-13; G-4; `postSaleOffer()`, `postLendOffer()`, `multicall()` |
| `evm-audit-governance` | Multisig + two-step ownership, no on-chain timelock/pause, admin key compromise, no vault admin migration path | I-8, I-6; `transferOwnership()`, `acceptOwnership()` |

### Excluded domains — not routed

| Domain | Reason |
|--------|--------|
| `evm-audit-defi-amm` | OVRFLO has no AMM; the Book is an orderbook, not a liquidity pool. |
| `evm-audit-defi-staking` | No staking, liquid staking, or restaking. |
| `evm-audit-erc4337` | No account abstraction, paymasters, or session keys. |
| `evm-audit-bridges` | Mainnet only; no cross-chain interactions. |
| `evm-audit-proxies` | No upgradeable contracts; all contracts are immutable. |
| `evm-audit-signatures` | No EIP-712, permits, or off-chain signatures. |
| `evm-audit-assembly` | No inline assembly or Yul in scope. |
| `evm-audit-chain-specific` | Mainnet only; no L2-specific concerns. |

---

## Finding format

Use this template for every finding. File Medium-and-above as GitHub issues.

| Field | Description |
|-------|-------------|
| **Title** | One-line summary of the vulnerability. |
| **Severity** | `High` — funds can be stolen or permanently locked. `Medium` — funds can be lost under specific conditions, or protocol accounting can be corrupted. `Low` — state or accounting drift that does not directly cause loss but degrades protocol integrity. `Gas` — optimization that does not affect correctness. `Informational` — code quality, style, or documentation issue. |
| **Affected contract + entry point** | Contract name and function name (e.g., `OVRFLO.deposit()`). |
| **Violated invariant ID** | The `G-/I-/X-/E-` code from `x-ray/invariants.md` that this finding violates or challenges. |
| **Precondition + attack path** | What state must hold, what the attacker does step by step, and what breaks. |
| **Recommendation** | Concrete fix or mitigation. |
| **Baseline-diff** | Check `docs/audit/rejected-findings-record.md` — does this finding re-litigate a settled conclusion (H-2, M-5, L-1, M-4, audit-report I-1 through I-4)? If so, reference the rejected finding and explain why this new evidence supersedes it. If not, state "No prior-review overlap." |

> **Before filing**: consult `docs/audit/rejected-findings-record.md` to avoid re-raising findings the internal review already closed. The rejected-findings record captures H-2 (Sablier v1.1 withdraw ACL), M-5 (cross-market fungibility by design), L-1 (uint128 narrowing), M-4 (oracle freshness), and audit-report I-1 through I-4 (token transfer assumptions). Each entry includes the reasoning that closed it — challenge the evidence, not the conclusion.
