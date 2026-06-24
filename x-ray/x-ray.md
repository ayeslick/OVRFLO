# X-Ray Report

> OVRFLO | 1161 nSLOC | 8c603d8 (`main`) | foundry | 23/06/26

---

## 1. Protocol Overview

**What it does:** OVRFLO wraps Pendle PT positions into immediate ERC20 liquidity plus streamed residual value, with an integrated secondary stream-trading and lending book.

- **Users**: PT holders seeking immediate liquidity; stream buyers; lenders/borrowers financing stream cash flows
- **Core flow**: deposit PT, mint immediate `ovrfloToken`, stream residual via Sablier, later claim PT 1:1 after maturity
- **Key mechanism**: Pendle TWAP-derived split (`toUser` / `toStream`) + Sablier NFT stream escrow for secondary market
- **Token model**: one `OVRFLOToken` per underlying (shared across approved maturities), PT custody per market
- **Admin model**: timelocked multisig owns `OVRFLOFactory`; factory is admin for each deployed `OVRFLO`

For a visual overview of the protocol's architecture, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Core Vault | OVRFLO, OVRFLOToken | 279 | PT deposit/claim, wrap/unwrap reserve accounting, token mint/burn |
| Factory / Admin Hub | OVRFLOFactory | 161 | deployment, market onboarding, admin forwarding, registry |
| Secondary Market & Pricing | OVRFLOBook, StreamPricing | 721 | stream sale/lending orderbook, eligibility checks, loan servicing |

### How It Fits Together

The core trick: PT discount is split into immediate fungible liquidity and a transferable streamed claim, then that stream claim becomes tradeable/borrowable in a separate orderbook.

### PT Deposit to Streamed Residual

```text
User
└─ OVRFLO.deposit(market, ptAmount, minToUser)
   ├─ IERC20(PT).safeTransferFrom(user -> OVRFLO)
   ├─ PendleOracle.getPtToSyRate()
   ├─ OVRFLOToken.mint(user, toUser)
   ├─ OVRFLOToken.mint(OVRFLO, toStream)
   └─ Sablier.createWithDurations(recipient=user, amount=toStream)
      *State change: marketTotalDeposited increases*
```

### Maturity Redemption

```text
User
└─ OVRFLO.claim(ptToken, amount)
   ├─ OVRFLOToken.burn(user, amount)
   └─ IERC20(PT).safeTransfer(OVRFLO -> user, amount)
      *State change: marketTotalDeposited decreases*
```

### Stream Sale Path

```text
Seller
└─ OVRFLOBook.listStream(market, streamId, apr)
   ├─ StreamPricing.requireEligible(factory, sablier, core, market, streamId)
   └─ Sablier.transferFrom(seller -> OVRFLOBook, streamId)

Buyer
└─ OVRFLOBook.takeListing(listingId, maxPriceIn)
   ├─ StreamPricing.grossPrice()/fee()
   ├─ IERC20(underlying).safeTransferFrom(buyer -> OVRFLOBook)
   ├─ IERC20(underlying).safeTransfer(OVRFLOBook -> seller/treasury)
   └─ Sablier.transferFrom(OVRFLOBook -> buyer, streamId)
```

### Stream-Backed Loan Path

```text
Borrower
└─ OVRFLOBook.borrowAgainstOffer(offerId, streamId, borrowAmount, minNetOut)
   ├─ StreamPricing.requireEligible(...)
   ├─ StreamPricing.obligationForFill(...)
   ├─ _storeLoan(...)
   ├─ Sablier.transferFrom(borrower -> OVRFLOBook, streamId)
   └─ IERC20(underlying).safeTransfer(OVRFLOBook -> borrower/treasury)

Servicing
└─ claimLoan() / repayLoan() / closeLoan()
   *State changes: loan.drawn, loan.repaid, loan.closed*
```

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Yield Aggregator** with **Lending/Borrowing** characteristics

The core vault path is a share/value conversion mechanism over PT inventory, while `OVRFLOBook` introduces stream-collateralized financing and orderbook settlement mechanics. Threat priority follows oracle/value-conversion correctness plus secondary-market settlement/loan-state integrity.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Timelocked multisig (factory owner) | Trusted | Owns `OVRFLOFactory`; can deploy vaults, onboard markets, set limits, sweep excess, and route all `OVRFLO` admin actions |
| OVRFLOFactory | Trusted (execution layer) | Executes owner-approved admin operations; sets series metadata and market approval mappings |
| OVRFLOBook owner | Bounded (config-only) | Instant setters for APR bounds, fee bps, treasury; no pause mechanism in scope |
| End users / traders | Untrusted | Permissionless wrap/unwrap/deposit/claim and stream trading/lending flows |
| Pendle market + oracle | Bounded external | Supplies PT/SY market data and oracle rates used in pricing and onboarding checks |
| Sablier V2 LL | Bounded external | Holds/streams NFT positions and defines withdrawable amounts used by loan servicing |

