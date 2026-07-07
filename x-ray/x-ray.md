# X-Ray Report

> OVRFLO | ~1,395 nSLOC | 01cad7b (`main`) | Foundry | 07/07/26

---

## 1. Protocol Overview

**What it does:** A lending platform that turns Pendle PT deposits into deterministic Sablier streaming collateral, letting users sell or borrow against it with self-repaying loans (no liquidations, no oracles at loan time).

- **Users**: PT holders deposit for immediate value + streams; stream owners sell or borrow on the secondary market; liquidity providers post offers
- **Core flow**: Deposit PT → receive ovrfloToken (principal) + Sablier stream (discount) → sell/borrow stream on OVRFLOBook → exit ovrfloToken via unwrap/claim/DEX
- **Key mechanism**: Linear APR discount pricing via `StreamPricing`; deterministic non-cancelable streams as collateral
- **Token model**: ovrfloToken (ERC20, 1:1 with PT via claim, 1:1 with underlying via wrap/unwrap, fungible across maturities of same underlying)
- **Admin model**: Timelocked multisig → OVRFLOFactory (immutable admin) → OVRFLO vaults + OVRFLOBook instances

For a visual overview, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Core Vault | OVRFLO, OVRFLOToken | ~490 | PT deposit vault, receipt token mint/burn, wrap/unwrap, flash loans |
| Secondary Market | OVRFLOBook, StreamPricing | ~810 | Order book for stream sales/loans, pricing library, pool primitive |
| Admin Hub | OVRFLOFactory | ~256 | Deploys and manages vaults/books, forwards admin to all dependents |

### How It Fits Together

The core trick: split a PT deposit into immediate principal (ovrfloToken) + streaming discount (Sablier), then use the stream as deterministic collateral for self-repaying loans.

### Deposit → Stream → Exit

```
User ──deposit(market, ptAmount)──→ OVRFLO
  ├─→ _requireOracleFresh()              *TWAP freshness check*
  ├─→ IPendleOracle.getPtToSyRate()      *TWAP rate*
  ├─→ _computeSplit(ptAmount, rate)       *split into immediate + streamed*
  ├─→ OVRFLOToken.mint(user, toUser)     *immediate principal*
  ├─→ OVRFLOToken.mint(vault, toStream)  *stream principal*
  └─→ Sablier.createWithDurations()       *vests toStream until maturity*
```

### Sell Stream into Offer

```
Seller ──sellIntoOffer(offerId, streamId)──→ OVRFLOBook
  ├─→ StreamPricing.requireEligible()      *validates stream vs series*
  ├─→ StreamPricing.grossPrice()           *discounts remaining at APR*
  ├─→ Sablier.transferFrom(seller→maker)   *stream moves to buyer*
  ├─→ underlying.transfer(seller, net)     *seller paid*
  └─→ underlying.transfer(treasury, fee)   *protocol fee*
```

### Borrow Pool (Batch Against Offers)

```
Borrower ──createBorrowPool(offerIds, streamId)──→ OVRFLOBook
  ├─→ StreamPricing.requireEligible()      *validates stream*
  ├─→ StreamPricing.grossPrice()           *price the stream*
  ├─→ _validateOffers()                    *active, same market/apr, no self-match, sorted*
  ├─→ StreamPricing.obligationForFill()    *ceiling-rounded debt*
  ├─→ StreamPricing.fee()                  *protocol fee*
  ├─→ require(netToBorrower >= minAcceptable)  *net slippage check*
  ├─→ _consumeOffers()                     *decrement capacity, record contributions*
  ├─→ _storeLoan()                         *borrower→pool, stream pledged*
  ├─→ Sablier.transferFrom(borrower→book)  *escrow stream*
  ├─→ underlying.transfer(borrower, net)   *loan disbursement*
  └─→ underlying.transfer(treasury, fee)   *protocol fee*
```

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Lending/Borrowing** with **Yield Aggregator/Vault** characteristics

