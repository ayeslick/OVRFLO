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
| Key files | 6 |
| Keys | 62 |
| Modules | 98 |
| `on-chain` keys | 23 |
| `projection` keys | 0 |
| `pure-client` keys | 39 |

## Trust-domain exposure by module

Counts of distinct keys each module touches, in either direction. A module with
a `projection` count is a module where a fail-closed mistake can happen.

| Module | on-chain | projection | pure-client |
|---|---|---|---|
| `web/app/assets/page.tsx` | 1 | 0 | 3 |
| `web/app/borrow/page.tsx` | 0 | 0 | 2 |
| `web/app/page.tsx` | 4 | 0 | 3 |
| `web/app/risk/page.tsx` | 0 | 0 | 1 |
| `web/app/supply/page.tsx` | 0 | 0 | 2 |
| `web/components/assets/AssetsPage.tsx` | 0 | 0 | 1 |
| `web/components/assets/Converter.tsx` | 2 | 0 | 0 |
| `web/components/assets/ConverterFlow.tsx` | 1 | 0 | 0 |
| `web/components/assets/StreamSelectMarket.tsx` | 1 | 0 | 1 |
| `web/components/borrow/AmountStep.tsx` | 2 | 0 | 1 |
| `web/components/borrow/BorrowFlow.tsx` | 1 | 0 | 4 |
| `web/components/borrow/PoolBand.tsx` | 1 | 0 | 0 |
| `web/components/borrow/RateStep.tsx` | 0 | 0 | 2 |
| `web/components/borrow/ReviewHandoff.tsx` | 1 | 0 | 0 |
| `web/components/borrow/SelectStream.tsx` | 1 | 0 | 1 |
| `web/components/borrow/StreamContext.tsx` | 0 | 0 | 1 |
| `web/components/CopyValue.tsx` | 0 | 0 | 1 |
| `web/components/first-run/Chooser.tsx` | 0 | 0 | 1 |
| `web/components/first-run/Surface.tsx` | 0 | 0 | 1 |
| `web/components/first-run/useAcknowledgeRiskTrace.ts` | 0 | 0 | 1 |
| `web/components/kit/ActionButton.tsx` | 1 | 0 | 3 |
| `web/components/kit/Amount.tsx` | 3 | 0 | 1 |
| `web/components/kit/AmountField.tsx` | 1 | 0 | 1 |
| `web/components/kit/LensTabs.tsx` | 0 | 0 | 1 |
| `web/components/kit/RateWindow.tsx` | 2 | 0 | 1 |
| `web/components/kit/Receipt.tsx` | 3 | 0 | 4 |
| `web/components/kit/RefetchNotice.tsx` | 0 | 0 | 1 |
| `web/components/kit/Ribbon.tsx` | 1 | 0 | 1 |
| `web/components/kit/RollingNumber.tsx` | 1 | 0 | 4 |
| `web/components/kit/SettlementTrace.tsx` | 1 | 0 | 3 |
| `web/components/kit/Shell.tsx` | 0 | 0 | 1 |
| `web/components/kit/StatusLine.tsx` | 1 | 0 | 1 |
| `web/components/kit/SurfaceState.tsx` | 0 | 0 | 1 |
| `web/components/kit/TokenUsdSwitch.tsx` | 2 | 0 | 1 |
| `web/components/Providers.tsx` | 1 | 0 | 0 |
| `web/components/rates/Workspace.tsx` | 1 | 0 | 2 |
| `web/components/supply/AmountStep.tsx` | 3 | 0 | 2 |
| `web/components/supply/QueueBand.tsx` | 1 | 0 | 0 |
| `web/components/supply/RateStep.tsx` | 0 | 0 | 2 |
| `web/components/supply/SelectMarket.tsx` | 1 | 0 | 1 |
| `web/components/supply/SupplyFlow.tsx` | 0 | 0 | 4 |
| `web/components/WalletRuntime.tsx` | 1 | 0 | 0 |
| `web/components/watch/BorrowedDetail.tsx` | 1 | 0 | 6 |
| `web/components/watch/ClosedLoanDetail.tsx` | 1 | 0 | 1 |
| `web/components/watch/StreamDetail.tsx` | 1 | 0 | 3 |
| `web/components/watch/StreamLedgerCard.tsx` | 1 | 0 | 0 |
| `web/components/watch/SuppliedDetail.tsx` | 3 | 0 | 5 |
| `web/components/watch/Wall.tsx` | 5 | 0 | 7 |
| `web/components/watch/WatchApp.tsx` | 1 | 0 | 1 |
| `web/hooks/useAcknowledgment.ts` | 0 | 0 | 1 |
| `web/hooks/useAllMarkets.ts` | 3 | 0 | 0 |
| `web/hooks/useApprovalWriteFlows.ts` | 2 | 0 | 4 |
| `web/hooks/useBorrowerBook.ts` | 2 | 0 | 0 |
| `web/hooks/useChainGuard.ts` | 1 | 0 | 0 |
| `web/hooks/useClearOnConfirm.ts` | 0 | 0 | 1 |
| `web/hooks/useClock.ts` | 1 | 0 | 2 |
| `web/hooks/useCompleteStreams.ts` | 1 | 0 | 0 |
| `web/hooks/useEnumerationPin.ts` | 1 | 0 | 0 |
| `web/hooks/useFlowDecisionHistory.ts` | 0 | 0 | 1 |
| `web/hooks/useFreshness.ts` | 0 | 0 | 1 |
| `web/hooks/useIdentityQueryReset.ts` | 0 | 0 | 1 |
| `web/hooks/useLadder.ts` | 4 | 0 | 0 |
| `web/hooks/useLenderBook.ts` | 3 | 0 | 0 |
| `web/hooks/useLending.ts` | 2 | 0 | 0 |
| `web/hooks/useMarketSymbols.ts` | 3 | 0 | 0 |
| `web/hooks/useOvrflos.ts` | 2 | 0 | 0 |
| `web/hooks/useStaleBalanceGuard.ts` | 0 | 0 | 1 |
| `web/hooks/useStaleRecovery.ts` | 0 | 0 | 2 |
| `web/hooks/useStreams.ts` | 3 | 0 | 0 |
| `web/hooks/useTransactionExecutor.ts` | 0 | 0 | 4 |
| `web/hooks/useTxQueue.ts` | 0 | 0 | 3 |
| `web/hooks/useUsdPrice.ts` | 3 | 0 | 0 |
| `web/hooks/useWalletChangeReset.ts` | 1 | 0 | 1 |
| `web/hooks/useWatchBalances.ts` | 1 | 0 | 0 |
| `web/hooks/useWriteFlow.ts` | 2 | 0 | 6 |
| `web/hooks/useZeroFirstApprove.ts` | 0 | 0 | 2 |
| `web/lib/actions/borrow.ts` | 0 | 0 | 1 |
| `web/lib/actions/claim.ts` | 1 | 0 | 1 |
| `web/lib/claim-all.ts` | 1 | 0 | 0 |
| `web/lib/flow-history.ts` | 0 | 0 | 1 |
| `web/lib/freshness.ts` | 0 | 0 | 1 |
| `web/lib/invalidate.ts` | 5 | 0 | 0 |
| `web/lib/ladder.ts` | 2 | 0 | 1 |
| `web/lib/ledger-card.ts` | 2 | 0 | 1 |
| `web/lib/lending-math.ts` | 1 | 0 | 0 |
| `web/lib/live-action-plan.ts` | 1 | 0 | 0 |
| `web/lib/parse.ts` | 0 | 0 | 2 |
| `web/lib/payoff.ts` | 2 | 0 | 7 |
| `web/lib/protocol-bootstrap.ts` | 1 | 0 | 0 |
| `web/lib/protocol/streams.ts` | 1 | 0 | 0 |
| `web/lib/query-keys.ts` | 4 | 0 | 0 |
| `web/lib/query-resource-registry.ts` | 1 | 0 | 0 |
| `web/lib/receipts.ts` | 0 | 0 | 1 |
| `web/lib/refetch-notice.ts` | 0 | 0 | 1 |
| `web/lib/storage.ts` | 0 | 0 | 1 |
| `web/lib/stream-book.ts` | 1 | 0 | 0 |
| `web/lib/surface-state.ts` | 0 | 0 | 1 |
| `web/lib/usd.ts` | 2 | 0 | 0 |

