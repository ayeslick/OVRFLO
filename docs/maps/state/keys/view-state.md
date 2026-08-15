# View state

Lens, selection, USD display mode, shell chrome, first-run memory, and the ALL
RATES workspace flag — what the user is currently looking at.
All `pure-client` except where a note points at an on-chain companion: none of
it is chain truth, and none of it may gate an action.

Entry format and rules: `README.md`.

---

### `watch.lens`

Which role lens is active: `supplied` · `borrowed` · `streams`.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/kit/LensTabs.tsx` — landing U4: APG tablist writes URL `?lens=` and per-wallet localStorage
  - `web/app/page.tsx` — resolution order: URL param → per-wallet memory → supplied default
- **readers:**
  - `web/components/watch/Wall.tsx` — landing U7: which row set to render
  - `web/components/kit/LensTabs.tsx` — landing U4: selected tab
- **notes:** Resolution order is URL → per-wallet memory → supplied (dual-role
  wallets; lenders visit most, on claim cadence). An invalid URL value is
  ignored. Memory is keyed by lowercased address; a different account never
  inherits the previous account's lens. A lens whose **confirmed** count is
  zero is hidden; a pending or failed book read is not a confirmed zero
  (`UI-WATCH-LENS`). Client-only: apply in an effect after first paint, never
  a render-read of localStorage (static-export hydration). Throw-tolerant
  storage wrapper (U6).

### `watch.selected-entity`

The entity whose detail is open: `{ kind: position | loan | stream, id }` or none.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/watch/Wall.tsx` — landing U7: `UI-WATCH-SELECT` writes `?position=` / `?loan=` / `?stream=`
  - `web/app/page.tsx` — hydrates from the URL; clears on disconnect
- **readers:**
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: mounted when kind is `position`
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: mounted when kind is `loan` (active)
  - `web/components/watch/StreamDetail.tsx` — landing U7: mounted when kind is `stream`
  - `web/components/watch/ClosedLoanDetail.tsx` — landing U7: mounted when kind is `loan` (SETTLED)
  - `web/components/watch/Wall.tsx` — landing U7: which row reads as selected
- **notes:** URL carries selection at every width so deep links and Back work
  (KTD13). Wide: detail in place. Narrow (<1024px): `watch.narrow-nav` list→detail.
  Selecting does not authorise; it only scopes which on-chain entity is shown.
  Account change clears this key.

### `watch.narrow-nav`

Whether the narrow viewport is showing the wall list or the selected detail.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/watch/Wall.tsx` — landing U7: list vs detail from viewport + `watch.selected-entity`
- **readers:**
  - `web/components/watch/Wall.tsx` — landing U7: `UI-WATCH-NARROW-NAV` return affordance
- **notes:** Derived from viewport and selection, not a third URL param. The
  URL still carries the selected entity so Back deselects. Below 1024px only.

### `usd.mode`

Whether amounts emphasize token units or a USD reference. Default `token`.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/kit/TokenUsdSwitch.tsx` — landing U4: `UI-SHELL-TOKEN-USD`
- **readers:**
  - `web/components/kit/Amount.tsx` — landing U4: companion USD figure
  - `web/components/kit/Receipt.tsx` — landing U4: **ignores this key** — receipts stay token-exact
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: hero companion
- **notes:** Display mode only. Never changes calldata, allowances, receipts, or
  gates. Persisted in throw-tolerant storage; applied in an effect after first
  paint. When `usd.staleness` is unavailable the switch is disabled
  (`USD UNAVAILABLE`) and this key must not print a guessed figure.

### `chrome.copy-value.copied`

Transient "copied" acknowledgement on a copyable value.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/CopyValue.tsx` — set on copy, cleared by a timer
- **readers:**
  - `web/components/CopyValue.tsx` — swaps the control's label (`UI-SHELL-ADDRESS-COPY`)
- **notes:** Catalogued so module coverage is honest. No product meaning.

### `review.reload-key`

Remount counter for a review-body error-boundary reset.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/kit/SettlementTrace.tsx` — landing U4: incremented by `UI-REVIEW-ERROR-BOUNDARY` `onReset`
- **readers:**
  - `web/components/kit/SettlementTrace.tsx` — landing U4: passed as `key` to the form body
