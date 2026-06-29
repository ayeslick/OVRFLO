# X-Ray Report

> OVRFLO | 1135 nSLOC | c01fba7 (`main`) | Foundry | 26/06/26

---

## 1. Protocol Overview

**What it does:** A Pendle-PT wrapper that splits a deposit into immediate ovrfloTokens (principal at TWAP value) plus a non-cancelable Sablier stream vesting the discount, then lets users sell or borrow against that stream on a secondary book where the stream itself repays the loan.

- **Users**: PT depositors (create collateral), stream sellers/borrowers (secondary market), lenders (fund loans/offers).
- **Core flow**: Deposit PT → receive ovrfloTokens + Sablier stream → pledge/sell stream on OVRFLOBook → stream repays loan at maturity.
- **Key mechanism**: Linear-APR discount pricing (`StreamPricing`), TWAP oracle split at deposit, deterministic non-cancelable streams as collateral (no liquidations).
- **Token model**: `OVRFLOToken` — ERC20, 18-decimals, mint/burn by the owning vault, fungible across all PT series sharing one underlying (by design).
- **Admin model**: Timelocked multisig owns `OVRFLOFactory` (admin hub for all vaults) and each `OVRFLOBook`; two-step ownership (`Ownable2Step`). No on-chain timelock or pause contract in scope.

See the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Core Vault | OVRFLO, OVRFLOToken | 279 | PT deposit → ovrfloToken + stream; 1:1 wrap/unwrap; post-maturity claim |
| Admin Hub | OVRFLOFactory | 146 | Deploys vaults+tokens, onboards markets (oracle/underlying checks), sweeps |
| Secondary Market | OVRFLOBook, StreamPricing | 710 | Sell/borrow against streams; linear-APR pricing + eligibility library |

### How It Fits Together

The core: a Pendle PT deposit is split into a liquid principal token (ovrfloToken) and a deterministic vesting stream of the same token, making the stream usable as self-repaying collateral without oracles.

### Deposit → Stream → Claim

```
OVRFLO.deposit(market, ptAmount, minToUser)
├─ IERC20(ptToken).safeTransferFrom(user, vault, ptAmount)   *no balance-delta check*
├─ rateE18 = IPendleOracle(oracle).getPtToSyRate(market, twap)   *freshness only checked at onboarding*
├─ toUser = ptAmount * rate / 1e18 (capped at ptAmount); toStream = ptAmount - toUser
├─ fee = toUser * feeBps / BPS  → safeTransferFrom(user, treasury, fee)
├─ OVRFLOToken.mint(user, toUser); OVRFLOToken.mint(vault, toStream)
└─ sablierLL.createWithDurations(...) → streamId             *recipient=user, non-cancelable*
```
*After maturity: `OVRFLO.claim(ptToken, amount)` burns ovrfloToken 1:1 and transfers PT out (`marketTotalDeposited` decremented).*

### Borrow Against Stream (Book)

```
OVRFLOBook.createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable)
├─ StreamPricing.requireEligible(factory, sablier, core, market, streamId)   *sender=core, asset, end=expiry, no cliff, non-cancelable, remaining>0*
├─ grossPrice = grossPrice(remaining, aprBps, ttm)   *floors; ttm = expiry - block.timestamp*
├─ require(borrowAmount <= grossPrice && <= capacity)
├─ obligation = obligationForFill(...)   *ceils; fast-paths to `remaining` on full borrow*
├─ sablier.transferFrom(borrower, book, streamId)   *book escrows NFT*
├─ pay underlying(net) to borrower; pay fee to treasury
└─ store Loan{obligation, drawn:0, repaid:0, closed:false}
```
*Servicing: `poolClaimLoan` (contributor draws, capped at outstanding) / `closeLoan` (permissionless, requires withdrawable ≥ outstanding) / `repayLoan` (borrower pays ovrfloToken). `outstanding = obligation - drawn - repaid`.*

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Lending/Borrowing** with **Yield Aggregator/Vault** characteristics