## Modules

### `web/app/assets/page.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.balances` | `on-chain` | landing U10: underlying / ovrflo / PT balances |
| reads | `action.amount-raw` | `pure-client` | landing U10: wrap / unwrap / PT deposit amounts |
| reads | `action.selected-market` | `pure-client` | landing U10: scopes PT / series |
| reads | `action.wallet-changed` | `pure-client` | landing U10: form reset |

### `web/app/borrow/page.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.stale-recovery` | `pure-client` | landing U9: requires one explicit re-confirm |
| reads | `action.wallet-changed` | `pure-client` | landing U9: form reset |

### `web/app/page.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `watch.lens` | `pure-client` | resolution order: URL param → per-wallet memory → supplied default |
| writes | `watch.selected-entity` | `pure-client` | hydrates from the URL; clears on disconnect |
| reads | `chain.borrower-loans` | `on-chain` | R12: any loan → watch |
| reads | `chain.connection` | `on-chain` | R12 entry: disconnected vs syncing vs watch vs first-run |
| reads | `chain.lender-positions` | `on-chain` | R12: any position → watch, not first-run |
| reads | `chain.markets` | `on-chain` | market list for shell and flow launch |
| reads | `first-run.dismissed` | `pure-client` | chooser vs guided when emptiness is confirmed |

### `web/app/risk/page.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `persist.acknowledgment` | `pure-client` | landing U11: does not fork the SETTLEMENT step |

### `web/app/supply/page.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.stale-recovery` | `pure-client` | landing U8: same |
| reads | `action.wallet-changed` | `pure-client` | landing U8: form reset |

### `web/components/assets/AssetsPage.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chrome.surface-state` | `pure-client` | landing U12: assets topology |

### `web/components/assets/Converter.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.balances` | `on-chain` | landing U10: wrap / unwrap / claim-PT |
| reads | `chain.wrap-reserve` | `on-chain` | landing U10: unwrap removed when reserve is empty; `UI-ASSETS-CLAIM-PT` replaces it |

### `web/components/assets/ConverterFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wrap-reserve` | `on-chain` | landing U10: `OVRFLOReserve.wrappedUnderlying()` |

### `web/components/assets/StreamSelectMarket.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.selected-market` | `pure-client` | landing U10: `UI-ASSETS-STREAM-SELECT-MARKET` |
| reads | `chain.markets` | `on-chain` | landing U10: `UI-ASSETS-STREAM-SELECT-MARKET` |

### `web/components/borrow/AmountStep.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.amount-raw` | `pure-client` | landing U9: bounded by stream remaining, not wallet balance |
| reads | `chain.lending-config` | `on-chain` | landing U9: `MIN_STREAM_AMOUNT` / fill floor |
| reads | `chain.market-symbols` | `on-chain` | landing U9: ovrflo-token symbol once the stream's market is known |

### `web/components/borrow/BorrowFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `persist.receipts` | `pure-client` | landing U12: persist on pending / confirmed borrow |
| reads | `action.flow-step` | `pure-client` | landing U12: Back moves one decision |
| reads | `chain.stream-truth` | `on-chain` | complete-set eligibility, not the wall pager |
| reads | `chrome.surface-state` | `pure-client` | landing U12: borrow topology |
| reads | `persist.drafts` | `pure-client` | landing U12: restore selections on return |

### `web/components/borrow/PoolBand.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.tick-depths` | `on-chain` | landing U9: draw vs resting liquidity |

### `web/components/borrow/RateStep.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `rates.workspace-open` | `pure-client` | landing U9: `UI-BORROW-ALL-RATES` |
| reads | `action.selected-apr-raw` | `pure-client` | landing U9: borrow tick; pool band |

### `web/components/borrow/ReviewHandoff.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.nft-operator` | `on-chain` | landing U9: skip stream-approve when operator already covers |

### `web/components/borrow/SelectStream.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.selected-stream-id` | `pure-client` | landing U9: picker; seeded from `UI-WATCH-BORROW-ROUTE` |
| reads | `chain.stream-truth` | `on-chain` | eligible unpledged list |

### `web/components/borrow/StreamContext.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.selected-stream-id` | `pure-client` | landing U9: `UI-BORROW-STREAM-CONTEXT` |

### `web/components/CopyValue.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.copy-value.copied` | `pure-client` | set on copy, cleared by a timer |
| reads | `chrome.copy-value.copied` | `pure-client` | swaps the control's label (`UI-SHELL-ADDRESS-COPY`) |

### `web/components/first-run/Chooser.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `first-run.dismissed` | `pure-client` | landing U11: `UI-FIRST-RUN-CHOOSER` |

### `web/components/first-run/Surface.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `first-run.dismissed` | `pure-client` | landing U11: `UI-FIRST-RUN-DISMISS` |

### `web/components/first-run/useAcknowledgeRiskTrace.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `persist.acknowledgment` | `pure-client` | landing U12: prepends ACKNOWLEDGE RISK on the first write |

### `web/components/kit/ActionButton.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.loans-of-position` | `on-chain` | landing U4: live amount in the control |
| reads | `executor.status` | `pure-client` | landing U4: per-action pending label (`UI-REVIEW-TX-STATE`) |
| reads | `queue.running` | `pure-client` | landing U4: blocks a second start while a row is in flight |
| reads | `tx.replaced` | `pure-client` | landing U4: pending copy follows the live hash |

### `web/components/kit/Amount.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.market-symbols` | `on-chain` | landing U4: labels |
| reads | `usd.mode` | `pure-client` | landing U4: companion USD figure |
| reads | `usd.price` | `on-chain` | landing U4: USD reference beside the token amount |
| reads | `usd.staleness` | `on-chain` | landing U4: `USD UNAVAILABLE` — no guessed figure |

