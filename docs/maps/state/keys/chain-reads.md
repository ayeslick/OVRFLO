# Chain reads

The browser's copies of chain facts, and the query keys that hold them.

`trust_domain: on-chain` here means **this value came from a contract read (or from
the wallet provider) and is the authority the UI is allowed to gate on.** It does
*not* mean the contract-side story lives in this file — `x-ray/` remains the
authority for Solidity entry points and contract state. These entries answer
"which browser modules depend on this chain fact?", nothing more.

USD feed keys (`usd.price`, `usd.staleness`) are on-chain **and display-only**:
they never appear on receipts, never enter calldata, and never reach a write
gate. Token amounts remain the signed unit.

Entry format and rules: `README.md`.

---

### `chain.connection`

The wallet connection: status, connected addresses, and chain ID.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/components/Providers.tsx` — mounts the wagmi and AppKit providers that own the connection
  - `web/components/WalletRuntime.tsx` — `WalletButton`: connect / disconnect (E2E swaps this module at build time)
- **readers:**
  - `web/app/page.tsx` — R12 entry: disconnected vs watch vs empty
  - `web/components/watch/WatchApp.tsx` — matrix vs incomplete vs disconnected
  - `web/hooks/useChainGuard.ts` — derives `wrongChain` against the configured chain
  - `web/hooks/useWriteFlow.ts` — builds the execution identity every write is checked against
  - `web/hooks/useWalletChangeReset.ts` — raises `action.wallet-changed` on address change
  - `web/components/watch/Wall.tsx` — landing U7: scopes the wall to the connected account
- **notes:** Provider-authoritative rather than contract-read, and the one
  `on-chain` key that gates directly: `useChainGuard` replaces every primary
  write surface with a switch-network prompt on the wrong chain
  (`UI-SHELL-NETWORK-GATE`). Every write also names its expected chain, so a
  broadcast is refused at the write layer even when the gate is bypassed.
  `wrongChain` is deliberately `false` while disconnected or reconnecting, so a
  switch-network prompt never displaces `CONNECT WALLET`. Disconnecting clears
  account-scoped UI; a transaction already broadcast continues on chain.

### `chain.vault-registry`

The factory's vault set and each vault's underlying, ovrfloToken, lending, reserve, and retired lendings.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/protocol-bootstrap.ts` — factory reads (`ovrfloCount`, `ovrflos`, `ovrfloInfo`, `ovrfloToLending`, `ovrfloToReserve`, `lendings(i)`)
  - `web/hooks/useOvrflos.ts` — exposes the bootstrap vault list to the rest of the app
- **readers:**
  - `web/hooks/useAllMarkets.ts` — the vault list every market enumeration starts from
  - `web/hooks/useStreams.ts` — landing U6: vault set that stream discovery is scoped to, and the readiness precondition for starting it
- **notes:** Fails closed in two directions. A partial hydration returns an empty
  vault list **plus** an explicit incompleteness error rather than a short list
  that reads as complete; a registry larger than the enumeration cap sets
  `tooLarge` rather than silently truncating. `useStreams` starts the pinned
  pager only after the registry is ready (`registryComplete`). The wall no
  longer refuses over `MAX_ENUMERATION_IDS`; complete-set consumers use
  `useCompleteStreams`. Truncation of the vault list itself still surfaces
  through `UI-SHELL-TRUNCATION`. `retiredLendings` lists factory markets that
  still map to the vault after `replaceLending`; with no replacement the list
  is empty.

### `chain.markets`

