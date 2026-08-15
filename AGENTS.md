Protocol briefing for agents (trust ranking, live contract map, settled do/do-not, known contradictions): `docs/agents/onboarding.md`. Read that file before advising on or changing protocol code. The **Before writing code** section there is binding: record intent (assumptions, predicted blast radius, verification) *before* the first code write; log every deviation from the active plan and why (do not edit the plan); compare the actual `git diff --stat` to that prediction before calling the work done. Do not reconstruct the record afterward. Frontend state-touching changes also write the scratch intent capsule (`docs/maps/SCHEMAS.md` §4).

Read https://ethskills.com/SKILL.md and follow it before writing Solidity or shipping anything onchain.
Read `docs/solutions/patterns/solidity-implementation-discipline.md` before writing or modifying Solidity — it carries the minimality ladder, the FREI-PI gate, the root-cause-fix procedure, the precedence rule (plan > critical patterns > ladder), and Sequence 6–9 (intent record → implement → verify → compare the final diff).
Read `docs/solutions/patterns/ovrflo-coding-standard.md` (enforceable rules, each citing its source and remediation tier) and `docs/solutions/patterns/ovrflo-style-guide.md` (naming, layout, NatSpec voice, comment discipline, fixture conventions) before writing OVRFLO Solidity or tests — they exist to eliminate micro-decisions; deviations need a recorded reason.
Read `docs/solutions/patterns/ovrflo-web-standard.md` before writing or modifying the Markets frontend — it carries the micro-decision rules (state placement, effects, branded money, dependencies, abstraction, platform-native) and the browser-runtime pathology section.
Use BASE_SECURITY.md for security guidelines.
Use VAULT_SECURITY.md for Vault security guidelines.

## How to explain things here — binding for every agent

Write for a reader who knows the protocol but not your jargon. Explaining is part of the work, not overhead on top of it.

- **Name the thing before you use it.** One plain sentence on what a contract, function, or mechanism *is* and *does*, then the point you are making. Never open with a signature or an identifier chain.
- **State the problem, then show the fix.** A finding without a concrete fix is half a finding. Show the before and after — actual names, actual arguments — not a description of the change.
- **One idea per sentence.** No clause-stacking. If a sentence carries a mechanism, a consequence, and a recommendation at once, split it into three.
- **Ban the shorthand that hides meaning.** No "the shape lies", "dead indirection", "load-bearing" without saying what it bears, "surface", "seam", "posture". Say what actually happens and to whom.
- **Sort findings by whether they break something.** Lead with what stops the build or ships a bug. Everything else goes in a named second group with a plain label — never "tidiness", "polish", or "nits", which tell the reader nothing about what is wrong.
- **Never relay another agent's or reviewer's output verbatim.** Sub-agent findings, audit reports, and doc-review envelopes arrive in reviewer jargon. Translate every one before it reaches the user, and attach a recommendation. Close low-stakes reviewer questions yourself with a stated recommendation rather than forwarding them.
- **Scale the response to the work.** A three-line change gets a three-line explanation. If a review of a small change produces twenty findings, sort them and say which few matter — do not deliver all twenty at equal weight.

## Before raising a security finding — read this list, not just the link

`docs/audit/` is required reading for any security review. The three findings below have been raised, disproven, and re-raised by a later reviewer who read the linked file but did not open it. They are enumerated here so the collision is visible **without a second hop**. If your finding matches one, the record is your starting point, not a wall — bring new evidence or move on.

- **Third-party stream withdrawal diverging lending accounting.** Raised as internal-review `H-2` and again as `audit-2026-07-28 H-1`. **Disproven both times:** the bound lockup is OVRFLO Streams — a fork of Sablier v2-core v1.1.2 (Solidity `SablierV2LockupLinear`, ERC721 identity `OVRFLOStream`). Vault getter `sablierLL` **no longer** resolves to canonical `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`. The fork preserves the v1.1 withdraw ACL byte-for-byte (**plan R3**): `withdraw` reverts unless the caller is the stream sender, NFT owner, or approved operator. The vault has no withdraw path and the market approves no operator. Newer Sablier Lockup docs describe a public withdraw-to-recipient path — **that is a different version than the fork lineage.** Checking only canonical Sablier is not following evidence.
- **R-01 — on-chain 18-decimal enforcement for PT.** Declined by design; Pendle PT is always 18 decimals and the multisig validates series onboarding. Re-raised as the 2026-07-28 audit's `L-1`.
- **Critical pattern #4 — address-scoped self-match prevention.** A correctness guard against an irrational self-loan state, not a security boundary; bypassing it with a second EOA gains nothing. Re-raised as the 2026-07-28 audit's `L-12`.