### `web/components/kit/AmountField.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | landing U4: `inputmode="decimal"`; never blocks paste |
| reads | `chain.balances` | `on-chain` | landing U4: MAX and insufficient-balance |

### `web/components/kit/LensTabs.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `watch.lens` | `pure-client` | landing U4: APG tablist writes URL `?lens=` and per-wallet localStorage |
| reads | `watch.lens` | `pure-client` | landing U4: selected tab |

### `web/components/kit/RateWindow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.selected-apr-raw` | `pure-client` | landing U4: stepper paddles |
| reads | `chain.lending-config` | `on-chain` | landing U4: paddle disabled-with-reason at bounds |
| reads | `chain.tick-depths` | `on-chain` | landing U4: stepper window |

### `web/components/kit/Receipt.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.frozen-quote` | `pure-client` | landing U4: ACTION RECEIPT lines; `UI-BORROW-QUOTE-UPDATED` / `UI-REVIEW-STALE` |
| reads | `chain.allowances` | `on-chain` | landing U4: PERMISSION RECEIPT exact allowance |
| reads | `chain.nft-operator` | `on-chain` | landing U4: PERMISSION RECEIPT for the stream |
| reads | `chain.wrap-reserve` | `on-chain` | landing U4: `UI-REVIEW-CLAIM-CONFIRMED` unwrap-enabled vs reserve-insufficient |
| reads | `schedule.cover-date` | `pure-client` | landing U4: review shows current `~` date (token-exact elsewhere) |
| reads | `schedule.repay-preview` | `pure-client` | landing U4: `UI-REVIEW-REPAY` current vs new date |
| reads | `usd.mode` | `pure-client` | landing U4: **ignores this key** — receipts stay token-exact |

### `web/components/kit/RefetchNotice.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chrome.refetch-notice` | `pure-client` | landing U12: `UI-SHELL-REFETCH-NOTICE` |

### `web/components/kit/Ribbon.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `schedule.clock` | `pure-client` | landing U4: gold edge at now (via the shared rAF driver) |
| reads | `schedule.stream-params` | `on-chain` | landing U4: origin → terminal geometry |

### `web/components/kit/RollingNumber.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `schedule.clock` | `pure-client` | landing U4: formats from bigint every frame |
| reads | `schedule.interpolated-earnings` | `pure-client` | landing U4: gold hero |
| reads | `schedule.interpolated-outstanding` | `pure-client` | landing U4: outstanding hero |
| reads | `schedule.interpolated-vested` | `pure-client` | landing U4: vested hero |
| reads | `schedule.stream-params` | `on-chain` | landing U4: schedule × clock |

### `web/components/kit/SettlementTrace.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `review.reload-key` | `pure-client` | landing U4: incremented by `UI-REVIEW-ERROR-BOUNDARY` `onReset` |
| reads | `action.approved-amount` | `pure-client` | landing U4: which stage is primary |
| reads | `action.wallet-changed` | `pure-client` | landing U4: replaces the form body with `UI-SHELL-WALLET-CHANGED` |
| reads | `chain.allowances` | `on-chain` | landing U4: omits the approve stage when covered |
| reads | `review.reload-key` | `pure-client` | landing U4: passed as `key` to the form body |

### `web/components/kit/Shell.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chrome.refetch-notice` | `pure-client` | landing U12: notice lives in the shell body, not Providers |

### `web/components/kit/StatusLine.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `schedule.freshness` | `pure-client` | landing U4: `UI-SHELL-STATUS` |
| reads | `usd.staleness` | `on-chain` | landing U4: `UI-SHELL-STATUS` `usd-unavailable` |

### `web/components/kit/SurfaceState.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chrome.surface-state` | `pure-client` | landing U12: labeled `data-surface-state` |

### `web/components/kit/TokenUsdSwitch.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `usd.mode` | `pure-client` | landing U4: `UI-SHELL-TOKEN-USD` |
| reads | `usd.price` | `on-chain` | landing U4: disables when unavailable |
| reads | `usd.staleness` | `on-chain` | landing U4: `disabled-unavailable` |

### `web/components/Providers.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.connection` | `on-chain` | mounts the wagmi and AppKit providers that own the connection |

### `web/components/rates/Workspace.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.selected-apr-raw` | `pure-client` | landing U8/U9: direct pick from `UI-RATES-ROW` |
| writes | `rates.workspace-open` | `pure-client` | landing U8/U9: `UI-RATES-CLOSE` / successful pick |
| reads | `chain.tick-depths` | `on-chain` | landing U8/U9: `UI-RATES-LADDER` |
| reads | `rates.workspace-open` | `pure-client` | landing U8/U9: `borrow-context` vs `supply-context` |

### `web/components/supply/AmountStep.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.amount-raw` | `pure-client` | landing U8: validation, MAX, `MIN_LIQUIDITY_AMOUNT` |
| reads | `action.selected-market` | `pure-client` | landing U8: scopes balances and ladder |
| reads | `chain.balances` | `on-chain` | landing U8: `loading-balance` is not `0` |
| reads | `chain.lending-config` | `on-chain` | landing U8: `MIN_LIQUIDITY_AMOUNT` inline feedback |
| reads | `chain.market-symbols` | `on-chain` | landing U8: underlying symbol on the amount field |

### `web/components/supply/QueueBand.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.tick-depths` | `on-chain` | landing U8: unfilled-ahead |

### `web/components/supply/RateStep.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `rates.workspace-open` | `pure-client` | landing U8: `UI-SUPPLY-ALL-RATES` |
| reads | `action.selected-apr-raw` | `pure-client` | landing U8: supply tick argument |

### `web/components/supply/SelectMarket.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.selected-market` | `pure-client` | landing U8: `UI-SUPPLY-SELECT-MARKET` |
| reads | `chain.markets` | `on-chain` | landing U8: `UI-SUPPLY-SELECT-MARKET` |

### `web/components/supply/SupplyFlow.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `persist.receipts` | `pure-client` | landing U12: persist on pending / confirmed supply |
| reads | `action.flow-step` | `pure-client` | landing U12: Back moves one decision |
| reads | `chrome.surface-state` | `pure-client` | landing U12: supply topology |
| reads | `persist.drafts` | `pure-client` | landing U12: restore selections on return |

### `web/components/WalletRuntime.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.connection` | `on-chain` | `WalletButton`: connect / disconnect (E2E swaps this module at build time) |

### `web/components/watch/BorrowedDetail.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.borrower-loans` | `on-chain` | landing U7: outstanding, repay, close |
| reads | `schedule.clock` | `pure-client` | landing U7: outstanding hero |
| reads | `schedule.cover-date` | `pure-client` | landing U7: done-date + live countdown |
| reads | `schedule.freshness` | `pure-client` | landing U7: entity as-of caption |
| reads | `schedule.interpolated-outstanding` | `pure-client` | landing U7: `UI-WATCH-HERO-OUTSTANDING` |
| reads | `schedule.repay-preview` | `pure-client` | landing U7: preview inside the repay flow |
| reads | `watch.selected-entity` | `pure-client` | landing U7: mounted when kind is `loan` (active) |

