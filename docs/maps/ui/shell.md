# Region brief — Shell

**Slug:** `SHELL` · **Control ID prefix:** `UI-SHELL-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/app/layout.tsx` · `web/app/page.tsx` ·
`web/components/MarketsApp.tsx` (interim masthead) · `web/components/WalletRuntime.tsx` ·
`web/components/CopyValue.tsx` · `web/components/Providers.tsx` ·
`web/app/{loading,error,global-error}.tsx` ·
`web/components/{ModalErrorBoundary,TruncationNotice}.tsx`.
U7 lands `WalletControl` and `Footer`.

**Purpose of the region.** Identify the application, connect a wallet, navigate to
Borrow / Supply / Assets / Risk, and own every app-wide honesty surface: disconnected
entry, syncing, status, route crashes, the write-path network gate, and the token/USD
display switch. The shell holds no market figure of its own.

**Boundary.** The watch surface, first-run, and every flow render *inside* the shell.
Disconnected entry copy is this brief's (R12, reframed `ENTRY.DISCONNECTED`). Connected
routing — watch vs first-run vs degraded Streams — is decided by `watch.md` and
`first-run.md`; the shell only hosts the outcome. The SETTLEMENT trace and receipts
belong to `review.md`. Do not add protocol metrics (TVL, aggregate rates, visitor
counts) anywhere in this region.

---

## `UI-SHELL-BRAND`

- **ID.** `UI-SHELL-BRAND`
- **Purpose.** Tell the user which application they are in, and give the page its single
  `<h1>`.
- **Visible when.** Always — it renders with the shell, before any wallet connection,
  contract read, or projection.
- **States.** One: rendered. It has no loading, error, or empty state. The mark is
  decorative (`alt=""`); the accessible name is the heading text.
- **Action.** Activating the wordmark returns to home: disconnected stays on
  `UI-SHELL-ENTRY-DISCONNECTED`; connected follows R12 (watch, first-run, or degraded
  watch). It submits nothing.
- **Copy rules.** The wordmark is exactly `OVRFLO`. Never `OVFL`, never `Ovrflo`, never
  `Overflow`. No tagline, no version string, no "self-repaying loans" strapline in the
  masthead — the public product statement belongs to marketing surfaces, not to app
  chrome. Wordmark-only: never `OVRFLO SYSTEM 1.0` or any system-version naming.
- **Data authority.** `pure-client` — static asset and literal text.

## `UI-SHELL-WALLET`

- **ID.** `UI-SHELL-WALLET`
- **Purpose.** Connect a wallet, and once connected, show which account the whole app is
  reporting on and let the user leave.
- **Visible when.** Always. The control is present in both connection states; only its
  contents change.
- **States.**
  - `disconnected` — renders a single `CONNECT WALLET` button.
  - `connected` — renders `UI-SHELL-ADDRESS-COPY` beside `DISCONNECT`.
  - Wallet-kit pending states (modal opening, in-wallet approval) are owned by the kit;
    this control does not invent a third pending glyph.
  - `disconnected` and `connected` stay visually distinct — a connected header that still
    reads `CONNECT WALLET` would misreport whose instruments are on screen.
- **Action.** `CONNECT WALLET` opens the wallet-kit modal; it submits no transaction.
  `DISCONNECT` calls wagmi `disconnect()`; it submits no transaction and revokes nothing
  on chain. Disconnecting clears account-scoped UI (selected entity, open flow, quotes,
  checkpoints) because those describe an account that is no longer connected. A
  transaction already broadcast continues on chain.
- **Copy rules.** `CONNECT WALLET` / `DISCONNECT`. Never imply that disconnecting cancels,
  closes, withdraws, or protects anything on chain. Never imply that connecting grants
  spending power; approvals are per-token and per-spender and are requested inside
  review. Do not describe the connected account as a portfolio.
- **Data authority.** `on-chain` — the live wallet connection. The account is the identity
  every other region scopes its reads by, so it is never taken from a projection or from
  a cached previous session.

