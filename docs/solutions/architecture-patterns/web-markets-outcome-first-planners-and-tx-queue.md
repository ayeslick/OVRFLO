---
title: "Web Markets Outcome-First Architecture: Pure Planners, Display Math, and Sequential Tx Queue"
date: 2026-07-27
category: docs/solutions/architecture-patterns
module: web
problem_type: architecture_pattern
component: frontend_stimulus
severity: medium
last_updated: 2026-07-31
applies_when:
  - "Rebuilding or extending the OVRFLO web markets UI where borrow/claim flows depend on on-chain StreamPricing quotes and OVRFLOLending liquidity"
  - "Separating outcome-first routing and batch planning into pure TypeScript modules testable without React"
  - "Mirroring Solidity pricing math in the frontend for display labels while keeping every submitted amount sourced from contract quote() reads"
  - "Implementing multi-step claim-all flows that must execute transactions sequentially with invalidation and fresh replan on resume"
  - "Coordinating TanStack Query cache keys and invalidation after wallet changes or confirmed receipts"
tags: [outcome-first-routing, pure-planners, tx-queue, stream-pricing-mirror, claim-all, react-query-invalidation, expandable-markets-table, nextjs, wagmi, ovrflo-lending]
related_components: [StreamPricing, OVRFLOLending, "Sablier V2"]
---

# Web Markets Outcome-First Architecture: Pure Planners, Display Math, and Sequential Tx Queue

Knowledge-track learning from the Jul 23 polish pass (commits `b236024`, `d263d3e`, `629d6ff`, `bef631f`, `36e4dfa`). Five focused commits layered pure planning modules, display math, query invalidation, expandable-table UX, and a sequential claim-all queue onto the OVRFLO Next.js markets surface. Supersedes the MarketsApp-centric overlay model documented in [web-markets-ui-polish.md](../ui-bugs/web-markets-ui-polish.md) while retaining its overlay stacking and symbol-read lessons.

## Context

The OVRFLO web app (`web/`) needed a markets-first UX: users browse Pendle series in an expandable table, inspect balances and positions inline, open slim action overlays for deposit/borrow/supply, and batch-claim pool shares plus Sablier streams from a summary strip. The Jul 23 pass replaced a shallow SELECT-button table and ad hoc form logic with a layered architecture:

| Commit | Focus |
|--------|-------|
| `b236024` | Display math mirroring on-chain `StreamPricing` |
| `d263d3e` | Pure borrow router + claim-all transaction planner |
| `629d6ff` | Shared TanStack Query invalidation, real ERC20 symbols, wallet-change guards |
| `bef631f` | Expandable markets table + two-level overlay state |
| `36e4dfa` | Position summary strip + sequential claim-all queue |

The recurring theme: **keep React thin** — routing, pricing display, claim planning, and invalidation live in testable pure modules; hooks orchestrate wagmi/TanStack Query; components compose layout and affordances.

## Guidance

### 1. Pure router — separate routing logic from React

Borrow liquidity selection is **price-blind by design**: the ladder groups depth by tick coverage only; the quoting layer clamps to gross-price caps in the borrow form.

```4:6:web/lib/router.ts
// Pure ladder builder (plan KTD3). Liquidity-coverage only — price-blind by design:
// the quoting layer clamps to the tick's grossPrice cap (applied in the BORROW form).
// Selection-scoped fill planning lives in lib/borrow.ts (planSelectedBorrow).
```

**`buildLadder`** (`web/lib/router.ts`) groups open positions per APR tick for a market. Self-owned liquidity is excluded from `total` (borrowers cannot draw against their own supply) but kept in `positions` for UI display. Positions are sorted ascending by id — input order from hooks is never assumed. Passing no `self` puts all liquidity in `total` — the supply-side ladder uses this deliberately so waiting depth includes the lender's own.

**`planSelectedBorrow`** (`web/lib/borrow.ts`, tickets 06–08; superseded the original `planBorrow`) plans a fill *at the user's selected tick*: `min(target, depth)` with a `partial` flag, plus the lowest fully-covering alternative tick offered only behind an explicit "show other options" click. Position ids for the transaction come from the contract's own `gatherLiquidity` read, not from indexed data. `resolveSelectedTick` keeps the user's tick while it still has borrowable depth, defaulting to the lowest liquid tick.