The approved market set per vault, with each market's series data (expiry, PT, fee, TWAP).

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useAllMarkets.ts` — batched `approvedMarketCount` / `approvedMarketAt` / `series` reads
- **readers:**
  - `web/app/page.tsx` — market list for shell and flow launch
  - `web/components/supply/SelectMarket.tsx` — landing U8: `UI-SUPPLY-SELECT-MARKET`
  - `web/components/assets/StreamSelectMarket.tsx` — landing U10: `UI-ASSETS-STREAM-SELECT-MARKET`
  - `web/hooks/useMarketSymbols.ts` — collects the token addresses to resolve symbols for
- **notes:** Exposes a three-valued `status` — `loading` · `ready` ·
  `unavailable` — alongside `tooLarge`, and returns `[]` for markets whenever
  the enumeration is incomplete or over budget. The empty list is only
  meaningful together with `status` and `tooLarge`: rendering it as "no markets"
  without checking both is the empty-versus-cannot-ask collapse.
  `UI-SUPPLY-SELECT-MARKET` and `UI-ASSETS-STREAM-SELECT-MARKET` must keep those
  states distinguishable. Token names are market-driven via `symbol()`, never a
  hardcoded `ovrfloWSTETH`.

### `chain.market-symbols`

Lowercased-address → ERC-20 symbol map for every market's ovrfloToken and underlying.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useMarketSymbols.ts` — one batched, deduplicated `symbol()` read
- **readers:**
  - `web/components/kit/Amount.tsx` — landing U4: labels
  - `web/components/watch/Wall.tsx` — landing U7: row labels
  - `web/components/supply/AmountStep.tsx` — landing U8: underlying symbol on the amount field
  - `web/components/borrow/AmountStep.tsx` — landing U9: ovrflo-token symbol once the stream's market is known
- **notes:** Resolve through a case-insensitive lookup; an unresolved symbol
  falls back to a formatted address rather than an empty label. Before a market
  is chosen, copy says "the market's ovrflo token". PT symbols are deliberately
  not read for customer-facing labels except on the stream-deposit path, which
  names PT, ovrflo token, and underlying fee separately.

### `chain.lending-config`

One lending market's book constants: `UNIT`, `MIN_LIQUIDITY_AMOUNT`,
`MIN_STREAM_AMOUNT`, `feeBps`, `aprMinBps` / `aprMaxBps`, `tickSpacing`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useLending.ts` — batched `OVRFLOLending` config reads
  - `web/hooks/useLadder.ts` — landing U6: consumes config as ladder bounds
- **readers:**
  - `web/lib/ladder.ts` — landing U5: window derivation, stepper clamps
  - `web/components/kit/RateWindow.tsx` — landing U4: paddle disabled-with-reason at bounds
  - `web/components/supply/AmountStep.tsx` — landing U8: `MIN_LIQUIDITY_AMOUNT` inline feedback
  - `web/components/borrow/AmountStep.tsx` — landing U9: `MIN_STREAM_AMOUNT` / fill floor
- **notes:** Cached long; never duplicated in `web/lib/config.ts`. Exposes a
  `complete` flag; a partial read must not be treated as a configured range,
  because a wrong `aprMin`/`aprMax` would silently reshape the ladder. The
  contract re-validates the tick regardless. This is the mechanism-map "book
  constants" row.

### `chain.tick-depths`

Every configured tick's resting depth from one `tickDepths(market)` view.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useLadder.ts` — landing U6: the one-read ladder
- **readers:**
  - `web/lib/ladder.ts` — landing U5: three-tick window, neighbor hints, clamps
  - `web/components/kit/RateWindow.tsx` — landing U4: stepper window
  - `web/components/rates/Workspace.tsx` — landing U8/U9: `UI-RATES-LADDER`
  - `web/components/borrow/PoolBand.tsx` — landing U9: draw vs resting liquidity
  - `web/components/supply/QueueBand.tsx` — landing U8: unfilled-ahead
- **notes:** On-chain, not a projection. The whole ladder arrives in one read,
  so stepping is instant. Depth is not a fill guarantee — a tick that looked
  deep may fill short; that race is `action.stale-recovery` / `UI-REVIEW-STALE`,
  not a reason to treat this key as a quote. v1-lite has no self-match guard on
  blind fill; do not subtract the user's own supply from borrow depth
  (`UI-RATES-ROW`). Empty (every rung zero after a successful read) is
  `UI-RATES-EMPTY`; a failed read is `unavailable` on `UI-RATES-LADDER`. Those
  must not share a representation. Re-quoted at every checkpoint.

