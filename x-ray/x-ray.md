# X-Ray Report

> OVRFLO | 1379 nSLOC | `f0661ab` (`codex/lending-v1-lite`) | Foundry | 10/08/26

---

## 1. Protocol Overview

**What it does:** Wraps Pendle Principal Tokens into a liquid ERC20 plus an OVRFLO Stream carrying the PT
discount, then runs a loan-only fixed-rate order book where lenders rest underlying at APR ticks and borrowers
draw against those streams as collateral.

- **Users**: PT holders wanting immediate liquidity; lenders wanting a fixed, known payout; borrowers monetizing
  a vesting stream without selling it outright.
- **Core flow**: deposit PT → receive ovrfloToken + an OVRFLO Stream → pledge that stream to borrow at a chosen
  APR tick → the stream self-repays the loan.
- **Key mechanism**: a per-tick append-only coordinate tape. Borrows are *blind fills* that advance one
  cumulative `filled` counter; lender attribution is computed later as interval overlap rather than written per
  fill.
- **Token model**: one `OVRFLOToken` (ERC20) per underlying, minted by the vault against PT deposits and 1:1
  wraps; OVRFLO Stream NFTs (bound lockup: fork of Sablier v2-core v1.1.2; interface `ISablierV2LockupLinear`) act as transferable collateral.
- **Admin model**: a timelocked multisig owns `OVRFLOFactory`, which is the sole admin of every vault and lending
  market and is `initialAdmin` on the lockup/comptroller. No contract-level operational timelock — the delay lives entirely in the multisig. Stream protocol fees stay zero by construction (factory forwards only `setNFTDescriptor`).

For a visual overview of the protocol's architecture, see the [architecture diagram](architecture.svg).

### Contracts in Scope

| Subsystem | Key Contracts | nSLOC | Role |
|-----------|--------------|------:|------|
| Lending book | OVRFLOLending, TickTree | 768 | Fixed-rate tick order book: blind fills, lazy interval attribution, epoch rollover |
| Vault | OVRFLO, OVRFLOToken | 317 | PT custody, TWAP-split deposit, wrap/unwrap reserve, PT flash loans |
| Admin | OVRFLOFactory | 199 | Registers externally deployed children (no child creation code embedded); single admin entry point for vaults and books |
| Shared pricing | StreamPricing | 95 | Stream eligibility, discounted gross price, obligation, fee (unchanged by the rewrite) |

### How It Fits Together

The core trick: because a tick's tape is append-only and consumption is a single monotone counter, a loan's
claim on any lender position can be recomputed forever from interval overlap — so a fill costs one storage write
no matter how many lender positions it crosses.

### Vault deposit — the discount split

```
OVRFLO.deposit(market, ptAmount, minToUser)
├─ OVRFLO._approvedRate()
│  └─ IPendleOracle.getOracleState() → getPtToSyRate()   ← reverts if TWAP window is not yet satisfied
├─ IERC20.safeTransferFrom()                              ← PT in
├─ OVRFLO._computeSplit()                                 ← toUser capped at face; toStream is the discount
├─ OVRFLOToken.mint(msg.sender, toUser)
├─ OVRFLOToken.mint(address(this), toStream)
└─ ISablierV2LockupLinear.createWithDurations()           ← the stream that later becomes collateral
```

### Blind fill — the load-bearing path

```
OVRFLOLending.borrow(market, aprBps, targetBorrow, streamId, minAcceptable)
├─ OVRFLOLending._validateTick()                          ← spacing set, tick aligned, inside APR bounds
├─ OVRFLOLending._fillTick()
│  ├─ StreamPricing.requireEligible() → Sablier.getStream()
│  ├─ StreamPricing.grossPrice()                          ← floors; caps the fill so obligation ≤ remaining
│  ├─ OVRFLOLending._selectEpoch()                        ← skips epochs under the atom, ≤ CURSOR_CAP steps
│  ├─ fill = min(target/UNIT, available, grossPrice/UNIT)
│  └─ epochState.filled = fillEnd; loanCount += 1         ← the entire consumption: ONE packed slot write
├─ ISablierV2LockupLinear.transferFrom()                  ← plain transferFrom; no onERC721Received surface
└─ IERC20.safeTransfer() ×2                               ← borrower net, then treasury fee
```

### Lazy attribution — claim time

