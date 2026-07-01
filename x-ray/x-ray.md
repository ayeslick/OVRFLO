# X-Ray Report

> OVRFLO | 1,162 nSLOC | 183e0ce (`main`) | Foundry | 01/07/26

---

## 1. Protocol Overview

**What it does:** Wraps Pendle Principal Tokens into liquid ovrfloTokens (immediate value) plus deterministic Sablier streams (residual discount), with a secondary market for trading and lending against those streams.

- **Users**: Deposit PT for yield tokenization; trade/lend Sablier streams on the secondary market
- **Core flow**: Deposit PT → receive ovrfloToken + Sablier stream → trade or borrow against stream → claim PT after maturity
- **Key mechanism**: TWAP oracle splits PT deposit into immediate (ovrfloToken) and streamed (Sablier) portions; linear APR discounting for secondary market pricing
- **Token model**: ovrfloToken (ERC20, 1:1 with PT at maturity, fungible across series of same underlying)
- **Admin model**: Timelocked multisig → OVRFLOFactory → OVRFLO vaults + OVRFLOBook instances; no upgradeable contracts

For a visual overview of the protocol's architecture, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Vault Core | OVRFLO, OVRFLOToken | 314 | PT deposit vault + wrapper ERC20 (1:1 wrap/unwrap, post-maturity claim) |
| Secondary Market | OVRFLOBook | 546 | Order book for stream sales and self-repaying pool loans backed by Sablier streams |
| Admin Hub | OVRFLOFactory | 194 | Deploys vaults/tokens/books; forwards multisig admin to vaults and books |
| Pricing Library | StreamPricing | 108 | Pure library for stream valuation, eligibility checks, and fee/obligation math |

### How It Fits Together

**The core trick:** Deposit PT at a discount → receive liquid ovrfloToken (immediate value) + a deterministic Sablier stream (residual discount) → trade or borrow against the stream on OVRFLOBook → exit via unwrap or post-maturity claim.

Key change since last x-ray: Sale offers and lend offers merged into a single unified `Offer` type (commit `aed261d`, 548 lines changed). An offer can be consumed as either a sale (`sellIntoOffer`) or a loan (`createBorrowPool`); the maker cannot restrict the path. Borrow listings and `createLenderPool` removed; pools are the only lending mechanism, and each pool has exactly one loan via the `poolLoanId` mapping. nSLOC dropped 17% (1,398 → 1,162).

### Deposit (PT → ovrfloToken + stream)
```
OVRFLO.deposit(market, ptAmount, minToUser)
├─ IPendleOracle(oracle).getPtToSyRate(market, twapDuration)     *TWAP rate splits principal from discount*
├─ toUser = PRBMath.mulDiv(ptAmount, rateE18, WAD)               *immediate ovrfloToken*
├─ toStream = ptAmount - toUser                                   *residual for streaming*
├─ IERC20(ptToken).safeTransferFrom(user, vault, ptAmount)
├─ IERC20(underlying).safeTransferFrom(user, TREASURY_ADDR, fee)  *fee in underlying*
├─ OVRFLOToken.mint(user, toUser)
├─ OVRFLOToken.mint(vault, toStream)
└─ sablierLL.createWithDurations(...)                              *non-cancelable stream to user*
```

### Borrow Pool (stream → loan)
```
OVRFLOBook.createBorrowPool(offerIds, streamId, targetBorrow, minAcceptable)
├─ StreamPricing.requireEligible(factory, sablier, core, market, streamId)  *validates stream*
├─ StreamPricing.grossPrice(remaining, aprBps, timeToMaturity)              *discounted price*
├─ _validateOffers(offerIds, market, aprBps, msg.sender)                    *no self-match, sorted*
├─ StreamPricing.obligationForFill(borrow, grossPrice, remaining, ...)      *ceiling-rounded debt*
├─ pools[poolId] = Pool(...)                          *CEI: all state before transfers*
├─ _consumeOffers(offerIds, poolId, actualBorrow)                           *decrement capacities*
├─ _storeLoan(borrower, address(this), streamId, obligation)
├─ loanPoolId[loanId] = poolId; poolLoanId[poolId] = loanId                 *1:1 pool-to-loan*
├─ sablier.transferFrom(borrower, book, streamId)                           *escrow stream*
├─ _payUnderlying(borrower, netToBorrower)                                  *loan disbursement*
└─ _payUnderlying(treasury, feeAmount)                                      *protocol fee*
```

