# X-Ray Report

> OVRFLO | 1,150 nSLOC | 24752cf (`main`) | Foundry | 13/07/26

---

## 1. Protocol Overview

**What it does:** OVRFLO turns Pendle PT discount into an immediate fungible claim plus a non-cancelable Sablier stream, then supports stream sales and self-repaying pooled loans.

- **Users**: PT depositors, wrapper reserve funders, stream sellers/buyers, liquidity lenders, and stream-backed borrowers.
- **Core flow**: Deposit PT, receive immediate ovrfloToken plus streamed discount, then claim PT, unwrap underlying, trade the token, or monetize the stream.
- **Key mechanism**: One fungible token spans PT-deposit and 1:1 underlying-wrap origins; combined backing, not origin-specific redemption, defines solvency.
- **Token model**: One owner-minted OVRFLOToken per underlying, with PT inventory and a separately tracked underlying wrap reserve.
- **Admin model**: A timelocked multisig owns OVRFLOFactory (per spec); the factory is immutable vault admin and owner of factory-deployed OVRFLOLending markets.

For a visual overview, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|---------------|------:|------|
| Core vault and token | `OVRFLO`, `OVRFLOToken` | 310 | PT deposits, fungible claim mint/burn, maturity claims, wrap/unwrap, PT flash loans |
| Deployment and administration | `OVRFLOFactory` | 186 | One-vault-per-underlying deployment, series onboarding, registry, admin forwarding |
| Stream market and pricing | `OVRFLOLending`, `StreamPricing` | 654 | Stream sales, pooled self-repaying loans, eligibility, discount and obligation math |

### Backwards-Compatibility Code

- `OVRFLO.series()` synthesizes vault-level immutables in the legacy eight-field tuple because active tests, `StreamPricing`, and integrations consume that ABI (`OVRFLO.sol:510-529`); it is live compatibility code, not a dead feature.

### How It Fits Together

The core trick: one ovrfloToken liability is created either against PT inventory or exact underlying reserve, so holders gain interchangeable claim, unwrap, and market exits.

### PT Deposit and Stream Creation

```text
User → OVRFLO.deposit()
     ├─ PendleOracle.getPtToSyRate()
     ├─ OVRFLOToken.mint(user, current PT value)
     └─ OVRFLOToken.mint(vault, discount)
        └─ Sablier.createWithDurations(recipient=user)
```

*The vault increments PT accounting before external calls; the transaction reverts atomically if transfer, oracle, mint, or stream creation fails.*

### Fungible Exit Paths

```text
ovrfloToken holder
├─ OVRFLO.unwrap() → burn token → transfer tracked underlying
├─ OVRFLO.claim()  → burn token → transfer matured PT
└─ external DEX    → sell token
```

*Token origin does not bind the exit path (per spec); aggregate PT plus underlying backing is the relevant solvency model.*

### Stream Sale

```text
Seller → OVRFLOLending.sellStreamToLiquidity()
       ├─ StreamPricing.requireEligible()
       ├─ Sablier.transferFrom(seller, lender)
       └─ underlying → seller + treasury
```

*Full stream identity, maturity, asset, cliff, cancelability, and remaining-value checks run before settlement.*

### Self-Repaying Pool Loan

```text
Borrower → OVRFLOLending.createBorrowerLoanPool()
         ├─ consume matching lender liquidity
         ├─ escrow Sablier stream
         └─ underlying → borrower + treasury

loan → repayLoan() / closeLoan() / claimLoanPoolShare()
     └─ ovrfloToken → shared loanPoolProceeds → lenders pro-rata
```

*The obligation is ceiling-rounded and bounded by eligible stream face value; recovery is pooled rather than sent directly to individual lenders.*

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Lending/Borrowing** with **Yield-tokenization vault** characteristics

