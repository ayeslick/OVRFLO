# X-Ray Report

> OVRFLO | 1206 nSLOC | 185eed9 (`main`) | Foundry | 07/07/26

---

## 1. Protocol Overview

**What it does:** A self-repaying loan platform where users borrow against deterministic Sablier streams derived from Pendle PT deposits. The stream itself repays the loan — no liquidations, no health checks, no oracles at loan time.

- **Users**: Borrowers (pledge streams for loans), lenders (fund offers/pools), stream sellers, PT depositors (create the collateral)
- **Core flow**: Deposit PT → receive ovrfloToken + Sablier stream → pledge stream as collateral to borrow underlying on OVRFLOBook → stream repays the loan automatically at maturity
- **Key mechanism**: PT discount is split at deposit via TWAP oracle into principal (ovrfloToken) and yield (non-cancelable Sablier stream). The stream is deterministic collateral — it pays exactly what it promises, so the loan self-repays without liquidations
- **Token model**: ovrfloToken (ERC20, 1:1 with PT at maturity, fungible across series of same underlying, 18-decimal) — the loan repayment asset
- **Admin model**: Timelocked multisig → OVRFLOFactory → OVRFLO vaults + OVRFLOBook instances (all non-upgradeable)

For a visual overview, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Loan Collateral Engine | OVRFLO, OVRFLOToken | ~350 | Creates deterministic Sablier streams from PT deposits; wrap/unwrap; flash loans |
| Lending Market | OVRFLOBook, StreamPricing | ~676 | Self-repaying loan origination, stream trading, loan servicing, pricing library |
| Admin Hub | OVRFLOFactory | ~180 | Deployment, market approval, admin forwarding |

### How It Fits Together

A Pendle TWAP oracle splits a PT deposit into principal (minted immediately as ovrfloToken) and yield (vested via a non-cancelable Sablier stream). That stream is deterministic collateral for self-repaying loans — it pays exactly what it promises, so the loan repays itself at maturity without liquidations, health checks, or loan-time oracles.

### Create loan collateral: deposit PT → ovrfloToken + Sablier stream

```
OVRFLO.deposit(market, ptAmount, minToUser)
├─ IPendleOracle.getPtToSyRate(market, twapDuration)        ← TWAP rate
├─ _computeSplit(ptAmount, rateE18)                          ← toUser + toStream
├─ IERC20(ptToken).safeTransferFrom(user, vault, ptAmount)   ← PT in
├─ IERC20(underlying).safeTransferFrom(user, treasury, fee)  ← fee in underlying
├─ OVRFLOToken.mint(user, toUser)                            ← immediate tokens
├─ OVRFLOToken.mint(vault, toStream)                         ← stream funding
└─ ISablierV2LockupLinear.createWithDurations(...)            ← stream created
```

### Originate self-repaying loan via pool

```
OVRFLOBook.createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable)
├─ StreamPricing.requireEligible(factory, sablier, core, market, streamId)
├─ StreamPricing.grossPrice(remaining, aprBps, ttm)           ← price the stream
├─ StreamPricing.obligationForFill(borrow, price, remaining)  ← compute debt
├─ _consumeOffers(offerIds, poolId, actualBorrow)             ← record contributions
├─ _storeLoan(borrower, book, streamId, obligation)           ← create loan
├─ sablier.transferFrom(borrower, book, streamId)             ← escrow stream
├─ _payUnderlying(borrower, netToBorrower)                    ← loan disbursement
└─ _payUnderlying(treasury, feeAmount)                        ← protocol fee
```

### Claim pool share (cumulative-recovered)

```
OVRFLOBook.claimPoolShare(poolId, amount)
└─ _claimFair(poolId, account, amount)
   ├─ recovered = drawn + repaid + min(withdrawable, outstanding)  ← if loan open
   ├─ claimable = contribution * recovered / totalContributed - poolReceived
   ├─ if poolProceeds < requestAmount && !loan.closed:
   │   ├─ sablier.withdraw(streamId, book, harvestAmount)    ← harvest deficit only
   │   └─ loan.drawn += harvestAmount; poolProceeds += harvestAmount
   ├─ poolReceived[account] += payAmount
   └─ IERC20(ovrfloToken).safeTransfer(account, payAmount)
```

### Close loan (permissionless)

```
OVRFLOBook.closeLoan(loanId)
├─ loan.closed = true                                      ← effects first
├─ loan.drawn += outstanding
├─ sablier.withdraw(streamId, book, outstanding)             ← draw from stream
├─ poolProceeds[poolId] += outstanding
└─ sablier.transferFrom(book, borrower, streamId)             ← return stream
```

