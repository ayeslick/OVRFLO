# Chain reads

The browser's copies of chain facts, and the query keys that hold them.

`trust_domain: on-chain` here means **this value came from a contract read (or from
the wallet provider) and is the authority the UI is allowed to gate on.** It does
*not* mean the contract-side story lives in this file — `x-ray/` remains the
authority for Solidity entry points and contract state. These entries answer
"which browser modules depend on this chain fact?", nothing more.

Entry format and rules: `README.md`.

---

### `chain.connection`

The wallet connection: status, connected addresses, and chain ID.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/components/Providers.tsx` — mounts the wagmi and AppKit providers that own the connection
  - `web/components/WalletRuntime.tsx` — connect / disconnect surface
- **readers:**
  - `web/components/MarketsApp.tsx` — derives the connected address; clears `markets.selected-market` and `markets.active-mode` when it changes
  - `web/hooks/useChainGuard.ts` — derives `wrongChain` against the configured chain
  - `web/hooks/useWriteFlow.ts` — builds the execution identity every write is checked against
  - `web/hooks/useClaimAllExecution.ts` — supplies the queue's owning identity
  - `web/components/action-flow/SupplyFlow.tsx` — signer-switch reset
  - `web/components/action-flow/BorrowFlow.tsx` — signer-switch reset
  - `web/components/action-flow/RepayFlow.tsx` — signer-switch reset
  - `web/components/action-flow/ConvertFlow.tsx` — signer-switch reset
  - `web/components/action-flow/PositionFlow.tsx` — signer-switch reset
  - `web/components/action-flow/ClaimFlow.tsx` — signer-switch reset
- **notes:** Provider-authoritative rather than contract-read, and the one
  `on-chain` key that gates directly: `useChainGuard` replaces every primary
  action control with a switch-network prompt on the wrong chain. The gate is
  only half of it — every write also names its expected chain, so a broadcast is
  refused at the write layer even when the gate is bypassed by a stale tab or a
  switch that races a click. `wrongChain` is deliberately `false` while
  disconnected or reconnecting, so a switch-network prompt never displaces
  CONNECT WALLET.

### `chain.vault-registry`

The factory's vault set and each vault's underlying, ovrfloToken, and lending address.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useOvrflos.ts` — batched factory reads (`ovrfloCount`, `ovrflos`, `ovrfloInfo`, `ovrfloToLending`)
- **readers:**
  - `web/hooks/useAllMarkets.ts` — the vault list every market enumeration starts from
  - `web/hooks/useHeldStreams.ts` — the vault set stream discovery is scoped to, and the readiness precondition for starting it
- **notes:** Fails closed in two directions. A partial hydration returns an empty
  vault list **plus** an explicit incompleteness error rather than a short list
  that reads as complete; and a registry larger than the enumeration cap sets
  `tooLarge` rather than silently truncating. Consumers must propagate both —
  `useHeldStreams` refuses to start discovery unless the registry is loaded,
  error-free, and within the cap, and marks itself unavailable otherwise.

### `chain.markets`

The approved market set per vault, with each market's series data.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useAllMarkets.ts` — batched `approvedMarketCount` / `approvedMarketAt` / `series` reads
- **readers:**
  - `web/components/MarketsApp.tsx` — passes the market list to the table and the positions strip
  - `web/components/MarketsTable.tsx` — renders one row per market
  - `web/components/PositionSummary.tsx` — filters to markets that have a lending instance
  - `web/hooks/useMarketSymbols.ts` — collects the token addresses to resolve symbols for
- **notes:** Exposes a three-valued `status` — `loading` · `ready` ·
  `unavailable` — alongside `tooLarge`, and returns `[]` for markets whenever
  the enumeration is incomplete or over budget. The empty list is therefore only
  meaningful together with `status` and `tooLarge`: rendering it as "no markets"
  without checking both is exactly the empty-versus-cannot-ask collapse the
  system chrome exists to prevent. `MarketsTable` receives `registryStatus` and
  `truncated` for that reason.

### `chain.market-symbols`