### `web/components/watch/ClosedLoanDetail.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.borrower-loans` | `on-chain` | landing U7: returned-stream identity |
| reads | `watch.selected-entity` | `pure-client` | landing U7: mounted when kind is `loan` (SETTLED) |

### `web/components/watch/StreamDetail.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | detail from hydrated state (U9 paints card) |
| reads | `schedule.clock` | `pure-client` | landing U7: vested hero |
| reads | `schedule.interpolated-vested` | `pure-client` | landing U7: `UI-WATCH-HERO-VESTED` |
| reads | `watch.selected-entity` | `pure-client` | landing U7: mounted when kind is `stream` |

### `web/components/watch/StreamLedgerCard.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | HTML ledger card figures (U9) |

### `web/components/watch/SuppliedDetail.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.lender-positions` | `on-chain` | landing U7: capital band, claim, withdraw |
| reads | `chain.loans-of-position` | `on-chain` | landing U7: `UI-WATCH-CLAIM` gate |
| reads | `schedule.clock` | `pure-client` | landing U7: earnings hero |
| reads | `schedule.freshness` | `pure-client` | landing U7: `UI-WATCH-FRESHNESS` |
| reads | `schedule.interpolated-earnings` | `pure-client` | landing U7: `UI-WATCH-HERO-EARNINGS` |
| reads | `usd.mode` | `pure-client` | landing U7: hero companion |
| reads | `usd.price` | `on-chain` | landing U7: hero USD companion |
| reads | `watch.selected-entity` | `pure-client` | landing U7: mounted when kind is `position` |

### `web/components/watch/Wall.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `watch.narrow-nav` | `pure-client` | landing U7: list vs detail from viewport + `watch.selected-entity` |
| writes | `watch.selected-entity` | `pure-client` | landing U7: `UI-WATCH-SELECT` writes `?lending=` plus `?position=` / `?loan=` / `?stream=` |
| reads | `chain.borrower-loans` | `on-chain` | landing U7: borrowed lens, SETTLED rows after active |
| reads | `chain.connection` | `on-chain` | landing U7: scopes the wall to the connected account |
| reads | `chain.lender-positions` | `on-chain` | landing U7: supplied lens rows |
| reads | `chain.market-symbols` | `on-chain` | landing U7: row labels |
| reads | `chain.stream-truth` | `on-chain` | Streams lens rows + `UI-WATCH-LOAD-MORE` |
| reads | `schedule.cover-date` | `pure-client` | landing U7: borrowed-row state line |
| reads | `schedule.interpolated-earnings` | `pure-client` | landing U7: supplied-row decisive number |
| reads | `schedule.interpolated-outstanding` | `pure-client` | landing U7: borrowed-row decisive number |
| reads | `schedule.interpolated-vested` | `pure-client` | landing U7: stream-row decisive number |
| reads | `watch.lens` | `pure-client` | landing U7: which row set to render |
| reads | `watch.narrow-nav` | `pure-client` | landing U7: `UI-WATCH-NARROW-NAV` return affordance |
| reads | `watch.selected-entity` | `pure-client` | landing U7: which row reads as selected |

### `web/components/watch/WatchApp.tsx`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | R12 entry book + Streams lens (factory-wide lendings) |
| reads | `chrome.surface-state` | `pure-client` | landing U12: watch wall |

### `web/hooks/useAcknowledgment.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `persist.acknowledgment` | `pure-client` | landing U6: one-time per address |

### `web/hooks/useAllMarkets.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.markets` | `on-chain` | batched `approvedMarketCount` / `approvedMarketAt` / `series` reads |
| writes | `chain.wagmi-reads` | `on-chain` | market enumeration and series reads |
| reads | `chain.vault-registry` | `on-chain` | the vault list every market enumeration starts from |

### `web/hooks/useApprovalWriteFlows.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.approved-amount` | `pure-client` | set when the approve receipt lands |
| writes | `chain.allowances` | `on-chain` | refreshes allowance as a touched resource after approve |
| writes | `chain.nft-operator` | `on-chain` | NFT-approval equivalent of allowance |
| reads | `action.approved-amount` | `pure-client` | step indicator only |
| reads | `approve.clearing` | `pure-client` | folded into the shared `busy` flag |
| reads | `chain.allowances` | `on-chain` | skip-without-renumber when allowance already covers |
| reads | `executor.status` | `pure-client` | the shared `busy` flag every approve-then-write form gates its buttons on |
| reads | `writeflow.is-preparing` | `pure-client` | part of the shared `busy` flag |

### `web/hooks/useBorrowerBook.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.borrower-loans` | `on-chain` | landing U6: enumeration then batched state; `loansOf` pagination follows `nextSeq` and never reuses a foreign `startSeq` |
| reads | `query.books.borrower` | `on-chain` | landing U6: registers the query |

### `web/hooks/useChainGuard.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.connection` | `on-chain` | derives `wrongChain` against the configured chain |

### `web/hooks/useClearOnConfirm.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.amount-raw` | `pure-client` | clears it exactly once per confirmation |

### `web/hooks/useClock.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.block-timestamp` | `on-chain` | landing U6: reads `block.timestamp` on each event-truth refresh |
| writes | `schedule.clock` | `pure-client` | landing U6: `useSyncExternalStore` (eager and hydration-safe variants) |
| writes | `schedule.skew-offset` | `pure-client` | landing U6: applies the offset to the store |
| reads | `chain.block-timestamp` | `on-chain` | landing U6: writes `schedule.skew-offset` |
| reads | `schedule.skew-offset` | `pure-client` | landing U6: skew-adjusted tick |

### `web/hooks/useCompleteStreams.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.stream-truth` | `on-chain` | complete held-stream set at the same pin |

### `web/hooks/useEnumerationPin.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.stream-truth` | `on-chain` | snapshot clock (reuses `useBlock`) |

### `web/hooks/useFlowDecisionHistory.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.flow-step` | `pure-client` | landing U12: `pushState` / `replaceState` / popstate |

### `web/hooks/useFreshness.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `schedule.freshness` | `pure-client` | landing U6: exposes the class |

### `web/hooks/useIdentityQueryReset.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.refetch-notice` | `pure-client` | landing U12: QueryCache subscriber in Providers |

### `web/hooks/useLadder.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.balances` | `on-chain` | landing U6: underlying balance beside supply |
| writes | `chain.lending-config` | `on-chain` | landing U6: consumes config as ladder bounds |
| writes | `chain.tick-depths` | `on-chain` | landing U6: the one-read ladder |
| reads | `query.ladder` | `on-chain` | landing U6: registers the query |