### Pool Claim (dual channel)
```
Channel A: Direct stream draw
OVRFLOBook.poolClaimLoan(poolId, amount)                                    *loanId derived from poolId*
├─ loanId = poolLoanId[poolId]; require(loanId != 0)
├─ entitlement = contribution * totalObligation / totalContributed          *pro-rata cap*
├─ streamClaimable = min(sablier.withdrawableAmountOf, _outstanding)
├─ drawAmount = min(amount, remaining, streamClaimable)
├─ poolReceived[poolId][caller] += drawAmount
├─ loan.drawn += drawAmount
└─ sablier.withdraw(streamId, caller, drawAmount)                           *direct to caller*

Channel B: Shared proceeds
OVRFLOBook.claimPoolShare(poolId, amount)
├─ proRataShare = poolProceeds * contribution / totalContributed             *pro-rata of pot*
├─ available = min(remaining, proRataShare)
├─ poolReceived[poolId][caller] += amount
├─ poolProceeds[poolId] -= amount
└─ IERC20(ovrfloToken).safeTransfer(caller, amount)                         *from shared pot*
```

### Flash Loan (PT → callback → repay)
```
OVRFLO.flashLoan(ptToken, amount, data)
├─ IPendleOracle(oracle).getPtToSyRate(market, twapDuration)                *rate for fee calc*
├─ IERC20(ptToken).safeTransfer(borrower, amount)                           *send PT first*
├─ IFlashBorrower(borrower).onFlashLoan(...)                                 *callback — can deposit/wrap/unwrap*
├─ require(ret == FLASH_CALLBACK_SUCCESS)
├─ IERC20(ptToken).safeTransferFrom(borrower, vault, amount)                *pull back PT*
└─ IERC20(underlying).safeTransferFrom(borrower, treasury, fee)             *fee in underlying*
```

### Close Loan (permissionless stream draw)
```
OVRFLOBook.closeLoan(loanId)                                                *permissionless*
├─ outstanding = obligation - drawn - repaid
├─ require(sablier.withdrawableAmountOf(streamId) >= outstanding)           *stream must cover debt*
├─ loan.closed = true
├─ sablier.withdraw(streamId, address(this), outstanding)                   *draw to poolProceeds*
├─ poolProceeds[poolId] += outstanding
└─ sablier.transferFrom(book, borrower, streamId)                           *return stream*
```

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Yield Aggregator/Vault** with **Lending/Borrowing** and **Secondary Market** characteristics

Primary vault mechanism (PT deposit → ovrfloToken + stream) matches yield aggregator signals. Stream-collateralized self-repaying loans add lending/borrowing. Unified offers and sale listings add secondary market order book. No liquidations exist by design — deterministic non-cancelable streams eliminate the need.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Timelocked Multisig | Trusted (external timelock) | Owns factory; all admin ops via 2-step ownership. Instant operational powers: set fees (1% vault, 100% book), set APR bounds (≤100%), sweep excess tokens, pause flash loans, approve markets, deploy vaults/books. No on-chain timelock on actions — delay is external to these contracts. |
| OVRFLOFactory | Bounded (immutable admin hub) | Forwards multisig calls to vaults and books. Cannot act independently — all functions are onlyOwner. Ownable2Step transfer delay protects the seat itself. |
| OVRFLO Vault | Bounded (onlyAdmin = factory) | Mints/burns ovrfloToken, creates Sablier streams, flash loans PT. Admin functions only callable by factory. |
| OVRFLOBook | Bounded (onlyOwner = factory) | Secondary market for stream trades and loans. Admin (fee/APR/treasury) only callable by factory. All stateful user functions are nonReentrant. |
| Users | Untrusted | Permissionless deposit/claim/wrap/unwrap/flashLoan on vault; post/fill offers, listings, pools on book. |

**Adversary Ranking** (ordered by threat level):