Lowercased-address → ERC-20 symbol map for every market's ovrfloToken and underlying.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useMarketSymbols.ts` — one batched, deduplicated `symbol()` read
- **readers:**
  - `web/components/MarketsApp.tsx` — resolves once and threads the map down as a prop
  - `web/components/MarketsTable.tsx` — row labels
  - `web/components/MarketRowDetail.tsx` — detail labels
  - `web/components/PositionSummary.tsx` — per-symbol rollup labels
  - `web/components/PositionList.tsx` — position labels
  - `web/components/MarketDetail.tsx` — overlay labels
- **notes:** Resolve through `symbolFor` so lookups never depend on address
  casing; an unresolved symbol falls back to a formatted address rather than an
  empty label. Read once at the top and passed down deliberately — resolving per
  row would re-issue the same batch for every market. PT symbols are
  deliberately not read.

### `chain.lending-config`

One lending market's APR bounds, fee, next IDs, and route cap.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useLending.ts` — batched `OVRFLOLending` config reads
- **readers:**
  - `web/components/MarketsTable.tsx` — ladder bounds for the rate cell
  - `web/components/MarketRowDetail.tsx` — ladder bounds and fee display
  - `web/components/PositionList.tsx` — fee and obligation context
  - `web/components/action-flow/SupplyFlow.tsx` — validates the chosen tick against the configured APR range
  - `web/components/action-flow/BorrowFlow.tsx` — ladder bounds and the route-ID cap that bounds batch assembly
  - `web/components/action-flow/PositionFlow.tsx` — ladder bounds for a rate adjustment
- **notes:** Exposes a `complete` flag; a partial read must not be treated as
  a configured range, because a wrong `aprMin`/`aprMax` would silently reshape
  the ladder the user picks from. The contract re-validates the tick regardless.

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
  in `web/lib/query-keys.ts`. Matching is done on the **serialised** key rather
  than by walking wagmi's internal key shape, because that shape is not part of
  its public contract and an address sits at different depths for a single read
  versus a batched one. Post-write refresh is scoped to the contracts the
  transaction actually touched — the market's whole contract set, not just the
  `to` address, because balance and allowance reads are keyed by *token*.
  A refresh failure is surfaced as `refresh_failed`, never swallowed: the
  transaction landed but the numbers on screen are not known to reflect it.

### `chain.block-timestamp`

The latest block timestamp, from `useBlock`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/hooks/useBorrowDemand.ts` — `useBlock` with a 30s stale time
- **readers:**
  - `web/hooks/useBorrowDemand.ts` — the window boundary for the trailing-30-day demand aggregation
- **notes:** Chain time, not client time — `chrome.now-seconds` is the client
  clock and is display-only. When this read errors, demand reports
  `unavailable`; when it is merely absent, demand reports `loading`. Those are
  two different answers and the hook keeps them apart.

### `query.streams.held`

Declared TanStack query key for the held-stream list: `["streams", "held", user]`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — declares `streamKeys.all` and `streamKeys.held`
- **readers:**
  - `web/lib/invalidate.ts` — `invalidateOnChainReads` (streams option), `invalidateAllOnChainReads`, and `scheduleHeldStreamsRetry` all target this key
- **notes:** **No producer currently registers a query under this key.** Held
  streams moved to the projection scope `projection.stream` during the on-chain
  discovery cutover, so every invalidation listed above is a no-op against an
  empty cache entry. Recorded rather than deleted because the drift is the
  finding: an agent reading `invalidate.ts` would otherwise conclude that
  refreshing held streams is handled. `scheduleHeldStreamsRetry` also describes
  indexer polling that no longer exists. Reviving this key means registering a
  producer; refreshing held streams today means matching the projection scope.

### `query.demand.market`

Declared TanStack query key for per-market borrow demand: `["demand", "market", market]`.

- **trust_domain:** `on-chain`
- **writers:**
  - `web/lib/query-keys.ts` — declares `demandKeys.all` and `demandKeys.market`
- **readers:**
  - `web/lib/query-keys.ts` — no production consumer; referenced only by its own unit test
- **notes:** Dead declaration. Borrow demand is served by `projection.demand`
  under the projection key space. Catalogued so the next agent does not wire a
  new consumer onto a key nothing invalidates.