The dominant signals are stream-backed borrowing, obligations, repayment, pooled lender claims, PT custody, fungible mint/burn, and oracle-valued deposits. It has no liquidation or health-factor mechanism because eligible non-cancelable streams self-repay (per spec).

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|--------------|
| Timelocked multisig | Trusted (external consensus and delay, per spec) | Owns factory; can deploy systems, onboard markets, set caps/fees/APRs/treasuries, pause flash loans, and sweep verified excess assets. |
| OVRFLOFactory | Trusted immutable admin | Sole vault admin and factory-deployed lending owner; forwards operations immediately once a multisig transaction reaches it. |
| OVRFLO vault | Trusted token owner | Sole OVRFLOToken minter/burner and Sablier stream sender; holds PT and underlying backing. |
| Liquidity lender | Bounded (escrow and position ownership) | Funds underlying, withdraws unmatched liquidity, receives purchased streams, and claims pool proceeds. |
| Borrower / seller / buyer | Untrusted | Chooses orders, slippage bounds, stream IDs, liquidity IDs, loan repayments, and settlement timing. |
| Flash borrower contract | Untrusted callback target | Temporarily receives PT and may re-enter unguarded vault operations during callback; must return PT and fee atomically. |

**Adversary Ranking**

1. **Economic accounting attacker** — Targets fungible cross-exit, pooled recovery, and floor/ceil seams where liabilities and recoveries meet.
2. **Malicious stream/order participant** — Supplies adversarial IDs, order combinations, partial fills, repayments, and claim timing across shared pools.
3. **Flash borrower and callback attacker** — Controls arbitrary callback code while vault PT is temporarily outside the contract.
4. **Oracle or market-state manipulator** — Targets PT-to-SY valuation, freshness, and Pendle market metadata used for mint splits and flash fees.
5. **Compromised protocol admin** — Controls configuration and verified excess recovery through the multisig-to-factory boundary.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig → factory** — External delay protects admin initiation (per spec), but accepted calls execute factory deployment, parameter, and sweep actions immediately; `OVRFLOFactory.sol:100-301`.

- **Factory → vault/lending** — Immutable addresses enforce the caller boundary, while factory compromise reaches every deployed system's configuration and excess-asset paths; `OVRFLO.sol:210-213`, `OVRFLOLending.sol:275-305`.

- **Vault → Pendle oracle/market** — Deposit value and series identity rely on external rate and metadata, with readiness, TWAP bounds, and exact SY-underlying checks; `OVRFLOFactory.sol:191-212`, `OVRFLO.sol:372-400`.

- **Vault/lending → Sablier** — Stream creation, ownership, accrued value, and withdrawal semantics are external, while eligibility pins sender, asset, end time, cliff, and cancelability; `StreamPricing.sol:211-235`.

- **Lending → ERC20s** — Incoming underlying and ovrfloToken use strict balance-delta checks, while outgoing transfers assume standard non-rebasing configured assets; `OVRFLOLending.sol:903-914`.

### Key Attack Surfaces

- **Aggregate backing across fungible exit paths** &nbsp;&#91;[I-1](invariants.md#i-1), [I-2](invariants.md#i-2), [I-3](invariants.md#i-3), [E-1](invariants.md#e-1)&#93; — `OVRFLO.sol:316-447` maintains PT and wrap buckets separately while one token can cross-exit; trace all supply and backing deltas together.

- **Loan-pool recovery and pro-rata claims** &nbsp;&#91;[I-16](invariants.md#i-16), [I-18](invariants.md#i-18), [I-19](invariants.md#i-19), [I-20](invariants.md#i-20), [E-3](invariants.md#e-3)&#93; — `OVRFLOLending.sol:479-673` merges repayments, stream draws, harvest deficits, and cumulative receipts; check symmetry across open and closed states.

- **Stream eligibility to obligation seam** &nbsp;&#91;[I-22](invariants.md#i-22), [I-23](invariants.md#i-23), [X-3](invariants.md#x-3), [E-2](invariants.md#e-2)&#93; — `StreamPricing.sol:145-166,187-235` couples directional rounding to external stream fields; confirm every fill path consumes the same validated snapshot.

- **Oracle and one-shot series onboarding** &nbsp;&#91;[I-5](invariants.md#i-5), [I-10](invariants.md#i-10), [X-1](invariants.md#x-1), [X-5](invariants.md#x-5)&#93; — `OVRFLOFactory.sol:191-216` commits external Pendle metadata into immutable claim-critical storage; trace readiness, expiry, PT, and SY identity assumptions.

- **PT flash-loan callback window** &nbsp;&#91;[I-2](invariants.md#i-2), [I-6](invariants.md#i-6), [I-7](invariants.md#i-7)&#93; — `OVRFLO.sol:463-491` intentionally permits deposit, wrap, and unwrap during the callback while guarding nested flash loans; check cross-function accounting at repayment.