**Finding IDs collide across audits** — the internal review and the 2026-07-28 audit both use `H-1`, `H-2`, `L-1`, `L-2`, and `I-4` for unrelated findings. Always qualify an ID with its audit when citing one.

Full disproofs and evidence: `docs/audit/rejected-findings-record.md`. Sablier ACL table: `docs/audit/sablier-interface-contract.md`. Enforceable rules: `docs/solutions/patterns/ovrflo-critical-patterns.md`.

## Agent skills

### Planning

Before any implementation-ready plan is declared build-ready, run the **ignorance-lens sweep** per `docs/solutions/patterns/ignorance-lens-sweep.md`: *walk the plan as the implementer will; find every decision it leaves underdetermined; ask whether two competent onboarded agents would decide the same way; rotate lenses until dry* — parallel lens-agents with verified-only findings, point-fix wrong plan text, fold the rest into a `### Sweep Contracts` section, finish with a completeness critic and stop at its diminishing-returns verdict. A plan that has not been swept is not build-ready, regardless of review verdicts.

The implementer is an onboarded agent, not a naive one: it has read the standards and can read the code. It cannot recover a decision settled in a session the plan does not record, and when the plan is silent it decides — invisibly, because a reasonable choice looks exactly like an instructed one. The threshold is in the pattern doc: every decision must be stated by the plan, stated by a standing rule, genuinely interchangeable, or covered by a stated rule for deciding (including when to stop and ask). Over-specifying what the style guide already decides is also a defect. Facts on the ground will differ; name the differences that must **stop** the work rather than be absorbed by a judgment call.

Two binding authorship rules from the same pattern doc: never paraphrase working code into a plan (cite its contract with a `file:line` anchor instead), and a test-accountability entry names the specific successor scenario, never just a unit.

### Git commits

Write commit messages per `.cursor/rules/commit-message-style.mdc` (Pope/Beams structure; STE100 + Google prose). Agent commits must use the plumbing bypass in `.cursor/rules/no-commit-attribution.mdc` — never bare `git commit`.

### GitHub

`gh` is installed and authenticated on this machine — use it for GitHub PRs, issues, and API calls.

### Triage labels

