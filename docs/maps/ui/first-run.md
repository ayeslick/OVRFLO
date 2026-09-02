# Region brief — Guided first run + risk

**Slug:** `FIRST-RUN` · **Control ID prefix:** `UI-FIRST-RUN-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/first-run/*` · `web/app/risk/page.tsx`.

**Purpose of the region.** The app's only teaching surface: a guided path for a
connected wallet confirmed empty of positions, loans, *and* streams, plus the
factual risk note at `/risk` and the one-time acknowledgment consumed by
`UI-REVIEW-ACKNOWLEDGE-RISK`.

**Boundary.** This region does **not** render when stream discovery is pending or
could-not-ask — that is `UI-WATCH-STREAMS-DEGRADED` (R12, AE5). Disconnected
visitors see `UI-SHELL-ENTRY-DISCONNECTED`, not this teaching surface. Marketing
landing is out of scope. No demonstration loan, no synthetic instrument, no
empty meter wall.

---

## `UI-FIRST-RUN-SURFACE`

- **ID.** `UI-FIRST-RUN-SURFACE`
- **Purpose.** Teach the PT → deposit → stream → borrow cycle in OVRFLO's voice
  and hand off into a first watchable object.
- **Visible when.** A wallet is connected **and** lender positions, borrower
  loans, **and** stream discovery are all confirmed empty. Hidden as soon as any
  protocol object exists.
- **States.** `guided` (default), `chooser` (after dismiss).
- **Action.** None itself — children are the cycle and intent rows.
- **Copy rules.** Four sentences, precise and direct: eligible collateral is a
  fixed-schedule non-cancelable stream; a loan's end is known when it opens;
  there are no health factors and no liquidations; watching is the home once
  something exists. No engagement promise, no streak, no "don't miss out".
- **Data authority.** `on-chain` for confirmed-empty books. `projection` for
  confirmed-empty stream discovery — and if discovery is not confirmed empty,
  this control must not render.

## `UI-FIRST-RUN-CYCLE`

- **ID.** `UI-FIRST-RUN-CYCLE`
- **Purpose.** Show the cycle as a labeled sequence.
- **Visible when.** `UI-FIRST-RUN-SURFACE` is `guided`.
- **States.** One: rendered.
- **Action.** None — labels. The actions sit on `UI-FIRST-RUN-INTENT-*`.
- **Copy rules.** `GET PT → DEPOSIT → RECEIVE STREAM → BORROW`. Deposit "mints
  the market's ovrflo token" — never a hardcoded token symbol. Right bay: what
  the visitor will have at each step (PT, ovrflo token + stream, pledged loan)
  without invented amounts.
- **Data authority.** `pure-client` — teaching copy.

## `UI-FIRST-RUN-INTENT-BORROW`

- **ID.** `UI-FIRST-RUN-INTENT-BORROW`
- **Purpose.** Send a visitor who needs PT to the approved series' Pendle market.
- **Visible when.** The guided surface is showing.
- **States.**
  - `linked` — address-verified Pendle deep link for the approved series.
  - `degraded` — URL unusable; copy names the market/series and directs to Pendle
    by series, labelled external. Not a dead button that pretends to work.
- **Action.** Opens the external Pendle URL. Labelled external. No protocol
  transaction.
- **Copy rules.** `GET PT ON PENDLE`. Not `GET wstETH PT ON PENDLE` as a constant
  — name the series from registry when known. Always disclose external
  destination.
- **Data authority.** `on-chain` for the approved series identity. The URL is
  configuration verified against that address; a rotten URL degrades this
  control, it does not invent a different market.

## `UI-FIRST-RUN-INTENT-DEPOSIT`

- **ID.** `UI-FIRST-RUN-INTENT-DEPOSIT`
- **Purpose.** Hand a visitor who already holds PT into stream creation.
- **Visible when.** The guided surface is showing.
- **States.** `enabled` (always as a path), `ready-balance` when PT `balanceOf` >
  0 (may be emphasized, not the only path).
- **Action.** Routes to `UI-ASSETS-STREAM-SELECT-MARKET`.
- **Copy rules.** `I ALREADY HOLD PT → DEPOSIT`. No invented PT amount.
- **Data authority.** `on-chain` for PT balance annotation. The route itself is
  always available; a zero PT balance is not a hidden path.

## `UI-FIRST-RUN-INTENT-SUPPLY`