- **Liquidity consumption and shared order optionality** &nbsp;&#91;[I-13](invariants.md#i-13), [I-14](invariants.md#i-14), [I-18](invariants.md#i-18), [I-24](invariants.md#i-24)&#93; — `OVRFLOLending.sol:323-390,553-611,845-874` lets one position fund either a sale or loan; trace partial fills, ID ordering, and exact escrow conservation.

- **Deposit-cap reconfiguration** &nbsp;&#91;[I-4](invariants.md#i-4)&#93; — `OVRFLO.sol:273-275,382-388` permits the admin to set a cap below current deposits; confirm downstream code consistently treats the cap as admission control rather than a global balance bound.

- **Admin operational powers** — `OVRFLOFactory.sol:220-301` exposes instant forwarding after external timelock execution, including fee recipients and excess-asset destinations; verify deployment configuration and multisig execution controls together.

- **Exact-transfer token assumptions** &nbsp;&#91;[I-3](invariants.md#i-3), [X-4](invariants.md#x-4)&#93; — `OVRFLO.sol:316-326` and `OVRFLOLending.sol:903-907` reject fee-on-transfer inflows, while reserve accounting requires non-rebasing wstETH behavior (per spec).

### Protocol-Type Concerns

**As a Lending/Borrowing protocol:**
- `OVRFLOLending.sol:640-673` calculates entitlement from cumulative recovery rather than interest indices; inspect rounding accumulation for many small contributors and claims.
- `OVRFLOLending.sol:479-529` has no liquidation path by design; loan closure therefore depends entirely on eligible stream accrual or borrower repayment (per spec).

**As a Yield-tokenization vault:**
- `OVRFLO.sol:355-359` rejects at-par or above-par deposits because some positive stream remainder is mandatory; assess behavior near maturity and at oracle rounding boundaries.
- `OVRFLO.sol:284-307` uses internal PT and wrap accounting rather than raw balances to distinguish backing from donations; direct transfers intentionally remain sweepable excess.

### Temporal Risk Profile

**Deployment & Initialization:**
- `OVRFLOFactory.sol:100-177` stages vault deployment and separately deploys lending; one-shot underlying and lending mappings mitigate duplicates, while operational readiness still depends on transaction ordering.
- `OVRFLOFactory.sol:191-216` requires oracle history and exact underlying before market activation, but live Pendle metadata is cached permanently after this transaction.

**Market Stress:**
- `OVRFLO.sol:372-411` mints against Pendle TWAP and fails closed when history is not ready; rapid wstETH/PT dislocation remains reflected only through the configured 15-to-30-minute window.
- `OVRFLOLending.sol:365-462` reprices streams at fill time but depends on escrowed underlying liquidity remaining available during stressed exits.

### Composability & Dependency Risks

**Dependency Risk Map:**

> **Pendle Oracle** — via `OVRFLO.deposit`, `OVRFLO.flashLoan`, `OVRFLOFactory.addMarket`
> - Assumes: PT-to-SY TWAP is accurate and observation readiness describes usable history.
> - Validates: readiness, cardinality at onboarding, and 15-to-30-minute duration bounds.
> - Mutability: external behavior and governance could not be determined from in-scope code.
> - On failure: reverts.

> **Pendle Market and SY** — via `OVRFLOFactory.addMarket`
> - Assumes: `readTokens`, `expiry`, and `yieldToken` identify the intended PT and wstETH-denominated series.
> - Validates: exact SY underlying equality, unique PT mapping, and one-shot series storage.
> - Mutability: external behavior could not be determined from in-scope code.
> - On failure: reverts.

> **Sablier V2 Lockup Linear** — via `OVRFLO.deposit` and all stream-bound lending flows
> - Assumes: stream NFT ownership, deposited/withdrawn amounts, timestamps, and withdrawals follow V2 semantics.
> - Validates: sender, asset, end time, no cliff, non-cancelability, and positive remaining balance.
> - Mutability: fixed mainnet address in the vault; external contract architecture is out of scope.
> - On failure: reverts.