- **notes:** Only the body sits inside the boundary; header and close stay
  outside so a body-level throw never traps the user. Incrementing discards
  `form-state.md` keys for that form by remounting. Distinct from
  `UI-SHELL-REGION-BOUNDARY` / `UI-SHELL-ROUTE-ERROR`.

### `rates.workspace-open`

Whether the ALL RATES expert workspace is open, and which flow opened it.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/borrow/RateStep.tsx` — landing U9: `UI-BORROW-ALL-RATES`
  - `web/components/supply/RateStep.tsx` — landing U8: `UI-SUPPLY-ALL-RATES`
  - `web/components/rates/Workspace.tsx` — landing U8/U9: `UI-RATES-CLOSE` / successful pick
- **readers:**
  - `web/components/rates/Workspace.tsx` — landing U8/U9: `borrow-context` vs `supply-context`
- **notes:** A pick writes `action.selected-apr-raw` and closes. Escape / close
  without a pick leaves the caller's tick standing. This workspace does not
  sign (`UI-RATES-WORKSPACE`).

### `first-run.dismissed`

Whether the connected empty wallet has dismissed the guided first run.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/first-run/Surface.tsx` — landing U11: `UI-FIRST-RUN-DISMISS`
- **readers:**
  - `web/app/page.tsx` — chooser vs guided when emptiness is confirmed
  - `web/components/first-run/Chooser.tsx` — landing U11: `UI-FIRST-RUN-CHOOSER`
- **notes:** Does not assert emptiness — R12 emptiness is on-chain books plus
  stream **truth**, and discovery could-not-ask never reaches first-run.
  Persisted per wallet; effect-applied. Dismissing still requires
  `persist.acknowledgment` before the first write.

### `persist.acknowledgment`

Whether this wallet has completed `UI-REVIEW-ACKNOWLEDGE-RISK`.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useAcknowledgment.ts` — landing U6: one-time per address
- **readers:**
  - `web/components/first-run/useAcknowledgeRiskTrace.ts` — landing U12: prepends ACKNOWLEDGE RISK on the first write
  - `web/app/risk/page.tsx` — landing U11: does not fork the SETTLEMENT step
- **notes:** Reads are never gated by acknowledgment — only the first write
  (`UI-FIRST-RUN-RISK` rule 5). Throw-tolerant storage. Never a safety score.
  Live SETTLEMENT traces compose this key; the executor is not rewritten.

### `chrome.refetch-notice`

Whether a background refetch failed while last-known data is still shown.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/refetch-notice.ts` — landing U12: module store; one flag for the whole app
  - `web/hooks/useIdentityQueryReset.ts` — landing U12: QueryCache subscriber in Providers
- **readers:**
  - `web/components/kit/RefetchNotice.tsx` — landing U12: `UI-SHELL-REFETCH-NOTICE`
  - `web/components/kit/Shell.tsx` — landing U12: notice lives in the shell body, not Providers
- **notes:** One global notice, never a per-hook toast. `UI-SHELL-PROVIDERS`
  stays banner-free. A first load error is not this key — only
  `status === error` with `dataUpdatedAt > 0`.

### `chrome.surface-state`

The eight-state grammar class for the current topology (`LOADING` … `ERROR`).

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/surface-state.ts` — landing U12: `classifySurfaceState`; LOADING is never zero
- **readers:**
  - `web/components/kit/SurfaceState.tsx` — landing U12: labeled `data-surface-state`
  - `web/components/watch/WatchApp.tsx` — landing U12: watch wall
  - `web/components/supply/SupplyFlow.tsx` — landing U12: supply topology
  - `web/components/borrow/BorrowFlow.tsx` — landing U12: borrow topology
  - `web/components/assets/AssetsPage.tsx` — landing U12: assets topology
- **notes:** STALE (signing disabled, refresh) is a distinct class from
  LOADING. Write-lifecycle states outrank data states. Confirmed-empty requires
  a ready read with count zero.

### `persist.scan-checkpoint` — retired

Per-wallet last-scanned-block for stream-candidate discovery. **Removed in U8**
with log-scan. Enumerable discovery needs no checkpoint.
