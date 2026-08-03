<!-- GENERATED FILE — DO NOT EDIT -->

# Client state — function/module index (generated)

**This file is generated. Do not hand-edit it, and never cite it as source of
truth.** The source of truth is the key catalog in `../keys/`
(`docs/maps/SCHEMAS.md` §3). If a line here is wrong, the key entry is wrong —
fix the key and regenerate. An index maintained by hand drifts and then lies
about blast radius, which is the one question this catalog exists to answer.

Regenerate:

```sh
node tools/scripts/generate-state-function-index.mjs
node tools/scripts/generate-state-function-index.mjs --check   # verify only
```

**Browser only.** `x-ray/` remains the authority for Solidity entry points and
on-chain contract state. This index does not cover, replace, or summarise it.

## Coverage

| | Count |
|---|---|
| Key files | 5 |
| Keys | 50 |
| Modules | 46 |
| `on-chain` keys | 9 |
| `projection` keys | 5 |
| `pure-client` keys | 36 |

## Trust-domain exposure by module

Counts of distinct keys each module touches, in either direction. A module with
a `projection` count is a module where a fail-closed mistake can happen.

| Module | on-chain | projection | pure-client |
|---|---|---|---|
| `web/components/action-flow/ActionFlowShell.tsx` | 0 | 1 | 4 |
| `web/components/action-flow/BorrowFlow.tsx` | 2 | 3 | 10 |
| `web/components/action-flow/ClaimFlow.tsx` | 1 | 0 | 2 |
| `web/components/action-flow/ConvertFlow.tsx` | 1 | 0 | 4 |
| `web/components/action-flow/PositionFlow.tsx` | 2 | 1 | 5 |
| `web/components/action-flow/RepayFlow.tsx` | 1 | 1 | 3 |
| `web/components/action-flow/SupplyFlow.tsx` | 2 | 2 | 5 |
| `web/components/ClaimAllModal.tsx` | 0 | 1 | 10 |
| `web/components/CopyValue.tsx` | 0 | 0 | 1 |
| `web/components/MarketDetail.tsx` | 1 | 0 | 2 |
| `web/components/MarketRowDetail.tsx` | 2 | 2 | 4 |
| `web/components/MarketsApp.tsx` | 3 | 0 | 2 |
| `web/components/MarketsTable.tsx` | 3 | 0 | 3 |
| `web/components/PositionList.tsx` | 2 | 3 | 2 |
| `web/components/PositionSummary.tsx` | 2 | 4 | 3 |
| `web/components/Providers.tsx` | 1 | 0 | 0 |
| `web/components/WalletRuntime.tsx` | 1 | 0 | 0 |
| `web/hooks/useAllMarkets.ts` | 3 | 0 | 0 |
| `web/hooks/useApprovalWriteFlows.ts` | 0 | 0 | 3 |
| `web/hooks/useBorrowDemand.ts` | 1 | 1 | 0 |
| `web/hooks/useBorrowerLoans.ts` | 0 | 1 | 0 |
| `web/hooks/useChainGuard.ts` | 1 | 0 | 0 |
| `web/hooks/useClaimAllExecution.ts` | 1 | 0 | 0 |
| `web/hooks/useClaimAllPreflight.ts` | 0 | 1 | 0 |
| `web/hooks/useClearOnConfirm.ts` | 0 | 0 | 1 |
| `web/hooks/useHeldStreams.ts` | 1 | 1 | 0 |
| `web/hooks/useLending.ts` | 2 | 0 | 0 |
| `web/hooks/useLendingLiquidity.ts` | 0 | 1 | 0 |
| `web/hooks/useLendingProjection.ts` | 0 | 4 | 0 |
| `web/hooks/useLoanBook.ts` | 0 | 1 | 0 |
| `web/hooks/useMarketSymbols.ts` | 3 | 0 | 0 |
| `web/hooks/useNowSeconds.ts` | 0 | 0 | 1 |
| `web/hooks/useOvrflos.ts` | 2 | 0 | 0 |
| `web/hooks/useProjectionSync.ts` | 0 | 5 | 0 |
| `web/hooks/useStaleRecovery.ts` | 0 | 0 | 2 |
| `web/hooks/useTransactionExecutor.ts` | 0 | 0 | 3 |
| `web/hooks/useTxQueue.ts` | 0 | 1 | 5 |
| `web/hooks/useWalletChangeReset.ts` | 0 | 0 | 1 |
| `web/hooks/useWriteFlow.ts` | 2 | 0 | 3 |
| `web/hooks/useZeroFirstApprove.ts` | 0 | 0 | 2 |
| `web/lib/discovery/lending-projection.ts` | 0 | 2 | 0 |
| `web/lib/discovery/live-projection.ts` | 0 | 4 | 0 |
| `web/lib/invalidate.ts` | 2 | 0 | 0 |
| `web/lib/query-keys.ts` | 2 | 0 | 0 |
| `web/lib/query-resource-registry.ts` | 1 | 3 | 0 |
| `web/lib/router.ts` | 0 | 1 | 0 |