---

## 2. Threat & Trust Model

> Protocol classified as: **Self-Repaying Lending Platform** (Lending/Borrowing primary, collateral creation via PT yield tokenization)

The protocol's core product is lending: users borrow underlying against deterministic Sablier streams. The PT deposit mechanism is the collateral creation layer that produces those streams — not the primary product. Lending signals: `createBorrowPool`, `repayLoan`, `closeLoan`, obligation tracking, loan servicing, pool proceeds distribution. The stream is deterministic and non-cancelable, so the loan self-repays at maturity — no liquidations, no health checks, no oracles at loan time.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Timelocked Multisig | Trusted (off-chain timelock + multisig) | Owns factory; 13 instant operational setters (fees, APR bounds, sweep excess, pause flash, deploy, add market, set treasury). No per-action timelock — multisig consensus is the only delay. |
| OVRFLOFactory | Bounded (immutable, owned by multisig) | Deploys vaults + books; forwards admin; oracle address immutable; cannot upgrade contracts |
| OVRFLO Vault | Bounded (admin = factory, all key params immutable) | Collateral creation engine: splits PT deposits into ovrfloToken + Sablier streams; wrap/unwrap; flash loans |
| OVRFLOBook | Bounded (owner = factory, immutables at construction) | Lending market: originates self-repaying loans, services repayments/closes, distributes pool proceeds; stream escrow |
| OVRFLOToken | Bounded (owner = vault) | ERC20 with mint/burn restricted to vault owner |
| User | Untrusted | Calls permissionless entry points; provides all parameters including slippage bounds |
| Sablier V2 | Trusted (immutable, non-upgradeable) | Stream creation, escrow, withdrawal; hardcoded address |
| Pendle Oracle | Trusted (singleton, potentially upgradeable by Pendle governance) | TWAP rate for PT/SY; read-only |

**Adversary Ranking:**

1. **Flash loan attacker** — Can borrow unlimited PT or underlying in a single tx to manipulate the TWAP rate at deposit time or exploit the flash loan callback window.
2. **Oracle manipulator** — Targets the Pendle TWAP (15-30 min window) to skew the deposit split, extracting more ovrfloToken than the PT warrants.
3. **Compromised admin** — The multisig can instantly sweep excess tokens, set fees to maximum, or pause flash loans. No per-action timelock beyond multisig consensus.
4. **Pool claim racer** — Attempts to front-run other contributors' claims, though the cumulative-recovered formula mitigates FCFS unfairness.
5. **Malicious stream pledgor** — Attempts to pledge an ineligible stream or exploit timing between eligibility check and escrow.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig → Factory** — Timelock protects the multisig seat, but all 13 operational functions execute instantly once signed. Most dangerous instant action: `sweepExcessPt`/`sweepExcessUnderlying` can move tokens out of any vault. `OVRFLOFactory.sol:229-244`.
- **Factory → OVRFLO** — `onlyAdmin` gate; factory is immutable admin for every vault. Compromising the factory compromises all vaults. `OVRFLO.sol:252-255`.
- **Factory → OVRFLOBook** — `onlyOwner` gate; factory owns all books. Compromising the factory controls all book parameters (fees, APR, treasury). `OVRFLOBook.sol:273-300`.
- **User → OVRFLOBook → Sablier** — Book trusts Sablier's `withdrawableAmountOf`, `transferFrom`, and `withdraw` to be accurate. Sablier V2 is immutable. `OVRFLOBook.sol:472-500, 645-668`.
- **OVRFLOBook → StreamPricing** — Pure library, no external calls except registry reads via `IOVRFLOFactoryRegistry` and `IOVRFLOSeriesRegistry`. `StreamPricing.sol:189-252`.

### Key Attack Surfaces

- **Cumulative-recovered claim formula** &nbsp;&#91;[I-18](invariants.md#i-18)&#93; — `_claimFair:645-668` computes `claimable = contribution * recovered / totalContributed - poolReceived` where `recovered` includes `min(withdrawable, outstanding)` for open loans. Worth tracing: the harvest at :659-665 mutates `loan.drawn` mid-claim, changing `recovered` for subsequent claimants in the same block.