The table's RATES column consumes the same ladder + display math with zero extra contract reads beyond existing liquidity hooks. Failed writes route through the **stale-recovery classification** (see `CONCEPTS.md`): stale races auto-invalidate and offer one re-confirm; terminal reverts disable with a reason; only genuinely transient failures stay retryable.

### 2. Display math layer — mirror on-chain StreamPricing, never submit from it

`web/lib/lending-math.ts` holds **display-only** bigint mirrors of `src/StreamPricing.sol`. BigInt `/` floors, matching contract `Math.mulDiv`. Every number a transaction submits must come from the contract's own `quote()` read.

```13:15:web/lib/lending-math.ts
// Display-only mirrors of StreamPricing (src/StreamPricing.sol). BigInt `/` floors,
// matching the contract's Math.mulDiv. Every number a transaction submits must come
// from the contract's own quote() read — never from these.
```

Core mirrors: `factorWad`, `upfrontBps`, `lenderReturnBps`, and `formatBpsPct` (one truncated decimal for percentages). Lender claimable projection uses **`recoveredForClaimable`**, combining drawn/repaid amounts with pending stream recovery for open loans.

For on-chain rounding directions that display math must mirror, see [repayloan-equality-rounding](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md).

### 3. Claim-all planner + sequential tx queue

**Planner (`planClaimAll`)** is pure: batch pool claims per lending contract (multicall of `claimLoanPoolShare`), then individual stream claims. Ordering is deterministic — lending addresses ascending, loan ids ascending, stream ids ascending.

**Runner (`useTxQueue`)** advances one row at a time, but it no longer owns
simulate/sign/receipt/refresh itself. Callers inject a `ClaimAllQueueExecutor`
(`confirm` + `retryRefresh`); the queue rebuilds every unsent row before the
next confirm, pauses on invariant failures (account/chain/completeness), and
**`resume()` always takes a fresh plan** recomputed from live data — never a
blind retry. Receipt truth still means the mined receipt's own success status,
not merely a resolved wait hook — see
[usetxqueue-on-chain-revert-treated-as-confirmed](../logic-errors/usetxqueue-on-chain-revert-treated-as-confirmed.md).

Pool claims encode a multicall; stream claims call Sablier `withdrawMax`. The modal signs nothing until **CONFIRM QUEUE**; RESUME recomputes from live props.

### 4. TanStack Query invalidation patterns

**Scoped invalidation** after a confirmed write via `invalidateOnChainReads`
(predicate-match on touched contracts) plus **projection refresh** via
`buildRefreshPlan` / `refreshQueryResources` so wagmi reads and discovery
scopes stay coherent:

```ts
// web/lib/invalidate.ts — scoped wagmi refresh (R39)
export function invalidateOnChainReads(
  queryClient: QueryClient,
  options: { contracts: readonly Address[]; user?: Address; streams?: boolean },
) { /* predicate-match touched contracts under WAGMI_READ_ROOTS */ }

// web/lib/query-resource-registry.ts — projection + contract refresh plan
export function buildRefreshPlan(
  resources: readonly TouchedResource[],
  identity: ActionIdentity,
): RefreshPlan { /* … */ }
```

`useWriteFlow` declares `touchedResources` on the ready action and refreshes
through the resource registry. `useTxQueue` no longer calls invalidation
helpers directly — it injects an executor whose confirm/refresh path owns
receipt-gated refresh (same registry contract).

**Named exception:** `invalidateAllOnChainReads` remains the deliberately
unscoped refresh for other-party stale-liquidity recovery (`useStaleRecovery`).
Do not hand it an empty scoped set — that quietly turns recovery into a no-op.
See [scoped-cache-invalidation-and-its-named-exception](./scoped-cache-invalidation-and-its-named-exception.md).

Tick-scoped `market-depth` resources must also match whole-market projection
keys (`aprBps` null) — see
[tick-scoped-market-depth-refresh-must-match-whole-market-keys](../logic-errors/tick-scoped-market-depth-refresh-must-match-whole-market-keys.md).

### 5. Expandable table + overlay UX

**Two-level state** in `MarketsApp`: `selectedMarket` drives the expanded row; `activeMode` drives the action overlay. Closing the overlay clears `activeMode` only — the row stays expanded. Signer switch collapses both.

**Expandable row** — one at a time, `aria-expanded` on row and toggle button, inline detail row with `stopPropagation` so clicks inside don't collapse.