Stream-backed self-repaying loans are the core primitive (lending). The vault tokenizes PT deposits into a fungible receipt token with wrap/unwrap (vault). The lending model eliminates liquidations and oracle dependencies at loan time by using deterministic, non-cancelable Sablier streams as collateral.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Timelocked Multisig | Trusted | Owns factory; all admin actions require consensus + timelock delay. Instant operational powers: deploy vaults/books, add markets, set fees, sweep excess, pause flash loans, set APR bounds. |
| OVRFLOFactory | Bounded (immutable admin) | Deploys vaults + books; forwards admin calls. Cannot mint/burn tokens or move user funds directly. One vault per underlying enforced. |
| OVRFLO Vault | Bounded (factory is admin) | Holds PT + underlying; mints/burns ovrfloToken. Admin functions gated by `onlyAdmin`. |
| OVRFLOBook | Bounded (factory is owner) | Holds escrowed streams + underlying liquidity. All stateful functions `nonReentrant`. |
| User/Depositor | Untrusted | Permissionless deposit, claim, wrap, unwrap, flash loan. |
| Stream Seller/Borrower | Untrusted | Permissionless sell, list, buy, borrow, close loan. Must own the stream. |
| Pool Contributor | Bounded (by contribution) | Can claim pro-rata from pool proceeds; `claimPoolShare` harvests deficit from the open loan's stream via `_claimFair` before paying out. |

**Adversary Ranking** (ordered by threat level):

1. **Flash loan attacker** — Can borrow unlimited underlying to swap for PT, run the deposit→unwrap→sell cycle, and repay in one tx.
2. **Oracle manipulator** — Pendle TWAP oracle determines the deposit split (immediate vs streamed). A manipulated rate could shift value between `toUser` and `toStream`.
3. **Pool claim racer** — Single claim channel (`claimPoolShare` from proceeds) with pro-rata caps. When `poolProceeds` is insufficient, `_claimFair` harvests withdrawable stream value into `poolProceeds` before paying out. Worth confirming caps hold under concurrent claims.
4. **Compromised admin** — Multisig key compromise gives instant control over fees, APR bounds, flash loan pause, and sweep functions.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig → Factory** — Timelock delay on ownership transfer, but all operational functions execute instantly once signed. *Git signal: 59 access_control commits — highest-churn area.*
- **Factory → Vault/Book** — Factory is the immutable admin; no vault or book can be administered directly. Factory has instant operational powers on every dependent.
- **Vault → ovrfloToken** — Vault is the token owner with mint/burn monopoly. Token ownership is transferred at deployment and never changes.
- **Book → Sablier streams** — Book escrows streams via `transferFrom`. Stream eligibility validated through `StreamPricing.requireEligible` (X-3).

### Key Attack Surfaces

