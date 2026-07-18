---
title: "Greenfield web/ rebuild: Markets UI + vault flows on the current ABI"
type: feat
date: 2026-07-18
supersedes: 2026-07-07-002-feat-web-book-market-wiring-plan.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# Plan: Greenfield web/ rebuild — Markets UI + vault flows

Scope: `web/` (rebuilt from scratch), `script/seed-local.sh`, `mockups/`, `tools/envio/` (final phase).
Goal: a new app — Markets trading UI for OVRFLOLending plus the vault flows (deposit, claim, streams) — wired to the **current** contract ABI, runnable end-to-end on a local Anvil fork via `npm --prefix web run bootstrap:local`.

**This plan supersedes `2026-07-07-002-feat-web-book-market-wiring-plan.md`.** That plan's architecture (discovery chain, hook shapes, four-role panel UX, modal flows, two-wallet manual verification, phased indexer) carries over and is not restated in full here — read it for UX detail. What changed: the contract ABI (src simplification, verified 2026-07-18), the stack (wagmi v3), the build approach (greenfield, not migration), and several externally-verified corrections (Sablier fee mechanism, Pendle API). Where this plan and the old plan conflict, **this plan wins**.

---

## Key Technical Decisions

KTD1. **Greenfield, not migration.** The old `web/` is discarded (it is already broken against the deployed ABI — `useAllMarkets` decodes the deleted 8-field `series` tuple, and its hand-written Sablier ABI declares `calculateMinFeeWei`, which does not exist on the deployed contract). Kept **as reference only**: `lib/config.ts` env plumbing, `lib/preflight.ts`, `lib/sablier.ts` GraphQL client, `lib/format.ts`, the modal step-lifecycle pattern in `ClaimModal`/`NewOvrfloModal`, `useModalA11y`, the CSP/static-export scripts (`build-csp.mjs`, `verify-static-export.mjs`, `check-banned-patterns.sh`), and the constraints recorded in `web/reviews/*.md` (binding: no cache-invalidation-free writes, single error-mapper, no `Number` on token amounts; moot: everything about the light theme).

KTD2. **Stack: Next 16.2.x + wagmi 3.7.x + viem 2.55.x + TanStack Query 5.x + Tailwind 4 + Reown AppKit + Vitest 4 — gated by Spike 0.** wagmi v2 is frozen — greenfield targets v3. Rename surface (per the official v2→v3 migration guide): `useAccount` → `useConnection`, `useAccountEffect`/`useSwitchAccount` renames, mutation fns standardized; read/write hooks (`useReadContract(s)`, `useWriteContract`, `useWaitForTransactionReceipt`, `useSimulateContract`) keep their names. Wallet modal: Reown AppKit — but note the evidence is asymmetric: RainbowKit is confirmed v2-only, while AppKit's peer range (`wagmi >=2.19.5`, verified on npm 2026-07-18) merely *admits* v3; no source confirms it is tested against v3. Therefore:
   **Spike 0 (first act of P2, before any scaffolding):** scratch branch installing `wagmi@^3.7`, `@reown/appkit@latest`, `@reown/appkit-adapter-wagmi@latest`, and the v3-mandated connector peer deps; render `createAppKit`, connect an injected wallet, compile and fire `useConnection` + one `useWriteContract`, and confirm the installed v3 migration guide's rename list. Only on green does the stack lock. **Fallback ladder if Spike 0 fails:** (1) custom DESIGN.md-native connect modal on bare wagmi v3 connectors (~200 lines: injected + WalletConnect provider; QR via a small lib; also tightens CSP by dropping the `*.reown.com`/`*.walletconnect.com` allowances and matches the sharp-corner/no-shadow design by construction); (2) only if that is rejected, defer to frozen wagmi 2.19.5 as acknowledged day-one debt. The custom modal is also the documented contingency if Spike 0 passes but AppKit's themed modal cannot be bent to DESIGN.md without fragile overrides. Connector SDKs are explicit installs in v3 — install only what we use.