**Adversary Ranking** (ordered by threat level for this protocol type, adjusted by git evidence):

1. **Oracle manipulator** — pricing split and stream financing both rely on market-rate-derived calculations where stale/misaligned inputs propagate directly into settlement.
2. **Sophisticated stream trader/MEV actor** — can exploit boundary conditions in listing/offer execution, slippage assumptions, and timing-sensitive maturity windows.
3. **Compromised admin key-holder** — controls market onboarding and critical configuration with direct operational authority.
4. **External dependency behavior drift** — Sablier/Pendle operational changes can alter assumptions of eligibility and servicing paths.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig/Factory boundary** — owner-gated factory calls are the sole admin ingress for vault configuration (`src/OVRFLOFactory.sol`); compromise enables immediate operational changes.
- **Factory/Vault registry boundary** — `ovrfloInfo` + market approvals define canonical asset/market routing (`src/OVRFLOFactory.sol` + `src/OVRFLO.sol`); incorrect writes propagate to deposit/wrap paths.
- **Book/Stream boundary** — `StreamPricing.requireEligible()` gates all stream-collateral operations (`src/StreamPricing.sol`); correctness depends on both local checks and external stream state.
- **Oracle/valuation boundary** — deposit split and financing obligations derive from oracle/time functions (`src/OVRFLO.sol`, `src/StreamPricing.sol`) rather than immutable constants.

### Key Attack Surfaces

- **Oracle-driven immediate mint split** &nbsp;&#91;[X-2](invariants.md#x-2)&#93; — `OVRFLO.deposit()` consumes `getPtToSyRate()` before minting user vs stream balances; worth checking rate freshness/quality assumptions under volatile markets.

- **APR-policy drift on active orders** &nbsp;&#91;[I-7](invariants.md#i-7)&#93; — APR is enforced at order creation but `setAprBounds()` can move policy after orders are active; worth checking operational expectations vs persisted order state.

- **Permissionless loan close path using external withdrawability** &nbsp;&#91;[I-8](invariants.md#i-8), [X-5](invariants.md#x-5)&#93; — `closeLoan()` is open to any caller once `withdrawable >= outstanding`; worth tracing edge behavior when Sablier withdrawability changes near maturity.

- **Wrap reserve accounting under direct token transfers** &nbsp;&#91;[I-3](invariants.md#i-3), [X-3](invariants.md#x-3)&#93; — reserve is tracked in `wrappedUnderlying` while raw balances can include donations; worth confirming all reserve-sensitive paths only trust tracked reserve.

- **Cross-contract stream eligibility enforcement** &nbsp;&#91;[X-1](invariants.md#x-1)&#93; — all book trade/loan paths hinge on `requireEligible()` checks across registry + Sablier metadata; worth checking any path that can bypass or stale-cache this gate.

- **Admin operational authority concentration** — factory owner can onboard markets, set limits, and sweep excess via immediate calls; worth checking blast radius assumptions for key compromise scenarios.

### Protocol-Type Concerns

**As a Yield Aggregator:**
- `OVRFLO.deposit()` clamps `toUser <= ptAmount` (`src/OVRFLO.sol`) but does not independently revalidate oracle freshness at call time; worth checking valuation robustness across high-volatility intervals.
- Shared `ovrfloToken` across maturities is intentional (`README.md`, per spec); worth checking all per-market accounting remains isolated despite fungible wrapper supply.

**As a Lending/Borrowing system:**
- Loan servicing derives from `drawn + repaid` vs `obligation` (`src/OVRFLOBook.sol`); worth checking every servicing path preserves monotonic outstanding reduction.
- Secondary-market obligations are time-sensitive (`StreamPricing.factor/grossPrice/obligationForFill`); worth checking rounding and maturity-edge transitions for residual dust behavior.

### Temporal Risk Profile

**Deployment & Initialization:**
- Constructor-based deployment avoids proxy-initializer front-run windows; configuration risk concentrates in factory setup + first market onboarding (`src/OVRFLOFactory.sol`).
- One-shot series/PT mapping in `setSeriesApproved()` reduces post-deployment mutation surface (`src/OVRFLO.sol`), but initial oracle/expiry correctness is critical.