- **Flash loan callback window** &nbsp;&#91;[G-9](invariants.md#g-9), [G-11](invariants.md#g-11)&#93; — `OVRFLO.flashLoan:463` sends PT before `IFlashBorrower.onFlashLoan` callback and pulls back after. `nonReentrant` blocks nested flash loans but `deposit`/`wrap`/`unwrap` remain callable during callback. Worth checking whether state changes during callback could affect repayment.

- **Oracle TWAP manipulation** &nbsp;&#91;[G-16](invariants.md#g-16)&#93; — `OVRFLO.deposit:393` and `flashLoan:474` read `getPtToSyRate` with 15-30 min TWAP. Worth confirming the window is sufficient against Pendle AMM manipulation given the protocol's split mechanism.

- **Stream eligibility validation** &nbsp;&#91;[X-2](invariants.md#x-2)&#93; — `StreamPricing.requireEligible:228-252` validates sender, asset, end time, cliff, cancelable, remaining. Worth checking edge cases where a stream's state changes between eligibility check and escrow transfer.

- **Admin operational powers without per-action timelock** &nbsp;&#91;[I-5](invariants.md#i-5), [I-6](invariants.md#i-6), [I-7](invariants.md#i-7), [I-9](invariants.md#i-9)&#93; — Factory owner can instantly set fees to max, sweep excess, pause flash loans, or change treasury. The timelock is on the multisig seat itself, not on individual function calls. Worth confirming which actions could redirect user funds.

- **Rounding direction in StreamPricing** &nbsp;&#91;[X-2](invariants.md#x-2)&#93; — `grossPrice` floors (buyer-favorable), `obligation` ceils (lender-favorable). Worth checking whether accumulated rounding dust across many partial borrows could create a gap in `obligation <= remaining`.

- **Late-burst churn on OVRFLOBook** — 46 source-touching commits in the last 30 days, including the pool claim fairness rewrite (`c5de575`, `56e5d66`) and removal of `poolClaimLoan` (`eb5193d`). Worth tracing whether the rewrite introduced edge cases not yet covered by fuzz properties.

### Protocol-Type Concerns

**As a Self-Repaying Lending Platform:**
- No liquidations — deterministic non-cancelable streams cannot underperform; `obligation <= remaining` (X-2) ensures the stream always covers the debt. The loan self-repays as the stream accrues.
- `closeLoan` is permissionless — anyone can close when `withdrawable >= outstanding`, creating a gas-race where the borrower's residual return is time-sensitive.
- No interest rate model — fixed linear APR set at loan origination via `StreamPricing.factor`. The "interest" is the difference between the discounted borrow amount and the obligation at maturity.
- Pool proceeds distribution uses cumulative-recovered accounting (I-18) — ensures pro-rata fairness across contributors regardless of claim timing.

**As a Collateral Creation Layer (PT deposit mechanism):**
- No share inflation attack — ovrfloToken mint is 1:1 with PT amount (not balance-based), and `MIN_PT_AMOUNT = 1e6` prevents dust deposits.
- `wrap` uses strict balance-delta check (G-17); `deposit` does not — PT is assumed to be standard ERC20 (18-decimal, no fee-on-transfer).
- Combined solvency invariant `totalSupply <= underlying.balanceOf + ptToken.balanceOf` (E-1) holds by design across cross-series fungibility.
- TWAP oracle (15-30 min) is the sole manipulation surface for the deposit split — all oracle dependency is at collateral creation, not at loan time.

### Temporal Risk Profile

**Deployment & Initialization:**
- `setSeriesApproved` is one-shot (I-11) — prevents reconfiguring a series after deposits. `ptToMarket` is one-shot (I-12) — prevents PT remapping. `underlyingToOvrflo` prevents duplicate vaults (G-43). No `initialize()` — all setup via constructor + factory admin calls.

**Market Stress:**
- TWAP oracle (15-30 min) provides manipulation resistance for deposit split. Stream accrual is time-based — `closeLoan` requires `withdrawable >= outstanding`. No liquidation cascade risk since no liquidations exist.

### Composability & Dependency Risks

> **Pendle Oracle** — via `OVRFLO._requireOracleFresh` + `getPtToSyRate`
> - Assumes: TWAP rate is fair and non-manipulable within the 15-30 min window
> - Validates: `oldestObservationSatisfied` (oracle freshness)
> - Mutability: Singleton, potentially upgradeable by Pendle governance
> - On failure: reverts (fail-closed)

