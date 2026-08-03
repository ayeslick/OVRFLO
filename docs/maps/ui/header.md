# Region brief — Header

**Slug:** `HEADER` · **Control ID prefix:** `UI-HEADER-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/MarketsApp.tsx` (the `<header className="topbar">` block) ·
`web/components/WalletRuntime.tsx` (`WalletButton`) · `web/components/CopyValue.tsx`

**Purpose of the region.** Identify the application, name the surface the user is on, and
carry the single wallet-connection control. It holds no market data and no financial
figure, and it must not acquire one — every number in this app belongs to a region that
can also say when the number is unknown.

**Boundary.** The header is the only place a wallet is connected or disconnected, but it
is **not** the network gate. Chain mismatch is gated inside the action overlay
(`UI-ACTION-NETWORK-GATE` in `action.md`), because a header-only network indicator does
not stop a write. Do not add a chain switcher here on the theory that it is more
discoverable — it would duplicate a gate that already exists at the write seam.

---

## `UI-HEADER-BRAND`

- **ID.** `UI-HEADER-BRAND`
- **Purpose.** Tell the user which application they are in, and give the page its single
  `<h1>`.
- **Visible when.** Always — it renders unconditionally with the shell, before any wallet
  connection, contract read, or projection.
- **States.** One: rendered. It has no loading, error, or empty state, because it depends
  on nothing that can fail. The mark is `/images/logo-mark.png` with an empty `alt`
  (decorative); the accessible name comes from the adjacent heading text.
- **Action.** None. It is not a link and not a control; it does not navigate or reset
  state. (An agent adding a home link here is changing the region's contract and needs a
  brief amendment, not a component tweak.)
- **Copy rules.** The wordmark is exactly `OVRFLO`. Never `OVFL`, never `Ovrflo`, never
  `Overflow` (`PRODUCT.md` — *the name is always `OVRFLO`*). No tagline, no claim, no
  "self-repaying loans" strapline in the header: the public product statement belongs to
  marketing surfaces, not to the app chrome.
- **Data authority.** `pure-client` — static asset and literal text. Nothing here is
  derived from chain or projection state.

## `UI-HEADER-SECTION-LABEL`

- **ID.** `UI-HEADER-SECTION-LABEL`
- **Purpose.** Name the surface the user is on. There is one surface (`MARKETS`), so this
  is orientation, not navigation.
- **Visible when.** Always, alongside the wallet control in `<nav className="nav">`.
- **States.** One: rendered. It is a `<span className="label mono">`, not a link and not a
  tab — there is nowhere else to go.
- **Action.** None.
- **Copy rules.** `MARKETS`. Do not style it as a selected tab or add sibling
  pseudo-tabs for surfaces that do not exist — a disabled "Portfolio" tab promises a page
  the product does not have. The v1 UX spec locked a **single page**: summary strip plus
  markets table, positions managed inside each market's expandable row
  (`docs/plans/ux-personas-journeys-screens.md`, locked decision 4).
- **Data authority.** `pure-client`.

## `UI-HEADER-WALLET`

- **ID.** `UI-HEADER-WALLET`
- **Purpose.** Connect a wallet, and once connected, show which account the whole app is
  reporting on and let the user leave.
- **Visible when.** Always. The control is present in both connection states; only its
  contents change.
- **States.**
  - `disconnected` — `useConnection().status !== "connected"`; renders a single `CONNECT`
    button.
  - `connected` — renders the truncated address (`UI-HEADER-ADDRESS-COPY`) beside a
    `DISCONNECT` button, as two sibling controls.
  - Wallet-kit states (modal opening, pending approval in the wallet) are owned by the
    wallet kit, not by this control; it does not render its own pending state.
  - `disconnected` and `connected` must stay visually distinct — a connected header that
    still reads `CONNECT` would misreport whose positions are on screen.
- **Action.** `CONNECT` opens the wallet-kit modal (`useAppKit().open()`); it submits no
  transaction. `DISCONNECT` calls wagmi `disconnect()`; it submits no transaction and
  revokes nothing on chain. Disconnecting has an app-wide consequence: `MarketsApp`
  watches `connectedAddress` and clears both the expanded market row and the open action
  overlay, because an expanded row's balances describe an account that is no longer
  connected.
- **Copy rules.** `CONNECT` / `DISCONNECT`. Never imply that disconnecting cancels,
  closes, withdraws, or protects anything on chain — it ends a browser session and
  nothing else. Never imply that connecting grants the app spending power; approvals are
  per-token and per-spender and are requested inside the action overlay. Do not describe
  the connected account as "your portfolio" — this app has no portfolio page.
- **Data authority.** `on-chain` for the connected account and its status (wagmi
  connection state read from the injected provider). The account is the identity every
  other region scopes its reads by, so it is never taken from a projection or from a
  cached previous session.

## `UI-HEADER-ADDRESS-COPY`

- **ID.** `UI-HEADER-ADDRESS-COPY`
- **Purpose.** Let the user recover the full connected address, which the header shows
  truncated.
- **Visible when.** `UI-HEADER-WALLET` is in its `connected` state.
- **States.**
  - `idle` — renders `formatAddress(address)` plus a copy glyph (`⧉`).
  - `copied` — glyph switches to `✓` for 1500 ms, then returns to `idle`.
  - `copy-unavailable` — clipboard write rejects (denied permission, non-secure context).
    The control stays in `idle`; it does **not** claim success. The full value remains
    readable from the `title` attribute, which is the deliberate fallback path.
- **Action.** Writes the full address to the clipboard. No transaction, no navigation.
  It is a separate control from `DISCONNECT` — nesting one button in another is invalid
  and unreachable by keyboard.
- **Copy rules.** The visible text is the truncated address and nothing else; the
  accessible name must stay the truncated value (no `aria-label` override, or the control
  announces something other than what it displays). The `title` carries
  `Copy wallet address: <full address>`. Never render a truncated identifier anywhere in
  this app without a recovery path — truncation without recovery makes the value
  unrecoverable from the UI.
- **Data authority.** `on-chain` — the address comes from the live connection, same
  source as `UI-HEADER-WALLET`.

---

## Region copy rules

These bind every control above and any control added to this region.

1. **No product framing that the protocol does not implement.** OVRFLO has no health
   factor, no liquidation, no margin call, no collateral ratio, and no liquidation price
   (`PRODUCT.md` — *Positioning*, *Product Principles* 2). A header badge, gauge, or
   status pill expressing any of those is not a copy choice, it is a false product claim.
2. **Comps are not product truth.** A value that appears in an Impeccable comp or any
   other generative field with no product truth behind it does not become a brief fact and
   does not ship (`../README.md`, authority order; `../SCHEMAS.md`). Comps win on pixels;
   this brief wins on meaning.
3. **No aggregate financial figure in the header.** Totals live in `positions.md`, where
   the loading / unavailable / empty distinction is already carried. A header total would
   have to invent one.
4. **No USD.** The app shows no fiat conversion anywhere, deliberately: a stale price feed
   printing a wrong dollar figure next to a correct token amount is worse than no dollar
   figure (recorded at `web/components/PositionSummary.tsx`, R31/L-8).
