# X-Ray Report

> OVRFLO | ~1100 nSLOC | 2841665 (`main`) | Foundry | 18/07/26

---

## 1. Protocol Overview

**What it does:** A Pendle Principal-Token wrapper vault that splits a PT deposit into immediate ovrfloToken (at TWAP value) plus a Sablier stream (the discount), with a secondary lending market for selling or self-repaying-borrowing against those streams.

- **Users**: PT depositors capture the fixed discount as extractable yield; lenders supply underlying to buy/lend against streams; borrowers pledge streams for self-repaying loans.
- **Core flow**: deposit PT -> receive ovrfloToken + Sablier stream -> sell/lend stream on OVRFLOLending -> exit ovrfloToken via unwrap or claim.
- **Key mechanism**: Linear APR discount to series maturity (`f = 1 + apr*ttm/(YEAR*BPS)`); `grossPrice` floors, `obligation` ceils (load-bearing directional rounding).
- **Token model**: ovrfloToken (ERC20, 18-dec, 1:1 with underlying, mint/burn by vault only); fungible across deposit and wrap origins and across market series for the same underlying.
- **Admin model**: Safe multisig with on-chain timelock -> OVRFLOFactory (Ownable2Step, 2-step ownership) -> OVRFLO vaults (onlyAdmin) and OVRFLOLending markets (onlyOwner). All operational setters are gated by the on-chain timelock.

For a visual overview, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Admin hub | OVRFLOFactory | ~200 | Deploys vaults/tokens/lendings; immutable admin; forwards multisig calls |
| Vault core | OVRFLO, OVRFLOToken | ~375 | PT wrapper vault + its 1:1 receipt token |
| Pricing lib | StreamPricing | ~130 | Pure linear-APR discount/obligation/eligibility math + registry interfaces |
| Secondary market | OVRFLOLending | ~500 | Stream sales + self-repaying loans via borrower loan pools with pro-rata claims |

### How It Fits Together

The core trick: a PT deposit is split at TWAP value so the principal leg (ovrfloToken) is liquid immediately and the yield leg (Sablier stream) is tradeable separately, letting the depositor exit both legs before maturity.

### Deposit -> stream -> exit

```
User.deposit(market, ptAmount, minToUser)
├─ OVRFLO._approvedRate(market)  ◄── reads IPendleOracle.getPtToSyRate after freshness check
├─ _computeSplit(ptAmount, rate)  ◄── toUser capped at face, toStream = remainder (reverts if 0)
├─ StreamPricing.fee(toUser, feeBps)  ◄── underlying pulled to TREASURY_ADDR
├─ OVRFLOToken.mint(user, toUser) + OVRFLOToken.mint(vault, toStream)
└─ ISablierV2LockupLinear.createWithDurations(...)  ◄── non-cancelable, cliff 0, endTime = expiry
```

### Wrap / unwrap (permissionless, 1:1, no stream)

```
User.wrap(amount)
├─ wrappedUnderlying += amount  ◄── reserve tracked separately from raw balance
├─ IERC20(underlying).safeTransferFrom  ◄── strict balance-delta check
└─ OVRFLOToken.mint(user, amount)

User.unwrap(amount)
├─ require(wrappedUnderlying >= amount)
├─ wrappedUnderlying -= amount; OVRFLOToken.burn(user, amount)
└─ IERC20(underlying).safeTransfer(user, amount)
```

### Self-repaying loan pool

```
Borrower.createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, minAcceptable)
├─ _validateLiquidity(...)  ◄── strictly-increasing IDs, same market/apr, no self-match
├─ _priceStream(...)  ◄── StreamPricing.requireEligible + grossPrice
├─ StreamPricing.obligationForFill(actualBorrow, grossPrice, remaining, apr, ttm)
├─ _storeLoan(borrower, streamId, obligation) + loanPools[loanId] = {...}  ◄── single ID space
├─ _consumeLiquidity(...)  ◄── per-lender loanPoolContributions recorded
├─ sablier.transferFrom(borrower, this, streamId)  ◄── escrow
└─ _payUnderlying(borrower, net) + _payUnderlying(treasury, fee)
```