### `web/hooks/useLenderBook.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.lender-positions` | `on-chain` | landing U6: enumeration then batched state |
| writes | `chain.loans-of-position` | `on-chain` | landing U6: paginated by returned `nextSeq` |
| reads | `query.books.lender` | `on-chain` | landing U6: registers the query |

### `web/hooks/useLending.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.lending-config` | `on-chain` | batched `OVRFLOLending` config reads |
| writes | `chain.wagmi-reads` | `on-chain` | lending config reads |

### `web/hooks/useMarketSymbols.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.market-symbols` | `on-chain` | one batched, deduplicated `symbol()` read |
| writes | `chain.wagmi-reads` | `on-chain` | symbol reads |
| reads | `chain.markets` | `on-chain` | collects the token addresses to resolve symbols for |

### `web/hooks/useOvrflos.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.vault-registry` | `on-chain` | exposes the bootstrap vault list to the rest of the app |
| writes | `chain.wagmi-reads` | `on-chain` | registry reads |

### `web/hooks/useStaleBalanceGuard.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `persist.receipts` | `pure-client` | landing U12: stale RPC must not resurrect pre-tx balances |

### `web/hooks/useStaleRecovery.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.stale-recovery` | `pure-client` | raised on a `stale`-classified error; each form clears it on submit, selection change, or wallet change |
| reads | `executor.result` | `pure-client` | classifies the surfaced error to decide whether this was a liquidity race |

### `web/hooks/useStreams.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.stream-truth` | `on-chain` | wall pager; pin hash is in the query key |
| writes | `schedule.stream-params` | `on-chain` | Enumerable hydration; fixed fields cached after first successful `getStream` (KTD9) |
| reads | `chain.vault-registry` | `on-chain` | landing U6: vault set that stream discovery is scoped to, and the readiness precondition for starting it |

### `web/hooks/useTransactionExecutor.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `executor.registry` | `pure-client` | inserts on start, deletes on terminal success, retains on `refresh_failed`, and trims retained entries past the cap |
| writes | `executor.result` | `pure-client` | set on completion, on retried refresh, and by `report` |
| writes | `executor.status` | `pure-client` | set from the runtime's phase callback and from the terminal result |
| writes | `tx.replaced` | `pure-client` | reconciles a receipt it did not submit (second tab) |
| reads | `executor.registry` | `pure-client` | deduplicates a repeat `confirm` onto the existing promise, and serves the retained failure to `retryRefresh` |
| reads | `executor.result` | `pure-client` | derives `hash`, `receipt`, and the surfaced `error` |

### `web/hooks/useTxQueue.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `queue.rows` | `pure-client` | `start`, `resume`, and per-row status updates |
| writes | `queue.running` | `pure-client` | set by `start` / `resume`, cleared on every non-advancing outcome |
| writes | `tx.replaced` | `pure-client` | records replaced as a first-class lifecycle state |
| reads | `queue.rows` | `pure-client` | derives `done`, `outcome`, `needsReview`, `failed` |
| reads | `queue.running` | `pure-client` | exposed as `running` and `inFlight` |

### `web/hooks/useUsdPrice.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `usd.price` | `on-chain` | landing U6: product of the two on-chain answers |
| writes | `usd.staleness` | `on-chain` | landing U6: exposes the class |
| reads | `query.usd.price` | `on-chain` | landing U6: registers the query |

### `web/hooks/useWalletChangeReset.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.wallet-changed` | `pure-client` | raises it on an address or chain change, drops identity-keyed queries, and clears it on explicit acknowledgement |
| reads | `chain.connection` | `on-chain` | raises `action.wallet-changed` on address change |

### `web/hooks/useWatchBalances.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wrap-reserve` | `on-chain` | wrap-reserve read on the discovered reserve |

### `web/hooks/useWriteFlow.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.frozen-quote` | `pure-client` | captured at review; compared to the rebuilt plan at sign |
| writes | `writeflow.is-preparing` | `pure-client` | set around plan preparation, cleared on settle or abort |
| reads | `action.frozen-quote` | `pure-client` | drift → `needs_review` |
| reads | `chain.connection` | `on-chain` | builds the execution identity every write is checked against |
| reads | `chain.wagmi-reads` | `on-chain` | names the touched resources per action and awaits the refresh before reporting success |
| reads | `executor.result` | `pure-client` | forwards hash, receipt, and error to the forms |
| reads | `executor.status` | `pure-client` | exposes the derived `isSigning` / `isConfirming` / `isRefreshing` / `needsReview` / `hasFailed` flags |
| reads | `schedule.freshness` | `pure-client` | STALE rules disable signing when degraded |
| reads | `tx.replaced` | `pure-client` | resolves the flow to the replacement's outcome; never spins on the old hash |
| reads | `writeflow.is-preparing` | `pure-client` | folded into `isInFlight` |

### `web/hooks/useZeroFirstApprove.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `approve.clearing` | `pure-client` | set when a reverted approve is retried via zero-first |
| writes | `approve.used-fallback` | `pure-client` | set once the fallback is used |
| reads | `approve.used-fallback` | `pure-client` | prevents a second fallback attempt |

### `web/lib/actions/borrow.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.selected-stream-id` | `pure-client` | landing U6: stream id argument of the loan call |

### `web/lib/actions/claim.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.loans-of-position` | `on-chain` | landing U6: Multicall batch of this position only |
| reads | `queue.rows` | `pure-client` | landing U6: "claim remaining" continuation when the pair cap splits a position |

### `web/lib/claim-all.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | complete-set stream claims |

### `web/lib/flow-history.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `action.flow-step` | `pure-client` | landing U12: parse, serialize, revalidate; checkpoints map to review |

### `web/lib/freshness.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `schedule.freshness` | `pure-client` | landing U5: SYNCED / RECONNECTING / DEGRADED / UNAVAILABLE from query status + last successful event read |

### `web/lib/invalidate.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wagmi-reads` | `on-chain` | `invalidateAllOnChainReads` invalidates both roots wholesale |
| reads | `chain.lender-positions` | `on-chain` | post-write refresh of declared `touchedResources` |
| reads | `chain.wagmi-reads` | `on-chain` | `keyMentionsAny` matches a serialised key against the touched contract set |
| reads | `query.books.borrower` | `on-chain` | post-write invalidation after borrow / repay / close |
| reads | `query.books.lender` | `on-chain` | post-write invalidation via `touchedResources` |
| reads | `query.ladder` | `on-chain` | re-quote at every checkpoint and after supply / borrow |

### `web/lib/ladder.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `action.selected-apr-raw` | `pure-client` | landing U5: window centering |
| reads | `chain.lending-config` | `on-chain` | landing U5: window derivation, stepper clamps |
| reads | `chain.tick-depths` | `on-chain` | landing U5: three-tick window, neighbor hints, clamps |

### `web/lib/ledger-card.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | snapshot percent / segments from hydrated schedule (U9) |
| reads | `schedule.interpolated-vested` | `pure-client` | U9: card bar uses streamedAmountOf at lastReadAt only (not the live clock) |
| reads | `schedule.stream-params` | `on-chain` | U9: HTML card snapshot from schedule × lastReadAt |