1. **Oracle manipulator / Flash loan attacker** — TWAP rate determines the deposit split; flash loans provide capital to move Pendle market prices within a single tx. Freshness not rechecked per deposit (X-1), but low practical risk: external Pendle traders/LPs write observations continuously; keeper bot via `prepareOracle()` as fallback.
2. **Pool claim accounting attacker** — Dual claim channels (poolClaimLoan + claimPoolShare) share a single entitlement cap; interactions between the two paths deserve scrutiny.
3. **Compromised multisig** — All operational powers are instant (no on-chain action delay); can sweep excess, change fees, pause flash loans, approve arbitrary markets.
4. **Order book griefing attacker** — Can post and cancel offers/listings to lock liquidity or front-run other traders.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

**Multisig → Factory** — External timelock + 2-step ownership; worst instant action: `sweepExcessPt` / `sweepExcessUnderlying` redirect excess tokens to any address (trusted `to` per project stance). *Git signal: 50 access_control commits — elevated churn.*

**Factory → Vault** — `onlyAdmin` modifier (`msg.sender == factory`); factory is immutable, set at vault construction. No bypass path; vault admin functions are never callable by non-factory addresses.

**Factory → Book** — `onlyOwner` (Ownable2Step); factory is set as owner at book deployment. Book admin (fee/APR/treasury) flows through factory only.

**User → Vault** — Permissionless deposit/claim/wrap/unwrap; no access control. Slippage protection via `minToUser` on deposit. Flash loan gated by `flashLoanPaused` circuit breaker only.

**User → Book** — Permissionless post/fill; `nonReentrant` on all stateful functions. Offer/listing cancellation gated by maker identity check. Pool claims gated by contribution > 0.

### Key Attack Surfaces

- **Pool claim dual-channel accounting** &nbsp;&#91;[I-14](invariants.md#i-14), [I-15](invariants.md#i-15), [I-16](invariants.md#i-16)&#93; — `poolClaimLoan` draws directly from streams (bypassing poolProceeds) while `claimPoolShare` draws from poolProceeds; both share the same `poolReceived`/entitlement accounting. Worth tracing whether concurrent claims on the same loan's stream can let a contributor exceed their entitlement through rounding at the pro-rata boundary.

- **Flash loan reentrancy via unguarded vault functions** &nbsp;&#91;[G-12](invariants.md#g-12), [G-13](invariants.md#g-13)&#93; — `flashLoan` uses `nonReentrant` but the callback can call `deposit`/`wrap`/`unwrap` which have no reentrancy guard. Worth checking if `marketTotalDeposited` increases during the callback affect the flash loan cap or fee calculation.

- **setMarketDepositLimit invariant violation** &nbsp;&#91;[I-6](invariants.md#i-6), [X-4](invariants.md#x-4)&#93; — Admin can set a market's deposit limit below the current `marketTotalDeposited` without reverting. Worth confirming no downstream logic assumes `marketTotalDeposited <= limit` holds globally.

- **closeLoan permissionless stream draw** &nbsp;&#91;[I-11](invariants.md#i-11), [I-13](invariants.md#i-13)&#93; — `closeLoan` is callable by anyone and draws the exact outstanding from the stream. Worth confirming the `withdrawable >= outstanding` guard prevents over-drawing and that the stream is correctly returned to the borrower.

- **Unified offer consumption ambiguity** — A single `Offer` can be consumed as either a sale (`sellIntoOffer`) or a loan (`createBorrowPool`); the maker cannot restrict the path. Worth tracing whether an offer maker expecting only sale fills could have their capacity consumed by a borrower on different terms.

- **Fee snapshot vs global fee divergence** — Listings snapshot `feeBps` at post time; offers use the current global `feeBps`. Worth confirming an admin cannot manipulate the global fee to extract value from offer fills (e.g., set to 0, let allies fill, restore).

- **Oracle rate at deposit boundary** &nbsp;&#91;[G-8](invariants.md#g-8)&#93; — When TWAP rate rounds to 1.0 (rate * ptAmount / WAD == ptAmount), `toStream` becomes 0 and the deposit reverts. Worth checking behavior at the maturity boundary as time-to-maturity approaches zero.