### Lender pro-rata claim (open or closed loan)

```
Lender.claimLoanPoolShare(loanId, amount)
└─ _claimFair(loanId, account, amount)
   ├─ recovered = drawn + repaid + (open? min(withdrawable, outstanding) : 0)
   ├─ claimable = contribution * recovered / totalContributed - loanPoolReceived
   ├─ if open && proceeds < request: harvest deficit from stream (capped at min(withdrawable, outstanding))
   ├─ loanPoolReceived += payAmount; loanPoolProceeds -= payAmount
   └─ IERC20(ovrfloToken).safeTransfer(account, payAmount)
```

### Flash loan (PT, atomic, pre-maturity)

```
Borrower.flashLoan(ptToken, amount, data)
├─ require(amount <= marketTotalDeposited[market])  ◄── cap
├─ fee = StreamPricing.fee(amount * rate / WAD, flashFeeBps)
├─ IERC20(pt).safeTransfer(borrower, amount)  ◄── send before callback
├─ IFlashBorrower.onFlashLoan(...)  ◄── must return FLASH_CALLBACK_SUCCESS hash
├─ IERC20(pt).safeTransferFrom(borrower, this, amount)  ◄── pullback
└─ IERC20(underlying).safeTransferFrom(borrower, TREASURY, fee)
```

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Yield Aggregator / Vault** with **Lending / Borrowing** characteristics

Vault pattern (PT deposit -> receipt token + streaming discount) is primary; the secondary market adds self-repaying stream-backed loans with pro-rata pool claims. Adversary list merges vault share-inflation concerns (donation/transfer attacks) with lending oracle-manipulation and pro-rata-accounting concerns.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Timelocked Multisig (Safe) | Trusted (on-chain timelock) | Owns factory via Ownable2Step. 14 setters all gated by on-chain timelock via Safe: deploy, addMarket, setLendingFee (up to 100% as emergency circuit breaker), setLendingTreasury, sweepExcess*, pauseFlash, setDepositLimit (low limit as deposit pause). |
| OVRFLOFactory | Bounded (Ownable2Step, no independent action) | Immutable admin on every vault; owner of every lending. Forwards multisig calls; cannot act independently. |
| OVRFLO Vault | Bounded (onlyAdmin = factory) | Holds PT + underlying; mints/burns ovrfloToken; creates Sablier streams; PT flash loan. |
| OVRFLOLending | Bounded (onlyOwner = factory) | Holds escrowed streams + liquidity; settles loans; pro-rata claims. |
| User / Depositor | Untrusted | Permissionless deposit, wrap, unwrap, claim, flashLoan. |
| Lender | Untrusted | Permissionless supplyLiquidity, sellStreamToLiquidity, postSaleListing, buyListing. Role-gated withdrawLiquidity, claimLoanPoolShare (by ownership/contribution). |
| Borrower | Untrusted | Permissionless createBorrowerLoanPool, closeLoan. Role-gated repayLoan (by loan.borrower). |
| Sablier V2 / Pendle | Trusted external (immutable) | Stream escrow, PT TWAP oracle, market/SY metadata. All immutable per project stance. |

**Adversary Ranking** (ordered by threat level for this protocol type):

