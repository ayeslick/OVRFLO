# View state

Lens, selection, USD display mode, shell chrome, first-run memory, and the ALL
RATES workspace flag — what the user is currently looking at.
All `pure-client` except where a note points at an on-chain companion: none of
it is chain truth, and none of it may gate an action.

Entry format and rules: `README.md`.

## Destination URLs (KD16)

Paths use a trailing slash. Advanced writes no path and no query param.
Refresh on a destination lands in Default. `?lens=` is ignored and stripped.
Unknown query keys must not crash. Pre-CS4 shapes have no compatibility redirects.

| Destination | URL | Notes |
|---|---|---|
| Your OVRFLO hub, empty, or incomplete scan | `/` | Incomplete scan does not change the path and does not write matrix query params from a provisional count |
| Self-Repaying Loan collection | `/?type=loan` | Written only after complete hydration on `/` |
| Self-Repaying Loan detail | `/?lending=<market>&loan=<id>` | Identity stays `(lending, id)` |
| Fixed Return collection | `/?type=fixed` | Written only after complete hydration on `/` |
| Fixed Return detail | `/?lending=<market>&position=<id>` | Same identity rule as today |
| Create (type not yet chosen) | `/create/` | Empty-portfolio Create and the Create nav item land here |
| Create Self-Repaying Loan | `/borrow/` | Existing page. `?stream=` and `?step=` stay |
| Create Fixed Return | `/supply/` | Existing page. `?step=` stays |
| Activity | `/activity/` | The portfolio matrix on `/` does not apply here |
| Wrap, unwrap, PT deposit | `/assets/` | Existing page |
| Risk | `/risk/` | Unchanged |
| Default vs Advanced | no path or query change | Disclosure only. `Return to Default` is the control. Browser Back does not toggle disclosure. Refresh lands in Default on the same destination |

Query keys that survive: `?lending=`, `?loan=`, `?position=`, `?stream=`, `?step=`, `?type=` (`loan` or `fixed` only). Transaction checkpoints remain unenterable from history.

---

### `watch.lens`

Which role lens is active on the incumbent wall: `supplied` · `borrowed` · `streams`.
The URL no longer carries this key.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/kit/LensTabs.tsx` — local wall tabs; does not write `?lens=`
  - `web/components/watch/WatchApp.tsx` — per-wallet localStorage only
- **readers:**
  - `web/components/watch/Wall.tsx` — which row set to render
  - `web/components/kit/LensTabs.tsx` — selected tab
- **notes:** `?lens=` is ignored and stripped (`web/lib/watch-url.ts`
  `stripLensFromLocation`). Ticket 15 replaces this wall with hub / collection /
  detail. An invalid historical URL value is ignored. Memory is keyed by
  lowercased address. Client-only: apply in an effect after first paint.

### `watch.portfolio-type`

Collection type on `/` after complete hydration: `loan` · `fixed` · none.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/watch-url.ts` — serializes `?type=` only when asked; CS4-U2 writes
    after complete hydration
  - `web/lib/portfolio-matrix.ts` — chooses type or identity after complete hydration
  - `web/components/watch/WatchApp.tsx` — calls `writeWatchSearch` on `/` after complete hydration
- **readers:**
  - `web/lib/watch-url.ts` — parse of surviving query keys
  - `web/components/watch/WatchApp.tsx` — hub vs collection vs detail
  - `web/lib/portfolio-matrix.ts` — keeps an explicit `?type=` collection on a mixed wallet
- **notes:** Written only after complete hydration on `/`. Incomplete scan
  must not write this key. Detail identity params take precedence over type.

### `chrome.disclosure`

Default vs Advanced disclosure over the current destination.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/disclosure.ts` — in-memory store; `setDisclosure` / `toggleDisclosure`
  - `web/components/kit/Shell.tsx` — `UI-SHELL-MODE`
  - `web/components/kit/DefaultHub.tsx` — hub help duplicate
- **readers:**
  - `web/components/kit/Shell.tsx` — `data-disclosure` and mode label
  - `web/components/kit/DefaultHub.tsx` — hub help duplicate
  - `web/components/watch/WatchApp.tsx` — Default matrix vs Advanced wall
- **notes:** Never a URL param. Refresh returns Default. Browser Back does not
  toggle it. Switching preserves the current object or task because the
  destination URL does not change.

### `watch.selected-entity`

The entity whose detail is open: `{ kind: position | loan, lending, id }`,
`{ kind: stream, id }`, or none.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/watch/Wall.tsx` — landing U7: `UI-WATCH-SELECT` writes `?lending=` plus `?position=` / `?loan=` / `?stream=`
  - `web/app/page.tsx` — hydrates from the URL; clears on disconnect
- **readers:**
  - `web/components/watch/SuppliedDetail.tsx` — landing U7: mounted when kind is `position`
  - `web/components/watch/BorrowedDetail.tsx` — landing U7: mounted when kind is `loan` (active)
  - `web/components/watch/StreamDetail.tsx` — landing U7: mounted when kind is `stream`
  - `web/components/watch/ClosedLoanDetail.tsx` — landing U7: mounted when kind is `loan` (SETTLED)
  - `web/components/watch/Wall.tsx` — landing U7: which row reads as selected
- **notes:** URL carries selection at every width so deep links and Back work
  (KTD13). Position and loan match `(lending, id)` — each market starts ids at
  1. A `?position=` / `?loan=` without `?lending=` is none. Stream ids are
  lockup-wide. Wide: detail in place. Narrow (<1024px): `watch.narrow-nav`
  list→detail. Selecting does not authorise; it only scopes which on-chain
  entity is shown. Account change clears this key.

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