## Modules

### `web/components/action-flow/ActionFlowShell.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.amount-raw` | `pure-client` | `parseAmount` turns it into the 18-decimal `bigint` the call uses |
| reads | `action.pending-label` | `pure-client` | prefixes SIGNING / CONFIRMING copy |
| reads | `action.wallet-changed` | `pure-client` | renders `WalletChangedNotice` |
| reads | `executor.status` | `pure-client` | `TxState` and `ApproveTxState` render one message per phase |
| reads | `projection.demand` | `projection` | `demandCellCopy` and `DemandAnnotation` render it |

### `web/components/action-flow/BorrowFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | `raw`, from `AmountInput` |
| writes | `action.approved-amount` | `pure-client` | `streamApprovedId`, the NFT-approval equivalent |
| writes | `action.selected-apr-raw` | `pure-client` | `selectedAprRaw` |
| writes | `action.selected-stream-id` | `pure-client` | `selectedStreamId`, seeded from the invoking action and changed by the picker |
| writes | `action.show-alternative` | `pure-client` | `showAlternative` |
| writes | `action.slippage-raw` | `pure-client` | `slippageRaw`, defaulted rather than left blank |
| writes | `action.submitted` | `pure-client` | `submitted`, set when the loan call is issued |
| reads | `action.amount-raw` | `pure-client` | validation and submit |
| reads | `action.approved-amount` | `pure-client` | step indicator and primary button |
| reads | `action.selected-apr-raw` | `pure-client` | bounds the ladder scan and the quote |
| reads | `action.selected-stream-id` | `pure-client` | chooses which held stream backs the quote and the loan call |
| reads | `action.show-alternative` | `pure-client` | swaps the quote panel for the alternative |
| reads | `action.slippage-raw` | `pure-client` | becomes the minimum-net bound carried into the call |
| reads | `action.stale-recovery` | `pure-client` | requires one explicit re-confirm instead of dead-ending |
| reads | `action.submitted` | `pure-client` | compares the settled result against what was quoted, so a short fill is reported rather than silently accepted |
| reads | `action.wallet-changed` | `pure-client` | same |
| reads | `chain.connection` | `on-chain` | signer-switch reset |
| reads | `chain.lending-config` | `on-chain` | ladder bounds and the route-ID cap that bounds batch assembly |
| reads | `chrome.now-seconds` | `pure-client` | window display |
| reads | `projection.demand` | `projection` | demand annotation beside the ladder |
| reads | `projection.market-apr` | `projection` | the candidate positions a borrow route is assembled from |
| reads | `projection.stream` | `projection` | the stream picker's candidate list |

### `web/components/action-flow/ClaimFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.pending-label` | `pure-client` | `pendingLabel` |
| reads | `action.pending-label` | `pure-client` | passed to `TxState` as the pending prefix |
| reads | `action.wallet-changed` | `pure-client` | same |
| reads | `chain.connection` | `on-chain` | signer-switch reset |

### `web/components/action-flow/ConvertFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | `raw`, from `AmountInput` |
| writes | `action.approved-amount` | `pure-client` | `ptApprovedAmount` and `underlyingApprovedAmount` |
| reads | `action.amount-raw` | `pure-client` | validation and submit |
| reads | `action.approved-amount` | `pure-client` | step indicator and primary button, per token |
| reads | `action.wallet-changed` | `pure-client` | same |
| reads | `chain.connection` | `on-chain` | signer-switch reset |
| reads | `chrome.now-seconds` | `pure-client` | window display |

### `web/components/action-flow/PositionFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.approved-amount` | `pure-client` | `approvedAmount` |
| writes | `action.selected-apr-raw` | `pure-client` | `selectedAprRaw` |
| reads | `action.approved-amount` | `pure-client` | step indicator and primary button |
| reads | `action.selected-apr-raw` | `pure-client` | the target tick of a rate adjustment |
| reads | `action.stale-recovery` | `pure-client` | same |
| reads | `action.wallet-changed` | `pure-client` | same |
| reads | `chain.connection` | `on-chain` | signer-switch reset |
| reads | `chain.lending-config` | `on-chain` | ladder bounds for a rate adjustment |
| reads | `chrome.now-seconds` | `pure-client` | window display |
| reads | `projection.market-apr` | `projection` | the position being adjusted |