**Market Stress:**
- Deposit split and listing/loan valuation remain rate/time dependent during volatility (`src/OVRFLO.sol`, `src/StreamPricing.sol`), so oracle lag directly affects immediate minting and book pricing.
- `closeLoan()` can be triggered by any actor once closable (`src/OVRFLOBook.sol`); worth checking stressed-market sequencing where withdrawable amount changes quickly.

### Composability & Dependency Risks

**Dependency Risk Map:**

> **Pendle Oracle / Market** — via `OVRFLO.deposit()`, `OVRFLOFactory.addMarket()`
> - Assumes: rate and market token metadata represent intended PT/SY relationship
> - Validates: onboarding readiness/cardinality + underlying match at add-market time
> - Mutability: external protocol/governance controlled
> - On failure: call-path reverts on explicit readiness checks; deposit path has no extra freshness gate

> **Sablier V2 Lockup Linear** — via `OVRFLO.deposit()` and `OVRFLOBook` trade/loan servicing
> - Assumes: sender/asset/end-time/cancelability metadata remain consistent with eligibility rules
> - Validates: `StreamPricing.requireEligible()` enforces sender/asset/end-time/cliff/cancelability
> - Mutability: external contract behavior outside local write control
> - On failure: eligibility-checked paths revert; servicing depends on external `withdrawableAmountOf()`

> **ERC20 PT/Underlying Tokens** — via wrap/deposit/book settlement transfer paths
> - Assumes: exact transfer semantics where `_pullExact`/balance-delta checks are applied
> - Validates: explicit exact-transfer checks in `OVRFLO.wrap()` and `_pullExact()` in `OVRFLOBook`
> - Mutability: token behavior varies by asset implementation
> - On failure: mismatch guards revert where exactness is required

**Token Assumptions** *(unvalidated only)*:
- PT/underlying tokens in non-`_pullExact` paths: assumes standard ERC20 transfer behavior for outbound transfers — impact if violated: settlement execution may revert or require manual recovery paths.

**Shared State Exposure** *(if applicable)*:
- Pendle market/oracle state is a shared dependency for both deposit valuation and market onboarding; behavior changes propagate across vault issuance and secondary-market expectations.

---

## 3. Invariants