- **ID.** `UI-FIRST-RUN-INTENT-SUPPLY`
- **Purpose.** Offer Supply when the wallet already holds underlying.
- **Visible when.** The guided surface is showing **and** underlying `balanceOf`
  is confirmed nonzero. Hidden when the read succeeded and the balance is zero —
  not disabled with a taunt. A failed or pending balance read keeps the row
  visible in `unavailable` / `loading` so "could not ask" cannot look like "no
  underlying".
- **States.** `ready`, `loading`, `unavailable`.
- **Action.** Routes to `UI-SUPPLY-SELECT-MARKET` when `ready`.
- **Copy rules.** `SUPPLY <underlying symbol>`. Live `symbol()`. Keep Borrow as a
  path alongside; do not replace the cycle. Unavailable copy names the failed
  read; it does not say the wallet holds none.
- **Data authority.** `on-chain` — underlying `balanceOf`. Hide-on-zero requires a
  successful read.

## `UI-FIRST-RUN-DISMISS`

- **ID.** `UI-FIRST-RUN-DISMISS`
- **Purpose.** Collapse the teaching surface to a plain chooser without asserting
  that the wallet now holds protocol objects.
- **Visible when.** `UI-FIRST-RUN-SURFACE` is `guided`.
- **States.** `armed`. After activation, surface becomes `chooser`.
- **Action.** Persists dismiss per wallet (`localStorage`, keyed by address).
  Returns to guided whenever the wallet is still confirmed protocol-empty and
  dismiss is cleared, or on a new account. Does not skip the R12 emptiness
  check.
- **Copy rules.** `SKIP FOR NOW` or equivalent. Not `I KNOW THE RISKS` — that is
  `UI-REVIEW-ACKNOWLEDGE-RISK`.
- **Data authority.** `pure-client` for dismiss memory. Emptiness remains
  `on-chain` + confirmed stream discovery.

## `UI-FIRST-RUN-CHOOSER`

- **ID.** `UI-FIRST-RUN-CHOOSER`
- **Purpose.** After dismiss, offer the two Default position types as plain
  launches — still not a watch wall, still not disconnected entry.
- **Visible when.** `UI-FIRST-RUN-SURFACE` is `chooser` (dismissed, still
  confirmed empty).
- **States.** One: rendered.
- **Action.** Self-Repaying Loan goes to `/borrow/`. Fixed Return goes to
  `/supply/`. These are typed create paths, not Default nav items.
- **Copy rules.** `Self-Repaying Loan`, `Fixed Return`. No protocol metrics. No
  demonstration instruments. Do not add Dashboard or Markets.
- **Data authority.** `pure-client` layout. Emptiness still confirmed as for the
  surface.

## `UI-FIRST-RUN-RISK`

- **ID.** `UI-FIRST-RUN-RISK`
- **Purpose.** State factual protocol risk without turning it into a health-factor
  dashboard or a marketing assurance.
- **Visible when.** `/risk` — readable **disconnected**. Also linked from the
  shell footer and from `UI-REVIEW-ACKNOWLEDGE-RISK`.
- **States.** One: rendered. No loading of a score. No empty. Failure to load a
  section is a missing paragraph, not a green check.
- **Action.** None required. Optional links to audit documents in the repo
  record, labelled as documents not as guarantees.
- **Copy rules.** Factual sections only:
  - contract risk (smart-contract failure is possible);
  - audit status stated truthfully from the repo record — no invented
    assurances, no "audited" badge without naming which review;
  - Pendle / Sablier / Chainlink dependencies;
  - fixed-schedule basis of displayed projections (interpolation of immutable
    stream params, not a price forecast);
  - not financial advice.
  Never health factors, never liquidation, never "your funds are safe".
- **Data authority.** `pure-client` — static copy sourced from `PRODUCT.md`,
  `docs/audit/`, and the plan's D10. It does not read a live "safety score".

---

## Region copy rules

1. **First-run renders only on confirmed emptiness of positions, loans, and
   streams.** Pending or could-not-ask discovery with zero books is watch
   degraded, never this region.
2. **No spectator or synthetic demonstration loans.**
3. **Token copy is market-driven.** "Mints the market's ovrflo token."
4. **Acknowledgment is `UI-REVIEW-ACKNOWLEDGE-RISK`.** This region owns `/risk`
   copy and the first-run teaching surface; it does not fork the SETTLEMENT
   step.
5. **Reads are never gated by acknowledgment.** Only the first write.
6. **No health factor, liquidation, or engagement mechanic.**