### Protocol-Type Concerns

**As a Yield Aggregator/Vault:**
- `OVRFLO.deposit:380-386` — `toUser = ptAmount * rate / WAD` (floored); `if (toUser > ptAmount) toUser = ptAmount` caps at par. Worth checking if rate > 1.0 is possible and whether the cap + `toStream > 0` guard creates a revert-only edge case.
- No ERC4626 share-price manipulation: ovrfloToken is minted 1:1 with PT deposited, not proportional to balance. Direct PT transfers to the vault are sweepable excess, not donations that inflate share price.
- `wrappedUnderlying` tracks wrap reserve separately from `balanceOf`; `sweepExcessUnderlying` only removes the delta. Worth confirming wrap/unwrap can't be griefed by direct transfers.

**As a Lending/Borrowing (no liquidations):**
- `StreamPricing.grossPrice` floors and `obligation` ceils — directional rounding is load-bearing for I-13 (obligation <= remaining). Worth verifying the rounding directions are correct for all APR/time combinations within bounds.
- No health factor, no liquidation mechanism — loan safety depends entirely on stream determinism (non-cancelable Sablier V2) and the obligation <= remaining invariant. If Sablier V2 behavior changes (immutable, so low risk), the lending model breaks.

### Temporal Risk Profile

**Deployment & Initialization:**
- Two-step deployment (`configureDeployment` → `deploy`) prevents parameter front-running. Series approval is one-shot (I-9); oracle cardinality must be prepared via `prepareOracle` before `addMarket`. Partially mitigated.

**Market Stress:**
- TWAP oracle (15-30 min window) provides manipulation resistance. Freshness not rechecked per deposit (X-1), but low practical risk: external Pendle traders/LPs write observations continuously, and a keeper bot via `prepareOracle()` is the fallback. Linear APR pricing for loans is market-stress-immune (no oracle at loan time). Partially mitigated.

### Composability & Dependency Risks

**Dependency Risk Map:**

> **Pendle Oracle (TWAP)** — via `OVRFLO.oracle.getPtToSyRate()`
> - Assumes: returns correct PT-to-SY rate in 1e18 scale within the TWAP window
> - Validates: TWAP duration bounds (15-30 min), oracle cardinality/observation readiness at `addMarket`
> - Mutability: Pendle-governed; potentially upgradeable by Pendle multisig
> - On failure: reverts (no fallback)

> **Sablier V2 Lockup Linear** — via `OVRFLO.sablierLL` and `OVRFLOBook.sablier`
> - Assumes: streams vest linearly, non-cancelable streams are truly non-cancelable, `withdrawableAmountOf` is accurate
> - Validates: stream sender == core vault, asset == ovrfloToken, end time == expiry, no cliff, non-cancelable
> - Mutability: immutable (V2 is not upgradeable; V4 rejected for this reason)
> - On failure: reverts

> **Pendle Market** — via `OVRFLOFactory.addMarket`
> - Assumes: `readTokens` returns correct SY/PT/YT, `expiry()` returns correct maturity
> - Validates: `IStandardizedYield(sy).yieldToken() == info.underlying`
> - Mutability: Pendle-governed
> - On failure: reverts

**Token Assumptions** *(out of scope — do not audit)*:
- Only standard 18-decimal exact-transfer ERC-20s will be used (no fee-on-transfer, no rebasing). The multisig validates canonical Pendle PTs at `addMarket()`. Token standard deviations are explicitly outside the threat model.

---

## 3. Invariants