```
OVRFLOLending.claim(loanId, positionId, amount)
├─ position.lender == msg.sender                          ← authorization is per-position, not per-address
├─ OVRFLOLending._overlapUnits()
│  ├─ (market, aprBps, epoch) equality                    ← the only thing separating numerically equal tapes
│  └─ TickTree.prefix() → position interval NOW, compared to the loan's FROZEN interval
├─ recovered = drawn + repaid + (open ? min(withdrawable, outstanding) : 0)   ← the clamp is a security boundary
├─ entitlement = mulDiv(overlap, recovered, fillEnd - fillStart) - received[loanId][positionId]
├─ [all storage writes land here]                         ← received, proceeds, drawn — before any interaction
├─ ISablierV2LockupLinear.withdraw()                       ← just-in-time harvest, fires iff the loan is open
└─ IERC20.safeTransfer()
```

### Withdraw — where frozen history is preserved

```
OVRFLOLending.withdraw(positionId)
├─ TickTree.prefix() → leafStart;  TickTree.leaf() → currentLeaf
├─ filledHistory = min(filled - leafStart, currentLeaf)   ← the clamp that keeps root() ≥ filled forever
├─ TickTree.setLeaf(leafIndex, filledHistory)             ← shrinks ONLY the unfilled suffix
└─ IERC20.safeTransfer(unfilled × UNIT)
```

---

## 2. Threat & Trust Model

### Protocol Threat Profile

> Protocol classified as: **Lending/Borrowing** with **Yield Aggregator** characteristics

`borrow`/`repay`/`close` plus collateral tracking drive the primary classification, but the protocol deliberately
omits the whole liquidation/health-factor/price-oracle apparatus that usually accompanies it: collateral is a
deterministic Sablier stream, so debt is settled by drawing vested value, not by liquidating a volatile position.
The vault half (PT in, derivative token out, discount streamed) supplies the secondary profile, and it is where
the only oracle dependency lives.

### Actors & Adversary Model

| Actor | Trust Level | Capabilities |
|-------|-------------|-------------|
| Timelocked multisig | Trusted | Owns the factory. Delay is external to the contracts — every forwarded action (fee, APR bounds, treasury, deposit limits, flash pause, sweeps, market approval, tick spacing) executes instantly once the multisig acts. Cannot touch user positions, loans, or the tape. |
| OVRFLOFactory | Trusted (multisig-gated) | Sole `onlyAdmin`/`onlyOwner` principal for both vault and book; deploys them and holds their ownership. |
| Lender (A1) | Untrusted | `supply` at any valid tick; `withdraw` own unfilled remainder; `claim` own positions' pro-rata share. Cannot reach filled capital except through `claim`. |
| Borrower (A2) | Untrusted | `borrow` against an eligible stream; `repay` at face. Post-origination the borrower can do nothing wrong — collateral settles the loan. |
| Anyone / keeper (A3) | Untrusted | `close` any covered loan; `repay` any loan (strict donation); `advanceEpochCursor`; trigger tree growth or epoch rollover implicitly by supplying. |
| Flash borrower | Untrusted | `IFlashBorrower` contract receiving PT mid-transaction; may re-enter the vault's unguarded `deposit`/`wrap`/`unwrap` during the callback. |

**Adversary Ranking** (ordered by threat level for this protocol type, adjusted by git evidence):

1. **Tape/attribution manipulator** — a lender or borrower trying to make interval overlap report a contribution
   that never happened; the entire claim system rests on coordinates staying frozen.
2. **Claim-race extractor** — a co-lender on a shared loan trying to take more than pro-rata, especially on an
   over-vested open stream where live `withdrawable` exceeds the outstanding.
3. **Oracle manipulator** — relevant only to the vault's deposit split, which is the one TWAP-dependent value
   distribution in the system.
4. **Flash-loan compositor** — chains the PT flash loan with the vault's unguarded wrap/claim/unwrap paths.
5. **Book griefer** — inflates leaves or epochs to degrade the book; economically bounded to gas, but the bound
   is what must be verified.
6. **Compromised admin** — instant fee/treasury/bounds changes with no on-chain delay.

See [entry-points.md](entry-points.md) for the full permissionless entry point map.

### Trust Boundaries