### `web/components/action-flow/RepayFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | `raw`, from `AmountInput` |
| writes | `action.approved-amount` | `pure-client` | `repayApprovedAmount` |
| reads | `action.amount-raw` | `pure-client` | validation, bounded by outstanding obligation rather than wallet balance |
| reads | `action.approved-amount` | `pure-client` | step indicator and primary button |
| reads | `action.wallet-changed` | `pure-client` | same |
| reads | `chain.connection` | `on-chain` | signer-switch reset |
| reads | `projection.lender` | `projection` | the loan being repaid, polled while the form is open |

### `web/components/action-flow/SupplyFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | `raw`, from `AmountInput` |
| writes | `action.approved-amount` | `pure-client` | `approvedAmount` |
| writes | `action.selected-apr-raw` | `pure-client` | `selectedAprRaw` |
| reads | `action.amount-raw` | `pure-client` | validation, MAX handling, submit |
| reads | `action.approved-amount` | `pure-client` | step indicator and which button is primary |
| reads | `action.selected-apr-raw` | `pure-client` | the APR argument of the supply call |
| reads | `action.wallet-changed` | `pure-client` | replaces the form body with WALLET CHANGED — RE-ENTER |
| reads | `chain.connection` | `on-chain` | signer-switch reset |
| reads | `chain.lending-config` | `on-chain` | validates the chosen tick against the configured APR range |
| reads | `chrome.now-seconds` | `pure-client` | window display |
| reads | `projection.demand` | `projection` | demand annotation beside the ladder |
| reads | `projection.market-apr` | `projection` | depth at the tick being supplied to |

### `web/components/ClaimAllModal.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `claim-all.nothing-left` | `pure-client` | `nothingLeft` |
| writes | `claim-all.review-changed` | `pure-client` | `reviewChanged` |
| writes | `claim-all.review-plan` | `pure-client` | seeded from `planClaimAll({ pools, streams })`; RESUME recomputes it from the live props |
| writes | `claim-all.reviewing` | `pure-client` | `reviewing`; forced closed when the plan stops being reviewable and the run has not started |
| writes | `claim-all.started` | `pure-client` | `started` |
| reads | `claim-all.nothing-left` | `pure-client` | says so explicitly |
| reads | `claim-all.review-changed` | `pure-client` | warns before the user confirms a plan that is no longer the one shown |
| reads | `claim-all.review-plan` | `pure-client` | rendered as the row list until the run starts, then handed to `useTxQueue` |
| reads | `claim-all.reviewing` | `pure-client` | renders the review pane |
| reads | `claim-all.started` | `pure-client` | switches the row list from `claim-all.review-plan` to `queue.rows`, and keeps the review pane from collapsing mid-run |
| reads | `projection.claim-verifier` | `projection` | `preflightInvariant` supplies the queue's `completeness` and `agreement` invariants and the batch-disabled copy |
| reads | `queue.error` | `pure-client` | renders the failure copy |
| reads | `queue.pause-reason` | `pure-client` | selects the copy explaining what to fix |
| reads | `queue.paused` | `pure-client` | renders the paused state and the resume affordance |
| reads | `queue.rows` | `pure-client` | renders the row list once the run has started |
| reads | `queue.running` | `pure-client` | blocks close and Escape while a row is in flight |

### `web/components/CopyValue.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.copy-value.copied` | `pure-client` | set on copy, cleared by a timer |
| reads | `chrome.copy-value.copied` | `pure-client` | swaps the control's label |

### `web/components/MarketDetail.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.market-detail.reload-key` | `pure-client` | incremented by `ModalErrorBoundary`'s `onReset` |
| reads | `chain.market-symbols` | `on-chain` | overlay labels |
| reads | `chrome.market-detail.reload-key` | `pure-client` | passed as `key` to the form body, forcing a fresh mount |
| reads | `markets.active-mode` | `pure-client` | renders the overlay for `activeMode.market` and `activeMode.action` |

### `web/components/MarketRowDetail.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `markets.active-mode` | `pure-client` | raises `onMode` from the per-action controls |
| writes | `markets.row-detail.advanced-open` | `pure-client` | `advancedOpen` toggle |
| reads | `chain.lending-config` | `on-chain` | ladder bounds and fee display |
| reads | `chain.market-symbols` | `on-chain` | detail labels |
| reads | `chrome.now-seconds` | `pure-client` | countdown display |
| reads | `markets.row-detail.advanced-open` | `pure-client` | gates rendering of the advanced block |
| reads | `markets.selected-market` | `pure-client` | rendered only for the selected market; every read it issues is scoped to it |
| reads | `projection.market-apr` | `projection` | ladder depth in the expanded row |
| reads | `projection.stream` | `projection` | streams available to act on in the expanded row |