> **Sablier V2 LL** — via `OVRFLO.createWithDurations`, `OVRFLOBook.transferFrom/withdraw/withdrawableAmountOf`
> - Assumes: streams are deterministic, non-cancelable, pay exact amounts on schedule
> - Validates: `requireEligible` checks sender, asset, end time, cliff, cancelable, remaining > 0
> - Mutability: Immutable (non-upgradeable)
> - On failure: reverts

> **Pendle Market** — via `OVRFLOFactory.readTokens/expiry`
> - Assumes: PT/SY/YT token addresses and expiry are correct and immutable
> - Validates: `IStandardizedYield(sy).yieldToken() == info.underlying`
> - Mutability: Immutable (Pendle markets are non-upgradeable)
> - On failure: reverts

**Token Assumptions** (unvalidated only):
- PT tokens: assumes 18 decimals, no fee-on-transfer, no rebasing — `deposit` pulls PT via `safeTransferFrom` without balance-delta check (unlike `wrap` which does check). Impact if violated: `marketTotalDeposited` would overstate actual PT held, allowing over-claiming.
- Underlying (fee path): `deposit` and `flashLoan` pull fee via `safeTransferFrom` without balance-delta — if underlying is fee-on-transfer, treasury receives less than `feeAmount`.

---

## 3. Invariants