> **Underlying and PT ERC20s** — via vault and lending transfers
> - Assumes: configured tokens transfer exact amounts and do not rebase unexpectedly.
> - Validates: SafeERC20 return handling; exact deltas on wrap and lending inflows.
> - Mutability: token contracts are out of scope.
> - On failure: reverts.

**Token Assumptions** (unvalidated only):
- PT tokens: outgoing and deposit transfer paths assume standard non-rebasing 18-decimal behavior; unusual token behavior can desynchronize tracked amounts.
- Underlying: outgoing balance changes are not post-checked; the intended wstETH underlying is non-rebasing and preserves 1:1 token units (per spec).

**Shared State Exposure:**
- Pendle oracle observations and PT/SY market state are shared with external users; OVRFLO reads but does not write prices, except admin oracle-cardinality preparation.
- Sablier stream ownership and withdrawal state are shared across users, OVRFLOLending, and any approved NFT operator; eligibility is rechecked on fills.

---

## 3. Invariants

> ### Full invariant map: **[invariants.md](invariants.md)**
>
> A dedicated reference file contains the complete invariant analysis.
>
> - **35 Enforced Guards** (`G-1` … `G-35`)
> - **24 Single-Contract Invariants** (`I-1` … `I-24`)
> - **5 Cross-Contract Invariants** (`X-1` … `X-5`)
> - **4 Economic Invariants** (`E-1` … `E-4`)
>
> Every inferred block cites a concrete delta pair, guard lift with write sites, state edge, temporal predicate, or NatSpec claim. The single **On-chain=No** block is a high-signal admission-control versus global-bound distinction.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md`, 615 lines, covers mechanics, actors, trust assumptions, deployment, and invariants |
| NatSpec | 616 annotations | Thorough on core contracts, state, events, external methods, and load-bearing rounding |
| Spec/Whitepaper | Present | README functions as protocol spec; spec-derived claims are tagged `(per spec)` |
| Inline Comments | Thorough | Explains cross-series fungibility, fee snapshots, pool recovery, strict transfer deltas, and ABI compatibility |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 50 | File scan |
| Test functions | 329 | File scan |
| Line coverage | Unavailable | Coverage runner completed tests but did not emit a summary before stalling |
| Branch coverage | Unavailable | Coverage runner completed tests but did not emit a summary before stalling |

### Test Depth

| Category | Count | Contracts Covered |
|----------|------:|-------------------|
| Unit | 329 total functions | Broad core, factory, token, lending, pricing, and attack scenarios |
| Fork | 6 files | Live Pendle, wstETH, Sablier, factory, deposit, claim, and wrap/unwrap flows |
| Stateless Fuzz | 18 | Vault split/fee/flash math and StreamPricing bounds |
| Stateful Fuzz (Foundry) | 12 | Vault, wrap/unwrap, and lending invariants |
| Stateful Fuzz (Medusa) | 135 | Config plus generated multi-contract property suite |
| Stateful Fuzz (Echidna) | 0 | Config present, no Echidna-named test functions detected |
| Formal Verification | 0 | No Certora, Halmos, or HEVM specifications detected |

### Gaps

- No formal verification targets the rounding-heavy obligation, pool-entitlement, or aggregate-backing properties.
- Echidna configuration exists without detected Echidna entry functions; Medusa and Foundry provide the active stateful coverage.

---

## 6. Developer & Git History

> Repo shape: normal_dev, 101 source-touching commits across 330 days. Analyzed branch: `main` at `24752cf`.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Current Source Changes |
|--------|--------:|--------------------|----------------------------:|
| jay | 218 | +4,824 / not reported | 100% |
| Perplexity Computer | 4 | no current-source attribution | 0% |
| ayeslick | 3 | no current-source attribution | 0% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 3 | Small team, current source attributed to one developer |
| Merge commits | 9 of 225 (4%) | Some branch integration, limited peer-review evidence |
| Repo age | 2025-08-15 → 2026-07-11 | 330 days |
| Recent source activity (30d) | 47 commits | High late-stage activity |
| Test co-change rate | 66.3% | Source-changing commits that also modified test files; not a coverage measure |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| `src/OVRFLOBook.sol` → `src/OVRFLOLending.sol` | 35 + rebrand | Highest-churn subsystem, with major pool and naming refactors |
| `src/OVRFLO.sol` | 27 | Core custody, mint/burn, oracle, and flash-loan logic |
| `src/OVRFLOFactory.sol` | 23 | Deployment, market onboarding, and admin boundary |
| `src/OVRFLOToken.sol` | 6 | Restricted supply controller |
| `src/StreamPricing.sol` | 4 | Low-churn but load-bearing pricing and eligibility library |

### Security-Relevant Commits

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| `92d5c41` | 2026-07-01 | add sweepExcessPt input guard and fuzz property fixes | 21 | runtime guards, transfer and accounting logic |
| `3a7b06a` | 2026-06-27 | code review fixes and docs | 18 | guard and access-control changes, no test co-change |
| `860f72d` | 2026-06-27 | factory deployment/management hardening | 17 | access, accounting, tests |
| `e3514b3` | 2026-03-07 | recovered Solidity hardening and tests | 17 | guards, transfer and accounting logic |
| `342409f` | 2026-04-18 | fix tests, update front end | 16 | access-control rewrite and code removal |
| `bdd752b` | 2026-07-03 | add oracle freshness checks | 15 | oracle and runtime guards |
| `36103df` | 2026-06-24 | gate book offers on active markets | 15 | access, transfer, accounting, oracle, tests |
| `98bff9d` | 2026-06-27 | add PT flash-loan facility | 14 | callback, transfer, accounting, tests |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|---------------|--------:|-----------|
| Fund flows | 37 | `OVRFLO.sol`, lending predecessor, `OVRFLOFactory.sol`, `StreamPricing.sol` |
| Oracle/price | 37 | `OVRFLO.sol`, lending predecessor, `OVRFLOFactory.sol`, `StreamPricing.sol` |
| Access control | 36 | `OVRFLO.sol`, lending predecessor, `OVRFLOFactory.sol`, `OVRFLOToken.sol` |
| State machines | 35 | `OVRFLO.sol`, lending predecessor, `OVRFLOFactory.sol` |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| OpenZeppelin Contracts | `lib/openzeppelin-contracts` | OpenZeppelin | Submodule | Broad pragma set reflects vendored upstream tree; no internalization detected |
| PRB Math | `lib/prb-math` | not classified | Submodule | Nine Solidity files, no internalization detected |

### Security Observations

- **Single-developer current-source attribution** — git analysis attributes 100% of current source additions to jay.
- **Late-stage churn** — 47 source commits occurred in the final 30-day window, including pool fairness, oracle freshness, and lending rebrand work.
- **Test co-change** — 66.3% of source-changing commits also changed tests, while 10% of fix candidates did not.
- **Lending lineage dominates churn** — the renamed OVRFLOBook/OVRFLOLending subsystem has the largest modification history and recent accounting fixes.
- **No technical-debt markers** — git analysis detected no TODO, FIXME, HACK, or XXX markers in current source.

### Cross-Reference Synthesis

- **Lending churn aligns with pool invariants** — the most-modified subsystem contains `I-16` through `I-20`, making pooled recovery the highest-leverage review area.
- **Oracle hardening aligns with one-shot configuration** — fix `bdd752b` and 37 oracle-area commits converge on `I-5`, `I-10`, `X-1`, and `X-5`.
- **Sweep guard aligns with combined backing** — fix `92d5c41` protects token classification at the same boundary summarized by `I-1` through `I-3` and `E-1`.
- **Recent rebrand retains historical attack surface** — current `OVRFLOLending.sol` should be reviewed together with its high-churn `OVRFLOBook.sol` lineage.

---

## X-Ray Verdict

**HARDENED** — Unit, stateless fuzz, Foundry invariant, Medusa, and fork tests exist; NatSpec and a detailed protocol specification are present; privileged operations route through a documented timelocked multisig and factory boundary.

**Structural facts:**
1. 1,150 in-scope nSLOC across five contracts/libraries and three subsystems.
2. 50 test files contain 329 test functions, including 18 stateless fuzz and 12 Foundry invariant functions.
3. One OVRFLOToken spans PT-deposit and underlying-wrap accounting, with four documented economic invariants.
4. The current branch has 225 commits, 101 source-touching commits, and 47 source commits in the latest 30-day window.
5. No proxy upgrade architecture or current-source technical-debt markers were detected.