### `web/components/MarketsApp.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `markets.active-mode` | `pure-client` | owns `activeMode`; sets it from `onMode`, clears it on overlay close and on signer switch |
| writes | `markets.selected-market` | `pure-client` | owns the `selectedMarket` state; clears it to `null` when the connected address changes |
| reads | `chain.connection` | `on-chain` | derives the connected address; clears `markets.selected-market` and `markets.active-mode` when it changes |
| reads | `chain.market-symbols` | `on-chain` | resolves once and threads the map down as a prop |
| reads | `chain.markets` | `on-chain` | passes the market list to the table and the positions strip |
| reads | `markets.active-mode` | `pure-client` | gates whether the overlay mounts at all; a null value renders no overlay |

### `web/components/MarketsTable.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `markets.active-mode` | `pure-client` | forwards `onMode(selected, action)` from the expanded detail |
| writes | `markets.selected-market` | `pure-client` | calls `onSelect(expanded ? null : market)` from the row toggle |
| reads | `chain.lending-config` | `on-chain` | ladder bounds for the rate cell |
| reads | `chain.market-symbols` | `on-chain` | row labels |
| reads | `chain.markets` | `on-chain` | renders one row per market |
| reads | `chrome.now-seconds` | `pure-client` | maturity and rate-window display |
| reads | `markets.selected-market` | `pure-client` | `selected` prop decides which row reads as expanded and whether the detail region renders |

### `web/components/PositionList.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `positions.advanced-open` | `pure-client` | `advancedOpen` toggle |
| reads | `chain.lending-config` | `on-chain` | fee and obligation context |
| reads | `chain.market-symbols` | `on-chain` | position labels |
| reads | `chrome.now-seconds` | `pure-client` | stream progress display |
| reads | `positions.advanced-open` | `pure-client` | gates rendering of the advanced block |
| reads | `projection.lender` | `projection` | per-market pool and loan rows |
| reads | `projection.market-apr` | `projection` | per-position rows |
| reads | `projection.stream` | `projection` | per-market stream rows |

### `web/components/PositionSummary.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `positions.aggregates` | `pure-client` | `onData(key, data)` inserts or removes one market's aggregate |
| writes | `positions.claim-all-open` | `pure-client` | `claimAllOpen`, set by the CLAIM ALL control and cleared on close |
| writes | `positions.loaded-user` | `pure-client` | set to the connected address by the LOAD POSITIONS button |
| reads | `chain.market-symbols` | `on-chain` | per-symbol rollup labels |
| reads | `chain.markets` | `on-chain` | filters to markets that have a lending instance |
| reads | `positions.aggregates` | `pure-client` | reduces the rows into per-symbol supplied/claimable totals and the loan summary |
| reads | `positions.claim-all-open` | `pure-client` | mounts `ClaimAllModal` |
| reads | `positions.loaded-user` | `pure-client` | compares against the connected address; renders the load prompt until they match, then mounts `LoadedPositionSummary` |
| reads | `projection.claim-verifier` | `projection` | passes the evaluation into `ClaimAllModal` |
| reads | `projection.lender` | `projection` | open-loan count, obligation, and satisfied totals; source of the Claim All plan |
| reads | `projection.market-apr` | `projection` | the user's own standing liquidity |
| reads | `projection.stream` | `projection` | the held-stream side of the portfolio rollup and the Claim All plan |

### `web/components/Providers.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.connection` | `on-chain` | mounts the wagmi and AppKit providers that own the connection |

### `web/components/WalletRuntime.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.connection` | `on-chain` | connect / disconnect surface |

### `web/hooks/useAllMarkets.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.markets` | `on-chain` | batched `approvedMarketCount` / `approvedMarketAt` / `series` reads |
| writes | `chain.wagmi-reads` | `on-chain` | market enumeration and series reads |
| reads | `chain.vault-registry` | `on-chain` | the vault list every market enumeration starts from |

### `web/hooks/useApprovalWriteFlows.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `approve.clearing` | `pure-client` | folded into the shared `busy` flag every approve-then-write form gates its buttons on |
| reads | `executor.status` | `pure-client` | the shared `busy` flag every approve-then-write form gates its buttons on |
| reads | `writeflow.is-preparing` | `pure-client` | part of the shared `busy` flag |

### `web/hooks/useBorrowDemand.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.block-timestamp` | `on-chain` | `useBlock` with a 30s stale time |
| reads | `chain.block-timestamp` | `on-chain` | the window boundary for the trailing-30-day demand aggregation |
| reads | `projection.demand` | `projection` | aggregates events into per-tick demand and derives the three-valued status |

### `web/hooks/useBorrowerLoans.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `projection.lender` | `projection` | unwraps the same scope into the borrower's `loans` only, with an optional poll interval |

### `web/hooks/useChainGuard.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.connection` | `on-chain` | derives `wrongChain` against the configured chain |

### `web/hooks/useClaimAllExecution.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.connection` | `on-chain` | supplies the queue's owning identity |