> ### 📋 Full invariant map: **[invariants.md](invariants.md)**
>
> A dedicated reference file contains the complete invariant analysis — do not look here for the catalog.
>
> - **19 Enforced Guards** (`G-1` … `G-19`) — per-call preconditions with `Check` / `Location` / `Purpose`
> - **9 Single-Contract Invariants** (`I-1` … `I-9`) — Conservation, Bound, Ratio, StateMachine
> - **5 Cross-Contract Invariants** (`X-1` … `X-5`) — caller/callee trust assumptions across boundaries
> - **3 Economic Invariants** (`E-1` … `E-3`) — higher-order properties deriving from `I-N` + `X-N`
>
> Every inferred block cites a concrete derivation primitive, and the On-chain=No blocks identify structural gaps worth deeper audit attention.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` (includes architecture, flows, admin model, and explicit shared-token design note) |
| NatSpec | ~3 files with heavy annotations | Core contract docs are strongest in `OVRFLO.sol`; lighter in `OVRFLOBook.sol` and token contract |
| Spec/Whitepaper | Present | `README.md` functions as protocol spec (per spec) |
| Inline Comments | Adequate | Critical pathways are annotated; some secondary-market internals rely on code readability over comments |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 16 | File scan (always reliable) |
| Test functions | 161 | File scan (always reliable) |
| Line coverage | Unavailable — `forge coverage` run failed due missing `MAINNET_RPC_URL` for fork suites | Coverage tool (requires compilation) |
| Branch coverage | Unavailable — `forge coverage` run failed due missing `MAINNET_RPC_URL` for fork suites | Coverage tool (requires compilation) |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | broad (138 passing runtime tests) | `OVRFLO`, `OVRFLOFactory`, `OVRFLOBook`, `OVRFLOToken`, `StreamPricing` |
| Integration | broad | end-to-end flows across factory/vault/book components |
| Fork | 1 (file-scan signal) | fork suites exist and failed due missing env var at runtime |
| Stateless Fuzz | 0 | none detected |
| Stateful Fuzz (Foundry) | 3 | wrap/unwrap invariant harness |
| Formal Verification (Certora) | 0 | none |
| Formal Verification (Halmos) | 0 | none |
| Formal Verification (HEVM) | 0 | none |

### Gaps

- Stateless fuzzing is absent in current scan output; math-heavy pricing and settlement paths rely primarily on unit/invariant tests.
- Formal verification artifacts are absent (`certora`, `halmos`, `hevm` all zero).
- Fork test execution depends on environment configuration (`MAINNET_RPC_URL`) and currently blocks coverage metrics generation.

---

## 6. Developer & Git History

> Repo shape: normal_dev — source evolved over 56 source-touching commits across ~312 days on analyzed branch `main` at `8c603d8`.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| jay | 102 | +3295 / -1668 | 100% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 3 | Small team |
| Merge commits | 5 of 108 (4.6%) | Light formal merge-review signal |
| Repo age | 2025-08-15 → 2026-06-23 | 312 days |
| Recent source activity (30d) | 3 commits | Late feature burst |
| Test co-change rate | 55.4% | Moderate co-modification of source with tests |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| `src/OVFL.sol` | 28 | Legacy high churn |
| `src/OVRFLOFactory.sol` | 15 | Core admin/onboarding hotspot |
| `src/OVRFLO.sol` | 14 | Core valuation/minting hotspot |
| `src/OVRFLOToken.sol` | 6 | Token-control churn |
| `src/OVRFLOBook.sol` | 2 | Recently introduced feature area |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| `e3514b3` | 2026-03-07 | Port recovered Solidity hardening and tests onto main | 17 | hardening + guard/access updates across multiple security domains |
| `342409f` | 2026-04-18 | Fix tests, update front end | 16 | bug-fix style guard/access rewrites across core files |
| `a668f38` | 2026-06-23 | feat: add OVRFLO wrap unwrap | 14 | new reserve path with accounting and access updates |
| `769a00a` | 2026-06-23 | feat: protect OVRFLOBook makers from retroactive fee changes | 13 | guard/accounting hardening in secondary market |
| `384c92e` | 2026-06-23 | feat: add OVRFLO secondary market book | 12 | large new fund-flow and access-control surface |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 23 | `src/OVRFLO.sol`, `src/OVRFLOBook.sol`, `src/OVRFLOFactory.sol` |
| fund_flows | 22 | `src/OVRFLO.sol`, `src/OVRFLOBook.sol`, `src/StreamPricing.sol` |
| oracle_price | 22 | `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`, `src/StreamPricing.sol` |
| state_machines | 16 | `src/OVRFLOFactory.sol` |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | `lib/openzeppelin-contracts` | OpenZeppelin | Submodule | large pragma range present in vendored tree; monitor upstream diffing discipline |
| prb-math | `lib/prb-math` | PRBMath | Submodule | standard math dependency |

### Security Observations

- **Single-author source concentration** — source-line churn is effectively 100% attributed to `jay`.
- **Recent feature surge** — latest 30-day source activity is concentrated in three June commits adding wrap/unwrap and full book flows.
- **High-risk domain overlap** — access-control, fund-flow, and oracle domains all show >20 touching commits in branch history.
- **Hotspot alignment** — factory and core vault remain the most modified active contracts, matching control-plane and valuation criticality.
- **Test co-change is moderate, not universal** — 55.4% of source-touching commits also touched tests (co-modification signal only).

### Cross-Reference Synthesis

- **Book launch + maker-protection commits align with attack surfaces** — recent June churn in `OVRFLOBook` maps directly to APR-policy and loan-servicing review focus.
- **Factory and vault churn align with cross-contract invariants** — registry/oracle integration changes reinforce scrutiny on `X-2`, `X-3`, and `X-4`.
- **Single-author concentration + low merge ratio** — review-process signals increase importance of explicit invariant cross-checking for core accounting paths.

---

## X-Ray Verdict

**ADEQUATE** — Strong structural test presence and explicit access boundaries are offset by missing stateless fuzz/formal verification signals and coverage metrics currently unavailable in this environment.

**Structural facts:**
1. 1161 nSLOC across 3 primary subsystems (factory/admin, core vault/token, secondary market/pricing).
2. 16 test files and 161 test functions are present; runtime coverage run executed but failed due missing fork RPC env.
3. Admin control is centralized through factory ownership with explicit owner/admin modifiers across all operational config writes.
4. Current branch history shows 56 source-touching commits over 312 days with recent concentration in new secondary-market and wrap/unwrap features.