### `chain.lender-positions`

The connected account's supply positions: `lenderPositionCount` →
`lenderPositionAt` → batched `positionState`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useLenderBook.ts` — landing U6: enumeration then batched state
- **readers:**
  - `web/app/page.tsx` — R12: any position → watch, not first-run
  - `web/components/watch/Wall.tsx` — landing U7: supplied lens rows
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: capital band, claim, withdraw
  - `web/lib/invalidate.ts` — post-write refresh of declared `touchedResources`
- **notes:** Confirmed-empty (count zero, read succeeded) is a different answer
  from unavailable. A failed book read must not hide the supplied lens as
  zero-count (`UI-WATCH-LENS`). Matching `enabled` predicates on the batched
  reads are required for wagmi batching. No health-factor or utilisation field
  exists on a position.

### `chain.borrower-loans`

The connected account's loans: `borrowerLoanCount` → `borrowerLoanAt` →
`loanState` (obligation, drawn, repaid, outstanding). Closed loans stay in the
book as SETTLED.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useBorrowerBook.ts` — landing U6: enumeration then batched state; `loansOf` pagination follows `nextSeq` and never reuses a foreign `startSeq`
- **readers:**
  - `web/app/page.tsx` — R12: any loan → watch
  - `web/components/watch/Wall.tsx` — landing U7: borrowed lens, SETTLED rows after active
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: outstanding, repay, close
  - `web/components/watch/ClosedLoanDetail.tsx` — landing U7: returned-stream identity
- **notes:** Outstanding after repay/close is event-derived: it changes only on
  a chain read, not on the interpolation tick. Close-ready is `outstanding`
  covered by current `withdrawableAmountOf` — both re-read at the gate
  (`UI-WATCH-CLOSE`, `UI-REVIEW-CLOSE`). Never invent a health factor or
  liquidation threshold beside outstanding.

### `chain.loans-of-position`

Paginated `loansOf(positionId, startSeq, maxN)` — the pairs a per-position claim
will batch.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useLenderBook.ts` — landing U6: paginated by returned `nextSeq`
- **readers:**
  - `web/lib/actions/claim.ts` — landing U6: Multicall batch of this position only
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: `UI-WATCH-CLAIM` gate
  - `web/components/kit/ActionButton.tsx` — landing U4: live amount in the control
- **notes:** Claimability at the gate is this read plus `loanState`, never
  interpolated earnings. Display interpolation may preview accrual
  (`schedule.interpolated-earnings`); it does not authorise. Cross-position
  Claim-All does not exist. A pair cap (gas headroom) is a named constant with
  a `ponytail:` ceiling comment; overflow is "claim remaining", not one
  oversized Multicall.

### `chain.stream-truth`

Hydrated held-stream facts from the OVRFLO Stream lens at one snapshot pin.
The Watch wall uses TanStack `useInfiniteQuery` whose `queryFn` is
`loadStreamPage` (`streamsOfOwnerIn` at `{blockHash, requireCanonical}` on
loopback, else `{blockNumber}` plus `verifyPinHash`). Complete-set consumers
(BorrowFlow eligibility, claim-all) use `loadCompleteStreams` /
`useCompleteStreams`, never the wall window.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useStreams.ts` — wall pager; pin hash is in the query key
  - `web/hooks/useCompleteStreams.ts` — complete held-stream set at the same pin
  - `web/hooks/useEnumerationPin.ts` — snapshot clock (reuses `useBlock`)
  - `web/lib/protocol/streams.ts` — `loadStreamPage` / `loadCompleteStreams`