1. **Flash loan attacker** — can borrow PT or underlying in one tx to manipulate the TWAP rate read by `deposit`/`flashLoan` or to move pool prices the oracle observes.
2. **Donation / direct-transfer attacker** — sends underlying or PT directly to the vault to inflate `totalAssets`-style accounting; the wrap reserve and deposit accounting use separate tracked counters, but the combined solvency invariant is what actually holds.
3. **Pro-rata accounting exploiter** — targets `_claimFair`'s `recovered`/`claimable`/`harvest` arithmetic to claim more than their share or strand minority contributors.
4. **Stream re-pledge attacker** — a returned stream (post-close or post-repay) can be re-pledged to a new loan; the stream's cumulative `withdrawn` spans all loans that used it.
5. **Compromised multisig** — all 14 factory setters are gated by the on-chain timelock; users have the delay window to react. `setLendingFee(100%)` serves as an emergency circuit breaker (blocks new lending without a separate pause flag); `setMarketDepositLimit(low)` does the same for deposits.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig -> Factory** — on-chain timelock via Safe; Ownable2Step gives additional 2-step transfer protection. All operational setters (deploy, addMarket, setLendingFee, sweepExcess*, setLendingTreasury) are timelocked, giving users a delay window to react. `setLendingFee(10000)` is the emergency circuit breaker for lending (100% fee blocks new interactions without a separate pause flag); `setMarketDepositLimit(low)` is the equivalent for deposits. Sale listings are protected by per-post fee snapshots. `OVRFLOFactory.sol:298`.
- **Factory -> Vault** — `onlyAdmin` (immutable `factory`); vault trusts exactly one admin address set at construction. Worst instant action: `sweepExcessPt`/`sweepExcessUnderlying` move excess tokens to a multisig-chosen `to` (zero-address validation intentionally omitted, `OVRFLO.sol:279,296`). *Git signal: 51 access_control commits, 10 fix-scored -> elevated risk.*
- **Factory -> Lending** — `onlyOwner`; lending trusts factory as owner. Worst instant action: `setTreasury`/`setFee`/`setAprBounds`. `OVRFLOLending.sol:263,278,288`.
- **User -> Vault (permissionless)** — no trust; strict balance-delta checks on `wrap` and `_pullExact` catch fee-on-transfer / short transfers. `OVRFLO.sol:320`, `OVRFLOLending.sol:809`.
- **Lending -> Sablier** — assumes `getStream`/`withdrawableAmountOf`/`withdraw`/`transferFrom` are accurate and that the contract holds the NFT when drawing. Sablier V2 is immutable. `OVRFLOLending.sol:455,485,599,627`.
- **Lending -> Core (via StreamPricing)** — reads `series(market)` to derive approval (`ptToken != address(0)`) and expiry. Series config is a one-shot latch (never reset). `StreamPricing.sol:178`.

### Key Attack Surfaces

- **Combined solvency under cross-exit fungibility** &nbsp;&#91;[E-1](invariants.md#e-1), [I-2](invariants.md#i-2)&#93; — `OVRFLO` allows a wrapper to claim PT while a depositor unwraps underlying post-maturity; the individual checks `wrappedUnderlying <= balance` and `marketTotalDeposited <= PT balance` can each break, but the combined `totalSupply <= underlying + PT` must hold. Worth tracing every mint/burn/sweep path to confirm no single action violates the combined invariant.

- **`_claimFair` pro-rata accounting** &nbsp;&#91;[I-5](invariants.md#i-5), [I-6](invariants.md#i-6)&#93; — `OVRFLOLending.sol:592-638` computes `recovered = drawn + repaid + min(withdrawable, outstanding)` for open loans, then `claimable = contribution * recovered / totalContributed - received`, harvests a deficit capped at `min(withdrawable, outstanding)`, and pays `min(request, proceeds)`. 54 fund_flows commits in git history. Worth confirming `recovered` is monotonic across harvest/repay/close and that floor division cannot strand a majority contributor.

- **Stream re-pledge across loans** &nbsp;&#91;[I-7](invariants.md#i-7)&#93; — `closeLoan` and `repayLoan` (on close) return the stream to the borrower via `sablier.transferFrom(this, borrower, streamId)`; the same stream can be re-pledged to a new loan. `getWithdrawnAmount` is cumulative across all loans that used the stream. Worth checking that `requireEligible`'s `remaining = deposited - withdrawn` correctly reflects prior draws from older closed loans.

