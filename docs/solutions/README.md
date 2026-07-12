# OVRFLO Solutions Knowledge Base

Searchable, categorized documentation of non-trivial problems solved in this repo.
Each file is a single-problem writeup with YAML frontmatter for fast lookup.

Adapted from the [compound-docs](https://github.com/every-marketplace/compound-engineering) skill.
Because OVRFLO is Solidity + Next.js (not Rails/CORA), the `component` and `module`
enums have been widened to reflect our stack; everything else matches the upstream schema.

## Categories

- `build-errors/` — compile / bundle / type errors
- `test-failures/` — Forge/Foundry or Vitest failures, flaky tests
- `runtime-errors/` — exceptions, crashes, hydration mismatches
- `performance-issues/` — slow queries, extra RPC calls, memory bloat
- `security-issues/` — auth, access control, slippage, oracle issues
- `ui-bugs/` — frontend rendering, data-not-shown, layout
- `integration-issues/` — Pendle, Sablier, Envio, CoinGecko, wallets
- `logic-errors/` — business-logic bugs in contracts or client code
- `developer-experience/` — DX issues: dead code, env layout, dev setup
- `best-practices/` — testing, workflow, and code-quality practices distilled from real review work
- `architecture-patterns/` — structural and system-level design patterns for OVRFLO contracts
- `design-patterns/` — function-level design patterns and Solidity-specific learnings distilled from implementation and review work
- `patterns/` — **required reading**: short, enforceable rules extracted
  from the writeups above. If you are touching an area a pattern covers,
  follow it or have a documented reason not to.

## How to add a new entry

1. Pick a category based on the primary `problem_type`.
2. Use filename pattern: `<kebab-slug>-<Area>-<YYYYMMDD>.md`
   (e.g. `transferred-sablier-nfts-invisible-WebUI-20260421.md`).
3. Copy the frontmatter shape from any existing file in this tree.
4. Write **exact** error messages, **what didn't work**, **root cause**,
   **working solution**, and **prevention** guidance.
5. Cross-link related entries under `## Related Issues`.

## Current entries

### Required reading (patterns)

- [patterns/ovrflo-critical-patterns.md](patterns/ovrflo-critical-patterns.md)
  — enforceable rules distilled from the writeups below. Currently covers:
  1. ERC-721 current ownership comes from the token, not from derived protocol events.
  2. Do not use `forge script --broadcast` against an Anvil mainnet fork (foundry#11714); use `forge create` + `cast send` via `script/seed-local.sh`.
  3. Modal bodies — and only modal bodies — are wrapped in a class-component error boundary with an `onReset` contract (header/close button stay outside).
  4. Prevent self-matched loans in OVRFLOLENDING (`createBorrowerLoanPool` / `createLenderPool`).
  5. TWAP duration bounds must be consistent across `prepareOracle` and `addMarket`.
  6. Standalone OVRFLOLENDING deployment must verify Sablier matches the vault's canonical immutable.
  7. Assert all-party token balances in every money-movement test (not just state flags and NFT ownership).
  8. View functions that resolve by ID must revert on non-existent IDs, not return zero defaults.
  9. The factory owns every deployed lending — lending admin is forwarded, not direct.
  10. One vault per underlying — `configureDeployment` must reject duplicates.
  11. Require strictly-increasing IDs in batch functions that accept ID arrays.
  12. Cap shared-pool claims at the lender's pro-rata share of current `loanPoolProceeds`.
  - Also includes a "Considered and rejected" section documenting 4 findings from the 2026-06-28 full-contract review that were explicitly dismissed (18-decimal underlying check, sweep zero-address guard, unchecked downcasts in deposit, registeredToken equality check).

### Best practices

- [best-practices/verify-token-balance-movement-not-just-ownership.md](best-practices/verify-token-balance-movement-not-just-ownership.md) —
  Non-fork tests for OVRFLOLENDING must assert `underlying.balanceOf` (and
  `ovrfloToken.balanceOf` / `sablier.getWithdrawnAmount` / `sablier.ownerOf`
  where applicable) for every party that touched value (seller, buyer,
  treasury, lending), not just state flags and NFT ownership. State flags prove
  an entry changed hands; balance assertions prove the money moved correctly.
- [best-practices/record-rejected-findings-with-rationale.md](best-practices/record-rejected-findings-with-rationale.md) —
  Rejected audit and code-review findings should be recorded in a persistent
  decision record with the original claim, rejection rationale, and supporting
  evidence, so future reviewers start where the last review ended instead of
  re-deriving settled conclusions.

### Web UI

- [integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md](integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md) —
  Streams whose Sablier NFT was transferred to a new wallet never appeared for the new
  recipient. Fixed by reverting from on-chain `Deposited` log scanning to the Sablier
  Envio GraphQL indexer.
- [ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md](ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md) —
  `useUsdPrices` was implemented but neither the Dashboard nor the Deposit/Claim modals
  ever rendered dollar values. Fixed by plumbing the `prices` prop through and rendering
  sublines via `formatUsdValue`.
- [developer-experience/post-refactor-dead-code-WebUI-20260421.md](developer-experience/post-refactor-dead-code-WebUI-20260421.md) —
  After the single-factory, indexer-revert and USD-wiring refactors, several files,
  env vars, ABI entries and helpers were left unreferenced. Removed without regression.
- [runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md](runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md) —
  A render-time throw inside `NewOvrfloModal` / `ClaimModal` (e.g. transient
  `useReadContracts` failure, mid-render wallet disconnect) escaped to
  `app/error.tsx` and crashed the whole dashboard, wiping in-progress form
  state. Fixed with a scoped class-component `ModalErrorBoundary` wrapping
  the modal *body only* (header/close button stay outside) plus an `onReset`
  contract so "Try again" actually retries.

### Security analyses

- [security-issues/flash-loan-wrap-claim-redeem-griefing-WrapUnwrap-20260622.md](security-issues/flash-loan-wrap-claim-redeem-griefing-WrapUnwrap-20260622.md) —
  Audit note. A flash-loan `wrap → claim → Pendle-redeem` loop could displace a
  matured series' PT, raising a claim-griefing concern. Reasoned and dismissed:
  the loop is value-neutral (every leg 1:1, fee-free), self-provisions the
  `unwrap` exit it displaces, has no profitable variant (no viable PT↔ovrfloToken
  AMM, Pendle's pool disabled post-expiry, no cross-series swaps), and only costs
  the attacker gas. Lists the trust assumptions and the conditions that would
  reopen it.
- [security-issues/repayloan-equality-rounding-no-brick-OVRFLOLENDING-20260624.md](security-issues/repayloan-equality-rounding-no-brick-OVRFLOLENDING-20260624.md) —
  Audit note. Concern that `bool closes = amount == outstanding;` in
  `OVRFLOLENDING.repayLoan` could brick loan closure via a rounding off-by-one.
  Dismissed: `outstanding` is always an exact integer wei
  (`obligation - drawn - repaid`), the borrower controls `amount` and can match
  it exactly on an 18-decimal token, and `obligation <= remaining` (ceiling debt
  vs. floor price) so the stream-draw close path via permissionless `closeLoan`
  always eventually succeeds. Documents the rounding invariants future
  `StreamPricing` edits must preserve. Includes a companion finding (fixed
  2026-06-28): self-matched loans (`borrower == lender`) broke `repayLoan`
  because `_pullExact`'s balance-delta check reverts on self-transfer; fixed by
  rejecting self-matching at loan creation in `createBorrowerLoanPool` and
  `createLenderPool`.

### Architecture patterns

- [architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md](architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md) —
  How the OVRFLO wrap/unwrap reserve is accounted and why deposit-origin
  ovrfloToken cannot consume the wrap reserve.
- [architecture-patterns/ovrflolending-entry-teardown-zero-what-matters.md](architecture-patterns/ovrflolending-entry-teardown-zero-what-matters.md) —
  OVRFLOLENDING tears down cancelled/filled entries by zeroing only the
  security-critical fields (`capacity`/`active`) and leaving identity/context
  fields populated. Post-EIP-3529 a full `delete` costs net gas to zero extra
  slots, and loans must never be erased (`loanState` history is a feature).
- [architecture-patterns/ovrflolending-liquidity-market-active-gate.md](architecture-patterns/ovrflolending-liquidity-market-active-gate.md) —
  OVRFLOLENDING liquidity posts (`postSaleLiquidityPosition`/`postLendLiquidityPosition`) front-load
  market/series/maturity validation via `_requireMarketActive` so lenders fail
  fast before locking liquidity behind a dead market. The shared checks live in
  one `StreamPricing.marketActive` helper that `requireEligible` also delegates
  to — single source of truth, no hot-path gas regression.
- [architecture-patterns/view-functions-revert-on-nonexistent-ids.md](architecture-patterns/view-functions-revert-on-nonexistent-ids.md) —
  View functions that resolve a struct by ID (liquidity, listing, loan) must
  revert when the ID does not exist rather than returning zero defaults.
  The sentinel is `lender`/`lender`/`borrower != address(0)`, which survives
  teardown (only `capacity`/`active` are zeroed) and fails only for IDs that
  were never created.
- [architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md](architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md) —
  The factory owns every deployed vault and lending; admin is forwarded through
  factory functions, not called directly. One vault per underlying is enforced
  at `configureDeployment` time.

### Design patterns

- [design-patterns/solidity-batch-function-safety-patterns.md](design-patterns/solidity-batch-function-safety-patterns.md) —
  Five function-level design patterns distilled from the OVRFLOLENDING Pool
  implementation: (1) strictly-increasing IDs in batch arrays to prevent
  duplicate-ID fund theft, (2) pro-rata cap on shared-pool claims to prevent
  majority-lender draining, (3) aggregate `totalObligation` for
  multi-loan pool entitlement, (4) no artificial caps on `view`-function
  results (eth_call has high gas limits), (5) stack-too-deep workarounds
  (memory arrays, block scoping, helper factoring).

### Local devnet & seeding

- [integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md](integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md) —
  `forge script --broadcast` fails against Anvil mainnet forks with
  `OutOfFunds` / `lack of funds (0) for max fee` even when the broadcaster is
  funded via `vm.deal` / `anvil_setBalance`. Worked around by replacing
  `script/SeedLocal.s.sol` with a `script/seed-local.sh` bash driver that
  uses `forge create` + `cast send` + `cast rpc`. Root cause is
  [foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714).