Lending signals: `createBorrowPool`, `repayLoan`, `poolClaimLoan`, `closeLoan`, loan obligations, collateral (stream), no liquidations by design. Vault signals: `deposit`/`claim`/`wrap`/`unwrap`, mint/burn wrapper token, streaming yield. Primary adversaries from lending (oracle, flash-loan, MEV, admin); vault adds share/donation and backing concerns.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Multisig | Trusted (off-chain timelocked) | Owns factory + each book via Ownable2Step. 2-step transfer delay on the seat; **all operational actions instant** (deploy, addMarket, sweep, setFee→100%, setAprBounds, setTreasury). No on-chain timelock/pause. |
| OVRFLOFactory | Bounded (multisig-gated) | Admin hub for all vaults: market onboarding, deposit limits, sweeps, oracle prep. Forwards admin to vaults. |
| OVRFLO vault | Bounded (factory is admin) | Holds PT + underlying; mints/burns ovrfloToken. Admin sweep of excess only. |
| OVRFLOToken | Bounded (vault-owned) | mint/burn restricted to owner vault; standard ERC20 otherwise. |
| User | Untrusted | Permissionless deposit/claim/wrap/unwrap + all book post/fill/close paths. |
| Lender / Borrower / Maker | Bounded (position-owner) | Cancel/claim/repay gated to the offer/listing/loan owner. |

**Adversary Ranking** (ordered by threat level):

1. **Oracle manipulator** — `deposit()` splits value off `getPtToSyRate`; the TWAP oracle is the single source of truth for the immediate-vs-streamed split.
2. **MEV / time-of-flight trader** — book `grossPrice` depends on `block.timestamp` via `timeToMaturity`; price drifts every block and is re-priced at fill vs post.
3. **Compromised admin (multisig)** — instant operational powers (sweep, 100% fee, treasury redirect, APR bounds) with no on-chain timelock or pause.
4. **External dependency drift** — Sablier V2 withdrawability/ACL semantics and Pendle oracle freshness are trusted; both are immutable addresses but externally governed.
5. **Malicious first depositor / donor** — wrap/unwrap reserve and cross-market ovrfloToken fungibility create backing-edge cases.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig → Factory → Vault** — off-chain timelocked multisig is the only admin path; worst instant action is `sweepExcessPt`/`sweepExcessUnderlying` (only tracked *excess*, not user backing) and `setFee`/`setAprBounds` to ceiling. No on-chain delay on operational calls. `OVRFLOFactory.sol:103-205`.
- **Vault ↔ OVRFLOToken** — vault is sole minter/burner; `OVRFLOToken.transferOwnership` is single-step (no two-step) — see L-3 in prior audit record.
- **Book ↔ Sablier NFT escrow** — book takes custody of stream NFTs; only the book (as recipient/owner) can withdraw to lenders. Trust rests on Sablier v1.1 ACL immutability. `OVRFLOBook.sol:398-426`.
- **External oracles/streams** — Pendle oracle + Sablier V2 are immutable vault/book constants; behavior can change only via external governance. *Git signal: oracle/fund-flow code in top-3 most-changed areas (29 commits each).*

### Key Attack Surfaces