## `UI-SHELL-ADDRESS-COPY`

- **ID.** `UI-SHELL-ADDRESS-COPY`
- **Purpose.** Let the user recover the full connected address, which the shell shows
  truncated.
- **Visible when.** `UI-SHELL-WALLET` is `connected`.
- **States.**
  - `idle` — truncated address plus a copy glyph.
  - `copied` — glyph switches to a check for 1500 ms, then returns to `idle`.
  - `copy-unavailable` — clipboard write rejects. The control stays in `idle` and does
    not claim success; the full value remains on `title`.
- **Action.** Writes the full address to the clipboard. No transaction. It is a separate
  control from `DISCONNECT` — nesting one button in another is invalid.
- **Copy rules.** Visible text is the truncated address. The accessible name stays that
  truncated value. `title` is `Copy wallet address: <full address>`. Never render a
  truncated identifier in this app without a recovery path.
- **Data authority.** `on-chain` — the live connection, same source as `UI-SHELL-WALLET`.

## `UI-SHELL-NAV`

- **ID.** `UI-SHELL-NAV`
- **Purpose.** Reach Borrow, Supply, Assets, and Risk from any connected or disconnected
  surface, without implying those destinations are the home.
- **Visible when.** Always, alongside the wallet control.
- **States.**
  - `idle` — links present, none current.
  - `current` — the open flow or `/risk` is marked current. Home (watch, first-run, or
    disconnected entry) does not mark a nav item current: the wordmark is home.
  - Links stay enabled while disconnected; following Borrow or Supply still lands on
    that flow's first decision, which then asks for a wallet where a write would need
    one.
- **Action.** Navigates to `/borrow`, `/supply`, `/assets`, or `/risk`. Submits nothing.
  Switching between Borrow and Supply preserves each flow's selections independently for
  the current wallet and chain (flow-spec navigation rule). Quotes always rebuild from
  live reads.
- **Copy rules.** Labels: `BORROW`, `SUPPLY`, `ASSETS`, `RISK`. Do not add a `POSITIONS`
  or `PORTFOLIO` item — the watch surface absorbed that index. Do not style these as the
  product's home. Do not show counts, badges, or "needs you" markers on nav.
- **Data authority.** `pure-client` — which route is open. Account-scoped enablement of
  *writes* inside those routes is `on-chain` and belongs to those briefs.

## `UI-SHELL-ENTRY-DISCONNECTED`

- **ID.** `UI-SHELL-ENTRY-DISCONNECTED`
- **Purpose.** Explain what home becomes once a wallet is connected, and offer Borrow and
  Supply as launchable flows, without pretending the visitor already has a book.
- **Visible when.** No wallet is connected. This is the flow spec's `ENTRY.DISCONNECTED`
  render, reframed to the watch-surface model (R12). It replaces the main surface; it
  does not render on top of a watch wall.
- **States.** One: rendered. There is no loading, empty, or error variant — nothing
  account-scoped has been asked yet. Connecting transitions out of this control into
  `UI-SHELL-ENTRY-SYNCING`, then to watch or first-run per R12.
- **Action.** `CONNECT WALLET` is `UI-SHELL-WALLET`. `BORROW` and `SUPPLY` are
  `UI-SHELL-NAV` launches — they do not connect the wallet by themselves. Connecting
  from this surface does not preserve a fictional destination; R12 decides the landing.
- **Copy rules.** One sentence each for what the home becomes (instruments you can watch:
  earnings rolling up, debt rolling down to a known done-date, streams vesting) and for
  Borrow and Supply as the two launchable flows. No protocol metrics: no TVL, no
  aggregate APR range, no visitor counts, no demonstration loan, no synthetic
  instrument. Disconnected is not empty and not an error. Never say "you have no
  positions". Never use health-factor or liquidation language to explain why a visitor
  should connect.
- **Data authority.** `pure-client` — static copy. No chain read backs this surface.

## `UI-SHELL-ENTRY-SYNCING`