### `web/hooks/useClaimAllPreflight.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `projection.claim-verifier` | `projection` | owns the query under `projectionKeys.scope({ kind: "claim-verifier", account, transportRole })`, running the primary and verifier discoveries in parallel |

### `web/hooks/useClearOnConfirm.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | clears it exactly once per confirmation |

### `web/hooks/useHeldStreams.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.vault-registry` | `on-chain` | the vault set stream discovery is scoped to, and the readiness precondition for starting it |
| reads | `projection.stream` | `projection` | unwraps the outcome and derives `unavailable` |

### `web/hooks/useLending.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.lending-config` | `on-chain` | batched `OVRFLOLending` config reads |
| writes | `chain.wagmi-reads` | `on-chain` | lending config reads |

### `web/hooks/useLendingLiquidity.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `projection.market-apr` | `projection` | unwraps and sorts the positions |

### `web/hooks/useLendingProjection.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `projection.demand` | `projection` | `useBorrowDemandProjection` binds the scope to `discoverBorrowDemand` |
| writes | `projection.lender` | `projection` | `useAccountLoanBookProjection` binds the scope to `discoverAccountLoanBook` |
| writes | `projection.market-apr` | `projection` | `useMarketLiquidityProjection` binds the scope to `discoverMarketLiquidity` |
| writes | `projection.stream` | `projection` | `useHeldStreamProjection` binds the scope to `discoverHeldStreams` |

### `web/hooks/useLoanBook.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `projection.lender` | `projection` | unwraps the outcome into `pools` and `loans` |

### `web/hooks/useMarketSymbols.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.market-symbols` | `on-chain` | one batched, deduplicated `symbol()` read |
| writes | `chain.wagmi-reads` | `on-chain` | symbol reads |
| reads | `chain.markets` | `on-chain` | collects the token addresses to resolve symbols for |

### `web/hooks/useNowSeconds.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.now-seconds` | `pure-client` | interval tick from `Date.now()` |

### `web/hooks/useOvrflos.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.vault-registry` | `on-chain` | batched factory reads (`ovrfloCount`, `ovrflos`, `ovrfloInfo`, `ovrfloToLending`) |
| writes | `chain.wagmi-reads` | `on-chain` | registry reads |

### `web/hooks/useProjectionSync.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `projection.claim-verifier` | `projection` | `getProjectionClient("verifier")` resolves a transport distinct from the historical one |
| writes | `projection.demand` | `projection` | owns the query under `projectionKeys.scope({ lending, kind: "demand", market })` |
| writes | `projection.lender` | `projection` | owns the query under `projectionKeys.scope({ lending, kind: "lender", account })` |
| writes | `projection.market-apr` | `projection` | owns the query under `projectionKeys.scope({ lending, kind: "market-apr", market })` |
| writes | `projection.stream` | `projection` | owns the TanStack query under `projectionKeys.scope({ kind: "stream", account })` |

### `web/hooks/useStaleRecovery.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.stale-recovery` | `pure-client` | raised on a `stale`-classified error; each form clears it on submit, selection change, or wallet change |
| reads | `executor.result` | `pure-client` | classifies the surfaced error to decide whether this was a liquidity race |

### `web/hooks/useTransactionExecutor.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `executor.registry` | `pure-client` | inserts on start, deletes on terminal success, retains on `refresh_failed`, and trims retained entries past the cap |
| writes | `executor.result` | `pure-client` | set on completion, on retried refresh, and by `report` |
| writes | `executor.status` | `pure-client` | set from the runtime's phase callback and from the terminal result |
| reads | `executor.registry` | `pure-client` | deduplicates a repeat `confirm` onto the existing promise, and serves the retained failure to `retryRefresh` |
| reads | `executor.result` | `pure-client` | derives `hash`, `receipt`, and the surfaced `error` |

### `web/hooks/useTxQueue.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `queue.error` | `pure-client` | set on rebuild throw, executor throw, refresh failure, and unclassified failure |
| writes | `queue.pause-reason` | `pure-client` | set alongside `queue.paused` |
| writes | `queue.paused` | `pure-client` | `pauseAt`, cleared by `start` / `resume` / `acceptReview` |
| writes | `queue.rows` | `pure-client` | `start`, `resume`, `acceptReview`, and per-row status updates |
| writes | `queue.running` | `pure-client` | set by `start` / `resume` / `acceptReview`, cleared on pause and on every non-advancing outcome |
| reads | `projection.claim-verifier` | `projection` | pauses before any wallet prompt when the invariant is not ready |
| reads | `queue.paused` | `pure-client` | exposed as `paused` |
| reads | `queue.rows` | `pure-client` | derives `done`, `outcome`, `needsReview`, `failed`, and the confirmed count |
| reads | `queue.running` | `pure-client` | exposed as `running` and `inFlight` |