- **Multisig → factory → contracts** — the single authorization design (pattern #8). The timelock is entirely
  off-chain: nothing in `src/` enforces a delay, so a compromised multisig acts instantly. Worst instant action
  is `setLendingTreasury` (`OVRFLOFactory.sol:301`) redirecting all future borrow fees. *Git signal: 63
  access-control-touching commits — the most-churned dangerous area in the repo.*

- **Book ↔ tape** — `OVRFLOLending` is the only writer of `TickTree` state, and `withdraw`
  (`OVRFLOLending.sol:421-429`) is the only path that can ever lower a stored value. Everything downstream of
  that clamp is arithmetic on frozen coordinates.

- **Book ↔ OVRFLO Streams** — collateral custody sits on the bound lockup (`ISablierV2LockupLinear`; fork of
  Sablier v2-core v1.1.2). Vault getter `sablierLL` no longer resolves to canonical `0xAFb979…`. The v1.1 ACL
  (withdraw restricted to sender/owner/operator) is preserved byte-for-byte (plan R3) and is what makes escrow
  safe; the book approves no operator and uses plain `transferFrom` throughout. After KTD6, matching audited
  vault bytecode is not a safe stream-binding predicate — `registerOvrflo` / `registerLending` require
  `factory.ovrfloStream()`. Settled ground — see `docs/audit/rejected-findings-record.md` before re-raising.

- **Vault ↔ Pendle oracle** — `_requireOracleFresh` (`OVRFLO.sol:344-347`) re-checks TWAP satisfaction at
  runtime rather than trusting onboarding-time validation alone.

### Key Attack Surfaces

- **Withdraw's filled-history clamp is the single point where the tape can shrink** &nbsp;&#91;[I-2](invariants.md#i-2), [X-2](invariants.md#x-2)&#93; — `OVRFLOLending.sol:421-429` computes `filledHistory = min(filled − leafStart, currentLeaf)` and is the only `setLeaf` caller in `src/`. Worth tracing every arithmetic path through that clamp against a partially consumed position whose epoch has since advanced.

- **Interval attribution trusts coordinates it does not re-derive** &nbsp;&#91;[I-1](invariants.md#i-1), [E-1](invariants.md#e-1)&#93; — `_overlapUnits` (`:886-898`) compares a *live* prefix query against a *frozen* stored interval. Worth confirming no reachable sequence lets a position's live interval move under a settled loan.

- **Cross-epoch claim guard is an equality check, not interval math** &nbsp;&#91;[G-45](invariants.md#g-45), [I-1](invariants.md#i-1)&#93; — `:887-889` rejects mismatched `(market, aprBps, epoch)`; leaf numbering restarts per epoch so intervals from different epochs collide numerically by construction. Worth checking every path that reaches overlap math carries the same triple check — including `loansOf`'s non-reverting core at `:904-908`.

- **Claim's `min(withdrawable, outstanding)` clamp on over-vested streams** &nbsp;&#91;[I-6](invariants.md#i-6), [E-2](invariants.md#e-2)&#93; — `:661` bounds the live-accrual term; `withdrawable > outstanding` is routine once a partially borrowed stream vests past its obligation. Worth confirming the clamp holds on every ordering of claim/repay/close across multiple contributors.

- **Epoch cursor advances as a side effect of borrowing** &nbsp;&#91;[I-16](invariants.md#i-16), [I-17](invariants.md#i-17), [G-37](invariants.md#g-37)&#93; — `_selectEpoch` (`:917-934`) persists cursor movement inside a fill and is bounded by `CURSOR_CAP`. Worth tracing what a borrow that exhausts the cap leaves behind versus what `advanceEpochCursor` (`:526-552`) would.

- **Growth root-copy ordering inside the tape** &nbsp;&#91;[I-13](invariants.md#i-13), [I-18](invariants.md#i-18)&#93; — `TickTree._grow` (`:125-130`) reads the old root at `:127` before writing the new height at `:128`. Worth confirming the read cannot observe post-growth state at any height transition, and that the copy routes through the same checked narrowing as ordinary writes.

- **Terminal-capacity rollover is only reachable via a virtual override** &nbsp;&#91;[I-18](invariants.md#i-18)&#93; — `_epochAtCapacity` (`:1026-1028`) is `virtual` so the harness can force the branch; 8^7 real appends are prohibitive. Worth confirming the production predicate (`height == MAX_HEIGHT && atCapacity()`) and not merely the overridden one is what ships.

- **Flash loan callback re-enters unguarded vault paths** — `OVRFLO.flashLoan` (`:459`) is `nonReentrant` but `deposit`, `wrap`, and `unwrap` are not, and the callback runs with PT already sent (`:472-474`). Worth tracing wrap/claim/unwrap cycles composed inside the callback window.

- **Admin operational powers carry no on-chain delay** — every `onlyOwner` forwarder in `OVRFLOFactory.sol:283-318` executes immediately. Worth confirming the off-chain timelock is the only thing standing between a key compromise and a fee/treasury redirect.

### Protocol-Type Concerns

**As a Lending/Borrowing protocol:**
- Directional rounding is load-bearing, not incidental: `grossPrice` floors (`StreamPricing.sol:111`) while
  `obligation` ceils (`:126`), and the equality fast path (`:147-149`) sidesteps the boundary. Flipping either
  direction breaks `obligation ≤ remaining`.
- Fill sizing composes three independent caps at `OVRFLOLending.sol:1070-1076` (target floor, available depth,
  gross price) with a deliberately inlined division at `:1070` so an oversized target partial-fills instead of
  reverting.

**As a Yield Aggregator:**
- The deposit split (`OVRFLO.sol:351-356`) caps `toUser` at face and requires `toStream > 0`, so the rate can
  briefly exceed 1e18 without minting above backing.
- The wrap reserve is tracked separately from the raw balance (`:59`, `:315`, `:335`), so a direct token
  donation cannot inflate what unwrap will pay out.

### Temporal Risk Profile

**Deployment & Initialization:**
- `supply` and `borrow` revert until `setLendingTickSpacing` runs (`OVRFLOLending.sol:1095`), so a freshly
  deployed book is inert rather than mis-configured — zero is the unset sentinel, not a valid spacing.
- The R2 onboarding bound (`underlying.totalSupply() ≤ 2^54 × UNIT`) is documented at the forwarder
  (`OVRFLOFactory.sol:307-310`) as an off-chain multisig checklist item, deliberately not an on-chain require.
- Ladder sizing is likewise an onboarding concern: `tickDepths` is O(rungs × epochs) with no pagination and
  spacing is set-once, so rung count must be sanity-checked before it is fixed.

**Market Stress:**
- Narrowing APR bounds hides — never locks — out-of-window liquidity from the ladder; `tickState` deliberately
  validates spacing only (`:765`) so those positions stay readable, and lenders enumerate their own positions
  via `lenderPositionAt` rather than the ladder.

### Composability & Dependency Risks

> **OVRFLO Streams (`ISablierV2LockupLinear`)** — via `OVRFLOLending.borrow/close/claim`, `OVRFLO.deposit`;
> bound fork of Sablier v2-core v1.1.2; getter `sablierLL` / factory `ovrfloStream`
> - Assumes: v1.1 withdraw ACL (sender / NFT owner / approved operator only); non-cancelable, no-cliff streams
> - Validates: sender, asset, end time, cliff, cancelability, remaining (`StreamPricing.sol:205-211`)
> - Mutability: immutable at the pinned address (the deliberate reason V2 is retained over V4)
> - On failure: revert; the book approves no operator and never uses `safeTransferFrom`

> **Pendle (market + TWAP oracle)** — via `OVRFLO.deposit/flashLoan`, `OVRFLOFactory.addMarket`
> - Assumes: PT is 18 decimals; `getPtToSyRate` reflects fair value over the fixed TWAP window
> - Validates: `oldestObservationSatisfied` at runtime (`OVRFLO.sol:346`) and cardinality at onboarding
>   (`OVRFLOFactory.sol:202`)
> - Mutability: external protocol, not controlled here
> - On failure: revert (fail-closed)

**Token Assumptions** *(unvalidated only)*:
- Rebasing underlying: unsupported by design — the strict balance-delta checks (`OVRFLO.sol:320`,
  `OVRFLOLending.sol:1149`) would reject it. wstETH, not stETH, is the intended underlying for exactly this reason.

---

## 3. Invariants

> ### 📋 Full invariant map: **[invariants.md](invariants.md)**
>
> A dedicated reference file contains the complete invariant analysis — do not look here for the catalog.
>
> - **68 Enforced Guards** (`G-1` … `G-68`) — per-call preconditions with predicate / location / purpose
> - **24 Single-Contract Invariants** (`I-1` … `I-24`) — Conservation, Bound, Ratio, StateMachine, Temporal
> - **5 Cross-Contract Invariants** (`X-1` … `X-5`) — caller/callee pairs that cross scope boundaries
> - **5 Economic Invariants** (`E-1` … `E-5`) — higher-order properties deriving from `I-N` + `X-N`
>
> Every inferred block cites a concrete Δ-pair, guard-lift + write-sites, state edge, temporal predicate, or
> NatSpec quote. The **On-chain=No** blocks are the high-signal ones. Note that in this protocol several
> On-chain=No entries (I-1, I-2, I-3, E-1) are *deliberately* test-enforced rather than runtime-enforced: they
> are global tape properties whose runtime validation would require an unbounded scan, which the implementation
> discipline explicitly forbids. Their executable form is `test/OVRFLOLendingInvariant.t.sol`.

---

## 4. Documentation Quality

| Aspect | Status | Notes |
|--------|--------|-------|
| README | Present | `README.md` — protocol spec; lending section still describes the pre-rewrite API (U8 owns the sync) |
| NatSpec | ~769 annotated lines | Dense and unusually explanatory — rationale, rounding direction, and security reasoning are inline, not just parameter docs |
| Spec/Whitepaper | Present | `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md` is the authoritative design spec (per spec); `CONCEPTS.md` carries domain vocabulary |
| Inline Comments | Thorough | Load-bearing decisions carry their reasoning at the site (e.g. the rollover pre-check at `OVRFLOLending.sol:384-386`, the harvest clamp at `:652-656`) |

---

## 5. Test Analysis

| Metric | Value | Source |
|--------|-------|--------|
| Test files | 34 | File scan (always reliable) |
| Test functions | 323 | File scan (always reliable) |
| Line coverage | 98.51% OVRFLOLending, 100% TickTree / StreamPricing / OVRFLO / Factory / Token | `forge coverage --ir-minimum` |
| Branch coverage | Unreliable under `--ir-minimum` | Default `forge coverage` fails with stack-too-deep; the IR-minimum fallback distorts branch instrumentation |

### Test Depth

| Category | Count | Contracts Covered |
|----------|-------|-------------------|
| Unit | ~300 | All in-scope contracts |
| Fork | 5 files | Vault, lending, factory, flash loan (self-skip without `MAINNET_RPC_URL`) |
| Stateless Fuzz | 20 functions | StreamPricing, TickTree (differential vs reference model), vault |
| Stateful Fuzz (Foundry) | 7 invariant functions | OVRFLO vault, wrap/unwrap |
| Stateful Fuzz (Echidna) | 1 config | Pre-rewrite property set |
| Stateful Fuzz (Medusa) | 1 config | Pre-rewrite property set |
| Formal Verification | 0 | Not implemented |

### Gaps

- **Lending stateful fuzz is the live gap.** `test/OVRFLOLendingInvariant.t.sol` was deleted with the sale-path
  rewrite and is being rebuilt (plan unit U6) — until it lands, the tape properties (I-1, I-2, I-3, E-1) have no
  executable enforcement, which is precisely the class of property unit tests cannot reach.
- **The Echidna/Medusa configs target the pre-rewrite ABI** and describe mechanisms that no longer exist.
- **Formal verification remains absent.** The frozen-history lemma (I-2 / E-1) is now stated precisely enough to
  hand to an engagement, which was the Definition of Done's stated purpose.
- Branch coverage is not measurable on the default profile — a toolchain limitation, not a suite gap.

---

## 6. Developer & Git History

> Repo shape: normal_dev — 130 of 419 commits touch source, spread over 360 days. Analyzed branch:
> `codex/lending-v1-lite` at `f0661ab`.

### Contributors

| Author | Commits | Source Lines (+/-) | % of Source Changes |
|--------|--------:|--------------------|--------------------:|
| jay | 410 | +6429 / -3895 | 100% |
| ayeslick | 5 | — | 0% |
| Perplexity Computer | 4 | — | 0% |

### Review & Process Signals

| Signal | Value | Assessment |
|--------|-------|------------|
| Unique contributors | 3 | Single-dev — one author wrote 100% of source lines |
| Merge commits | 13 of 419 (3.1%) | Minimal branch-merge process |
| Repo age | 2025-08-15 → 2026-08-10 | ~12 months |
| Recent source activity (30d) | 7 lending commits | Active rewrite in progress, not a pre-audit burst |
| Test co-change rate | 73.1% | Source-changing commits that also touch tests (co-modification, NOT coverage) |

### File Hotspots

| File | Modifications | Note |
|------|-------------:|------|
| src/OVRFLO.sol | 36 | Vault core — highest churn |
| src/OVRFLOBook.sol | 35 | Historical name of the lending contract |
| src/OVRFLOFactory.sol | 30 | Admin hub |
| src/OVRFLOLending.sol | 19 | Current book; 6 of these are the in-flight v1-lite rewrite |
| src/StreamPricing.sol | 14 | Deliberately stable — carried over unchanged |
| src/TickTree.sol | 1 | Brand new; no revision history to learn from |

### Security-Relevant Commits

**Score** = weighted sum of fix-like signals (message keywords, diff patterns, change shape). **10+ warrants a
manual diff.**

| SHA | Date | Subject | Score | Key Signal |
|-----|------|---------|------:|------------|
| 92d5c41 | 2026-07-01 | fix: add sweepExcessPt input guard, fuzz suite with property fixes | 21 | adds runtime guards (+30/-0), spans 4 security domains |
| 024753b | 2026-07-13 | test: stateful fuzz suite, 57 properties, GL-70 stream-reuse fix | 20 | removes runtime guards (+40/-61), accounting logic |

### Dangerous Area Evolution

| Security Area | Commits | Key Files |
|--------------|--------:|-----------|
| access_control | 63 | OVRFLO.sol, OVRFLOFactory.sol, OVRFLOLending.sol, OVRFLOToken.sol |

### Forked Dependencies

| Library | Path | Upstream | Status | Notes |
|---------|------|----------|--------|-------|
| openzeppelin-contracts | lib/openzeppelin-contracts | OpenZeppelin | Submodule (not internalized) | 318 files; mixed pragma ranges are upstream's own, not local edits |

*`lib/prb-math` was removed as a submodule in `8727556`; this repo's `src/` pricing core is OZ `Math`/`SafeCast`
only. The OVRFLO Streams fork (sibling GPL repo) keeps `@prb/math` as a scoped exception — see `AGENTS.md`.*

### Technical Debt Markers

None — `tech_debt.total_count == 0`. No TODO/FIXME/HACK/XXX markers in `src/`.

### Security Observations

- **Single-author codebase** — jay wrote 100% of source lines; no second pair of eyes is encoded in history.
- **Low merge-commit rate** — 3.1% (13/419), so peer review is not visible in the git record.
- **`TickTree.sol` has exactly one commit** — the highest-risk new component has no revision history, which is
  why the plan mandated test-first development against an independent reference model.
- **Access control is the most-churned dangerous area** — 63 commits across all four stateful contracts.
- **Test co-change is healthy at 73.1%**, and both top-scored fix commits carry test changes.
- **The rewrite is mid-flight** — six lending commits in four days, with the invariant and fuzz layers
  (U6/U7) not yet rebuilt. Test-layer coverage lags source-layer completeness by design of the plan's sequencing.
- **No technical debt markers anywhere in `src/`.**

### Cross-Reference Synthesis

- **`OVRFLOLending.sol` is both the churn leader among live files and the source of every top attack surface** →
  highest-leverage review targets are `withdraw`'s clamp (`:421-429`), `_overlapUnits` (`:886-898`), and
  `claim`'s harvest clamp (`:652-670`).
- **`TickTree`'s single commit + I-13/I-18's packed-node invariants** → the differential fuzz against a reference
  model is carrying the load that revision history normally would.
- **GL-70 appears in the git record (024753b) and in the current design** → both closure paths now return the
  stream, so close-time withdrawn snapshots are required in the rebuilt suite, not optional.
- **Deleted lending invariant suite + On-chain=No tape invariants** → the protocol's most load-bearing property
  (E-1, lazy attribution exactness) currently has no executable enforcement at this commit.

---

## X-Ray Verdict

**ADEQUATE** — unit and stateless-fuzz layers are thorough and source coverage is near-total, but the lending
stateful-fuzz layer is absent at this commit, and access control has clear boundaries with the timelock living
off-chain rather than in the contracts.

**Structural facts:**
1. 1379 nSLOC across four subsystems; the lending book (`OVRFLOLending` + `TickTree`) is 768 of them (56%).
2. 40 entry points — 10 permissionless, 2 role-gated, 28 admin-only; every admin path routes through one factory.
3. One developer authored 100% of source lines; 3.1% of commits are merges.
4. Source line coverage is 98.51%–100% per file, with 323 test functions across 34 files.
5. Zero technical debt markers; zero internalized (forked) dependencies.