- **Oracle-driven deposit split** &nbsp;[X-1](invariants.md#x-1), [I-11](invariants.md#i-11) — `OVRFLO.deposit:344` consumes `getPtToSyRate` to split `ptAmount` into `toUser`/`toStream`; freshness/cardinality is verified only at `OVRFLOFactory.addMarket:164-166` onboarding, not rechecked at deposit. Worth tracing whether a stale/manipulated TWAP can skew the split within a block.

- **PT exact-transfer assumption** &nbsp;[I-1](invariants.md#i-1) — `OVRFLO.deposit:340` pulls PT via `safeTransferFrom` *without* a balance-delta check (unlike `wrap` and book `_pullExact`), then increments `marketTotalDeposited` by the full `ptAmount`. A fee-on-transfer PT would make accounting exceed the real balance. Worth confirming all onboardable PTs are exact-transfer.

- **Book pricing time-dependence** &nbsp;[I-6](invariants.md#i-6), [E-2](invariants.md#e-2) — `grossPrice`/`obligation` recompute at fill time from `expiryCached - block.timestamp`; a listing posted early is re-priced later (remaining may also drop if the seller withdrew mid-stream). Worth checking fill-time repricing interaction with snapshotted fees and `minObligationOut` slippage.

- **Permissionless `closeLoan` liveness** &nbsp;[X-2](invariants.md#x-2), [I-10](invariants.md#i-10) — `OVRFLOBook.closeLoan:732` is callable by anyone once `withdrawableAmountOf >= outstanding`; it draws the stream and returns the NFT. Worth tracing whether any partial-`poolClaimLoan` state leaves the loan unclosable or the residual misrouted.

- **Admin instant powers without on-chain timelock/pause** &nbsp;[I-4](invariants.md#i-4), [I-8](invariants.md#i-8) — `setFee`/`setAprBounds`/`setTreasury`/`sweepExcess*`/`setMarketDepositLimit` execute instantly on multisig sign; `setMarketDepositLimit` can lower the cap below already-deposited principal. No `Pausable` anywhere; deposit-limit=0 freezes new deposits but never pauses claims or the book. Worth confirming the off-chain timelock is the sole delay.

- **Cross-market ovrfloToken fungibility** &nbsp;[E-3](invariants.md#e-3), [I-9](invariants.md#i-9) — one ovrfloToken serves every PT series of the same underlying; `claim` burns ovrfloToken against any matured series with sufficient `claimablePt(ptToken)`. Worth checking whether two series with identical `expiryCached` under one underlying create any accounting ambiguity.

- **`uint128`/`uint40` narrowing in deposit** &nbsp;[I-1](invariants.md#i-1) — `deposit` casts `toStream` to `uint128` for Sablier and `duration` to `uint40`; economically unreachable with 18-decimal PT but worth a revert-vs-truncation confirmation.

### Upgrade Architecture Concerns

No upgradeable contracts (no UUPS/transparent/beacon/proxy). All core contracts are immutable deployments; `OVRFLOToken` uses single-step `transferOwnership` (not two-step) — a key-transfer risk noted in prior findings.

### Protocol-Type Concerns

**As a Lending/Borrowing:**
- No health factor, no liquidation, no liquidator incentive — by design (deterministic non-cancelable stream is the collateral). Solvency rests entirely on `obligation <= remaining` (`StreamPricing` rounding invariant [E-2](invariants.md#e-2)).
- `poolClaimLoan` caps draws at `_outstanding` so a contributor cannot overdraw past the obligation; `closeLoan` requires full coverage. Worth checking the partial-claim → close residual path.

**As a Yield Aggregator/Vault:**
- Not ERC4626 share-based; ovrfloToken is minted at PT market value (not pro-rata), so classic share-inflation is not the model. `wrap`/`unwrap` is 1:1 against a tracked `wrappedUnderlying` reserve with a balance-delta check [I-2](invariants.md#i-2).
- `sweepExcessUnderlying` removes only `balance - wrappedUnderlying`; direct donations become admin-sweepable, not user-extractable. Worth confirming no path lets `wrappedUnderlying` exceed actual balance.

### Temporal Risk Profile

**Deployment & Initialization:**
- `OVRFLOFactory.deploy` + `addMarket` set vault immutables and one-shot series config in a single multisig-owned flow; `addMarket` requires a ready Pendle oracle window and exact SY-underlying match. No `initialize()`/proxy front-running surface (no proxies). `OVRFLOFactory.sol:112-176`.

**Market Stress:**
- TWAP (15-30 min window) mitigates single-block oracle manipulation but stale rates during volatility skew the deposit split; no on-chain staleness re-check at deposit. `OVRFLO.deposit:344` [X-1](invariants.md#x-1).

### Composability & Dependency Risks

> **Pendle Oracle** — via `OVRFLO.deposit:344`, `OVRFLOFactory.addMarket:155`
> - Assumes: `getPtToSyRate` returns a fresh, manipulation-resistant TWAP in 1e18 scale.
> - Validates: cardinality + oldest-observation satisfied at onboarding only (`addMarket`); not rechecked at deposit.
> - Mutability: Immutable vault/factory constant; oracle contract is externally governed by Pendle.
> - On failure: returns a stale/wrong rate → split skew; no revert/circuit-breaker at deposit.

> **Sablier V2 Lockup Linear** — via `OVRFLO.deposit:362`, `OVRFLOBook.*`
> - Assumes: `withdrawableAmountOf` monotonic, `withdraw` ACL = sender/owner/approved only, NFT ownership = withdrawal authority, non-cancelable streams stay non-cancelable.
> - Validates: `StreamPricing.requireEligible` checks sender=core, asset, end=expiry, no cliff, non-cancelable, remaining>0 at pledge time; not re-checked at claim/close.
> - Mutability: Immutable constant (`0xAFb979…`); Sablier V2 is immutable (v1.1), externally governed.
> - On failure: wrong withdrawable → over/under-draw; ACL bypass → value sink. Bounded by book NFT custody.

**Token Assumptions** *(unvalidated only)*:
- Pendle PT: assumes exact transfer (no fee-on-transfer) and 18 decimals — `deposit` has no PT balance-delta check [I-1](invariants.md#i-1).
- ovrfloToken: assumes 18-decimal granularity so `repayLoan` equality closes cleanly (documented in `docs/solutions`).
- Underlying: `wrap` and book `_pullExact` use balance-delta checks (fee-on-transfer safe).

**Shared State Exposure**: Pendle oracle TWAP is shared with all Pendle users; large PT market actions could move the TWAP window the vault reads. Sablier streams are per-deposit (not shared pools).

---

## 3. Invariants

> ### Full invariant map: [invariants.md](invariants.md)
>
> - **18 Enforced Guards** (`G-1` … `G-18`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **13 Single-Contract Invariants** (`I-1` … `I-13`) — Conservation, Bound, StateMachine, Temporal
> - **5 Cross-Contract Invariants** (`X-1` … `X-5`) — caller/callee pairs across scope boundaries
> - **3 Economic Invariants** (`E-1` … `E-3`) — higher-order properties deriving from `I-N` + `X-N`
>
> The **On-chain=No** blocks are the high-signal ones — each is simultaneously an invariant and a potential bug. Attack-surface bullets above cross-link directly into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` — thorough protocol spec with flows, architecture, fee structure, security notes (per spec) |
| NatSpec | ~120 annotations | Extensive `@notice`/`@dev` across all contracts; rounding-direction rationale documented in `StreamPricing` |
| Spec/Whitepaper | Present | `README.md` doubles as spec; `CONCEPTS.md` holds domain glossary (per spec) |
| Inline Comments | Thorough | Load-bearing rounding notes, CEI intent, solution-doc cross-references |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 16 | File scan (always reliable) |
| Test functions | 179 | File scan (always reliable) |
| Line coverage | Unavailable | `forge coverage` ran (167 pass / 4 fork skipped) but emitted no % summary; lcov may exist in `coverage/` |
| Branch coverage | Unavailable | Same as above |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~130 | OVRFLO, OVRFLOBook, OVRFLOFactory, OVRFLOToken, StreamPricing |
| Stateless Fuzz | ~20 | StreamPricing math (`grossPrice`/`obligation`/`factor` bounds, monotonicity) |
| Stateful Fuzz (Foundry invariant) | 3 | wrap/unwrap solvency: `SupplyEqualsPtBackingPlusUnderlyingReserve`, `UnwrapsNeverExceedSuccessfulWraps`, `WrappedReserveNeverExceedsUnderlyingBalance` |
| Fork | 4 files | Book, Factory, OVRFLO, WrapUnwrap — require `MAINNET_RPC_URL` (skipped here) |
| Stateful Fuzz (Echidna) | 0 | — |
| Stateful Fuzz (Medusa) | 0 | — |
| Formal Verification (Certora/Halmos/hevm) | 0 | — |

### Gaps

- No stateful fuzz on the **book loan lifecycle** (claim/repay/close interleaving) — the 3 Foundry invariants cover wrap/unwrap only.
- No formal verification of `StreamPricing` rounding invariant `obligation <= remaining` (stress-tested via stateless fuzz but not proven).
- Fork tests require an archive RPC; not runnable in this environment.
- No negative auth tests documented for book cancel paths beyond unit reverts.

---

## 6. Developer & Git History

> Repo shape: **normal_dev** — 63 source-touching commits over 315 days; the OVFL→OVRFLO rename/migration (commit `96dd254`) reset many file paths; current `src/` is the post-migration codebase.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| jay | 111 | +3811 / — | 100% |
| Perplexity Computer | 4 | — | <1% |
| ayeslick | 3 | — | <1% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 3 | Single-dev dominance (jay = 100% of source lines) |
| Merge commits | 5 of 118 (4%) | Minimal merge-based review |
| Repo age | 2025-08-15 → 2026-06-26 | ~10.5 months |
| Recent source activity (30d) | 10 commits | **Late burst before audit** — entire secondary market + wrap/unwrap + refactor landed 2026-06-23/24 |
| Test co-change rate | 58.7% | Majority of source commits also touch tests (co-modification, not coverage) |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/OVRFLO.sol (ex-OVFL.sol) | 47 combined | Highest churn — core vault, refactored repeatedly |
| src/OVRFLOFactory.sol (ex-OVFLFactory) | 25 combined | Onboarding/oracle flow reworked several times |
| src/OVRFLOBook.sol | 5 | New (2026-06-23), 849-line initial drop |
| src/OVRFLOToken.sol | 6 | Thin, stable |
| src/StreamPricing.sol | 2 | New, math-critical |

### Security-Relevant Commits

**Score** = weighted fix-like signals (keywords, diff patterns, change shape). **10+ warrants a manual diff.**

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| e3514b3 | 2026-03-07 | Port recovered Solidity hardening and tests onto main | 17 | +6 runtime guards, tightens AC, token/accounting logic, 4 security domains |
| 342409f | 2026-04-18 | Fix tests, update front end | 16 | rewrites guards, loosens AC (-5), net removal |
| 36103df | 2026-06-24 | Gate OVRFLOBook offers on active markets + audit docs | 15 | +33 guards, tightens AC, 437 lines |
| a668f38 | 2026-06-23 | feat: add OVRFLO wrap unwrap | 14 | +10 guards, token/accounting, 4 domains |
| 769a00a | 2026-06-23 | protect OVRFLOBook makers from retroactive fee changes | 13 | hardening, fee snapshot, accounting |
| 384c92e | 2026-06-23 | feat: add OVRFLO secondary market book | 12 | +64 guards, +849 lines, new subsystem |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 30 | OVRFLO, OVRFLOBook, OVRFLOFactory, OVRFLOToken |
| fund_flows | 29 | OVRFLO, OVRFLOBook, OVRFLOFactory, StreamPricing |
| oracle_price | 29 | OVRFLO, OVRFLOBook, OVRFLOFactory, StreamPricing |
| state_machines | 19 | OVRFLOFactory |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule | Standard v4.9; pragma range broad but unmodified |
| prb-math | lib/prb-math | — | Submodule | `>=0.8.4`; used for `mulDiv` rounding |

No internalized/forked libraries with logic changes. No tech-debt markers (TODO/FIXME) in source.

### Security Observations

- **Single-developer code** — jay authored 100% of source lines; no on-chain peer-review signal beyond 5 merge commits.
- **Late burst** — 10 source commits in the 30 days before audit, including the entire 849-line book subsystem and wrap/unwrap; minimal seasoning.
- **One commit without test co-change** in the late window (`11a8806` "CEI for OVRFLOBook") — 12-line CEI reorder, low residual risk.
- **Oracle/fund-flow/access churn** — top-3 most-modified security areas (29-30 commits each); high-churn core vault warrants deeper review.
- **No on-chain timelock/pause** — admin powers rely entirely on the off-chain multisig process; no `Pausable`/`TimelockController` in scope.
- **OVRFLOToken single-step ownership** — unlike factory/book (`Ownable2Step`), the token uses single-step `transferOwnership`.
- **Fix-without-test rate 0%** — every fix-scored commit co-changed tests (co-modification signal, not coverage).

### Cross-Reference Synthesis

- **`OVRFLO.deposit` is #1 in BOTH oracle-surface AND conservation gap** — no PT balance-delta + onboarding-only freshness → highest-leverage review: the split math and the exact-transfer assumption.
- **Late-burst book subsystem (384c92e, 849 lines) has no stateful fuzz on loan interleaving** — claim/repay/close sequences are unit-tested only → prioritize stateful fuzz here.
- **`StreamPricing` rounding is load-bearing for solvency (E-2) but only stress-fuzzed, not formally proven** — `obligation <= remaining` underpins the no-liquidation design.

---

## X-Ray Verdict

**ADEQUATE** — Roles, docs, and tests are solid (Foundry invariants + stateless fuzz + unit breadth), but single-developer code with a late pre-audit feature burst, no on-chain timelock/pause, and load-bearing math that is stress-fuzzed but not formally proven cap the posture at adequate.

**Tier calculation:** Tests = HARDENED (unit + fuzz + Foundry invariant); Docs = HARDENED (NatSpec + spec + thorough inline); Access Control = ADEQUATE (clear roles + multisig, but no on-chain timelock/pause). Lowest = ADEQUATE. No TODOs in security paths (tech_debt=0), so no further drop.

**Structural facts:**
1. 1135 nSLOC across 3 subsystems (Core Vault, Admin Hub, Secondary Market); 5 in-scope contracts, 0 upgradeable.
2. 179 test functions across 16 files, including 3 Foundry invariant tests (wrap/unwrap solvency) and ~20 stateless fuzz tests (StreamPricing math).
3. Single developer (jay) authored 100% of source lines; 10 source commits landed in the 30 days before audit.
4. 2 external immutable dependencies (Pendle Oracle, Sablier V2 LL at `0xAFb979…`); no internalized/forked libraries with logic changes.
5. No on-chain timelock or pause mechanism; admin powers are instant on multisig sign (off-chain timelock only).