- **ID.** `UI-SHELL-ENTRY-SYNCING`
- **Purpose.** Hold the requested surface while chain, balances, lender positions,
  borrower loans, and stream discovery resolve in parallel, without reporting zero.
- **Visible when.** A wallet has just connected, or the account or chain just changed,
  and the R12 entry gate has not yet classified watch / first-run / degraded watch.
- **States.** One: `syncing`. Unresolved regions use a bounded skeleton or `CHECKING…`.
  Loading is never represented as zero, as an empty wall, or as first-run.
- **Action.** None. The user may still disconnect or follow nav; quotes and checkpoints
  are not yet valid.
- **Copy rules.** `CHECKING…` / `LOADING`. Never "no positions", never a zeroed meter,
  never a first-run teaching surface. First-run may render only after positions, loans,
  *and* stream discovery are confirmed empty (`first-run.md`).
- **Data authority.** `pure-client` for the syncing flag. The reads in flight are
  `on-chain` (books, balances) and `projection` (stream candidates). Their results do
  not display here.

## `UI-SHELL-STATUS`

- **ID.** `UI-SHELL-STATUS`
- **Purpose.** Show event-read freshness for the whole app so a degraded RPC cannot
  silently freeze or invent values.
- **Visible when.** A wallet is connected and at least one account-scoped read has been
  attempted. Absent while disconnected.
- **States.** Five, and they must stay distinguishable:
  - `synced` — last event read succeeded; caption `EVENTS AS OF <hh:mm:ss>`.
  - `reconnecting` — a read is retrying; schedule interpolation on watch keeps moving.
  - `degraded` — reads failing; caption `DEGRADED — SHOWING LAST KNOWN` plus the
    as-of time of the last successful event read. Signing is disabled (existing STALE
    rules). Schedule-backed heroes and ribbons keep interpolating.
  - `unavailable` — no successful event read exists yet and the ask failed; not
    degraded-with-last-known, not empty.
  - `usd-unavailable` — the USD feed is classified unavailable (non-positive answer, or
    `updatedAt` past heartbeat-plus-grace, or past the 24h cutoff). Token amounts are
    unaffected; the USD switch disables.
- **Action.** None — disclosure. Refresh is the query layer's job; this control does not
  offer a separate retry that could be mistaken for a write.
- **Copy rules.** Name events as-of, never "live" when the last read is stale. Never
  collapse degraded into empty or into a red crash. Never imply the display froze.
  Never use this line for engagement ("come back to claim").
- **Data authority.** `on-chain` for the last successful read's block time. `pure-client`
  for the degraded/reconnecting classification derived from query status. USD
  classification is `on-chain` (Chainlink × `stEthPerToken`) and display-only.

## `UI-SHELL-TOKEN-USD`

- **ID.** `UI-SHELL-TOKEN-USD`
- **Purpose.** Let the user switch whether amounts emphasize token units or a USD
  reference, without changing anything that would be signed.
- **Visible when.** Always, once the shell has rendered. Disabled when USD is
  unavailable (`UI-SHELL-STATUS` `usd-unavailable`).
- **States.** `token` (default), `usd`, `disabled-unavailable` (`USD UNAVAILABLE`).
- **Action.** Client-side display mode only. It never changes calldata, allowances,
  receipts, or gates.
- **Copy rules.** USD is a reference beside the token amount, never a replacement: the
  token value never disappears. Receipts (`UI-REVIEW-PERMISSION-RECEIPT`,
  `UI-REVIEW-ACTION-RECEIPT`) stay token-exact — USD does not appear on committed
  lines. Never present a USD figure as the amount that will move. Rounding: cents
  below $1,000, whole dollars above. The feed is stETH/USD × wstETH `stEthPerToken`;
  never assume stETH ≈ ETH.
- **Data authority.** `pure-client` for the mode. `on-chain` for the feed answer and
  its freshness. A missing or stale feed disables the switch; it does not print a
  guessed dollar figure.

## `UI-SHELL-FOOTER`

