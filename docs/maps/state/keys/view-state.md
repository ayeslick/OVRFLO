# View state

Selection, expansion, and overlay state — what the user is currently looking at.
All `pure-client`: none of it is chain truth, and none of it may gate an action.

Entry format and rules: `README.md`.

---

### `markets.selected-market`

The market whose row is expanded in the table. `null` collapses every row.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/MarketsApp.tsx` — owns the `selectedMarket` state; clears it to `null` when the connected address changes
  - `web/components/MarketsTable.tsx` — calls `onSelect(expanded ? null : market)` from the row toggle
- **readers:**
  - `web/components/MarketsTable.tsx` — `selected` prop decides which row reads as expanded and whether the detail region renders
  - `web/components/MarketRowDetail.tsx` — rendered only for the selected market; every read it issues is scoped to it
- **notes:** Level one of the two-level view state; `markets.active-mode` is level
  two. Collapsing the row is what stops the row's historical scans, so this key
  bounds work as well as layout. The signer-switch reset in `MarketsApp` is
  deliberate — an expanded row's balances describe the previous account.

### `markets.active-mode`

The `{ market, action }` pair backing the action overlay. `null` means no overlay.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/MarketsApp.tsx` — owns `activeMode`; sets it from `onMode`, clears it on overlay close and on signer switch
  - `web/components/MarketsTable.tsx` — forwards `onMode(selected, action)` from the expanded detail
  - `web/components/MarketRowDetail.tsx` — raises `onMode` from the per-action controls
- **readers:**
  - `web/components/MarketsApp.tsx` — gates whether the overlay mounts at all; a null value renders no overlay
  - `web/components/MarketDetail.tsx` — renders the overlay for `activeMode.market` and `activeMode.action`
- **notes:** Closing the overlay clears this key only — the row stays expanded. The
  overlay scrim blocks the table while open, so this key and
  `markets.selected-market` can never point at different markets. Changing that
  invariant is a state-map change, not a styling change.

### `markets.row-detail.advanced-open`

Whether the expanded row's advanced (raw-value) block is showing.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/MarketRowDetail.tsx` — `advancedOpen` toggle
- **readers:**
  - `web/components/MarketRowDetail.tsx` — gates rendering of the advanced block
- **notes:** Local disclosure only. It hides presentation, never a control that
  changes what an action does.

### `positions.advanced-open`

The same disclosure toggle inside the per-market position list.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/PositionList.tsx` — `advancedOpen` toggle
- **readers:**
  - `web/components/PositionList.tsx` — gates rendering of the advanced block
- **notes:** Deliberately separate from `markets.row-detail.advanced-open`; the two
  disclosures are independent and sharing one key would couple them.

### `positions.loaded-user`

The address whose personal history the user has explicitly asked to load.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/PositionSummary.tsx` — set to the connected address by the LOAD POSITIONS button
- **readers:**
  - `web/components/PositionSummary.tsx` — compares against the connected address; renders the load prompt until they match, then mounts `LoadedPositionSummary`
- **notes:** This is the consent gate for historical scanning: no candidate
  discovery or hydration runs for an account until the user asks. It is compared
  case-insensitively against the live connected address, so a signer switch drops
  back to the prompt rather than showing the previous account's history. It gates
  *work*, never *permission* — nothing downstream treats it as authorisation.

### `positions.aggregates`

Per-market rollups reported upward by each mounted market row, keyed by market.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/PositionSummary.tsx` — `onData(key, data)` inserts or removes one market's aggregate
- **readers:**
  - `web/components/PositionSummary.tsx` — reduces the rows into per-symbol supplied/claimable totals and the loan summary
- **notes:** Derived state, not a fact: every value in it originates in an
  `on-chain` or `projection` key owned elsewhere. Each row carries its own
  `status`, and a symbol renders `—` until every market reporting under it is
  ready — one market's failure must never be absorbed into another market's total.
  Summing across mixed-readiness rows would manufacture a confident wrong number,
  which is the failure this shape exists to prevent.

### `positions.claim-all-open`

Whether the Claim All modal is mounted.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/PositionSummary.tsx` — `claimAllOpen`, set by the CLAIM ALL control and cleared on close
- **readers:**
  - `web/components/PositionSummary.tsx` — mounts `ClaimAllModal`
- **notes:** Unmounting the modal discards the whole queue surface
  (`queue.rows` and the `claim-all.*` keys). Confirmed rows are already on chain;
  the queue's own history is not recoverable across a close.

### `chrome.market-detail.reload-key`

Remount counter for the overlay body after an error-boundary reset.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/MarketDetail.tsx` — incremented by `ModalErrorBoundary`'s `onReset`
- **readers:**
  - `web/components/MarketDetail.tsx` — passed as `key` to the form body, forcing a fresh mount
- **notes:** Only the body sits inside the boundary; the header and close button
  stay outside so a body-level throw never traps the user. Incrementing this key
  discards all `form-state.md` keys for that form by remounting — which is the
  point, since the form state that produced the throw is not trustworthy.

### `chrome.now-seconds`

The browser's current wall-clock second, used for countdowns and maturity display.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useNowSeconds.ts` — interval tick from `Date.now()`
- **readers:**
  - `web/components/MarketsTable.tsx` — maturity and rate-window display
  - `web/components/MarketRowDetail.tsx` — countdown display
  - `web/components/PositionList.tsx` — stream progress display
  - `web/components/action-flow/SupplyFlow.tsx` — window display
  - `web/components/action-flow/BorrowFlow.tsx` — window display
  - `web/components/action-flow/ConvertFlow.tsx` — window display
  - `web/components/action-flow/PositionFlow.tsx` — window display
- **notes:** Client clock, not block time — it can be wrong by any amount and is
  attacker-controlled on the user's own machine. Display only. Anything that
  decides whether an action is permitted uses block timestamp
  (`chain.block-timestamp`) or the contract's own check. The deferred variant
  returns `null` before hydration so server and client renders agree.

### `chrome.copy-value.copied`

Transient "copied" acknowledgement on a copyable value.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/CopyValue.tsx` — set on copy, cleared by a timer
- **readers:**
  - `web/components/CopyValue.tsx` — swaps the control's label
- **notes:** Catalogued for completeness so the index's module coverage is honest.
  It carries no product meaning.