Default canonical labels (no renames): `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (no `CONTEXT-MAP.md`). See `docs/agents/domain.md`.

### Testing

Read `docs/agents/testing.md` before running the E2E suite — it covers required environment setup and how to tell an environment collision from a real regression.

## Development Commands

### Build and Test
- `forge build` - Compile all Solidity contracts
- `forge test` - Run all tests
- `forge test --match-test test_FunctionName` - Run specific test
- `forge test -vvv` - Run tests with verbose output (useful for debugging)
- `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` - Run invariant tests (`[profile.invariant.invariant]`: 500 runs, depth 40 — the default `[invariant]` profile is 25 runs / depth 10, so the `FOUNDRY_PROFILE=invariant` prefix is required to get the real coverage)
- `forge test --match-contract OVRFLOFuzz` - Run fuzz tests (1000 runs)
- `forge test --match-path "test/fork/*" --fork-url $MAINNET_RPC_URL` - Run mainnet fork tests

### Deployment
- **Production / testnet / Tenderly VTN:** `forge script script/OVRFLO.s.sol --rpc-url <RPC_URL> --broadcast`. Set `PRIVATE_KEY` and `MULTISIG_ADDRESS` environment variables for deployment.
- **Local Anvil mainnet fork:** use `bash script/seed-local.sh` (driven by `npm --prefix web run bootstrap:local`) — **do not** run `forge script --broadcast` against a local Anvil fork; it hits [foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714) and fails with `lack of funds (0) for max fee` even when the broadcaster is funded. See `docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md` and rule #2 of `docs/solutions/patterns/ovrflo-critical-patterns.md`.

### Code Quality
- `forge fmt` - Format Solidity code
- `forge snapshot` - Generate gas snapshots for tests
- `forge build --sizes` - Diagnostic table of runtime/initcode size per contract (the gate itself is `test/DeploySize.t.sol`, run via `forge test`)

### Frontend
- `npm --prefix web run dev` - Start Next.js dev server
- `npm --prefix web run test` - Run Vitest unit tests (`-- --coverage` for an informational coverage report on `lib/` and `hooks/`)
- `npm --prefix web run test:e2e` - Run Playwright/Gherkin E2E tests (see `web/tests/e2e/README.md`; requires a seeded local Anvil fork, `BOOT_NO_UI=1 npm --prefix web run bootstrap:local`)
- `npm --prefix web run build` - Production build
- `npm --prefix web run bootstrap:local` - Seed local Anvil fork (drives `script/seed-local.sh`)

## Architecture Overview

Foundry-based Solidity project implementing OVRFLO, a Pendle-based vault system for yield tokenization, with a lending market (OVRFLOLending) — a loan-only, fixed-rate tick order book — for borrowing against OVRFLO Streams (fork of Sablier v2-core v1.1.2; Solidity names stay Sablier-shaped).

### Core Contracts (`src/`)

**OVRFLOFactory** — Registry and admin hub owned by a timelocked multisig (`Ownable2Step`). Deploys nothing: children (OVRFLO vaults, which construct their own OVRFLOToken, and OVRFLOLending instances) are deployed externally by any EOA/script, then `registerOvrflo()`/`registerLending()` (`onlyOwner`) verify every constructor-arg binding on-chain — vault `factory`/`oracle`/`sablierLL` (must equal `factory.ovrfloStream()`), duplicate-underlying, lending `factory`/`owner`/stream bindings, 1:1 vault-lending mapping — before admitting the candidate to the registry. After KTD6, matching audited vault bytecode is not a safe stream-binding predicate; registration is. `SablierMismatch` still proves vault and lending bind the same stream. One-shot `setOvrfloStream` admits the canonical lockup (checks `factory()`/`admin()`/`comptroller.admin()`). `setStreamNFTDescriptor` is the only lockup admin forwarder — no `transferAdmin` forwarder (protocol fees immutable at zero by construction, SC13). The factory embeds no child creation code (EIP-170). Serves as immutable `factory` (admin) for all registered vaults and owner of all registered lending markets. Forwards admin calls (series approval, deposit limits, oracle prep, lending admin including `setLendingTickSpacing`) to vaults and lending markets. Prevents duplicate vault registration per underlying (`underlyingToOvrflo` mapping).

**OVRFLO** — Pendle basket vault that wraps PT deposits into ovrfloTokens. Handles PT (Principal Token) deposits with market-value fees. Creates OVRFLO Streams on the bound lockup via getter `sablierLL()` (constructor-bound; not an inline hardcode). Permissionless wrap/unwrap path (underlying <-> ovrfloToken 1:1). PT flash loan facility (atomic loan of deposited PT via EIP-4531 callback). Admin functions gated by `onlyAdmin` modifier (factory is admin).

**OVRFLOLending** — Loan-only, fixed-rate tick order book (`Ownable2Step` + `ReentrancyGuard` + `Multicall`, owned by the factory). Lenders rest liquidity at an APR tick via `supply`/`withdraw`. Borrowers pledge an OVRFLO Stream and draw against tick liquidity with a single blind fill (`borrow`) that advances a tick epoch's cumulative `filled` counter without reading or enumerating lender positions — no position IDs, no collisions, fill gas flat in positions crossed. Lender attribution is computed lazily by interval overlap against a `TickTree` packed prefix-sum tree, never stored per fill. Loan servicing: `repay` (permissionless, face value), `close` (permissionless stream-draw settlement), `claim` (pro-rata payout from a loan's recovered value). No sale listings or loan pools — a full borrow is economically a sale (obligation caps at the stream's remaining value).

**TickTree** — Internal library (`src/TickTree.sol`) implementing the packed segment tree OVRFLOLending's tick epochs use for O(log n) prefix-sum queries: `append`, `setLeaf`, `prefix`, `leaf`, `root`. Dynamic height 4→7 (8^4 to 8^7 leaves), growing on demand; a tick rolls to a fresh epoch once its tree hits the height cap.

**StreamPricing** — Pure library for OVRFLO Stream valuation, gross price, obligation, and fee math. `marketActive` / `requireEligible` helpers used by both OVRFLO and OVRFLOLending. Defines `IOVRFLOFactoryRegistry` and `IOVRFLOSeriesRegistry` interfaces.

**OVRFLOToken** — ERC20 token deployed per underlying asset. Owned and controlled by OVRFLO contract. Mint/burn restricted to owner.

### External Interfaces (`interfaces/`)
`IFlashBorrower` (EIP-4531 callback), `IPPrincipalToken`, `IPendleMarket`, `IPendleOracle`, `ISablierV2LockupLinear` (hand-kept interface against the fork address; name kept per R9), `IStandardizedYield`.

### Key Integrations
- **Pendle Protocol**: PT/YT markets for yield tokenization, SY for underlying validation
- **OVRFLO Streams**: GPL fork of Sablier v2-core v1.1.2 (separate repo); linear streaming for excess yield distribution and stream-backed loans. Identifier names in this repo stay Sablier-shaped (`sablierLL`, `SABLIER_LOCKUP_ADDRESS`, …); values point at the fork.
- **OpenZeppelin**: Standard contracts (ERC20, Ownable2Step, ReentrancyGuard, Multicall) plus `Math`/`SafeCast` for all narrowing casts — no PRB-Math in this repo's `src/` (the pricing core and TickTree are both OZ-based). The OVRFLO Streams fork keeps `@prb/math` as a scoped exception.

### Core Flows
1. **Deposit**: PT deposits with market-value fees, creates an OVRFLO Stream NFT
2. **Claim**: Burn ovrfloTokens to claim PT after maturity
3. **Wrap/Unwrap**: Permissionless 1:1 underlying <-> ovrfloToken via wrap reserve
4. **PT Flash Loan**: Atomic PT loan with EIP-4531 callback, repaid in same tx
5. **Lending market**: Borrow against a pledged OVRFLO Stream via OVRFLOLending's tick order book (supply liquidity at an APR tick, blind-fill borrow, repay/close/claim)
6. **Admin**: Multisig -> OVRFLOFactory -> OVRFLO / OVRFLOLending (series approval, deposit limits, oracle prep, lending config including tick spacing); stream art via `setStreamNFTDescriptor`

### Security Features
- Timelocked multisig owns factory (all admin operations require consensus + delay)
- Factory serves as single admin entry point for all vaults and lending markets (pattern #8)
- Factory registers externally deployed children instead of constructing them — embeds no child creation code, so the factory stays under the EIP-170 runtime cap by construction; every registration re-verifies the constructor-arg bindings construction used to fix (`docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md`)
- `test/DeploySize.t.sol` gates all four deployables (plus an `OVRFLOLending` headroom canary) against the EIP-170/EIP-3860 mainnet caps so this finding class cannot silently regress
- TWAP oracle pricing for market valuation
- Reentrancy protection on critical functions
- Per-market deposit limits (0 = unlimited)
- Duplicate underlying prevention via `underlyingToOvrflo` mapping, enforced at registration (pattern #9)
- Pro-rata cap on shared claims across positions overlapping a loan (pattern #12)
- Frozen-history / lazy-attribution correctness: no tape coordinate below a tick epoch's `filled` counter ever changes, so interval-overlap attribution stays exact forever (see `x-ray/invariants.md` I-2)
- Blind-fill borrow has no self-match guard by design — blind fills cannot enumerate lender positions, and per the `docs/audit/rejected-findings-record.md` L-12 reasoning a self-fill is self-neutral minus the protocol fee (critical pattern #4, superseded-by-design)

### Testing Strategy
- Uses Foundry's testing framework with `forge-std`
- Unit tests: `test/OVRFLOLending.t.sol`, `test/TickTree.t.sol`, `test/OVRFLO.t.sol`, `test/OVRFLOFactory.t.sol`, `test/StreamPricing.t.sol`
- Math tests: `test/StreamPricing.math.t.sol` (pure pricing math verification)
- Fuzz tests: `test/OVRFLOFuzz.t.sol` (1000 runs)
- Invariant tests: `test/OVRFLOLendingInvariant.t.sol`, `test/OVRFLOInvariant.t.sol`, `test/OVRFLOWrapUnwrap.invariant.t.sol` (`FOUNDRY_PROFILE=invariant`: 500 runs, depth 40)
- Attack scenario tests: `test/OVRFLOAttackScenarios.t.sol` (flash-loan griefing, wrap/claim/redeem loops)
- Mainnet fork tests: `test/fork/` (real Pendle markets, bound OVRFLO Streams lockup; self-skip without `MAINNET_RPC_URL`)
- Frontend tests: `web/tests/` (Vitest)
- Test coverage target: >90% for core OVRFLO components

### Dependencies
- Foundry toolchain for compilation, testing, and deployment
- OpenZeppelin contracts (via git submodules) — `Math`/`SafeCast` cover all narrowing-cast and rounding needs; no PRB-Math dependency in this repo's `src/` (the OVRFLO Streams fork is the scoped `@prb/math` exception)
- Forge-std for testing utilities
- Next.js + wagmi + viem for frontend (`web/`)

## Learned User Preferences

- Prefer off-chain multisig verification over redundant on-chain checks; do not duplicate what the timelocked multisig already validates.
- Keep code Pendle-specific rather than generalizing for arbitrary PT protocols; use a wrapper/adapter contract if another protocol is ever needed.
- Favor simplicity and minimal abstractions; pushback on added complexity ("this is solidity not python" — use mappings directly instead of helpers like `vaultAt(i)`; don't introduce arrays when mappings suffice).
- Stay on the Sablier V2 v1.1 ACL lineage intentionally (smaller attack surface; fork of v1.1.2 — V4 is rejected because it lets Sablier's multisig change things post-deploy, and newer Lockup public-withdraw would resurrect the rejected finding).
- Deposit limits use 0 = unlimited; to cap deposits, set a positive limit. Do not add `disableSeries`/`enableSeries` toggles.
- Cross-market `ovrfloToken` fungibility under one underlying is a design feature, not a bug; explicitly note this in README/security docs.
- When proposing plans, write them as standalone `.md` files under `docs/plans/` rather than editing in place.
- Do not edit plan files while implementing them — treat them as read-only specs.
- When running post-change verification, run `forge build` then `forge test` (user prefers tests after a clean build).
- Project, contract, and token names use `OVRFLO` (never `OVFL`); `ovrfloToken` symbols get an `OVRFLO`/`overflo` prefix.

## Learned Workspace Facts

- License is MIT across all contracts in this repo. The stream lockup lives in the separate GPL `OVRFLO-Streams` repo.
- Pendle PT tokens always have 18 decimals; code assumes and enforces this invariant (e.g. `MIN_PT_AMOUNT`).
- Admin flows are multisig -> factory -> vault or lending; no dependent contract is administered directly. Stream lockup/comptroller admin is the factory; fees cannot be enabled (SC13).
- The factory carries a factory-wide `oracle` immutable, set at construction (`OVRFLOFactory.sol` constructor) — `registerOvrflo`'s `OracleMismatch` check validates a candidate vault's `oracle` immutable against it, and `addMarket` reads it directly. Per-series storage still exists too: `SeriesInfo` (written by `setSeriesApproved`) caches per-market TWAP duration, fee, expiry, and PT address, but the oracle *address* itself is the factory-wide immutable, not a per-series value. (Corrected 2026-08-11 — the prior fact claiming "no hardcoded `PENDLE_ORACLE` in the factory" was stale; user decision.)
- The factory also carries `ovrfloStream` (set once). Getter on the vault stays `sablierLL()`; value is the fork, not canonical `0xAFb979…`.
- `MIN_TWAP_DURATION` (15 minutes) and `MAX_TWAP_DURATION` (30 minutes) are both enforced in the factory.
- `setSeriesApproved` is intended to be called once per market and never overwritten; claims depend on `ptToken`/`ovrfloToken`/expiry staying immutable for the life of outstanding deposits.
- OVRFLO Streams are per-deposit, per-customer — not per-market; deposit fees are taken in underlying via a separate zap contract path. Lockup protocol fees stay zero by construction.
- Loans are self-repaying (lender draws from the pledged stream until obligation is met, then residual returns to borrower). A returned stream can be re-pledged to a new loan.
- OVRFLO has a PT flash loan facility: atomic loan of deposited PT via EIP-4531 callback (`IFlashBorrower`), repaid in the same tx with an oracle-adjusted fee in underlying. Capped by `marketTotalDeposited`, gated pre-maturity, globally pausable by the multisig. `flashLoan` itself is `nonReentrant` (nested flash loans revert — `test_NestedFlashLoan_RevertsDueToNonReentrant`); deposit-during-callback still works because `deposit` carries no guard.
- The OVRFLO cycle: deposit PT -> receive ovrfloToken + OVRFLO Stream -> borrow the stream's full discounted value on OVRFLOLending (economically a sale; the loan-only market has no separate sale mechanism) -> exit ovrfloToken via unwrap or swap. Captures the fixed PT discount as extractable yield. See `README.md` and `CONCEPTS.md` "OVRFLO cycle" entry.
- Permissionless wrap/unwrap path: underlying <-> ovrfloToken 1:1, bounded by a separately tracked wrap reserve (not the raw token balance). Direct transfers to the vault do not increase wrap reserve.
- UI reference / brand source: https://overflow.finance (stream-management-focused app UI, 2026 aesthetic); built via the `/frontend-design` skill. Frontend is Next.js + wagmi + viem in `web/`.
- Plans live in `docs/plans/`. Do not edit plan files while implementing them — treat them as read-only specs.
- The correct solvency invariant for an OVRFLO vault is combined: `totalSupply <= underlying.balanceOf(vault) + ptToken.balanceOf(vault)`. Individual checks (`wrappedUnderlying <= balance`, `marketTotalDeposited <= PT balance`) are too strict post-maturity when ovrfloToken fungibility allows cross-exits (a wrapper claims PT, a depositor unwraps underlying). As long as the combined invariant holds, every holder can exit through some path (unwrap, claim, DEX). ovrfloToken fungibility across deposit and wrap origins is a design feature that increases exit optionality — no one is forced into any particular exit path. Established during the 2026-07-01 fuzz campaign.
- `sweepExcessPt` requires `ptToMarket[ptToken] != address(0)` to prevent draining the wrap reserve when a non-PT address (e.g. the underlying token) is passed. This is input validation on a token-transfer function, distinct from R-02 (rejected `to = address(0)` guard) which concerns the sweep destination. The multisig validates intent; the contract validates input.
- wstETH is the correct vault underlying (not stETH). The value chain `ovrfloToken = PT = SY = wstETH` is 1:1 at every link. The ~0.1% token-count gap when redeeming PT through Pendle's SY is exchange rate lag on Pendle's side, not an OVRFLO accounting issue. This is self-policing: the SY lag discourages wrap->claim arbitrage and nudges users toward unwrap (the hard-backed path). Using stETH would create a 22%+ value mismatch between exit paths (unwrap gives 1 stETH, claim gives 1 wstETH ~= 1.2287 stETH), transferring value from depositors to wrappers. stETH rebasing also breaks the `wrap` function's strict balance-delta check.

## Knowledge Base

- `docs/solutions/` holds writeups of past problems organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Categories: `architecture-patterns/`, `design-patterns/`, `best-practices/`, `security-issues/`, `integration-issues/`, `runtime-errors/`, `ui-bugs/`, `developer-experience/`, `patterns/`. `docs/solutions/patterns/ovrflo-critical-patterns.md` is required reading — 20 enforceable rules extracted from those writeups. Relevant when implementing or debugging in a documented area.
- `CONCEPTS.md` holds shared domain vocabulary for OVRFLO entities, named processes, and status concepts; relevant when orienting to the codebase or discussing domain concepts.
