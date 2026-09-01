# Markets region briefs — index

The meaning layer for OVRFLO Markets UI/UX. Eight region-level briefs, each
documenting its controls against the seven mandatory fields in `../SCHEMAS.md`.
Column tower: `docs/agents/system.md`. These eight files are the live control map.
CS4 Default / Advanced is the target product IA, not a ninth region.

**All eight bodies are written (watch-surface rebuild, U2).** Every control
carries the seven mandatory fields. Optional columns — a11y notes, colour/token
references, links to covering tests — are deferred and may be added later, never
as a substitute for the seven.

Do **not** confuse [`review.md`](review.md) (this region's brief) with
[`../REVIEW.md`](../REVIEW.md) (the agent review contract).

The six-region set (HEADER, POSITIONS, MARKETS-TABLE, SETTLEMENT, ACTION, CHROME)
is retired. Owner-approved replacement: `docs/adr/0001-watch-surface-region-set.md`.

## The eight regions

| Region | Slug | Brief | Incumbent / landing code |
|---|---|---|---|
| Shell | `SHELL` | [`shell.md`](shell.md) | `web/app/layout.tsx` · `web/app/page.tsx` · `web/components/MarketsApp.tsx` · `web/components/WalletRuntime.tsx` · `web/components/CopyValue.tsx` · `web/components/Providers.tsx` · `web/app/{loading,error,global-error}.tsx` · `web/components/{ModalErrorBoundary,TruncationNotice,Footer}.tsx`. Wallet control is `WalletButton` from `wallet-runtime`. |
| Watch surface | `WATCH` | [`watch.md`](watch.md) | `web/components/watch/{Wall,SuppliedDetail,BorrowedDetail,StreamDetail,ClosedLoanDetail}.tsx`. Entry gate: `web/app/page.tsx`. |
| Borrow flow | `BORROW` | [`borrow.md`](borrow.md) | `web/app/borrow/page.tsx`, `web/components/borrow/*`. |
| Supply flow | `SUPPLY` | [`supply.md`](supply.md) | `web/app/supply/page.tsx`, `web/components/supply/*`. |
| ALL RATES expert workspace | `RATES` | [`rates.md`](rates.md) | U4 `RateWindow` plus U8/U9 `ALL RATES` workspace. |
| Split review + receipts | `REVIEW` | [`review.md`](review.md) | `web/components/action-flow/ActionFlowShell.tsx` until U8–U11 kit `SettlementTrace` / `Receipt`. |
| Assets converter + stream creation | `ASSETS` | [`assets.md`](assets.md) | `web/components/action-flow/ConvertFlow.tsx` until U10: `web/app/assets/page.tsx`, `web/components/assets/*`. |
| Guided first run + risk | `FIRST-RUN` | [`first-run.md`](first-run.md) | U11: `web/components/first-run/*`, `web/app/risk/page.tsx`. |

Eight regions, fixed until another Owner-approved charter edit. A surface that
seems to need a ninth is a signal to re-read the boundaries above, not to add a
region. SETTLEMENT trace and PERMISSION / ACTION receipts are shared families
inside `review.md`, not a ninth region.

## How a brief is structured

One file per region, with controls nested inside it — not one file per control.
Each control carries all seven fields from `../SCHEMAS.md` §1:

**ID · Purpose · Visible when · States · Action · Copy rules · Data authority**

Optional at pass 1: a11y notes, color/token references, links to covering tests.

## Sources a brief is built from

- `PRODUCT.md` — product truth, and the boundary a brief may not cross
- Plan Product Contract R1–R14 and KTD3 / KTD7 / KTD13
- `docs/plans/2026-08-11-markets-frontend-flow-spec.md` — flow grammar,
  checkpoints, receipts, exceptions (entry model and Positions-as-destination
  superseded: watch is home)
- The incumbent / landing components listed above
- `DESIGN.md` — visual system (pixels only)

**Tag status.** Control-ID tags on Gherkin are the target shape; U13 rewrites
features. Do not cite a tag that does not exist yet.

**Not** Impeccable generative fields. Comps win on pixels and nothing else.
OVRFLO has no health factors and no liquidations.

## Render-inventory coverage

Every flow-spec render and every plan addition maps to a brief section. Zero
gaps. U14's harness mounts these same rows.

### A. Flow-spec 24

| # | Render | Brief section |
|---|---|---|
| 1 | `ENTRY.DISCONNECTED` | `shell.md` `UI-SHELL-ENTRY-DISCONNECTED` |
| 2 | `ENTRY.READY` | Superseded by R12: holdings → `watch.md` `UI-WATCH-WALL`; confirmed empty → `first-run.md` `UI-FIRST-RUN-SURFACE`; syncing → `shell.md` `UI-SHELL-ENTRY-SYNCING`. Compact route chooser is not home. Nav launches remain `UI-SHELL-NAV`. |
| 3 | `BORROW.SELECT_STREAM` | `borrow.md` `UI-BORROW-SELECT-STREAM` · `UI-BORROW-NO-STREAM` |
| 4 | `BORROW.ENTER_AMOUNT + SELECT_RATE` | `borrow.md` `UI-BORROW-AMOUNT` · `UI-BORROW-RATE-WINDOW` · `UI-BORROW-STEPPER` · `UI-BORROW-POOL-BAND` · `UI-BORROW-FACTS` |
| 5 | `BORROW.REVIEW` | `review.md` `UI-REVIEW-BORROW` · `UI-REVIEW-SETTLEMENT-TRACE` · `UI-REVIEW-ACTION-RECEIPT` |
| 6 | `BORROW.APPROVE_STREAM` | `review.md` `UI-REVIEW-PERMISSION-RECEIPT` · `UI-REVIEW-APPROVE` |
| 7 | `BORROW.SIGN` | `review.md` `UI-REVIEW-CONFIRM` · `UI-REVIEW-ACTION-RECEIPT` · `UI-REVIEW-TX-STATE` |
| 8 | `BORROW.CONFIRMED` | `review.md` `UI-REVIEW-ACTION-RECEIPT` (`confirmed`) · watch landing `UI-WATCH-ROW-BORROWED` |
| 9 | `SUPPLY.SELECT_MARKET` | `supply.md` `UI-SUPPLY-SELECT-MARKET` · `UI-SUPPLY-MARKET-UNAVAILABLE` |
| 10 | `SUPPLY.ENTER_AMOUNT + SELECT_RATE` | `supply.md` `UI-SUPPLY-AMOUNT` · `UI-SUPPLY-RATE-WINDOW` · `UI-SUPPLY-STEPPER` · `UI-SUPPLY-QUEUE-BAND` · `UI-SUPPLY-FACTS` |
| 11 | `SUPPLY.REVIEW` | `review.md` `UI-REVIEW-SUPPLY` · `UI-REVIEW-SETTLEMENT-TRACE` · `UI-REVIEW-ACTION-RECEIPT` |
| 12 | `SUPPLY.APPROVE` | `review.md` `UI-REVIEW-PERMISSION-RECEIPT` · `UI-REVIEW-APPROVE` |
| 13 | `SUPPLY.SIGN` | `review.md` `UI-REVIEW-CONFIRM` · `UI-REVIEW-TX-STATE` |
| 14 | `SUPPLY.CONFIRMED` | `review.md` `UI-REVIEW-ACTION-RECEIPT` (`confirmed`) · watch landing `UI-WATCH-ROW-SUPPLIED` |
| 15 | `POSITIONS.INDEX + SUPPLY_DETAIL` | `watch.md` `UI-WATCH-LENS` (supplied) · `UI-WATCH-WALL` · `UI-WATCH-ROW-SUPPLIED` · `UI-WATCH-DETAIL-SUPPLIED` · `UI-WATCH-HERO-EARNINGS` · `UI-WATCH-CAPITAL-BAND` |
| 16 | `POSITIONS.INDEX + LOAN_DETAIL` | `watch.md` `UI-WATCH-LENS` (borrowed) · `UI-WATCH-ROW-BORROWED` · `UI-WATCH-DETAIL-BORROWED` · `UI-WATCH-HERO-OUTSTANDING` · `UI-WATCH-ROW-SETTLED` |
| 17 | `POSITIONS.INDEX + STREAM_DETAIL` | `watch.md` `UI-WATCH-LENS` (streams) · `UI-WATCH-ROW-STREAM` · `UI-WATCH-DETAIL-STREAM` · `UI-WATCH-HERO-VESTED` · `UI-WATCH-BORROW-ROUTE` |
| 18 | Representative `LOADING`, `EMPTY`, `STALE`, `PENDING`, `ERROR` per topology | `shell.md` `UI-SHELL-ENTRY-SYNCING` · `UI-SHELL-STATUS` · `UI-SHELL-ROUTE-LOADING` · `UI-SHELL-ROUTE-ERROR`; `review.md` `UI-REVIEW-TX-STATE` · `UI-REVIEW-STALE`; each region's `loading` / `empty` / `unavailable` / `failed` states. Loading is never zero. |
| 19 | `POSITIONS.CLAIM_CONFIRMED` unwrap enabled | `review.md` `UI-REVIEW-CLAIM-CONFIRMED` state `unwrap-enabled` |
| 20 | `POSITIONS.CLAIM_CONFIRMED` insufficient wrap reserve | `review.md` `UI-REVIEW-CLAIM-CONFIRMED` state `reserve-insufficient` |
| 21 | `POSITIONS.UNWRAP_REVIEW` and `POSITIONS.UNWRAP_CONFIRMED` | `assets.md` `UI-ASSETS-UNWRAP` · `review.md` `UI-REVIEW-UNWRAP` |
| 22 | `STREAM.REVIEW`, `STREAM.APPROVE_PT`, `STREAM.APPROVE_FEE` | `assets.md` `UI-ASSETS-STREAM-ENTER-PT` · `review.md` `UI-REVIEW-STREAM-DEPOSIT` · `UI-REVIEW-PERMISSION-RECEIPT` (PT and fee) |
| 23 | `ASSETS.WRAP_AMOUNT`, `ASSETS.WRAP_APPROVE`, `ASSETS.WRAP_CONFIRMED` | `assets.md` `UI-ASSETS-WRAP-AMOUNT` · `review.md` `UI-REVIEW-WRAP` · `UI-REVIEW-PERMISSION-RECEIPT` |
| 24 | `POSITIONS.REPAY_AMOUNT`, `POSITIONS.REPAY_PREPARE` wrap shortfall, `POSITIONS.REPAY_APPROVE`, `POSITIONS.REPAY_CONFIRMED` | `watch.md` `UI-WATCH-REPAY` · `review.md` `UI-REVIEW-REPAY` · `UI-REVIEW-REPAY-PREPARE` · `UI-REVIEW-PERMISSION-RECEIPT` |

### B. Plan additions

| Addition | Brief section |
|---|---|
| Three lens renders (Supplied / Borrowed / Streams) | `watch.md` `UI-WATCH-LENS` · `UI-WATCH-ROW-SUPPLIED` · `UI-WATCH-ROW-BORROWED` · `UI-WATCH-ROW-STREAM` |
| Ribbon state set (recorded / edge / future / inert / degraded) | `watch.md` `UI-WATCH-RIBBON` |
| Degraded status | `shell.md` `UI-SHELL-STATUS` (`degraded`) · `watch.md` `UI-WATCH-FRESHNESS` · `UI-WATCH-STREAMS-DEGRADED` |
| Guided first run | `first-run.md` `UI-FIRST-RUN-SURFACE` · `UI-FIRST-RUN-CYCLE` · `UI-FIRST-RUN-INTENT-*` |
| Risk surface | `first-run.md` `UI-FIRST-RUN-RISK` |
| Acknowledgment step | `review.md` `UI-REVIEW-ACKNOWLEDGE-RISK` (inserted into `UI-REVIEW-SETTLEMENT-TRACE`) |
| Both claim-confirmed variants | `review.md` `UI-REVIEW-CLAIM-CONFIRMED` (`unwrap-enabled` and `reserve-insufficient`) — same as A.19–20 |
| Narrow-viewport watch navigation | `watch.md` `UI-WATCH-NARROW-NAV` · `UI-WATCH-SELECT` (`?lens=` `?lending=` `?position=` `?loan=` `?stream=`) |
| `ALL RATES` expert workspace | `rates.md` entire brief; opened from `UI-BORROW-ALL-RATES` / `UI-SUPPLY-ALL-RATES` |
| `ENTRY.SYNCING` | `shell.md` `UI-SHELL-ENTRY-SYNCING` |

Related flow-spec screens bundled inside the 24 still have owners:
`BORROW.PENDING` / `SUPPLY.PENDING` → `UI-REVIEW-TX-STATE`; `STREAM.SELECT_MARKET`
→ `UI-ASSETS-STREAM-SELECT-MARKET`; `STREAM.CONFIRMED` →
`UI-ASSETS-STREAM-CONFIRMED`; `ASSETS.UNWRAP_SIGN` → `UI-REVIEW-CONFIRM` on
unwrap (no approval).