- **ID.** `UI-SHELL-FOOTER`
- **Purpose.** Reach the factual risk surface and name the deployment without adding a
  second marketing page inside the app.
- **Visible when.** Always.
- **States.** One: rendered.
- **Action.** Link to `/risk` (`UI-FIRST-RUN-RISK`). Optional explorer link to the
  connected chain's factory, labelled as external.
- **Copy rules.** `RISK`. No TVL, no audit-badge row, no "battle-tested" claim. Audit
  status lives on `/risk` and is stated from the repo record.
- **Data authority.** `pure-client` for the links. Explorer target is `on-chain`
  (configured chain and factory address).

## `UI-SHELL-PROVIDERS`

- **ID.** `UI-SHELL-PROVIDERS`
- **Purpose.** Establish wagmi and react-query context, and initialise the wallet kit
  exactly once.
- **Visible when.** Always — wraps the page and renders no UI of its own.
- **States.** One: mounted. The wallet runtime is selected at **build time**; the E2E
  runtime is a different build, so the production bundle contains no test connector.
- **Action.** None. Consequence: every downstream `on-chain` read has a client and a
  cache.
- **Copy rules.** It renders no copy. It must not grow a status banner; app-wide status
  is `UI-SHELL-STATUS` and the route error controls.
- **Data authority.** `pure-client` — configuration and context.

## `UI-SHELL-ROUTE-LOADING`

- **ID.** `UI-SHELL-ROUTE-LOADING`
- **Purpose.** Say the app is coming up before any market data exists to show.
- **Visible when.** The route loading boundary is active (`web/app/loading.tsx`).
- **States.** One: `loading`, `role="status"` `aria-live="polite"`, reading `LOADING`.
- **Action.** None.
- **Copy rules.** It says loading and nothing more. No skeleton table of plausible
  rows, no placeholder rate, no zeroed total, no demonstration ribbon.
- **Data authority.** `pure-client`.

## `UI-SHELL-ROUTE-ERROR`

- **ID.** `UI-SHELL-ROUTE-ERROR`
- **Purpose.** Recover the Markets route from a client-side crash without losing the
  tab, and say the one thing that matters: whether money moved.
- **Visible when.** The route error boundary catches (`web/app/error.tsx`).
- **States.** One: `caught`, `role="alert"` — heading `MARKET VIEW UNAVAILABLE`, body
  `A client-side error interrupted this route. No transaction was submitted.`, plus
  `TRY AGAIN`.
- **Action.** `TRY AGAIN` calls Next `reset()`. It submits nothing.
- **Copy rules.** The no-transaction sentence is load-bearing. It is accurate because
  this boundary catches render faults, not broadcast transactions. Distinct heading
  from `UI-SHELL-GLOBAL-ERROR`.
- **Data authority.** `pure-client` — a render fault, not chain state.

## `UI-SHELL-GLOBAL-ERROR`

- **ID.** `UI-SHELL-GLOBAL-ERROR`
- **Purpose.** Last-resort recovery when even the root layout failed.
- **Visible when.** The global error boundary catches (`web/app/global-error.tsx`).
- **States.** One: `caught`, `role="alert"` — `OVRFLO UNAVAILABLE`, body
  `The application could not recover this view. No transaction was submitted.`, plus
  `RELOAD APPLICATION`.
- **Action.** `RELOAD APPLICATION` calls `reset()`. No transaction.
- **Copy rules.** Distinct heading from `UI-SHELL-ROUTE-ERROR`. Keep the same
  no-transaction guarantee.
- **Data authority.** `pure-client`.

## `UI-SHELL-NETWORK-GATE`

- **ID.** `UI-SHELL-NETWORK-GATE`
- **Purpose.** Stop every write path when the wallet is on the wrong chain, and offer
  the switch.
- **Visible when.** The connected chain is not the configured deployment chain, and a
  write surface (Borrow, Supply, Assets, or a watch action overlay) is open. It
  **replaces** the form body so no action can sign on the wrong chain. It does not
  replace the watch wall's read-only heroes.