- **Oracle TWAP rate read in deposit / flashLoan** &nbsp;&#91;[G-15](invariants.md#g-15), [X-4](invariants.md#x-4)&#93; — `OVRFLO._freshRate` reads `IPendleOracle.getPtToSyRate(market, twapDuration)` after `getOracleState` freshness; TWAP window is 15-30 min (`OVRFLOFactory._validateTwapBounds`). Worth confirming the window is long enough to resist single-block flash-loan manipulation for the PT/SY pair.

- **Fee ceiling as emergency brake** &nbsp;&#91;[I-9](invariants.md#i-9)&#93; — `OVRFLOLending.MAX_FEE_BPS = 10_000` (100%) is intentionally permissive: `setLendingFee(10000)` acts as a circuit breaker that blocks new lending interactions without adding a separate pause flag to every function. Sale listings are protected by per-post fee snapshots. The same pattern applies to `setMarketDepositLimit` in OVRFLO (setting a low limit effectively pauses deposits). Both are gated by the on-chain timelock.

- **Vault setter lacks bound validation (factory-gated)** &nbsp;&#91;[X-1](invariants.md#x-1), [X-2](invariants.md#x-2), [X-3](invariants.md#x-3)&#93; — `OVRFLO.setSeriesApproved` does not validate `feeBps <= 100`, `twapDuration ∈ [15min, 30min]`, or `expiry > now`. These bounds are enforced only in `OVRFLOFactory.addMarket`. Since `setSeriesApproved` is `onlyAdmin` (= factory) and the factory always checks, the bounds hold, but the vault setter itself is unguarded. Worth confirming no path reaches `setSeriesApproved` without the factory checks.

- **Permissionless `closeLoan` draw path** &nbsp;&#91;[G-22](invariants.md#g-22), [I-8](invariants.md#i-8)&#93; — `OVRFLOLending.closeLoan` is callable by anyone; requires `withdrawable >= outstanding`, draws exactly `outstanding` to `address(this)`, credits `loanPoolProceeds`, returns stream to borrower. Worth tracing that `withdrawable` (Sablier linear accrual) can never exceed `deposited - withdrawn` and that `outstanding` never underflows.

### Upgrade Architecture Concerns

No proxy patterns. All contracts are immutable once deployed. `OVRFLOFactory` is the only upgrade-like vector (it can deploy new vaults/lendings but cannot modify existing ones). No storage gaps, no `initialize()`, no UUPS/transparent/beacon.

### Protocol-Type Concerns