- **readers:**
  - `web/components/watch/WatchApp.tsx` — R12 entry book + Streams lens (factory-wide lendings)
  - `web/components/watch/Wall.tsx` — Streams lens rows + `UI-WATCH-LOAD-MORE`
  - `web/components/watch/StreamDetail.tsx` — detail from hydrated state (U9 paints card)
  - `web/components/watch/StreamLedgerCard.tsx` — HTML ledger card figures (U9)
  - `web/lib/ledger-card.ts` — snapshot percent / segments from hydrated schedule (U9)
  - `web/components/borrow/SelectStream.tsx` — eligible unpledged list
  - `web/components/borrow/BorrowFlow.tsx` — complete-set eligibility, not the wall pager
  - `web/lib/claim-all.ts` — complete-set stream claims
  - `web/lib/lending-math.ts` — eligibility mirror of `requireEligible`
  - `web/lib/stream-book.ts` — source cursor, duplicate fail-closed, four book fields
- **notes:** No projection candidate set. Drop any stream whose on-chain owner
  is not the connected address. Hide empty / depleted streams. `MAX_ENUMERATION_IDS`
  is not a wall refusal. Pagination advances by source index even when a window
  yields zero render-eligible rows. A duplicate id in one snapshot is
  `unavailable`, not a Set merge. Query keys include `chainId`, lockup, account,
  and lowercased `pin.blockHash` so `keyMentionsAny` still invalidates.
  Freshness: a held pin is success. The head poll refreshes `dataUpdatedAt`
  (`headUpdatedAt`) every interval whether or not the pin hash changes, so
  `FRESHNESS_MAX_AGE_MS` does not disable signing on a current snapshot.
  `blockTimestamp` on the outcome is the pinned block time. An `unknown_block`
  pin miss captures a new `{blockNumber, blockHash}` and puts the new hash in
  the query key. Placeholder pages under a new hash stay stale and keep the
  page pin until page one of the new snapshot arrives. STALE REFRESH advances
  the pin; it does not refetch the old hash. Writes still simulate against
  latest. Pledged-stream companion `useLoanStreams` shares `READ_INTERVAL_MS`.
  Watch lender/borrower books aggregate every lending from factory discovery;
  `markets[0].lending` is not the Watch scope. Selection and writes bind
  `(lending, id)`.

### `chain.balances`

ERC-20 `balanceOf` for the connected wallet, per token the open surface needs.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useLadder.ts` — landing U6: underlying balance beside supply
  - `web/app/assets/page.tsx` — landing U10: underlying / ovrflo / PT balances
- **readers:**
  - `web/components/kit/AmountField.tsx` — landing U4: MAX and insufficient-balance
  - `web/components/supply/AmountStep.tsx` — landing U8: `loading-balance` is not `0`
  - `web/components/assets/Converter.tsx` — landing U10: wrap / unwrap / claim-PT
- **notes:** Refetch on window focus (U6 re-enables it). A missing balance is
  `loading` or `unavailable`, never a zero that enables MAX. Touched as a
  resource after wrap, unwrap, supply, repay, and deposit.

### `chain.allowances`

ERC-20 `allowance(owner, spender)` for the exact token and spender of the open write.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useApprovalWriteFlows.ts` — refreshes allowance as a touched resource after approve
- **readers:**
  - `web/hooks/useApprovalWriteFlows.ts` — skip-without-renumber when allowance already covers
  - `web/components/kit/SettlementTrace.tsx` — landing U4: omits the approve stage when covered
  - `web/components/kit/Receipt.tsx` — landing U4: PERMISSION RECEIPT exact allowance
- **notes:** **The gate.** `action.approved-amount` is progress display only.
  Treating the form's memory as sufficient would let a stale or
  externally-revoked allowance present as approved. The contract reverts if
  allowance is insufficient regardless.

### `chain.nft-operator`