### `web/hooks/useWalletChangeReset.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.wallet-changed` | `pure-client` | raises it on an address change and clears it on explicit acknowledgement |

### `web/hooks/useWriteFlow.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `writeflow.is-preparing` | `pure-client` | set around plan preparation, cleared on settle or abort |
| reads | `chain.connection` | `on-chain` | builds the execution identity every write is checked against |
| reads | `chain.wagmi-reads` | `on-chain` | names the touched resources per action and awaits the refresh before reporting success |
| reads | `executor.result` | `pure-client` | forwards hash, receipt, and error to the forms |
| reads | `executor.status` | `pure-client` | exposes the derived `isSigning` / `isConfirming` / `isRefreshing` / `needsReview` / `hasFailed` flags |
| reads | `writeflow.is-preparing` | `pure-client` | folded into `isInFlight` |

### `web/hooks/useZeroFirstApprove.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `approve.clearing` | `pure-client` | set when a reverted approve is retried via zero-first |
| writes | `approve.used-fallback` | `pure-client` | set once the fallback is used |
| reads | `approve.used-fallback` | `pure-client` | prevents a second fallback attempt, so a token failing for another reason surfaces its error instead of looping |

### `web/lib/discovery/lending-projection.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `projection.lender` | `projection` | log scan and candidate assembly |
| writes | `projection.market-apr` | `projection` | ladder log scan |

### `web/lib/discovery/live-projection.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `projection.demand` | `projection` | borrow-event scan |
| writes | `projection.lender` | `projection` | hydration into the account loan book |
| writes | `projection.market-apr` | `projection` | hydration into positions |
| writes | `projection.stream` | `projection` | produces the outcome: OVRFLO-origin streams intersected with recipient Transfer logs, then hydrated from Sablier |

### `web/lib/invalidate.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wagmi-reads` | `on-chain` | `invalidateAllOnChainReads` invalidates both roots wholesale |
| reads | `chain.wagmi-reads` | `on-chain` | `keyMentionsAny` matches a serialised key against the touched contract set |
| reads | `query.streams.held` | `on-chain` | `invalidateOnChainReads` (streams option), `invalidateAllOnChainReads`, and `scheduleHeldStreamsRetry` all target this key |

### `web/lib/query-keys.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `query.demand.market` | `on-chain` | declares `demandKeys.all` and `demandKeys.market` |
| writes | `query.streams.held` | `on-chain` | declares `streamKeys.all` and `streamKeys.held` |
| reads | `query.demand.market` | `on-chain` | no production consumer; referenced only by its own unit test |

### `web/lib/query-resource-registry.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wagmi-reads` | `on-chain` | `refreshQueryResources` refetches the matched subset after a write, with `throwOnError` |
| reads | `chain.wagmi-reads` | `on-chain` | `buildRefreshPlan` decides which keys a write must refresh |
| reads | `projection.lender` | `projection` | loan and liquidity-position writes reconcile the lender, borrower, and demand scopes for that lending market |
| reads | `projection.market-apr` | `projection` | market-depth and liquidity-position writes reconcile this scope |
| reads | `projection.stream` | `projection` | every loan or stream write reconciles active `kind: "stream"` scopes |

### `web/lib/router.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `projection.market-apr` | `projection` | assembles a borrow route across candidate positions; receives them as an argument rather than calling the hook, and relies on the descending-ID order `useLendingLiquidity` establishes |

## Keys

Reverse lookup — the *who reads X?* direction. Follow the source file for the
full entry, including fail-closed guidance on `projection` keys.