- **Flash loan wrap-claim-redeem cycle** &nbsp;[I-13](invariants.md#i-13), [E-1](invariants.md#e-1) — `OVRFLO.flashLoan` + `wrap` + `claim` form a cycle where PT is flash-loaned, deposited, ovrfloToken unwrapped, and PT repaid. Worth tracing whether any oracle lag or rounding edge lets the extractor profit beyond the fixed PT yield.

- **StreamPricing rounding direction** &nbsp;[I-7](invariants.md#i-7), [E-2](invariants.md#e-2) — `StreamPricing.sol:147-157`: `grossPrice` floors, `obligation` ceils by 1 wei. The invariant `obligation <= remaining` depends on this asymmetry. Worth confirming at boundary values.

- **Pool single-channel claim accounting** &nbsp;[I-3](invariants.md#i-3), [I-4](invariants.md#i-4), [E-3](invariants.md#e-3) — `claimPoolShare` now handles both open and closed loans. The `_claimFair` internal harvests withdrawable stream value when the loan is open and `poolProceeds` is insufficient, increasing both `loan.drawn` and `poolProceeds` before the claim payout reduces `poolProceeds`. The `poolReceived` cap still prevents over-claiming. Worth tracing that no contributor can over-claim.

- **Oracle freshness at runtime** &nbsp;[I-17](invariants.md#i-17), [X-1](invariants.md#x-1) — `OVRFLO._requireOracleFresh:347-350` checks `oldestObservationSatisfied` before every `getPtToSyRate` read (added in M-03 fix). Cardinality is intentionally NOT rechecked at runtime. Worth confirming the asymmetry is safe.

- **Pendle oracle TWAP rate** &nbsp;[X-1](invariants.md#x-1) — `OVRFLO.deposit:377` reads `IPendleOracle.getPtToSyRate` after the freshness check. The rate determines the split between immediate and streamed value. Worth confirming the 15-30 min TWAP window is manipulation-resistant.

- **Cross-market ovrfloToken fungibility** &nbsp;[I-13](invariants.md#i-13) — ovrfloToken is shared across all PT markets for the same underlying. The combined solvency invariant (I-13) is the correct check; individual checks are too strict post-maturity.

- **OVRFLOBook offer/listing one-way flags** &nbsp;[I-8](invariants.md#i-8), [I-10](invariants.md#i-10) — `offer.active` and `saleListing.active` transition true→false only. No revival path exists.

### Protocol-Type Concerns

**As a Lending/Borrowing:**
- `StreamPricing.obligationForFill:170` fast-paths full-borrow to `remaining` exactly, avoiding floor/ceil mismatch at the boundary. Worth checking partial-borrow near the boundary (grossPrice - 1 wei).
- `OVRFLOBook.closeLoan:474` is permissionless — anyone can close a loan once the stream has accrued enough. This is by design (self-repaying), but worth confirming no griefing vector exists.

**As a Yield Aggregator/Vault:**
- `OVRFLO.wrap:316` uses a strict `balanceAfter - balanceBefore == amount` check. Fee-on-transfer or rebasing tokens would fail this check. The factory validates `SY.yieldToken() == underlying` (G-55), binding to Pendle SY yield tokens (e.g. wstETH), which are non-rebasing.

### Temporal Risk Profile

**Deployment & Initialization:**
- `OVRFLOFactory.deploy:133` and `deployBook:166` are two-step (configure then deploy). The deployer EOA is the initial owner until `acceptOwnership` is called.

**Market Stress:**
- Pendle TWAP oracle (15-30 min window) can lag during volatility. `OVRFLO.deposit:377` uses the rate at deposit time with no fallback. `minToUser` provides slippage protection but does not bound the rate itself. Oracle freshness is now checked at runtime (I-17).

### Composability & Dependency Risks

> **Pendle Oracle** — via `OVRFLO.deposit:377`, `flashLoan:473`, `OVRFLOFactory.addMarket:196`
> - Assumes: Returns a valid PT-to-SY TWAP rate in 1e18 scale
> - Validates: TWAP duration (15-30 min) at onboarding; `oldestObservationSatisfied` at runtime (I-17); cardinality at onboarding only
> - Mutability: Immutable vault-level oracle, singleton set at factory construction
> - On failure: Reverts (no try/catch, no fallback)

> **Sablier V2 Lockup Linear** — via `OVRFLO.deposit:402`, `OVRFLOBook` (transferFrom, withdraw, withdrawableAmountOf)
> - Assumes: Streams are non-cancelable, pay the correct asset, vest linearly to the cached expiry
> - Validates: `StreamPricing.requireEligible` checks sender, asset, end time, cliff, cancelability, remaining > 0
> - Mutability: Hardcoded immutable (`0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`)
> - On failure: Reverts

> **Pendle Market / SY** — via `OVRFLOFactory.addMarket:204`
> - Assumes: `readTokens()` returns correct (SY, PT, YT) addresses; `expiry()` returns correct maturity
> - Validates: `SY.yieldToken() == underlying` (G-55); oracle cardinality and readiness
> - Mutability: External Pendle contracts; upgradeability depends on Pendle's governance
> - On failure: Reverts

**Token Assumptions** *(unvalidated only)*:
- wstETH (underlying): assumes non-rebasing, 18 decimals, standard ERC20 transfer. Validated indirectly via `SY.yieldToken()` match.

---

## 3. Invariants

> ### Full invariant map: **[invariants.md](invariants.md)**
>
> - **56 Enforced Guards** (`G-1` … `G-56`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **17 Single-Contract Invariants** (`I-1` … `I-17`) — Conservation, Bound, StateMachine, Temporal
> - **3 Cross-Contract Invariants** (`X-1` … `X-3`) — caller/callee pairs that cross scope boundaries
> - **3 Economic Invariants** (`E-1` … `E-3`) — higher-order properties deriving from `I-N` + `X-N`
>
> Every inferred block cites a concrete Δ-pair, guard-lift + write-sites, state edge, temporal predicate, or NatSpec quote. The **On-chain=No** blocks are the high-signal ones. Attack-surface bullets above cross-link directly into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` — comprehensive protocol spec with flows, architecture diagrams, security analysis |
| NatSpec | ~130 annotations | Thorough on all 5 contracts; every public function documented with `@notice`, `@dev`, `@param` |
| Spec/Whitepaper | Present | `README.md` serves as the spec; `docs/solutions/` contains 14+ writeups with YAML frontmatter |
| Inline Comments | Thorough | `docs/solutions/patterns/ovrflo-critical-patterns.md` documents 17 enforceable rules; `CONCEPTS.md` has domain vocabulary |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 49 | File scan (always reliable) |
| Test functions | 299 | Suite result: 91 + 13 + 6 + 5 + 3 = 118 in coverage run; 299 total across all files |
| Line coverage | 100% (source files) | `forge coverage` via lcov.info — 593/593 instrumented lines hit |
| Branch coverage | 99.6% (source files) | `forge coverage` via lcov.info — 267/268 branches hit (1 uncovered branch in OVRFLOBook) |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~25 files | OVRFLO, OVRFLOBook, OVRFLOFactory, StreamPricing, OVRFLOToken |
| Mainnet fork | 6 files | Vault, book, factory, flash loan, wrap/unwrap |
| Stateless fuzz | 1 suite (1000 runs) | OVRFLOFuzz |
| Stateful fuzz (Foundry) | 3 suites (500 runs, depth 25) | OVRFLOBook invariant, OVRFLO invariant, wrap/unwrap invariant |
| Attack scenarios | 1 suite | Flash-loan griefing, wrap/claim/redeem loops |
| Math stress | 1 suite | StreamPricing rounding, overflow, boundary |
| Stateful fuzz (Echidna) | 1 config (`echidna.yaml`) | 133 properties across 5 contracts |
| Stateful fuzz (Medusa) | 1 config (`medusa.json`) | 133 properties, 500K test limit, 10 workers |
| Audit fix tests | 7 files (U1-U7) | Guard tests, boundary reverts, edge cases, fork self-skip, defensive branch harness |
| Formal verification | 0 | Not yet implemented — I-7, I-4/E-3, I-2/I-3 identified as targets |

### Gaps

- **No formal verification** — Math-heavy pricing logic (`StreamPricing`) and pool pro-rata accounting would benefit from Halmos. Three properties identified: I-7 (rounding invariant), I-4/E-3 (pool pro-rata fairness), I-2/I-3 (pool conservation).
- **Fuzz campaign re-run pending** — Medusa/Echidna configs have 133 properties. 5 violations were found and fixed in the audit campaign (M-01 through L-02); a re-run to confirm zero violations is pending.
- **1 uncovered branch** in `OVRFLOBook.sol` (99.6% branch coverage) — worth identifying which branch is missed.

---

## 6. Developer & Git History

> Repo shape: normal_dev — 93 source-touching commits over 324 days (Aug 2025 → Jul 2026)

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| jay | 190 | +4,698 / -2,554 | 100% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 3 (1 source) | Single-developer; 2 non-source contributors |
| Merge commits | 8 of 197 (4.1%) | Predominantly linear commits |
| Repo age | Aug 2025 → Jul 2026 | 324 days |
| Recent source activity (30d) | 40 commits | Heavy development burst — audit fixes, refactoring, test campaign |
| Test co-change rate | 65.6% | Healthy — 2/3 of source commits also modify tests |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/OVRFLOBook.sol | 29 | Secondary market — most modified file; received pool feature, unified offers, 5 audit fixes |
| src/OVFL.sol | 28 | Legacy file (pre-OVRFLO rename); not current code |
| src/OVRFLO.sol | 26 | Core vault — oracle freshness, split refactor, flash loan |
| src/OVRFLOFactory.sol | 22 | Admin hub — frequent access control changes |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 92d5c41 | 2026-07-01 | fix: add sweepExcessPt input guard, fuzz suite | 21 | Adds 30 runtime guards, tightens access control, 4 security domains |
| 3a7b06a | 2026-06-27 | fix: code review fixes + doc updates | 18 | Adds 16 guards, tightens access control, no test changes |
| 860f72d | 2026-06-27 | feat: fix factory deployment/management gaps | 17 | Makes admin immutable, 88 lines changed |
| e3514b3 | 2026-03-07 | Port recovered Solidity hardening and tests | 17 | Hardening/validation, token transfer + accounting changes |
| bdd752b | 2026-07-03 | fix(M-03): add oracle freshness check | 15 | Oracle/pricing, adds runtime guard, 4 security domains |
| 36103df | 2026-06-24 | Gate OVRFLOBook offers on active markets | 15 | Adds 33 guards, 437 lines changed |
| 887f2b9 | 2026-06-29 | feat(U7): add poolClaimLoan and claimPoolShare | 14 | New fund flow paths, 9 guards |
| f925744 | 2026-06-29 | feat(U5): add createBorrowPool | 14 | New batch lending primitive, 10 guards |
| 98bff9d | 2026-06-27 | feat: add PT flash loan facility | 14 | New flash loan path, 14 guards, 145 lines |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 59 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, OVRFLOToken.sol |
| fund_flows | 59 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, StreamPricing.sol |
| oracle_price | 59 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, StreamPricing.sol |
| state_machines | 33 | OVRFLO.sol, OVRFLOFactory.sol |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule | 318 .sol files; multiple pragma versions — standard OZ, no internalization |
| prb-math | lib/prb-math | — | Submodule | 9 .sol files; pragma >=0.8.4 — standard, no modifications |

### Security Observations

- **Single-developer risk** — jay authored 100% of source lines; no peer review signals from multi-author commits.
- **40 late commits in 30 days** — heaviest burst: 5 audit fixes (M-01 through L-02), refactoring, 7 test files (U1-U7), and doc sync.
- **3a7b06a fix without test changes** — code review fixes spanning access control and accounting, 12 lines changed, no test co-modification. *Git signal: 10% fix-without-test rate overall.*
- **No tech debt markers** — zero TODO/FIXME/HACK comments in source files.
- **OVFL.sol hotspot is legacy** — 28 modifications to `src/OVFL.sol` (pre-rename); current code is `src/OVRFLO.sol` with 26 modifications.
- **Audit campaign completed** — 5 findings (M-01, M-02, M-03, L-01, L-02) found, fixed test-first, and documented in `docs/audit/audit-findings.md`. Pattern #12 resynced.

### Cross-Reference Synthesis

- **`OVRFLOBook.sol` is #1 in BOTH churn AND attack-surface priority** — pool single-channel claims, rounding math, and 5 audit fixes all route through it → highest-leverage review target.
- **59 access_control + 59 fund_flows + 59 oracle_price commits** — all three security areas have identical commit counts because every functional change touches all three (access gating, fund movement, and oracle-dependent pricing). This is structural, not coincidental.
- **M-03 fix (oracle freshness) directly addresses X-1 attack surface** — the oracle was previously checked only at onboarding; now `oldestObservationSatisfied` is verified before every rate read (I-17).
- **M-01 fix (pro-rata cap removal) changes I-4 mechanism** — the invariant `poolReceived <= entitlement` still holds, but enforcement shifted from a pro-rata cap on a shrinking pot to `min(remaining, poolProceeds)`.

---

## X-Ray Verdict

**HARDENED** — A well-structured lending protocol with deterministic collateral (no liquidation risk), comprehensive test coverage (100% line, 99.6% branch on source files; unit + fuzz + invariant + fork + Medusa/Echidna with 133 properties), thorough documentation (NatSpec + README spec + 13 critical patterns), and timelocked multisig governance. An audit campaign found and fixed 5 findings (M-01 through L-02) with test-first discipline. The main risk factors are single-developer codebase, a 40-commit development burst in the last 30 days, and no formal verification of the math-heavy pricing logic.

**Structural facts:**
1. ~1,395 nSLOC across 3 subsystems (vault, secondary market, admin hub) — compact, focused codebase.
2. 0 upgradeable contracts — all vaults, books, and tokens are deployed via `new` (no proxies).
3. 1 developer wrote 100% of source code over 324 days.
4. 100% line coverage and 99.6% branch coverage on source files (via `forge coverage`); 133 fuzz properties via Medusa/Echidna; 3 Foundry invariant test suites (500 runs, depth 25).
5. 17 enforceable critical patterns documented in `docs/solutions/patterns/ovrflo-critical-patterns.md`; 5 audit findings found and fixed in `docs/audit/audit-findings.md`.