**Disabled actions always explain why** in `MarketRowDetail` (CONNECT WALLET, MARKET MATURED, LENDING NOT DEPLOYED, etc.).

**Symbol batching** — one deduped `useReadContracts` at app root, threaded as props via `symbolFor`. Before adding more reads to this batch (or building a new one), verify every call's `query.enabled` predicate matches exactly — see [wagmi read-batching enabled-predicate safety](../architecture-patterns/wagmi-read-batching-requires-matching-enabled-predicates.md).

**Wallet-change guard** — forms reset and show a notice until the user acknowledges; never act on selections from a prior account (`useWalletChangeReset`).

Wrap modal error boundaries around fetch-heavy modal bodies per [modal-render-error doc](../runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md) and pattern #3 in [ovrflo-critical-patterns.md](../patterns/ovrflo-critical-patterns.md).

### 6. Position summary strip — per-market reporters, per-symbol aggregation

The R1 strip aggregates STREAMS / SUPPLIED / LOANS / CLAIMABLE **per token symbol**, never cross-summed across different tokens. Per-market reporter children mount hooks unconditionally and bubble aggregates upward; one market's error renders "—" without stalling siblings.

## Why This Matters

1. **Testability** — Pure modules (`router.ts`, `claim-all.ts`, `lending-math.ts`) unit-test without React or wagmi mocks.

2. **Safety boundaries** — Display math is explicitly separated from transaction inputs. The router is price-blind so UI rate previews cannot drift into submitted calldata. Wallet-change guards prevent signing with stale form state after account switch.

3. **Consistency under writes** — Shared refresh planning means single-tx forms and multi-tx claim-all queues refetch the same wagmi and projection query keys. Projection scopes for held streams / demand are invalidated from declared touched resources rather than unbounded polling loops. Claim-all's queue injects an executor for confirm/refresh rather than calling invalidation helpers itself.

4. **Progressive disclosure** — Expandable rows keep the markets list scannable; overlays isolate transaction complexity. Disabled buttons with captions reduce support burden vs. mysteriously grayed controls.

5. **Multi-tx UX without race conditions** — Sequential queue with receipt-gated advance, pause-on-signer-switch, and fresh-plan resume avoids parallel nonce conflicts, stale calldata retries, and cross-account signing.

## When to Apply

Apply this layered pattern when building DeFi frontends that:

- **Route across on-chain liquidity** (order books, tick ladders, pool aggregation) — extract routing into pure functions mirroring contract semantics (self-match exclusion, strictly-increasing ids).
- **Show pricing previews** that mirror Solidity math — duplicate the formula in a display module with an explicit "never submit from here" contract; always read `quote()` or equivalent for tx args.
- **Batch multiple writes** (claims, approvals + actions, multicalls) — use a planner (what to send) separate from a runner (when to send), sequential execution, invalidation per receipt, fresh replan on resume.
- **Mix wagmi contract reads with browser-side discovery projections** — scoped invalidation for chain reads plus resource-registry refresh for projection keys.
- **Use expandable tables for primary navigation** — two-level state (selection vs. modal), collapse on signer switch, aria-expanded for accessibility.
- **Aggregate multi-market positions** — reporter-child pattern so React hook rules stay satisfied and partial failures degrade gracefully per symbol.

Skip the full stack for trivial single-action pages (one contract, one read, one button) where the abstraction tax exceeds the benefit.

## Examples

### Per-form invalidation → scoped + registry refresh

**Before** (`629d6ff^`): each form passed its own `invalidateKeys`; easy to miss a key when adding a new read.

**After**: declare `touchedResources`, refresh through `buildRefreshPlan` /
`refreshQueryResources`, and keep `invalidateAllOnChainReads` only as the
named other-party recovery exception (see scoped-cache learning).

```ts
const plan = buildRefreshPlan(resources, identity);
await refreshQueryResources(queryClient, plan, { captureHead, hydrate });
```

### Hardcoded symbols → batched ERC20 reads

Deduped batch at app root via `useMarketSymbols`, case-insensitive lookup via `symbolFor`, threaded from `MarketsApp` into table and detail components.

### SELECT-button table → expandable primary surface

**Before** (`bef631f^`): flat four-column table with a SELECT button; no inline detail, no TVL/rates.