### `web/lib/lending-math.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | eligibility mirror of `requireEligible` |

### `web/lib/live-action-plan.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wrap-reserve` | `on-chain` | unwrap capacity from `OVRFLOReserve.wrappedUnderlying()` |

### `web/lib/parse.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `persist.drafts` | `pure-client` | landing U5: bigint-safe serializer (`JSON.stringify` throws on bigint) |
| reads | `action.amount-raw` | `pure-client` | landing U5: locale-aware parse into branded wei (German `1,5`) |

### `web/lib/payoff.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `schedule.cover-date` | `pure-client` | landing U5: pure over `(schedule, outstanding, now)` |
| writes | `schedule.interpolated-earnings` | `pure-client` | landing U5: schedule × clock, clamped at cover-date obligation share |
| writes | `schedule.interpolated-outstanding` | `pure-client` | landing U5: last-read outstanding minus schedule-backed stream draw since that read |
| writes | `schedule.interpolated-vested` | `pure-client` | landing U5: Sablier streamed amount from schedule × clock |
| writes | `schedule.repay-preview` | `pure-client` | landing U5: same function as `schedule.cover-date` with reduced outstanding |
| writes | `schedule.skew-offset` | `pure-client` | landing U5: skew estimator from `chain.block-timestamp` |
| reads | `chain.block-timestamp` | `on-chain` | landing U5: skew estimator (local clock vs chain) |
| reads | `schedule.clock` | `pure-client` | landing U5: cover-date / countdown inputs |
| reads | `schedule.skew-offset` | `pure-client` | landing U5: clamp interpolations to the deterministic formula |
| reads | `schedule.stream-params` | `on-chain` | landing U5: vested / remaining / cover-date |

### `web/lib/protocol-bootstrap.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.vault-registry` | `on-chain` | factory reads (`ovrfloCount`, `ovrflos`, `ovrfloInfo`, `ovrfloToLending`, `ovrfloToReserve`, `lendings(i)`) |

### `web/lib/protocol/streams.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.stream-truth` | `on-chain` | `loadStreamPage` / `loadCompleteStreams` |

### `web/lib/query-keys.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `query.books.borrower` | `on-chain` | landing U6: `bookKeys.borrower` factory |
| writes | `query.books.lender` | `on-chain` | landing U6: `bookKeys.lender` factory |
| writes | `query.ladder` | `on-chain` | landing U6: `ladderKeys.market` factory |
| writes | `query.usd.price` | `on-chain` | landing U6: `usdKeys.price` factory |

### `web/lib/query-resource-registry.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chain.wagmi-reads` | `on-chain` | `refreshQueryResources` refetches the matched subset after a write, with `throwOnError` |
| reads | `chain.wagmi-reads` | `on-chain` | `buildRefreshPlan` decides which keys a write must refresh |

### `web/lib/receipts.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `persist.receipts` | `pure-client` | landing U12: factory-namespaced `ovrflo:receipt:{factory}:{hash}` |
| reads | `persist.receipts` | `pure-client` | landing U12: `reconcileReceipt`; `guardConfirmedBalances` |

### `web/lib/refetch-notice.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.refetch-notice` | `pure-client` | landing U12: module store; one flag for the whole app |

### `web/lib/storage.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `persist.drafts` | `pure-client` | landing U12: throw-tolerant `ovrflo:draft:{kind}:{factory}:{chainId}:{account}` |

### `web/lib/stream-book.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| reads | `chain.stream-truth` | `on-chain` | source cursor, duplicate fail-closed, four book fields |

### `web/lib/surface-state.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `chrome.surface-state` | `pure-client` | landing U12: `classifySurfaceState`; LOADING is never zero |

### `web/lib/usd.ts`

| Direction | Key | Trust domain | Role |
|---|---|---|---|
| writes | `usd.price` | `on-chain` | landing U5: pure product + classification |
| writes | `usd.staleness` | `on-chain` | landing U5: non-positive answer, heartbeat-plus-grace, 24h absolute cutoff |

## Keys

Reverse lookup — the *who reads X?* direction. Follow the source file for the
full entry, including fail-closed guidance on `projection` keys.