| Key | Trust domain | Writers | Readers | Source |
|---|---|---|---|---|
| `action.amount-raw` | `pure-client` | `web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx`<br>`web/hooks/useClearOnConfirm.ts` | `web/components/action-flow/ActionFlowShell.tsx`<br>`web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.approved-amount` | `pure-client` | `web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx` | `web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.pending-label` | `pure-client` | `web/components/action-flow/ClaimFlow.tsx` | `web/components/action-flow/ClaimFlow.tsx`<br>`web/components/action-flow/ActionFlowShell.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.selected-apr-raw` | `pure-client` | `web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx` | `web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.selected-stream-id` | `pure-client` | `web/components/action-flow/BorrowFlow.tsx` | `web/components/action-flow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.show-alternative` | `pure-client` | `web/components/action-flow/BorrowFlow.tsx` | `web/components/action-flow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.slippage-raw` | `pure-client` | `web/components/action-flow/BorrowFlow.tsx` | `web/components/action-flow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.stale-recovery` | `pure-client` | `web/hooks/useStaleRecovery.ts` | `web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.submitted` | `pure-client` | `web/components/action-flow/BorrowFlow.tsx` | `web/components/action-flow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.wallet-changed` | `pure-client` | `web/hooks/useWalletChangeReset.ts` | `web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx`<br>`web/components/action-flow/ClaimFlow.tsx`<br>`web/components/action-flow/ActionFlowShell.tsx` | `docs/maps/state/keys/form-state.md` |
| `approve.clearing` | `pure-client` | `web/hooks/useZeroFirstApprove.ts` | `web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/form-state.md` |
| `approve.used-fallback` | `pure-client` | `web/hooks/useZeroFirstApprove.ts` | `web/hooks/useZeroFirstApprove.ts` | `docs/maps/state/keys/form-state.md` |
| `chain.block-timestamp` | `on-chain` | `web/hooks/useBorrowDemand.ts` | `web/hooks/useBorrowDemand.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.connection` | `on-chain` | `web/components/Providers.tsx`<br>`web/components/WalletRuntime.tsx` | `web/components/MarketsApp.tsx`<br>`web/hooks/useChainGuard.ts`<br>`web/hooks/useWriteFlow.ts`<br>`web/hooks/useClaimAllExecution.ts`<br>`web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx`<br>`web/components/action-flow/ClaimFlow.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.lending-config` | `on-chain` | `web/hooks/useLending.ts` | `web/components/MarketsTable.tsx`<br>`web/components/MarketRowDetail.tsx`<br>`web/components/PositionList.tsx`<br>`web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.market-symbols` | `on-chain` | `web/hooks/useMarketSymbols.ts` | `web/components/MarketsApp.tsx`<br>`web/components/MarketsTable.tsx`<br>`web/components/MarketRowDetail.tsx`<br>`web/components/PositionSummary.tsx`<br>`web/components/PositionList.tsx`<br>`web/components/MarketDetail.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.markets` | `on-chain` | `web/hooks/useAllMarkets.ts` | `web/components/MarketsApp.tsx`<br>`web/components/MarketsTable.tsx`<br>`web/components/PositionSummary.tsx`<br>`web/hooks/useMarketSymbols.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.vault-registry` | `on-chain` | `web/hooks/useOvrflos.ts` | `web/hooks/useAllMarkets.ts`<br>`web/hooks/useHeldStreams.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.wagmi-reads` | `on-chain` | `web/hooks/useOvrflos.ts`<br>`web/hooks/useAllMarkets.ts`<br>`web/hooks/useMarketSymbols.ts`<br>`web/hooks/useLending.ts`<br>`web/lib/invalidate.ts`<br>`web/lib/query-resource-registry.ts` | `web/lib/invalidate.ts`<br>`web/lib/query-resource-registry.ts`<br>`web/hooks/useWriteFlow.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chrome.copy-value.copied` | `pure-client` | `web/components/CopyValue.tsx` | `web/components/CopyValue.tsx` | `docs/maps/state/keys/view-state.md` |
| `chrome.market-detail.reload-key` | `pure-client` | `web/components/MarketDetail.tsx` | `web/components/MarketDetail.tsx` | `docs/maps/state/keys/view-state.md` |
| `chrome.now-seconds` | `pure-client` | `web/hooks/useNowSeconds.ts` | `web/components/MarketsTable.tsx`<br>`web/components/MarketRowDetail.tsx`<br>`web/components/PositionList.tsx`<br>`web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/ConvertFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx` | `docs/maps/state/keys/view-state.md` |
| `claim-all.nothing-left` | `pure-client` | `web/components/ClaimAllModal.tsx` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `claim-all.review-changed` | `pure-client` | `web/components/ClaimAllModal.tsx` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `claim-all.review-plan` | `pure-client` | `web/components/ClaimAllModal.tsx` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `claim-all.reviewing` | `pure-client` | `web/components/ClaimAllModal.tsx` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `claim-all.started` | `pure-client` | `web/components/ClaimAllModal.tsx` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `executor.registry` | `pure-client` | `web/hooks/useTransactionExecutor.ts` | `web/hooks/useTransactionExecutor.ts` | `docs/maps/state/keys/execution-state.md` |
| `executor.result` | `pure-client` | `web/hooks/useTransactionExecutor.ts` | `web/hooks/useTransactionExecutor.ts`<br>`web/hooks/useWriteFlow.ts`<br>`web/hooks/useStaleRecovery.ts` | `docs/maps/state/keys/execution-state.md` |
| `executor.status` | `pure-client` | `web/hooks/useTransactionExecutor.ts` | `web/hooks/useWriteFlow.ts`<br>`web/components/action-flow/ActionFlowShell.tsx`<br>`web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/execution-state.md` |
| `markets.active-mode` | `pure-client` | `web/components/MarketsApp.tsx`<br>`web/components/MarketsTable.tsx`<br>`web/components/MarketRowDetail.tsx` | `web/components/MarketsApp.tsx`<br>`web/components/MarketDetail.tsx` | `docs/maps/state/keys/view-state.md` |
| `markets.row-detail.advanced-open` | `pure-client` | `web/components/MarketRowDetail.tsx` | `web/components/MarketRowDetail.tsx` | `docs/maps/state/keys/view-state.md` |
| `markets.selected-market` | `pure-client` | `web/components/MarketsApp.tsx`<br>`web/components/MarketsTable.tsx` | `web/components/MarketsTable.tsx`<br>`web/components/MarketRowDetail.tsx` | `docs/maps/state/keys/view-state.md` |
| `positions.advanced-open` | `pure-client` | `web/components/PositionList.tsx` | `web/components/PositionList.tsx` | `docs/maps/state/keys/view-state.md` |
| `positions.aggregates` | `pure-client` | `web/components/PositionSummary.tsx` | `web/components/PositionSummary.tsx` | `docs/maps/state/keys/view-state.md` |
| `positions.claim-all-open` | `pure-client` | `web/components/PositionSummary.tsx` | `web/components/PositionSummary.tsx` | `docs/maps/state/keys/view-state.md` |
| `positions.loaded-user` | `pure-client` | `web/components/PositionSummary.tsx` | `web/components/PositionSummary.tsx` | `docs/maps/state/keys/view-state.md` |
| `projection.claim-verifier` | `projection` | `web/hooks/useClaimAllPreflight.ts`<br>`web/hooks/useProjectionSync.ts` | `web/components/PositionSummary.tsx`<br>`web/components/ClaimAllModal.tsx`<br>`web/hooks/useTxQueue.ts` | `docs/maps/state/keys/projection.md` |
| `projection.demand` | `projection` | `web/hooks/useProjectionSync.ts`<br>`web/hooks/useLendingProjection.ts`<br>`web/lib/discovery/live-projection.ts` | `web/hooks/useBorrowDemand.ts`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/ActionFlowShell.tsx` | `docs/maps/state/keys/projection.md` |
| `projection.lender` | `projection` | `web/hooks/useProjectionSync.ts`<br>`web/hooks/useLendingProjection.ts`<br>`web/lib/discovery/lending-projection.ts`<br>`web/lib/discovery/live-projection.ts` | `web/hooks/useLoanBook.ts`<br>`web/hooks/useBorrowerLoans.ts`<br>`web/components/PositionSummary.tsx`<br>`web/components/PositionList.tsx`<br>`web/components/action-flow/RepayFlow.tsx`<br>`web/lib/query-resource-registry.ts` | `docs/maps/state/keys/projection.md` |
| `projection.market-apr` | `projection` | `web/hooks/useProjectionSync.ts`<br>`web/hooks/useLendingProjection.ts`<br>`web/lib/discovery/lending-projection.ts`<br>`web/lib/discovery/live-projection.ts` | `web/hooks/useLendingLiquidity.ts`<br>`web/components/MarketRowDetail.tsx`<br>`web/components/PositionSummary.tsx`<br>`web/components/PositionList.tsx`<br>`web/components/action-flow/SupplyFlow.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/components/action-flow/PositionFlow.tsx`<br>`web/lib/router.ts`<br>`web/lib/query-resource-registry.ts` | `docs/maps/state/keys/projection.md` |
| `projection.stream` | `projection` | `web/hooks/useProjectionSync.ts`<br>`web/hooks/useLendingProjection.ts`<br>`web/lib/discovery/live-projection.ts` | `web/hooks/useHeldStreams.ts`<br>`web/components/PositionSummary.tsx`<br>`web/components/PositionList.tsx`<br>`web/components/MarketRowDetail.tsx`<br>`web/components/action-flow/BorrowFlow.tsx`<br>`web/lib/query-resource-registry.ts` | `docs/maps/state/keys/projection.md` |
| `query.demand.market` | `on-chain` | `web/lib/query-keys.ts` | `web/lib/query-keys.ts` | `docs/maps/state/keys/chain-reads.md` |
| `query.streams.held` | `on-chain` | `web/lib/query-keys.ts` | `web/lib/invalidate.ts` | `docs/maps/state/keys/chain-reads.md` |
| `queue.error` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `queue.pause-reason` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `queue.paused` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/hooks/useTxQueue.ts`<br>`web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `queue.rows` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/hooks/useTxQueue.ts`<br>`web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `queue.running` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/hooks/useTxQueue.ts`<br>`web/components/ClaimAllModal.tsx` | `docs/maps/state/keys/execution-state.md` |
| `writeflow.is-preparing` | `pure-client` | `web/hooks/useWriteFlow.ts` | `web/hooks/useWriteFlow.ts`<br>`web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/execution-state.md` |