> ### Full invariant map: **[invariants.md](invariants.md)**
>
> - **32 Enforced Guards** (`G-1` … `G-32`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **18 Single-Contract Invariants** (`I-1` … `I-18`) — Conservation, Bound, Ratio, StateMachine, Temporal
> - **4 Cross-Contract Invariants** (`X-1` … `X-4`) — caller/callee pairs that cross scope boundaries
> - **4 Economic Invariants** (`E-1` … `E-4`) — higher-order properties deriving from `I-N` + `X-N`
>
> Every inferred block cites a concrete Δ-pair, guard-lift + write-sites, state edge, temporal predicate, or NatSpec quote. The **On-chain=No** blocks (I-6, X-4) are the high-signal ones — each is simultaneously an invariant and a potential bug. Attack-surface bullets above cross-link directly into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` (39KB); comprehensive protocol description, flows, design notes, fee structure |
| NatSpec | ~578 annotations | Thorough across all 5 source files; per-function `@notice`/`@dev` with design rationale |
| Spec/Whitepaper | Present | README serves as spec (per spec); contains invariants, actor definitions, trust assumptions |
| Inline Comments | Adequate | Rounding directions documented in StreamPricing; security docs referenced for key decisions |

Spec-derived claims tagged `(per spec)` where applicable: obligation <= remaining (per spec), protocol solvency E-1 (per spec), no liquidations by design (per spec), ovrfloToken cross-series fungibility (per spec).

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 19 | File scan (13 in test/ + 6 in test/fork/) |
| Test functions | 296 | File scan |
| Line coverage | Unavailable | forge coverage timed out after 180s (twice); background run completed tests (67 passed, 0 failed) but did not produce coverage table |
| Branch coverage | Unavailable | Same as above |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | 13 | All (OVRFLO, OVRFLOBook, OVRFLOFactory, OVRFLOToken, StreamPricing, FlashLoan, WrapUnwrap) |
| Fork | 6 | Mainnet fork: vault, book, factory, flash loan, wrap/unwrap |
| Stateless Fuzz | present | OVRFLOFuzz (1000 runs) |
| Stateful Fuzz (Foundry) | 3 | OVRFLOBook invariant, OVRFLO invariant, wrap/unwrap invariant (500 runs, depth 25) |
| Attack Scenarios | 1 | Flash-loan griefing, wrap/claim/redeem loops |
| Math Stress | 1 | StreamPricing math (rounding, overflow, boundary) |
| Stateful Fuzz (Echidna) | 0 | none |
| Stateful Fuzz (Medusa) | 0 | none |
| Formal Verification (Certora) | 0 | none |
| Formal Verification (Halmos) | 0 | none |
| Formal Verification (HEVM) | 0 | none |

### Gaps

- No Echidna or Medusa stateful fuzzing for pool claim accounting and flash loan reentrancy paths — highest audit impact given the dual-channel claim complexity.
- No formal verification for StreamPricing math (obligation <= remaining, rounding directions) — math-heavy financial logic benefits most from formal methods.
- Coverage metrics unavailable (forge coverage timed out); test existence confirmed by file scan (19 files, 296 functions). Previous run reported 88.35% line coverage (100% for src/ files) but that predates the unified offer merge.
- Frontend tests (Vitest in `web/tests/`) exist but are out of scope for this contract audit.

---

## 6. Developer & Git History

> Repo shape: normal_dev — 84 source-touching commits over 319 days (2025-08-15 → 2026-06-30). Analyzed branch: `main` at `183e0ce`.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| jay | 171 | +4,643 | 100% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 1 | Single-dev dominance (jay: 100% of source lines) |
| Merge commits | low | Minimal formal review process |
| Repo age | 2025-08-15 → 2026-06-30 | 319 days |
| Recent source activity (30d) | 31 commits | Very active — late burst of pool features, unified offer merge, and fixes |
| Test co-change rate | 64.3% | Most source commits include test changes; 10% fix-without-test rate |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/OVRFLO.sol | 50 | Highest churn — vault core, renamed mid-project |
| src/OVRFLOBook.sol | 31 | Secondary market — all pool features and unified offer merge in last 30 days |
| src/OVRFLOFactory.sol | 22 | Admin hub, deployment, market approval |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 3a7b06a | 2026-06-27 | fix: code review fixes + doc updates | 18 | adds guards, tightens AC, 4 security domains |
| 860f72d | 2026-06-27 | feat: fix factory deployment/management gaps + make admin immutable | 17 | adds guards, tightens AC, fund_flows + oracle |
| e3514b3 | 2026-03-07 | Port recovered Solidity hardening and tests onto main | 17 | hardening, guards, token transfer + accounting |
| 342409f | 2026-04-18 | Fix tests, update front end | 16 | rewrites guards, loosens AC, 4 domains |
| 36103df | 2026-06-24 | Gate OVRFLOBook offers on active markets | 15 | adds 33 guards, tightens AC, 437 lines changed |
| 98bff9d | 2026-06-27 | feat: add PT flash loan facility | 14 | new feature, guards, AC, token transfer |
| 887f2b9 | 2026-06-29 | feat(U7): add poolClaimLoan and claimPoolShare | 14 | new feature, guards, fund_flows |
| f925744 | 2026-06-29 | feat(U5): add createBorrowPool | 14 | new feature, guards, fund_flows |
| a668f38 | 2026-06-23 | feat: add OVRFLO wrap unwrap | 14 | new feature, guards, AC, token transfer |
| aed261d | 2026-06-30 | refactor: merge sale and lend offers into unified offer type | — | 548 lines changed; major structural simplification |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 50 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, OVRFLOToken.sol |
| fund_flows | 50 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, StreamPricing.sol |
| oracle_price | 50 | OVRFLO.sol, OVRFLOBook.sol, OVRFLOFactory.sol, StreamPricing.sol |
| state_machines | 29 | OVRFLO.sol, OVRFLOFactory.sol |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule | 318 .sol files; not internalized |
| prb-math | lib/prb-math | — | Submodule | 9 .sol files; not internalized |

### Security Observations

- **Single-developer risk** — jay authored 100% of source lines; no peer review signals.
- **Late burst** — 31 source commits in 30 days, all OVRFLOBook pool features and unified offer merge; least testing history for newest code.
- **High-churn security areas** — 50 commits each across access_control, fund_flows, oracle_price.
- **Fix without tests** — 10% fix-without-test rate; 5 late commits without test changes.
- **Critical late fix** — `ca8e248` added pro-rata cap on `claimPoolShare` to prevent draining `poolProceeds` — validates I-15/E-4.
- **Major refactor** — `aed261d` merged sale/lend offers into unified type (548 lines changed, nSLOC -17%); simplifies attack surface but all in last 30 days.
- **No TODO/FIXME** — 0 technical debt markers in the codebase.
- **No internalized libs** — all dependencies are standard submodules; no hidden attack surface from adapted code.

### Cross-Reference Synthesis

- **OVRFLOBook.sol is #1 in BOTH churn AND attack-surface priority** — all top attack surfaces route through it → highest-leverage review: poolClaimLoan, claimPoolShare, createBorrowPool, closeLoan.
- **31 late commits correlate with the newest attack surfaces** — pool claim dual-channel accounting and unified offer consumption have the least testing history.
- **setMarketDepositLimit gap (I-6, X-4) aligns with 50 access_control commits** — admin power churn increases risk of missing invariant checks on setters.
- **Unified offer merge (aed261d) simplifies but reshapes the surface** — removed createLenderPool double-validation and borrow listings; new risk is offer consumption ambiguity (sale vs loan path).

---

## X-Ray Verdict

**HARDENED** — Comprehensive test suite (unit + fuzz + invariant, 19 files, 296 functions) with thorough NatSpec and spec documentation, but single-developer codebase with a late burst of complex pool features and a major structural refactor that have minimal testing history.

**Tier calculation:**
- Tests: HARDENED (unit + fuzz + invariant, 19 files, 296 functions; coverage unavailable but test existence confirmed)
- Docs: HARDENED (578 NatSpec annotations + comprehensive README/spec)
- Access Control: HARDENED (timelocked multisig + 2-step ownership + flash loan pause)
- Code Hygiene: 0 TODOs → no tier drop

**Structural facts:**
1. 1,162 nSLOC across 5 contracts in 3 subsystems (vault, secondary market, pricing library)
2. 19 test files with 296 test functions; coverage metrics unavailable (forge coverage timed out); previous run reported 88.35% line coverage on source files
3. Single developer (jay) authored 100% of source lines over 319 days; 31 late commits in 30 days
4. No upgradeable contracts — all admin relationships are immutable (factory, oracle, sablier, underlying, ovrfloToken)
5. 0 TODO/FIXME markers in the codebase; unified offer merge (aed261d) reduced nSLOC by 17% (1,398 → 1,162)