Sablier `isApprovedForAll` / `getApproved` for the stream being pledged.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useApprovalWriteFlows.ts` — NFT-approval equivalent of allowance
- **readers:**
  - `web/components/borrow/ReviewHandoff.tsx` — landing U9: skip stream-approve when operator already covers
  - `web/components/kit/Receipt.tsx` — landing U4: PERMISSION RECEIPT for the stream
- **notes:** Same rule as `chain.allowances`: re-read at the gate. Borrow has
  no ERC-20 fee approval — the fee comes from proceeds (`UI-BORROW-FACTS`).

### `chain.wrap-reserve`

The reserve contract's tracked wrap counter (not the raw token balance and not a vault figure).

- **trust_domain:** `on-chain`
- **writers:**
  - `web/components/assets/ConverterFlow.tsx` — landing U10: `OVRFLOReserve.wrappedUnderlying()`
  - `web/hooks/useWatchBalances.ts` — wrap-reserve read on the discovered reserve
  - `web/lib/live-action-plan.ts` — unwrap capacity from `OVRFLOReserve.wrappedUnderlying()`
- **readers:**
  - `web/components/assets/Converter.tsx` — landing U10: unwrap removed when reserve is empty; `UI-ASSETS-CLAIM-PT` replaces it
  - `web/components/kit/Receipt.tsx` — landing U4: `UI-REVIEW-CLAIM-CONFIRMED` unwrap-enabled vs reserve-insufficient
- **notes:** Empty reserve is an unavailable unwrap route, not a failed claim
  and not a failed user balance. Direct transfers to the reserve do not increase
  wrap reserve. The web learns the reserve address from `factory.ovrfloToReserve`.

### `chain.block-timestamp`

The latest block timestamp, from a block read.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useClock.ts` — landing U6: reads `block.timestamp` on each event-truth refresh
- **readers:**
  - `web/lib/payoff.ts` — landing U5: skew estimator (local clock vs chain)
  - `web/hooks/useClock.ts` — landing U6: writes `schedule.skew-offset`
- **notes:** Chain time, not client time. `schedule.clock` is the client tick
  and is display-only. When this read errors, skew is unknown and interpolated
  values must not pretend to be chain-aligned — freshness degrades; signing
  follows existing STALE rules. Used for the skew offset, never as a
  per-second animation driver.

### `chain.wagmi-reads`

The whole wagmi read cache — every `useReadContract` / `useReadContracts` result,
rooted at `["readContract"]` and `["readContracts"]`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useOvrflos.ts` — registry reads
  - `web/hooks/useAllMarkets.ts` — market enumeration and series reads
  - `web/hooks/useMarketSymbols.ts` — symbol reads
  - `web/hooks/useLending.ts` — lending config reads
  - `web/lib/invalidate.ts` — `invalidateAllOnChainReads` invalidates both roots wholesale
  - `web/lib/query-resource-registry.ts` — `refreshQueryResources` refetches the matched subset after a write, with `throwOnError`
- **readers:**
  - `web/lib/invalidate.ts` — `keyMentionsAny` matches a serialised key against the touched contract set
  - `web/lib/query-resource-registry.ts` — `buildRefreshPlan` decides which keys a write must refresh
  - `web/hooks/useWriteFlow.ts` — names the touched resources per action and awaits the refresh before reporting success
- **notes:** wagmi read hooks own their own keys; only real `useQuery` keys live
  in `web/lib/query-keys.ts` (rewritten U6 as factories per feature). Matching
  is done on the **serialised** key. Post-write refresh is scoped to the
  contracts the transaction actually touched — the market's whole contract set,
  not just the `to` address, because balance and allowance reads are keyed by
  *token*. A refresh failure is `refresh_failed`, never swallowed: the
  transaction landed but the numbers on screen are not known to reflect it.

### `usd.price`

Chainlink mainnet stETH/USD × wstETH `stEthPerToken`. Display-only.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useUsdPrice.ts` — landing U6: product of the two on-chain answers
  - `web/lib/usd.ts` — landing U5: pure product + classification