KTD3. **ABIs are generated, except Sablier's.** `@wagmi/cli` foundry plugin generates `ovrfloFactoryAbi`/`ovrfloAbi`/`ovrfloLendingAbi` from `forge` artifacts (ABI constants only, no hook codegen) — this makes the drift that broke the old app structurally impossible. **Exception: the Sablier Lockup ABI is permanently hand-maintained** — the repo's `ISablierV2LockupLinear.sol` is a narrow interface of what the contracts call; frontend-only functions (`withdrawMax`, `getRecipient`, ERC-721 approvals) have no forge artifact. Hand-write it once against the Sourcify-verified ABI of `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`, and add a **Sablier ABI drift test**: a Vitest test asserting every entry in the hand-written `sablierLockupAbi` matches the corresponding signature in the vendored `tools/envio/abi/SablierV2LockupLinear.json` (pinned in-repo copy, not a live fetch) — this closes the one drift surface typegen can't cover, the exact surface that broke the old app. **Spike (before committing to typegen): run generation once and assert `StreamPricing`'s 8 custom errors appear in the generated `ovrfloLendingAbi`** (library errors referenced via `revert` should flatten into the consumer artifact; if not, hand-append the 8 `type:"error"` entries). CI-enforced drift check: a Vitest test asserting expected function/error names exist in the generated ABI, plus regeneration in the build script so stale artifacts fail loudly.

KTD4. **Sablier claim flow (corrects the old plan).** On the deployed v1.1.2 contract: `withdrawMax(uint256 streamId, address to)` is **nonpayable** — send no value; `calculateMinFeeWei` **does not exist** (it belongs to newer Sablier versions); withdrawals are fee-free. Withdraw ACL: only the stream's sender, recipient, or approved operator may call — the connected wallet must be the recipient (`getRecipient(streamId) == user`; exists on the deployed ABI). `withdrawableAmountOf` returns `uint128`. Verified via Sourcify + the vendored `tools/envio/abi/SablierV2LockupLinear.json`; re-verify empirically with one `cast call` against the local fork during U2.