> ### Full invariant map: [invariants.md](invariants.md)
>
> - **43 Enforced Guards** (`G-1` … `G-43`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **18 Single-Contract Invariants** (`I-1` … `I-18`) — Conservation, Bound, Ratio, StateMachine, Temporal
> - **4 Cross-Contract Invariants** (`X-1` … `X-4`) — caller/callee pairs that cross scope boundaries
> - **3 Economic Invariants** (`E-1` … `E-3`) — higher-order properties deriving from `I-N` + `X-N`
>
> Every inferred block cites a concrete Δ-pair, guard-lift + write-sites, edge, temporal predicate, or NatSpec claim. All 18 inferred invariants are On-chain=Yes — no unguarded write sites were found. Attack-surface bullets above cross-link directly into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` — comprehensive protocol spec with flows, architecture, security notes |
| NatSpec | ~120 annotations | Thorough on all public/external functions; invariant comments on rounding, solvency |
| Spec/Whitepaper | Present | `README.md` serves as spec; `CONCEPTS.md` for domain vocabulary; `AUDIT.md` for audit methodology |
| Inline Comments | Thorough | Key math directions documented; `forge-lint` disable comments on safe casts; rounding rationale explained |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 50 | File scan (always reliable) |
| Test functions | 328 | File scan (always reliable) |
| Line coverage | Pending | forge coverage still running at time of report |
| Branch coverage | Pending | forge coverage still running at time of report |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~310 | OVRFLO, OVRFLOBook, OVRFLOFactory, StreamPricing |
| Fork | 6 | Real Pendle markets, Sablier streams on mainnet fork |
| Stateful Fuzz (Foundry) | 3 suites | OVRFLOBook invariant, OVRFLO invariant, Wrap/Unwrap invariant (500 runs, depth 25) |
| Stateful Fuzz (Echidna) | 0:1 | Config present (`echidna.yaml`), no test functions found |
| Stateful Fuzz (Medusa) | 0:1 | Config present (`medusa.json`), no test functions found |
| Stateless Fuzz | 0 | None detected |
| Formal Verification (Certora) | 0 | None detected |
| Formal Verification (Halmos) | 0 | None detected |
| Formal Verification (HEVM) | 0 | None detected |

### Gaps

- **Stateless fuzz**: 0 — no standalone fuzz tests beyond invariant suites. Math-heavy pricing logic in `StreamPricing` could benefit from targeted stateless fuzzing of `grossPrice`/`obligation` edge cases.
- **Formal verification**: 0 — `obligation <= remaining` (X-2) and combined solvency (E-1) are prime candidates for formal proof.
- **Echidna/Medusa**: Configs present but no test functions written. Invariant suites use Foundry only.

---

## 6. Developer & Git History

> Repo shape: normal_dev — 99 source-touching commits across 221 total over 326 days (2025-08-15 → 2026-07-07)

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------:|--------------------:|
| jay | 221 | +4773 | 100% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 1 | Single-developer — no peer review signals |
| Merge commits | 0 of 221 (0%) | No formal review process — linear history |
| Repo age | 2025-08-15 → 2026-07-07 | ~11 months |
| Recent source activity (30d) | 46 commits | Very active — late burst before audit |
| Test co-change rate | 65.7% | 65.7% of source-changing commits also modify test files |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/OVRFLOBook.sol | 65 | Highest churn — lending market with pool claim rewrite |
| src/OVRFLO.sol | 65 | Collateral engine — oracle, flash loan, wrap/unwrap changes |
| src/OVRFLOFactory.sol | 65 | Admin hub — deployment, market approval evolution |
| src/StreamPricing.sol | 65 | Pricing library — eligibility, rounding changes |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 92d5c41 | 2026-07-01 | fix: add sweepExcessPt input guard, fuzz suite | 21 | Adds runtime guards, tightens access control |
| 3a7b06a | 2026-06-27 | fix: code review fixes + doc updates | 18 | Tightens access control, accounting logic |
| 860f72d | 2026-06-27 | feat: fix factory deployment gaps + make admin immutable | 17 | Tightens access control, accounting |
| e3514b3 | 2026-03-07 | Port recovered Solidity hardening and tests | 17 | Hardening, runtime guards, access control |
| c5de575 | 2026-07-06 | fix: replace FCFS pool claims with cumulative-recovered | 16 | Changes token transfer + accounting logic |
| bdd752b | 2026-07-03 | fix(M-03): add oracle freshness check in deposit/flashLoan | 15 | Oracle/pricing, adds runtime guard |
| 36103df | 2026-06-24 | Gate OVRFLOBook offers on active markets | 15 | Tightens access control, 437 lines changed |
| 887f2b9 | 2026-06-29 | feat(U7): add poolClaimLoan and claimPoolShare | 14 | Feature addition, token transfer + accounting |
| f925744 | 2026-06-29 | feat(U5): add createBorrowPool for batch borrowing | 14 | Feature addition, token transfer + accounting |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 65 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, OVRFLOToken.sol |
| fund_flows | 65 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, StreamPricing.sol |
| oracle_price | 65 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, StreamPricing.sol |
| state_machines | 34 | OVRFLO.sol, OVRFLOFactory.sol |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule | Standard, not internalized. Multiple pragma versions for backward compat. |
| prb-math | lib/prb-math | PRB-Math | Submodule | Standard, not internalized. Single pragma `>=0.8.4`. |

### Technical Debt Markers

No TODO, FIXME, HACK, or XXX comments found in source files (tech_debt.total_count = 0).

### Security Observations

- **Single-developer risk** — jay authored 100% of source code across 221 commits; no peer review signals (0 merge commits).
- **46 late source commits in 30 days** — heavy churn before audit, including pool claim fairness rewrite and oracle freshness fixes.
- **9 source commits without test changes** — residual risk from untested code changes (measures file co-modification, not coverage).
- **OVRFLOBook.sol is #1 in both churn AND attack-surface priority** — all top attack surfaces route through it.
- **Fix commit c5de575 (score 16) replaced the entire claim mechanism** — cumulative-recovered formula is new code with limited production exposure.
- **No forked dependencies with divergent logic** — OZ and PRB-Math are standard submodules.

### Cross-Reference Synthesis

- **OVRFLOBook.sol is #1 in BOTH churn AND attack-surface priority** — all top-4 surfaces route through it → highest-leverage review: `_claimFair`, `closeLoan`, `createBorrowPool`, `sellIntoOffer`.
- **Late-burst c5de575 + 56e5d66 rewrote `_claimFair`** — the cumulative-recovered formula (I-18) is new code with 30-day exposure; fuzz properties SP-58/59/60 were updated but formal verification is absent.
- **Oracle freshness fix bdd752b added `_requireOracleFresh` to deposit/flashLoan** — G-16 now covers deposits and flash loans; ffb6c50 extended it to preview functions, closing the gap identified in review.

---

## X-Ray Verdict

**HARDENED** — Comprehensive test suite (unit + fuzz + invariant + fork + echidna/medusa configs), thorough documentation (README as spec, NatSpec, audit companion docs), and timelocked multisig access control with clear trust boundaries.

**Structural facts:**
1. 1206 nSLOC across 3 subsystems (Loan Collateral Engine, Lending Market, Admin Hub), 5 contracts + 1 library, all non-upgradeable
2. Single developer (jay) authored 100% of source code across 221 commits over 326 days
3. 50 test files with 328 test functions, 3 Foundry invariant suites (500 runs, depth 25), 6 mainnet fork tests, echidna + medusa configs present
4. 46 source-touching commits in the last 30 days including pool claim fairness rewrite — elevated late-change risk
5. 0 TODO/FIXME markers in source code; tech debt clean