- **readers:**
  - `web/components/kit/Amount.tsx` — landing U4: USD reference beside the token amount
  - `web/components/kit/TokenUsdSwitch.tsx` — landing U4: disables when unavailable
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: hero USD companion
- **notes:** **Display-only.** Never in receipts (`UI-REVIEW-PERMISSION-RECEIPT`,
  `UI-REVIEW-ACTION-RECEIPT`), never in calldata, never a write gate. The token
  amount never disappears when USD mode is on. The per-second tick never
  extrapolates a price (KTD14) — this refreshes with the read cadence. Feed
  addresses enter `web/lib/config.ts` only after explorer verification. Never
  assume stETH ≈ ETH.

### `usd.staleness`

Classification of the USD feed: fresh, heartbeat-stale, or `USD UNAVAILABLE`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/usd.ts` — landing U5: non-positive answer, heartbeat-plus-grace, 24h absolute cutoff
  - `web/hooks/useUsdPrice.ts` — landing U6: exposes the class
- **readers:**
  - `web/components/kit/TokenUsdSwitch.tsx` — landing U4: `disabled-unavailable`
  - `web/components/kit/StatusLine.tsx` — landing U4: `UI-SHELL-STATUS` `usd-unavailable`
  - `web/components/kit/Amount.tsx` — landing U4: `USD UNAVAILABLE` — no guessed figure
- **notes:** Display-only, same as `usd.price`. Unavailable disables the switch;
  it does not invent a dollar figure and does not block token-denominated
  writes. Token amounts are unaffected.

### `query.books.lender`

Declared TanStack query key for the lender book: factory per account + market.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — landing U6: `bookKeys.lender` factory
- **readers:**
  - `web/hooks/useLenderBook.ts` — landing U6: registers the query
  - `web/lib/invalidate.ts` — post-write invalidation via `touchedResources`
- **notes:** No inline key literals outside this factory (U6 grep gate). Broadest
  sensible invalidation after supply / withdraw / claim receipts.

### `query.books.borrower`

Declared TanStack query key for the borrower book.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — landing U6: `bookKeys.borrower` factory
- **readers:**
  - `web/hooks/useBorrowerBook.ts` — landing U6: registers the query
  - `web/lib/invalidate.ts` — post-write invalidation after borrow / repay / close
- **notes:** Same factory discipline as `query.books.lender`. Closed loans remain
  in this book as SETTLED; invalidation after close must also refresh streams
  so the freed stream reappears on the same reconciling read (R9).

### `query.request-book`

Declared TanStack query key for resting request-book rows per account and lending set.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — `requestBookKeys.factory`
- **readers:**
  - `web/hooks/useRequestBook.ts` — registers the factory query
  - `web/lib/invalidate.ts` — post-write invalidation after post / execute / cancel
- **notes:** The book list is `requestCount(account)` then `requestAt(account, i)`.
  Those ids swap-compact, so the hook pins every read to one block the same
  way the stream wall does. Each id hydrates through `requests(id)`.
  Completeness follows this wallet's count, not `nextRequestId`. The factory
  walk unions `lending.router()` with `priorRouterAt(lending, i)`. An address
  with no code is skipped. A contract whose `lending()` call fails stays
  unavailable. `row.lending` comes from `book.lending()`. A failed factory
  prior-list read never paints an empty portfolio. Waiting-request identity
  stays on `?stream=`.

### `query.ladder`

Declared TanStack query key for `tickDepths(market)`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — landing U6: `ladderKeys.market` factory
- **readers:**
  - `web/hooks/useLadder.ts` — landing U6: registers the query
  - `web/lib/invalidate.ts` — re-quote at every checkpoint and after supply / borrow
- **notes:** One key per market, not per tick — the view returns every rung.

### `query.streams.truth` — retired

Custom TanStack key for hydrated stream truth. **Removed in U8.** Held-stream
reads are wagmi `readContract` / `readContracts` keys scoped to
`SABLIER_LOCKUP_ADDRESS`. See `chain.stream-truth` and ADR-0002.

### `query.usd.price`

Declared TanStack query key for the USD product.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — landing U6: `usdKeys.price` factory
- **readers:**
  - `web/hooks/useUsdPrice.ts` — landing U6: registers the query
- **notes:** Read cadence, not tick cadence. Display-only consumers.