KTD5. **`gatherLiquidity` is the primary matcher (reverses the old plan's client-side assembly).** Current signature: `gatherLiquidity(market, aprBps, targetAmount, startId, borrower)` — pass the connected wallet as `borrower` (self-exclusion is now correct under `eth_call`); pass `address(0)` when no wallet is connected (disables exclusion — fine for unauthenticated depth preview). The client-side scan over `useLendingOrders.liquidity` is kept **only** for the "why insufficient" empty state (distinguish "no liquidity at this rate" from "only your own liquidity") and runs lazily, only after the on-chain call returns `sufficient: false`. **Pagination:** the contract returns no resume cursor; treat `sufficient: false` with `nextLiquidityId <= startId + SCAN_WINDOW` as final, else re-call with `startId += SCAN_WINDOW` (window 500, matching the enumeration cap). **Stale-id revert:** between preview and submit, a gathered id can be drained by another user; `_validateLiquidity` then hard-reverts `"OVRFLOLending: liquidity inactive"` on the whole batch — this is NOT the slippage case and NOT insufficiency. Dedicated error copy ("Liquidity changed since your quote — refreshing…") + automatic refetch + re-gather. `minAcceptable` never fires on this path (the revert precedes it).

KTD6. **Cache invalidation: receipt-triggered `invalidateQueries` on hook-returned `queryKey`s.** The old plan's premise (wagmi keys not addressable) is wrong in v2 and v3 — every wagmi query hook returns `queryKey`. Pattern: `useWriteContract` → `useWaitForTransactionReceipt` → on success, `queryClient.invalidateQueries({ queryKey })` for each affected read. The old plan's write→invalidation matrix (its "Cache invalidation matrix" section) carries over as the authority on *which* domains each write touches; only the mechanism changes. No `refetch()`-callback plumbing.

KTD7. **Wrap/unwrap is backlog item #1, not core** (resolves the scope ambiguity). Core scope = Markets loop (lend, borrow, sell, buy, repay, close, claim shares) + vault deposit/claim/streams. Wrap/unwrap ships immediately after the E2E gate, first backlog item, same as the old plan's ordering. Matured-series claim promotion, USD context, activity history, and the Pendle zap remain backlog in that order.

KTD8. **DESIGN.md is the visual authority; no migration phase exists.** Build directly from the mockups (`app-tables-v2.html` as the Markets base — after applying the still-pending structural corrections from the old plan's Phase 4; `landing-v3.html` for the landing). Dark theme from day one: obsidian/carbon/graphite/chalk/dim, cyan = borrow, gold = lend, no shadows/blur/rounding > 2px, mono for all data, tabular-nums, 1200px rail. The old plan's Phase 0 (component migration) is deleted — there is nothing to migrate.

KTD9. **Test strategy split.** Provider-tree integration tests (wagmi `mock` connector + real `WagmiProvider`/`QueryClientProvider` wrapper) for every component containing a write flow (all five modals + panel actions). Plain module-level mocks acceptable for pure enumeration/display hooks and pure libs. Pure math (`lending-math.ts`) tested without wagmi at all. The old suite's module-mock-everything approach is not carried over.

KTD11. **Indexer: Ponder replaces the vendored Envio indexer** (researched 2026-07-18; overturns the ideation doc's "keep Envio" on two facts that postdate its reasoning). Sablier entered maintenance mode 2026-07-13 — their hosted endpoint (the current devnet/mainnet fallback) runs only through **June 2028**, so self-hosting is mandatory before mainnet either way. Self-hosted Envio without HyperSync loses its entire speed advantage while keeping a three-service Docker footprint (Postgres+Hasura+indexer), a HyperSync token dependency with unfinalized pricing, and the pending V2→V3 rewrite; Ponder is one Node process (embedded PGlite in dev — Docker leaves `bootstrap:local`), standard `eth_getLogs` only, first-class `factory()` support for `LendingDeployed` children, and the sync workload here is trivial. Pattern #1 is engine-generic ("an indexer or `ownerOf`") — no institutional rule is violated; `check-banned-patterns.sh` needs zero changes. **Must-port scar tissue:** the mint-Transfer skip in the current handlers (the transferred-NFTs fix — a Transfer from `address(0)` must not clobber the recipient set by the co-emitted Create event). Local-fork sharp edges (documented in Ponder's Foundry guide): `disableCache: true` is mandatory (our fork reports chain id 1, so Ponder would otherwise cache fork-local blocks as mainnet), interval mining preferred (~2s; auto-mining has a known stall edge). Query shape changes from Hasura-style (`where: {recipient: {_eq}}`) to Ponder's flat operators + `items`/`pageInfo` envelope — or use `@ponder/client` typed SQL-over-HTTP instead of GraphQL (decide at implementation; the contract test pins whichever is chosen). `tools/envio/` is deleted once the Ponder indexer passes the local E2E gate. Ponder pins: latest 0.x at implementation time, Node ≥22; budget for pre-1.0 breaking minors.

KTD10. **Env/chain gating unchanged.** Anvil forks mainnet and reports chain id 1; keep the mainnet-only chain assertion from the old `config.ts`. Addresses flow at runtime from `deployments/local.json` → `write-env.sh` → `NEXT_PUBLIC_*`; typegen supplies ABIs only — the two pipelines stay separate (no per-chain `deployments` blocks in `wagmi.config.ts`).

---

## Ground truth: current contract surface (re-verified 2026-07-18)

Discovery chain (all current names):

```
env NEXT_PUBLIC_OVRFLO_FACTORY
  -> factory.ovrflos(i) / ovrfloCount()
  -> factory.ovrfloInfo(vault)                      (treasury, underlying, ovrfloToken)
  -> factory.approvedMarketCount(vault) / approvedMarketAt(vault, i)
  -> vault.series(market)   -> 7 fields: (twapDurationFixed, feeBps, expiryCached,
                               ptToken, ovrfloToken, underlying, oracle)
                               approval = ptToken != address(0)   [no `approved` field]
  -> factory.ovrfloToLending(vault)                 (address(0) = not deployed)
```

Lending reads — **auto-getters only; zero-structs for unknown ids, never reverts**:

| Data | Getter | Shape |
|---|---|---|
| Params | `aprMinBps()/aprMaxBps()/feeBps()` | uint16 each; launch 1000/1000/0 — always read |
| Cursors | `nextLiquidityId()/nextSaleListingId()/nextLoanId()` | start at 1. **No `nextLoanPoolId` — single ID space, loanId == loanPoolId** |
| Liquidity | `liquidityPositions(id)` | `(lender, market, aprBps, availableLiquidity)` — 4 fields, **no `active`**; active ⇔ `availableLiquidity > 0`; exists ⇔ `lender != 0` |
| Listing | `saleListings(id)` | `(seller, market, streamId, aprBps, feeBps, active)` — `active` here IS a real stored field; do not share an "active" helper with liquidity |
| Loan | `loans(id)` | `(borrower, streamId, obligation, drawn, repaid, closed)` — 6 fields, **no `lender`, no `outstanding`**; compute `outstanding = obligation - drawn - repaid` client-side; exists ⇔ `borrower != 0` |
| Pool | `loanPools(id)` | `(borrower, aprBps, market, totalContributed)` — 4 fields, **no `totalObligation`**; obligation lives on `loans(id)` |
| Pool accounting | `loanPoolContributions(id, addr)`, `loanPoolReceived(id, addr)`, `loanPoolProceeds(id)` | keyed by loanId. **`loanPoolLoanId`/`loanToLoanPool` deleted** |
| Pricing | `quote(market, streamId, aprBps, borrowAmount)` | unchanged; `borrowAmount = 0` = full-sale price |
| Matching | `gatherLiquidity(market, aprBps, targetAmount, startId, borrower)` | see KTD5 |

Writes: all 10 functions unchanged from the old plan (section 0.3 there remains accurate, including approval prerequisites, `claimLoanPoolShare(loanId, type(uint128).max)` max-claim pattern, and `lender != borrower` on `createBorrowerLoanPool`).

Claimable math (formula unchanged; lookup path simplified):

```
loan      = loans(loanId)                        // no translation map
recovered = loan.drawn + loan.repaid
            + (loan.closed ? 0 : min(withdrawableAmountOf(loan.streamId), outstanding))
entitled  = loanPoolContributions[loanId][user] * recovered / loanPools(loanId).totalContributed
claimable = max(0, entitled - loanPoolReceived[loanId][user])
```

**Error surface — re-derive, do not patch the old table.** Custom errors (exactly 8, from `StreamPricing.sol`): `MarketNotApproved, WrongSender, WrongAsset, WrongEndTime, SeriesMatured, CliffPresent, CancelableStream, RemainingZero` (`SeriesNotApproved` and `CoreNotRegistered` are deleted — remove their copy entries entirely, do not fold into neighbors). Revert strings: generate the table from `rg -o '"OVRFLOLending: [^"]*"' src/OVRFLOLending.sol | sort -u` at implementation time. Collision trap: `"unknown liquidity"`/`"unknown listing"` no longer exist; `"liquidity inactive"`/`"listing inactive"` now cover BOTH "never existed" (via zero-struct → write-path guard) and "drained/closed" — write one message per string that is honest for both cases, plus the KTD5 stale-batch copy. Only `"unknown loan"` survives as an existence error.

Enumeration semantics: with zero-struct getters, per-id failures are impossible — filter uniformly on the identity field (`lender != 0` / `seller != 0` / `borrower != 0`); loading vs. empty is distinguished by the hook's `isLoading`, never by result absence. Keep the 500-id cap per side with the same too-large error.

---

## Phases

### P1 — Seed script repair + lending deploy (hard prerequisite)

`script/seed-local.sh` is broken four ways vs. the current factory (verified): 1-arg `forge create` vs `constructor(owner, oracle)`; 3-arg `prepareOracle` vs 2; 5-arg `addMarket` vs 4; stETH underlying vs the fixtures' wstETH. Fix per the old plan's Phase 1.0 items 1–6 (still accurate, including the wstETH wrap-and-transfer sequence and seeding anvil account #2 `0x3C44...93BC` as the lender wallet), then add the `deployLending` step + `lending`/`lenderWallet` fields in `deployments/local.json` per old Phase 1.1. Keep fork block 24609670 (fixtures constant) — **add a check that both fixture markets are still pre-maturity at that block's timestamp; if matured, repin fixtures first and stop.**
Verify: `bash script/seed-local.sh` completes on a fresh fork; `jq .lending deployments/local.json` non-zero; `cast call $LENDING 'aprMinBps()(uint16)'` → 1000.

### P2 — Scaffold + data layer

New Next 16 app in `web/` (static export, CSP scripts carried over, Reown AppKit, dark theme tokens in `globals.css` from DESIGN.md). `wagmi.config.ts` with the foundry plugin (KTD3 spike first); hand-written `sablierLockupAbi` (KTD4 surface: `withdrawMax`, `withdraw`, `getRecipient`, `withdrawableAmountOf`, `getDepositedAmount`, `getWithdrawnAmount`, `approve`, `getApproved`, `isApprovedForAll`, `transferFrom` — all nonpayable/view per the verified ABI). Hooks, mirroring the old plan's shapes with the new ground truth: `useOvrflos`, `useAllMarkets` (7-field series), `useLending`, `useLendingOrders` (auto-getters + zero-struct filtering), `useLendingPositions` (single-ID claimable math above), `useUserStreams` + `fetchEscrowedStreams` overlay (old section 0.7 carries over — discovery via the new Ponder indexer per KTD11).
**Ponder indexer (new `tools/ponder/`, replaces `tools/envio/`):** the 5 Sablier LockupLinear events with the mint-Transfer skip ported, `ponder.schema.ts` mirroring the current 2-entity shape, `disableCache: true` + interval mining for the local fork, wired into `bootstrap-local.sh` in place of `envio:up` — **with a readiness poll this time** (Ponder exposes health/ready endpoints; the old bootstrap started Envio blind). Money-numbers-on-chain rule unchanged. Pure `lib/lending-math.ts` (`loanPoolClaimable`, `formatAprBps`, `aprChoices`) with Vitest. Error mapper: single module, custom-error decoding via `ContractFunctionRevertedError.data?.errorName` + the re-derived string table.
Verify: ABI-drift Vitest test green; `npm --prefix web run test` green; a scratch page renders live factory/market/lending data from the fork.

### P3 — Markets UI + vault flows

Old plan sections 3.1–3.3 carry over as the UX spec (four-role 2×2 grid LENDING/BORROWING/STREAMS/SELLING, markets table ASSET/LIQUIDITY DEPTH/FOR SALE/APR/FEE with the single-rate rationale, five modals) with these deltas: BorrowModal uses `gatherLiquidity` per KTD5 (including stale-batch retry UX); StreamClaim per KTD4 (no value, no fee call, recipient preflight via `getRecipient`); RepayModal computes `outstanding` client-side; all invalidation per KTD6's mechanism with the old matrix's domains. Vault flows rebuilt: deposit (PT), claim (post-maturity burn), stream list — reusing the modal-lifecycle pattern by reference. Empty-state acceptance: a fresh lending market (`nextLiquidityId == 1`) renders panel empty states in one pass — no spinner (the multicall array is empty).
Verify: Vitest component tests per KTD9; manual render against the fork.

### P4 — Mockup corrections

Old Phase 4 punch-list, still pending (confirmed): four-role grid replaces the 2-panel strip, headers → ASSET/LIQUIDITY DEPTH/FOR SALE/APR/FEE, SELL/BUY buttons, wiring-map comment rewritten against the P2 ground truth (current getter names, wstETH denomination). Landing diagram centering + buy-side marketing copy carry over.

### P5 — Local E2E gate

The old plan's 8-step two-wallet manual flow carries over verbatim (dev wallet borrows/sells/buys/claims; lender wallet supplies/claims shares) with one correction: step 7's stream CLAIM sends **no value** (KTD4). Every step must reflect on-chain state after invalidation without reload. For P5 this is a manual checklist — a human should see the flow once.
Gate: all 8 steps + `npm --prefix web run lint:security && test && build`.
**Post-P5 requirement (not a P5 gate):** a scripted Playwright + Anvil + mock-EIP-1193 E2E of the same 8 steps (deterministic, no wallet extension) is a hard precondition for any devnet/mainnet exposure — sequenced in the backlog immediately after wrap/unwrap.

### P6 — Ponder indexer extension (factory + lending)

Extend the P2 Ponder indexer (KTD11): add the factory contract block plus a `factory()`-discovered lending-market block (children share one ABI — satisfied). Entities per the current event inventory (note: `LoanClosed`/`LoanRepaid` carry no `lender`; lender-side attribution derives from `LoanPoolShareClaimed` (has `lender`) and `LiquiditySupplied` — the activity feed's lender view is claims-and-supplies, not per-loan repayment events; document this in the schema). Factory-vs-lending `LendingAprBoundsSet`/`LendingFeeSet`/`LendingTreasurySet` name collisions: index the factory variants (indexed `lending` target), skip all three lending-local duplicates. Discovery swaps inside the hooks; shapes frozen; money numbers stay on-chain (old rule stands); cap removed. Delete `tools/envio/` in this phase if not already removed after P5. **Devnet note:** the old R9 posture (hosted Sablier indexer backs devnet) has a silent gap — the hosted index only sees real mainnet, so streams created on a Tenderly VTN fork are invisible to it and the Streams/Selling panels miss every devnet-created stream. Devnet therefore runs its own Ponder instance against the VTN RPC (start block = deployment block, sync is instant; `ponder dev` mode suffices) instead of the hosted fallback. **Before mainnet:** a deployed self-hosted Ponder instance (plain Postgres) replaces the hosted-Sablier-endpoint fallback everywhere — that endpoint sunsets June 2028 with Sablier's maintenance mode, and nothing in the app may depend on it at launch.

### P7 — Backlog (ordered)

1. **Wrap/unwrap panel** (KTD7). 2. **Scripted E2E** (Playwright + Anvil + mock EIP-1193; see P5 — required before any external deploy). 3. Matured-claim promotion. 4. USD context. 5. Activity history (P6 entity). 6. Self-repay ETA. 7–8. Borrow health + liquidity guardrails (old list). 9. **Pendle zap — rewritten spec**: the old endpoint is dead (404). Target `POST /v3/sdk/{chainId}/convert` (confirm body schema against the Swagger at implementation); response nests under `routes[0]` (`tx{to,data}`, `outputs[0].amount`, `data.priceImpact`); `tx.value` absent for ERC20 inputs (default 0). Pin Router V4 `0x888888888889758F76e7103c6CbF23ABbF58F946` (live-verified as `tx.to`); keep the old plan's spender/`tx.to` validation, approval-from-`requiredApprovals`, actual-balance-not-quoted, and local-fork-guard rules. Free tier 100 CU/min — no key required today (re-verify at implementation).

---

## Acceptance criteria

- [ ] P1: seed completes on a fresh fork; `deployments/local.json` has `factory, ovrflo, token, lending, devWallet, lenderWallet`; fixture markets pre-maturity at the pinned block
- [ ] P2 Spike 0: wagmi 3.7 + AppKit connect + one write verified green on a scratch branch before any scaffolding (or the KTD2 fallback ladder invoked and the stack decision amended)
- [ ] P2: generated ABIs contain all expected functions AND the 8 StreamPricing errors (Vitest-asserted, CI-enforced); Sablier ABI hand-file contains no `calculateMinFeeWei`, a nonpayable `withdrawMax`, and passes the drift test against the vendored envio ABI
- [ ] P2: zero-struct filtering uniform across all four enumerations; empty-market renders empty states, not spinners
- [ ] P3: every write follows preflight → write → receipt → `invalidateQueries(queryKey)`; no `refetch()` callback plumbing; no `Number` on token amounts (banned-patterns script enforces)
- [ ] P3: stream CLAIM tx has no `value` field; claim preflight checks `getRecipient == user`
- [ ] P3: BorrowModal handles all three distinct failures with distinct copy: insufficient liquidity / all-self-owned / stale-batch revert
- [ ] P5: 8-step two-wallet flow green without page reloads
- [ ] P2: Ponder indexer serves stream discovery locally (readiness-polled in bootstrap); mint-Transfer skip ported and covered by a test; `disableCache: true` set for the fork profile
- [ ] P6: hooks' return shapes unchanged after indexer extension; money numbers still on-chain; `tools/envio/` deleted; devnet/mainnet no longer reference the hosted Sablier endpoint before any external deploy
- [ ] Old plan file gains a header line: `> SUPERSEDED by 2026-07-18-002-feat-web-markets-rebuild-plan.md` (only edit permitted to it)

## References

- Superseded spec (UX authority where not contradicted): `docs/plans/2026-07-07-002-feat-web-book-market-wiring-plan.md`
- ABI ground truth: `src/OVRFLOLending.sol`, `src/OVRFLO.sol:508-522` (`series`), `src/OVRFLOFactory.sol` (`ovrfloToLending:51`, `deployLending:166`, `addMarket:191`, `prepareOracle:263`, `constructor:84`); event inventory `src/OVRFLOLending.sol:166-221`, `src/OVRFLOFactory.sol:72-78`
- Seed fixtures: `script/lib/OVRFLOTestFixtures.sol` (wstETH, fork block, markets)
- Stack (verified against npm registry / official docs 2026-07-18): wagmi v2→v3 migration guide, wagmi TanStack Query guide (addressable `queryKey`s), @wagmi/cli foundry plugin, Next 16 static exports, Reown AppKit adapter peer ranges, RainbowKit wagmi-v3 discussion #2575, testing-wagmi mock-connector reference
- Sablier v1.1.2 verified surface: Sourcify ABI for `0xAFb9...dCC9` + `tools/envio/abi/SablierV2LockupLinear.json` + sablier-labs/v2-core v1.1.2 source (withdraw ACL)
- Pendle Convert API: hosted-SDK docs + live probes 2026-07-18 (old `/v1/sdk/.../swap` 404s; v3 POST recommended; Router V4 confirmed)
- Design: `DESIGN.md`, `mockups/app-tables-v2.html`, `mockups/landing-v3.html`
- Old-app lessons (binding constraints): `web/reviews/*.md`
- Stack ideation (Spike 0, Sablier drift test, custom-modal contingency, E2E promotion adopted; Vite-vs-Next declined with flip condition on record; its "keep Envio" pick overturned by KTD11 on post-dating facts): `docs/ideation/2026-07-18-web-markets-rebuild-tech-stack-ideation.html`
- Indexer decision (KTD11, researched 2026-07-18): Sablier maintenance-mode announcement 2026-07-13 (infra through June 2028); Envio HyperSync token requirement (Nov 2025) + self-hosting docs (3-service footprint); Ponder docs — factory config, Foundry/Anvil guide (`disableCache`), GraphQL/SQL-over-HTTP, ERC-721 example; Uniswap the-compact-indexer as production reference; repo switching surface: `web/lib/sablier.ts` (single query), `tools/envio/src/EventHandlers.ts:121-140` (mint-Transfer skip to port)