- **States.** `wrong-chain` (notice plus switch), `switching` (`SWITCHING…`),
  `switch-rejected` (`SWITCH REJECTED — CHANGE NETWORK IN YOUR WALLET`).
- **Action.** Requests a wallet chain switch. No protocol transaction.
- **Copy rules.** State both chain ids: connected and expected. A header-only network
  indicator is not this control — it would inform without preventing.
- **Data authority.** `on-chain` — the connected chain id. This is a gate, so it is
  never taken from cached or client state.

## `UI-SHELL-WALLET-CHANGED`

- **ID.** `UI-SHELL-WALLET-CHANGED`
- **Purpose.** Stop a form whose inputs were entered for a different account from being
  submitted by the new one.
- **Visible when.** The connected address changed while a flow was open. It replaces
  the form body. Watch selection and lens memory re-key to the new account.
- **States.** One: `wallet-changed`, with `CONTINUE`.
- **Action.** `CONTINUE` resets that flow's client state (amount, tick, stream, local
  approval bookkeeping, stale-recovery flag) and re-renders for the new account. No
  transaction. Account- or chain-keyed queries invalidate so no surface renders the
  previous account's entities.
- **Copy rules.** `WALLET CHANGED — RE-ENTER`. Do not silently re-scope a half-entered
  form to a new account.
- **Data authority.** `on-chain` — the connected account.

## `UI-SHELL-REGION-BOUNDARY`

- **ID.** `UI-SHELL-REGION-BOUNDARY`
- **Purpose.** Contain a thrown render error to one independent display region so a
  failed feed cannot blank the page.
- **Visible when.** A region's body throws. The shell chrome (brand, nav, wallet,
  status) stays outside the boundary.
- **States.** `caught` — `SOMETHING WENT WRONG` with `TRY AGAIN`, `role="alert"`.
- **Action.** `TRY AGAIN` clears the error and remounts the region. No transaction.
- **Copy rules.** Never claim a transaction did or did not go through — the boundary
  does not know. Never render a crash as an empty wall. Flow-body crashes while a
  dialog is open are `UI-REVIEW-ERROR-BOUNDARY`.
- **Data authority.** `pure-client`.

## `UI-SHELL-TRUNCATION`

- **ID.** `UI-SHELL-TRUNCATION`
- **Purpose.** Give every capped list one shared way to admit it is capped.
- **Visible when.** An enumerated list is rendered up to a discovery or display budget
  (stream candidates, loan pages, tick windows that cannot show the full ladder).
- **States.** One: rendered, `role="status"`,
  `SHOWING FIRST <limit> <noun> — <detail or "DATA TRUNCATED">`.
- **Action.** None. No "show more" — the cap is a budget, not pagination.
- **Copy rules.** Warning, not error. A truncated list is never presented as complete.
- **Data authority.** `projection` in role when it reports discovery completeness;
  otherwise `pure-client` display budget. It never gates an action.

---

## Region copy rules

1. **Disconnected is a precondition, not empty and not an error.** One wording,
   `CONNECT WALLET`. No zeros, no red, no "you have no positions".
2. **No protocol metrics on the shell.** TVL, aggregate rates, and visitor counts do
   not appear on `ENTRY.DISCONNECTED` or in the masthead.
3. **Loading is never zero.** `CHECKING…` and bounded skeletons are not empty walls
   and not first-run.
4. **USD is reference-only.** It never appears on a receipt's committed lines and
   never reaches a gate. Unavailable USD disables the switch; it does not invent a
   number.
5. **No health factor, liquidation, margin, or engagement mechanic** in chrome copy,
   including error, empty, and loading copy.
6. **The wallet session is volatile.** Account, chain, and connection can change
   during reads, simulation, signing, and while operations are pending. An operation
   belongs to the identity captured when it started. A disconnect does not erase a
   transaction already broadcast.
7. **Comps are not product truth.** A badge or metric in a comp with no product
   backing does not enter this region.