| Key | Trust domain | Writers | Readers | Source |
|---|---|---|---|---|
| `action.amount-raw` | `pure-client` | `web/components/kit/AmountField.tsx`<br>`web/hooks/useClearOnConfirm.ts` | `web/lib/parse.ts`<br>`web/components/supply/AmountStep.tsx`<br>`web/components/borrow/AmountStep.tsx`<br>`web/app/assets/page.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.approved-amount` | `pure-client` | `web/hooks/useApprovalWriteFlows.ts` | `web/components/kit/SettlementTrace.tsx`<br>`web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/form-state.md` |
| `action.flow-step` | `pure-client` | `web/hooks/useFlowDecisionHistory.ts`<br>`web/lib/flow-history.ts` | `web/components/supply/SupplyFlow.tsx`<br>`web/components/borrow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.frozen-quote` | `pure-client` | `web/hooks/useWriteFlow.ts` | `web/hooks/useWriteFlow.ts`<br>`web/components/kit/Receipt.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.selected-apr-raw` | `pure-client` | `web/components/kit/RateWindow.tsx`<br>`web/components/rates/Workspace.tsx` | `web/components/supply/RateStep.tsx`<br>`web/components/borrow/RateStep.tsx`<br>`web/lib/ladder.ts` | `docs/maps/state/keys/form-state.md` |
| `action.selected-market` | `pure-client` | `web/components/supply/SelectMarket.tsx`<br>`web/components/assets/StreamSelectMarket.tsx` | `web/components/supply/AmountStep.tsx`<br>`web/app/assets/page.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.selected-stream-id` | `pure-client` | `web/components/borrow/SelectStream.tsx` | `web/components/borrow/StreamContext.tsx`<br>`web/lib/actions/borrow.ts` | `docs/maps/state/keys/form-state.md` |
| `action.stale-recovery` | `pure-client` | `web/hooks/useStaleRecovery.ts` | `web/app/borrow/page.tsx`<br>`web/app/supply/page.tsx` | `docs/maps/state/keys/form-state.md` |
| `action.wallet-changed` | `pure-client` | `web/hooks/useWalletChangeReset.ts` | `web/components/kit/SettlementTrace.tsx`<br>`web/app/borrow/page.tsx`<br>`web/app/supply/page.tsx`<br>`web/app/assets/page.tsx` | `docs/maps/state/keys/form-state.md` |
| `approve.clearing` | `pure-client` | `web/hooks/useZeroFirstApprove.ts` | `web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/form-state.md` |
| `approve.used-fallback` | `pure-client` | `web/hooks/useZeroFirstApprove.ts` | `web/hooks/useZeroFirstApprove.ts` | `docs/maps/state/keys/form-state.md` |
| `chain.allowances` | `on-chain` | `web/hooks/useApprovalWriteFlows.ts` | `web/hooks/useApprovalWriteFlows.ts`<br>`web/components/kit/SettlementTrace.tsx`<br>`web/components/kit/Receipt.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.balances` | `on-chain` | `web/hooks/useLadder.ts`<br>`web/app/assets/page.tsx` | `web/components/kit/AmountField.tsx`<br>`web/components/supply/AmountStep.tsx`<br>`web/components/assets/Converter.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.block-timestamp` | `on-chain` | `web/hooks/useClock.ts` | `web/lib/payoff.ts`<br>`web/hooks/useClock.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.borrower-loans` | `on-chain` | `web/hooks/useBorrowerBook.ts` | `web/app/page.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/watch/BorrowedDetail.tsx`<br>`web/components/watch/ClosedLoanDetail.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.connection` | `on-chain` | `web/components/Providers.tsx`<br>`web/components/WalletRuntime.tsx` | `web/app/page.tsx`<br>`web/hooks/useChainGuard.ts`<br>`web/hooks/useWriteFlow.ts`<br>`web/hooks/useWalletChangeReset.ts`<br>`web/components/watch/Wall.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.lender-positions` | `on-chain` | `web/hooks/useLenderBook.ts` | `web/app/page.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/watch/SuppliedDetail.tsx`<br>`web/lib/invalidate.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.lending-config` | `on-chain` | `web/hooks/useLending.ts`<br>`web/hooks/useLadder.ts` | `web/lib/ladder.ts`<br>`web/components/kit/RateWindow.tsx`<br>`web/components/supply/AmountStep.tsx`<br>`web/components/borrow/AmountStep.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.loans-of-position` | `on-chain` | `web/hooks/useLenderBook.ts` | `web/lib/actions/claim.ts`<br>`web/components/watch/SuppliedDetail.tsx`<br>`web/components/kit/ActionButton.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.market-symbols` | `on-chain` | `web/hooks/useMarketSymbols.ts` | `web/components/kit/Amount.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/supply/AmountStep.tsx`<br>`web/components/borrow/AmountStep.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.markets` | `on-chain` | `web/hooks/useAllMarkets.ts` | `web/app/page.tsx`<br>`web/components/supply/SelectMarket.tsx`<br>`web/components/assets/StreamSelectMarket.tsx`<br>`web/hooks/useMarketSymbols.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.nft-operator` | `on-chain` | `web/hooks/useApprovalWriteFlows.ts` | `web/components/borrow/ReviewHandoff.tsx`<br>`web/components/kit/Receipt.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.stream-truth` | `on-chain` | `web/hooks/useStreams.ts`<br>`web/hooks/useCompleteStreams.ts`<br>`web/hooks/useEnumerationPin.ts`<br>`web/lib/protocol/streams.ts` | `web/components/watch/WatchApp.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/watch/StreamDetail.tsx`<br>`web/components/watch/StreamLedgerCard.tsx`<br>`web/lib/ledger-card.ts`<br>`web/components/borrow/SelectStream.tsx`<br>`web/components/borrow/BorrowFlow.tsx`<br>`web/lib/claim-all.ts`<br>`web/lib/lending-math.ts`<br>`web/lib/stream-book.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.tick-depths` | `on-chain` | `web/hooks/useLadder.ts` | `web/lib/ladder.ts`<br>`web/components/kit/RateWindow.tsx`<br>`web/components/rates/Workspace.tsx`<br>`web/components/borrow/PoolBand.tsx`<br>`web/components/supply/QueueBand.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chain.vault-registry` | `on-chain` | `web/lib/protocol-bootstrap.ts`<br>`web/hooks/useOvrflos.ts` | `web/hooks/useAllMarkets.ts`<br>`web/hooks/useStreams.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.wagmi-reads` | `on-chain` | `web/hooks/useOvrflos.ts`<br>`web/hooks/useAllMarkets.ts`<br>`web/hooks/useMarketSymbols.ts`<br>`web/hooks/useLending.ts`<br>`web/lib/invalidate.ts`<br>`web/lib/query-resource-registry.ts` | `web/lib/invalidate.ts`<br>`web/lib/query-resource-registry.ts`<br>`web/hooks/useWriteFlow.ts` | `docs/maps/state/keys/chain-reads.md` |
| `chain.wrap-reserve` | `on-chain` | `web/components/assets/ConverterFlow.tsx`<br>`web/hooks/useWatchBalances.ts`<br>`web/lib/live-action-plan.ts` | `web/components/assets/Converter.tsx`<br>`web/components/kit/Receipt.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `chrome.copy-value.copied` | `pure-client` | `web/components/CopyValue.tsx` | `web/components/CopyValue.tsx` | `docs/maps/state/keys/view-state.md` |
| `chrome.refetch-notice` | `pure-client` | `web/lib/refetch-notice.ts`<br>`web/hooks/useIdentityQueryReset.ts` | `web/components/kit/RefetchNotice.tsx`<br>`web/components/kit/Shell.tsx` | `docs/maps/state/keys/view-state.md` |
| `chrome.surface-state` | `pure-client` | `web/lib/surface-state.ts` | `web/components/kit/SurfaceState.tsx`<br>`web/components/watch/WatchApp.tsx`<br>`web/components/supply/SupplyFlow.tsx`<br>`web/components/borrow/BorrowFlow.tsx`<br>`web/components/assets/AssetsPage.tsx` | `docs/maps/state/keys/view-state.md` |
| `executor.registry` | `pure-client` | `web/hooks/useTransactionExecutor.ts` | `web/hooks/useTransactionExecutor.ts` | `docs/maps/state/keys/execution-state.md` |
| `executor.result` | `pure-client` | `web/hooks/useTransactionExecutor.ts` | `web/hooks/useTransactionExecutor.ts`<br>`web/hooks/useWriteFlow.ts`<br>`web/hooks/useStaleRecovery.ts` | `docs/maps/state/keys/execution-state.md` |
| `executor.status` | `pure-client` | `web/hooks/useTransactionExecutor.ts` | `web/hooks/useWriteFlow.ts`<br>`web/components/kit/ActionButton.tsx`<br>`web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/execution-state.md` |
| `first-run.dismissed` | `pure-client` | `web/components/first-run/Surface.tsx` | `web/app/page.tsx`<br>`web/components/first-run/Chooser.tsx` | `docs/maps/state/keys/view-state.md` |
| `persist.acknowledgment` | `pure-client` | `web/hooks/useAcknowledgment.ts` | `web/components/first-run/useAcknowledgeRiskTrace.ts`<br>`web/app/risk/page.tsx` | `docs/maps/state/keys/view-state.md` |
| `persist.drafts` | `pure-client` | `web/lib/storage.ts`<br>`web/lib/parse.ts` | `web/components/supply/SupplyFlow.tsx`<br>`web/components/borrow/BorrowFlow.tsx` | `docs/maps/state/keys/form-state.md` |
| `persist.receipts` | `pure-client` | `web/lib/receipts.ts`<br>`web/components/supply/SupplyFlow.tsx`<br>`web/components/borrow/BorrowFlow.tsx` | `web/lib/receipts.ts`<br>`web/hooks/useStaleBalanceGuard.ts` | `docs/maps/state/keys/execution-state.md` |
| `query.books.borrower` | `on-chain` | `web/lib/query-keys.ts` | `web/hooks/useBorrowerBook.ts`<br>`web/lib/invalidate.ts` | `docs/maps/state/keys/chain-reads.md` |
| `query.books.lender` | `on-chain` | `web/lib/query-keys.ts` | `web/hooks/useLenderBook.ts`<br>`web/lib/invalidate.ts` | `docs/maps/state/keys/chain-reads.md` |
| `query.ladder` | `on-chain` | `web/lib/query-keys.ts` | `web/hooks/useLadder.ts`<br>`web/lib/invalidate.ts` | `docs/maps/state/keys/chain-reads.md` |
| `query.usd.price` | `on-chain` | `web/lib/query-keys.ts` | `web/hooks/useUsdPrice.ts` | `docs/maps/state/keys/chain-reads.md` |
| `queue.rows` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/hooks/useTxQueue.ts`<br>`web/lib/actions/claim.ts` | `docs/maps/state/keys/execution-state.md` |
| `queue.running` | `pure-client` | `web/hooks/useTxQueue.ts` | `web/hooks/useTxQueue.ts`<br>`web/components/kit/ActionButton.tsx` | `docs/maps/state/keys/execution-state.md` |
| `rates.workspace-open` | `pure-client` | `web/components/borrow/RateStep.tsx`<br>`web/components/supply/RateStep.tsx`<br>`web/components/rates/Workspace.tsx` | `web/components/rates/Workspace.tsx` | `docs/maps/state/keys/view-state.md` |
| `review.reload-key` | `pure-client` | `web/components/kit/SettlementTrace.tsx` | `web/components/kit/SettlementTrace.tsx` | `docs/maps/state/keys/view-state.md` |
| `schedule.clock` | `pure-client` | `web/hooks/useClock.ts` | `web/components/kit/RollingNumber.tsx`<br>`web/components/kit/Ribbon.tsx`<br>`web/lib/payoff.ts`<br>`web/components/watch/SuppliedDetail.tsx`<br>`web/components/watch/BorrowedDetail.tsx`<br>`web/components/watch/StreamDetail.tsx` | `docs/maps/state/keys/schedule.md` |
| `schedule.cover-date` | `pure-client` | `web/lib/payoff.ts` | `web/components/watch/BorrowedDetail.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/kit/Receipt.tsx` | `docs/maps/state/keys/schedule.md` |
| `schedule.freshness` | `pure-client` | `web/lib/freshness.ts`<br>`web/hooks/useFreshness.ts` | `web/components/kit/StatusLine.tsx`<br>`web/components/watch/SuppliedDetail.tsx`<br>`web/components/watch/BorrowedDetail.tsx`<br>`web/hooks/useWriteFlow.ts` | `docs/maps/state/keys/schedule.md` |
| `schedule.interpolated-earnings` | `pure-client` | `web/lib/payoff.ts` | `web/components/kit/RollingNumber.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/watch/SuppliedDetail.tsx` | `docs/maps/state/keys/schedule.md` |
| `schedule.interpolated-outstanding` | `pure-client` | `web/lib/payoff.ts` | `web/components/kit/RollingNumber.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/watch/BorrowedDetail.tsx` | `docs/maps/state/keys/schedule.md` |
| `schedule.interpolated-vested` | `pure-client` | `web/lib/payoff.ts` | `web/components/kit/RollingNumber.tsx`<br>`web/components/watch/Wall.tsx`<br>`web/components/watch/StreamDetail.tsx`<br>`web/lib/ledger-card.ts` | `docs/maps/state/keys/schedule.md` |
| `schedule.repay-preview` | `pure-client` | `web/lib/payoff.ts` | `web/components/kit/Receipt.tsx`<br>`web/components/watch/BorrowedDetail.tsx` | `docs/maps/state/keys/schedule.md` |
| `schedule.skew-offset` | `pure-client` | `web/lib/payoff.ts`<br>`web/hooks/useClock.ts` | `web/hooks/useClock.ts`<br>`web/lib/payoff.ts` | `docs/maps/state/keys/schedule.md` |
| `schedule.stream-params` | `on-chain` | `web/hooks/useStreams.ts` | `web/lib/payoff.ts`<br>`web/components/kit/Ribbon.tsx`<br>`web/components/kit/RollingNumber.tsx`<br>`web/lib/ledger-card.ts` | `docs/maps/state/keys/schedule.md` |
| `tx.replaced` | `pure-client` | `web/hooks/useTxQueue.ts`<br>`web/hooks/useTransactionExecutor.ts` | `web/hooks/useWriteFlow.ts`<br>`web/components/kit/ActionButton.tsx` | `docs/maps/state/keys/execution-state.md` |
| `usd.mode` | `pure-client` | `web/components/kit/TokenUsdSwitch.tsx` | `web/components/kit/Amount.tsx`<br>`web/components/kit/Receipt.tsx`<br>`web/components/watch/SuppliedDetail.tsx` | `docs/maps/state/keys/view-state.md` |
| `usd.price` | `on-chain` | `web/hooks/useUsdPrice.ts`<br>`web/lib/usd.ts` | `web/components/kit/Amount.tsx`<br>`web/components/kit/TokenUsdSwitch.tsx`<br>`web/components/watch/SuppliedDetail.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `usd.staleness` | `on-chain` | `web/lib/usd.ts`<br>`web/hooks/useUsdPrice.ts` | `web/components/kit/TokenUsdSwitch.tsx`<br>`web/components/kit/StatusLine.tsx`<br>`web/components/kit/Amount.tsx` | `docs/maps/state/keys/chain-reads.md` |
| `watch.lens` | `pure-client` | `web/components/kit/LensTabs.tsx`<br>`web/app/page.tsx` | `web/components/watch/Wall.tsx`<br>`web/components/kit/LensTabs.tsx` | `docs/maps/state/keys/view-state.md` |
| `watch.narrow-nav` | `pure-client` | `web/components/watch/Wall.tsx` | `web/components/watch/Wall.tsx` | `docs/maps/state/keys/view-state.md` |
| `watch.selected-entity` | `pure-client` | `web/components/watch/Wall.tsx`<br>`web/app/page.tsx` | `web/components/watch/SuppliedDetail.tsx`<br>`web/components/watch/BorrowedDetail.tsx`<br>`web/components/watch/StreamDetail.tsx`<br>`web/components/watch/ClosedLoanDetail.tsx`<br>`web/components/watch/Wall.tsx` | `docs/maps/state/keys/view-state.md` |
| `writeflow.is-preparing` | `pure-client` | `web/hooks/useWriteFlow.ts` | `web/hooks/useWriteFlow.ts`<br>`web/hooks/useApprovalWriteFlows.ts` | `docs/maps/state/keys/execution-state.md` |