**After**: click-to-expand row, maturity + days, TVL from `marketTotalDeposited`, live RATES from `buildLadder` + `upfrontBps`, `MarketRowDetail` inline. Overlay wiring stays in `MarketsApp` — table emits `onMode`, app renders `MarketDetail` scrim.

### Display math added atop existing lending helpers

**Before** (`b236024^`): `lending-math.ts` had loan/pool helpers only — no StreamPricing mirrors.

**After**: WAD/BPS constants and pricing mirrors with explicit display-only boundary (`factorWad`, `upfrontBps`).

### Claim-all from planner to sequential queue

Planner output shape:

```7:9:web/lib/claim-all.ts
export type QueuedTx =
  | { kind: "pool-claims"; lending: Address; loanIds: bigint[] }
  | { kind: "stream-claim"; streamId: bigint };
```

Queue advances on receipt with invalidation every step; `resume()` recomputes plan from live pool/stream props.

## Related

- [Web Markets UI Polish](../ui-bugs/web-markets-ui-polish.md) — predecessor overlay and symbol-read patterns (Jul 23)
- [Modal render error crashes dashboard](../runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md) — error boundary placement for fetch-heavy modals
- [OVRFLO Critical Patterns](../patterns/ovrflo-critical-patterns.md) — enforceable rule #3 for modal error boundaries
- [USD prices not shown in modals](../ui-bugs/usd-prices-not-shown-in-modals-WebUI-20260421.md) — ancestor-hook + batched read pattern for pricing display
- [repayLoan equality rounding](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md) — on-chain rounding invariants display math must mirror
- [Solidity batch function safety](../design-patterns/solidity-batch-function-safety-patterns.md) — on-chain claim/pool semantics the planner targets
- [Adjust-rate multicall shrink race](../logic-errors/adjust-rate-multicall-shrink-race.md) — receipt-truth and per-flow error classification for the withdraw-then-supply multicall (tickets 06–08)
- [wagmi read-batching enabled-predicate safety](wagmi-read-batching-requires-matching-enabled-predicates.md) — the safety condition for merging `useReadContract` calls into a `useReadContracts` batch like the symbol batching described above
- [Scope cache invalidation to what a write touched](./scoped-cache-invalidation-and-its-named-exception.md) — R39 scoped invalidation + named unscoped recovery
- [Freeze what you show, recompute what you submit](../design-patterns/freeze-what-you-show-recompute-what-you-submit.md) — claim-all review snapshot vs submit replan
- [Unified executor must latch identity and rebuild before every write](../logic-errors/unified-executor-must-latch-identity-and-rebuild-before-write.md) — single-action executor races this architecture now routes through

## Related files (quick index)

| Module | Role |
|--------|------|
| `web/lib/router.ts` | Tick ladder builder (buildLadder) |
| `web/lib/borrow.ts` | Selection-scoped borrow planning, slippage, error classification, receipt parsing |
| `web/lib/positions.ts` | Position-card states, progress, adjust-rate receipt/error helpers |
| `web/lib/lending-math.ts` | Display math + loan/pool helpers |
| `web/lib/claim-all.ts` | Claim-all tx planner |
| `web/lib/invalidate.ts` | Shared query invalidation |
| `web/hooks/useTxQueue.ts` | Sequential claim runner |
| `web/hooks/useWriteFlow.ts` | Single-tx write + invalidation |
| `web/hooks/useMarketSymbols.ts` | Batched symbol reads |
| `web/hooks/useWalletChangeReset.ts` | Signer-switch form guard |
| `web/components/MarketsTable.tsx` | Expandable markets table |
| `web/components/MarketRowDetail.tsx` | Expanded row content |
| `web/components/MarketsApp.tsx` | Two-level selection state |
| `web/components/PositionSummary.tsx` | Summary strip + claim-all entry |
| `web/components/ClaimAllModal.tsx` | Review + queue UI |

Tests: `web/tests/lib/router.test.ts`, `web/tests/lib/borrow.test.ts`, `web/tests/lib/positions.test.ts`, `web/tests/lib/claim-all.test.ts`, `web/tests/lib/lending-math.test.ts`, `web/tests/hooks/useTxQueue.test.tsx`, `web/tests/components/markets-table.test.tsx`, `web/tests/components/borrow-form.test.tsx`, `web/tests/components/supply-form.test.tsx`, `web/tests/components/position-cards.test.tsx`, `web/tests/components/position-summary.test.tsx`.