**As a Yield Aggregator / Vault:**
- `ovrfloToken` is 1:1 (not share-based), so the classic ERC4626 share-inflation attack does not apply; there is no `convertToShares`/`totalAssets` ratio to manipulate. Donation inflation is blocked by the separate `wrappedUnderlying` tracker (direct transfers don't increase the reserve).
- `_computeSplit` reverts if `toStream == 0` (`OVRFLO.sol:355`), so par-rate deposits (rate == 1e18) reverts rather than minting with zero stream. Worth confirming this is intended.

**As a Lending / Borrowing (secondary):**
- Self-repaying loans have no liquidations, no health factor; the stream is non-cancelable and pays a fixed asset on a fixed schedule, so the lender draws accrued value until `obligation` is met. The `obligation <= remaining` invariant (from `grossPrice` floor + `obligation` ceil + full-borrow fast path) is what makes this safe.
- `StreamPricing.obligation` uses `Math.mulDiv(..., Rounding.Up)` (ceil) and `grossPrice` uses `PRBMath.mulDiv` (floor); the directional rounding is documented as load-bearing (`StreamPricing.sol:24-30`).

### Temporal Risk Profile

**Deployment & Initialization:**
- `configureDeployment -> deploy -> deployLending -> addMarket` is the prerequisite chain; `deploy` transfers `OVRFLOToken` ownership to the vault in the same tx. Empty-state: first `wrap` sets `wrappedUnderlying`; first `deposit` creates the first stream. No first-depositor share inflation (1:1 token).

**Market Stress:**
- Sablier stream accrual is linear/deterministic, so there is no stream-side oracle latency under volatility. The PT TWAP oracle (`IPendleOracle`) has a 15-30 min window; under rapid market moves the rate can be stale for the window duration. Worth checking the window against the PT's volatility.
- wstETH/ETH correlation is assumed stable; AGENTS.md documents the choice of wstETH (not stETH) to avoid a 22%+ exit-path value mismatch.

### Composability & Dependency Risks

**Dependency Risk Map:**

> **Sablier V2 Lockup Linear** — via `OVRFLO.sablierLL`, `OVRFLOLending.sablier`
> - Assumes: stream state (`getStream`, `withdrawableAmountOf`) is accurate; `transferFrom` enforces ownership; `withdraw` pays out.
> - Validates: `requireEligible` checks sender/asset/endTime/cliff/cancelable/deposited-withdrawn.
> - Mutability: Immutable (project stance: V2 over V4 for smaller attack surface).
> - On failure: reverts (no fail-open).

> **Pendle Oracle** — via `OVRFLO._freshRate`, `OVRFLOFactory.addMarket`
> - Assumes: `getPtToSyRate` returns a fair TWAP within the window; `getOracleState` correctly reports cardinality/freshness.
> - Validates: `_requireOracleFresh` checks `oldestObservationSatisfied`; factory checks `!increaseCardinalityRequired` at addMarket.
> - Mutability: Pendle-governed; oracle address is a factory immutable.
> - On failure: reverts ("oracle not ready").

> **Pendle Market / SY** — via `OVRFLOFactory.addMarket`
> - Assumes: `readTokens()` returns the correct SY/PT/YT pair; `expiry()` is the PT maturity; `IStandardizedYield(sy).yieldToken()` matches the vault underlying.
> - Validates: `yieldToken == info.underlying` at addMarket; `expiry > block.timestamp`.
> - Mutability: Pendle markets are immutable post-creation.
> - On failure: reverts ("underlying mismatch" / "market expired").

**Token Assumptions** *(unvalidated only)*:
- wstETH: assumes standard ERC20 (no fee-on-transfer, no rebasing at the token level). `wrap`'s strict balance-delta check (`OVRFLO.sol:320`) catches any deviation. 18 decimals assumed.
- PT tokens: assume 18 decimals (enforced via `MIN_PT_AMOUNT = 1e6` and documented invariant). Standard ERC20.

**Shared State Exposure:**
- The Pendle market TWAP pool is shared with other Pendle users; a large OVRFLO flash-loan-driven swap could move the observed TWAP. The 15-30 min window is the mitigation.

---

## 3. Invariants

> ### Full invariant map: **[invariants.md](invariants.md)**
>
> - **26 Enforced Guards** (`G-1` ... `G-26`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **9 Single-Contract Invariants** (`I-1` ... `I-9`) — Conservation, Bound, StateMachine, Temporal
> - **4 Cross-Contract Invariants** (`X-1` ... `X-4`) — caller/callee pairs across scope boundaries
> - **2 Economic Invariants** (`E-1` ... `E-2`) — higher-order properties deriving from `I-N` + `X-N`
>
> The **On-chain=No** blocks are the high-signal ones (X-1/X-2/X-3 vault setter gaps, I-2 combined solvency). Attack-surface bullets above cross-link directly into the relevant blocks.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` (user-facing); `CONCEPTS.md` is the domain glossary |
| NatSpec | ~180 annotations | Thorough on public/external; `@dev` explains load-bearing rounding and design choices |
| Spec/Whitepaper | Present | `CONCEPTS.md`, `DESIGN.md` (design system), `AGENTS.md` (workspace facts); `docs/solutions/` holds writeups |
| Inline Comments | Thorough | `forge-lint` directives on unsafe casts; `@dev` on directional rounding, CEI, single-ID-space |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 13+ (unit, fuzz, invariant, attack, fork, fizz harness) | File scan |
| Test functions | 364 | `forge test` (all pass) |
| Line coverage (src/) | 100.00% (559/559) | `forge coverage` |
| Branch coverage (src/) | 99.07% (107/108) | `forge coverage` |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~250 | OVRFLO, OVRFLOFactory, OVRFLOLending, OVRFLOToken, StreamPricing, WrapUnwrap, FlashLoan |
| Stateless Fuzz | 1000 runs | StreamPricing.math, OVRFLOFuzz |
| Stateful Fuzz (Foundry) | 500 runs, depth 40 | OVRFLOInvariant, OVRFLOLendingInvariant, OVRFLOWrapUnwrap.invariant |
| Stateful Fuzz (Echidna) | 57 properties, 1 config | test/fizz/Properties.sol + handlers |
| Stateful Fuzz (Medusa) | 1 config | echidna.yaml shared |
| Attack Scenarios | AE4/AE5/R17-R19 | OVRFLOAttackScenarios.t.sol |
| Fork | 6 files | Real Pendle markets + Sablier V2 (skips without MAINNET_RPC_URL) |
| Formal Verification (Certora) | 0 | none |
| Formal Verification (Halmos) | 0 | none |
| Formal Verification (HEVM) | 0 | none |

### Gaps

- No formal verification (Certora/Halmos/HEVM) for the load-bearing `StreamPricing` rounding math or the `_claimFair` pro-rata formula. These are the highest-audit-impact gaps given the directional-rounding and pro-rata-fairness invariants.
- Echidna/Medusa harness has coverage gaps documented in prior review (maturity never crossed organically, `feeBps` stays 0, `withdrawable == outstanding` always); the stateful fuzz surface is narrower than the property count suggests.

---

## 6. Developer & Git History

> Repo shape: normal_dev — 251 commits over 337 days, 118 touching source. Active single-developer project with a recent 30-day burst of refactoring (U1-U8 simplification commits on 2026-07-17).

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| jay | 244 | +5039 | 100% |
| Perplexity Computer | 4 | — | — |
| ayeslick | 3 | — | — |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 3 | Single-dev (jay = 100% of source lines) |
| Merge commits | 9 of 251 (3.6%) | Minimal formal review process |
| Repo age | 2025-08-15 -> 2026-07-18 | 337 days |
| Recent source activity (30d) | 65 commits | Active; late burst of refactoring before audit |
| Test co-change rate | 70.3% | 70% of source commits also touch tests (co-modification, not coverage) |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/OVRFLOBook.sol (historical) | 35 | Renamed to OVRFLOLending; high churn lineage |
| src/OVRFLO.sol | 34 | Vault core; frequent access_control/fund_flows churn |
| src/OVRFLOFactory.sol | 27 | Admin hub |
| src/StreamPricing.sol | 13 | Pricing lib (U5/U6/U7 rewrites in last week) |
| src/OVRFLOLending.sol | 9 | Secondary market (current name; was OVRFLOBook) |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 92d5c41 | 2026-07-01 | fix: add sweepExcessPt input guard | 21 | +30 guards, access_control + fund_flows + oracle + state_machines |
| 024753b | 2026-07-13 | test: stateful fuzz suite, GL-70 stream-reuse fix | 20 | bug fix, removes guards, fund_flows + oracle |
| 3a7b06a | 2026-06-27 | fix: code review fixes + doc updates | 18 | +16 guards, 4 security domains |
| 1b9086a | 2026-07-15 | test: fix 18 test quality findings | 17 | +3 guards, 4 domains |
| 860f72d | 2026-06-27 | feat: fix factory deployment gaps + make admin immutable | 17 | +28 access control, 4 domains |
| e3514b3 | 2026-03-07 | Port recovered Solidity hardening | 17 | hardening, +6 guards |
| bdd752b | 2026-07-03 | fix(M-03): add oracle freshness check in deposit and flashLoan | 15 | oracle/pricing, +1 guard |
| df0ceea | 2026-07-15 | fix: SP-99 tautology, gatherLiquidity API, dead ghosts | 14 | accounting, +1 guard |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| fund_flows | 54 | OVRFLO.sol, OVRFLOFactory.sol, OVRFLOLending.sol, StreamPricing.sol |
| oracle_price | 54 | OVRFLO.sol, OVRFLOFactory.sol, OVRFLOLending.sol, StreamPricing.sol |
| access_control | 51 | OVRFLO.sol, OVRFLOFactory.sol, OVRFLOLending.sol, OVRFLOToken.sol |
| state_machines | 45 | OVRFLO.sol, OVRFLOFactory.sol |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule | Pragma ranges differ from upstream notes (cosmetic) |
| prb-math | lib/prb-math | — | Submodule | `>=0.8.4` |

### Security Observations

- **Single-developer dominance** — jay = 100% of source lines; no on-chain peer review signal beyond merge commits (3.6%).
- **30-day late burst** — 65 source commits in the last 30 days, including 8 U1-U8 refactors on 2026-07-17 immediately before this audit; high churn on fund_flows/oracle/access_control.
- **Fix commits without test changes** — 10% fix-without-test rate; the GL-70 stream-reuse fix (024753b) shipped tests, but cosmetic refactors (U2/U3/U8) did not.
- **High-churn hotspots** — OVRFLO.sol (34 mods) and OVRFLOFactory.sol (27 mods) are the most-modified security-critical files.
- **No technical debt markers** — 0 TODO/FIXME/HACK comments in src/.
- **All deps are standard submodules** — no internalized/forked libraries with divergent logic.

### Cross-Reference Synthesis

- **`_claimFair` is #1 in BOTH churn AND attack-surface priority** — 54 fund_flows commits + the pro-rata accounting surface routes through it -> highest-leverage review: `recovered` monotonicity, harvest cap, floor-division stranding.
- **Vault setter bound gaps (X-1/X-2/X-3) align with 51 access_control commits** — the factory enforces fee/twap/expiry bounds but the vault setter does not; every `addMarket` change touched both files, so the gap is a design choice, not an oversight, but worth confirming no second caller path exists.
- **`StreamPricing` U5/U6/U7 rewrites (2026-07-17) replaced hand-rolled ceil with `Math.mulDiv(Rounding.Up)`** — the directional rounding invariant (I-1) was re-implemented 1 day before this audit; worth re-confirming the ceil path is still pinned by tests.

---

## X-Ray Verdict

**HARDENED** — 100% src/ line coverage, unit + stateless fuzz + 3 Foundry invariant suites + 57-property Echidna harness + fork tests + attack scenarios; thorough NatSpec with load-bearing-rounding documentation; clear access-control boundaries via an immutable factory admin with on-chain timelock on all operational setters. Dropped from FORTIFIED by: no formal verification of the directional-rounding or pro-rata-fairness math.

**Structural facts:**
1. ~1100 nSLOC across 4 subsystems (admin hub, vault core, pricing lib, secondary market); 5 source files, all immutable post-deploy (no proxies).
2. 100% line coverage on src/ (559/559); 99.07% branch coverage; 364 passing tests across unit/fuzz/invariant/attack/fork.
3. Single developer (jay) authored 100% of source lines; 65 source commits in the last 30 days including 8 same-day refactors immediately before audit.
4. 4 cross-contract bound gaps where the vault setter (`setSeriesApproved`) relies on the factory to enforce fee/twap/expiry bounds rather than validating them itself.
5. 2 load-bearing directional-rounding functions (`grossPrice` floor, `obligation` ceil) with no formal verification; the ceil was re-implemented via `Math.mulDiv(Rounding.Up)` 1 day before audit.
