# Region brief — System chrome

**Slug:** `CHROME` · **Control ID prefix:** `UI-CHROME-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/Providers.tsx` · `web/components/WalletRuntime.tsx` ·
`web/components/ModalErrorBoundary.tsx` · `web/components/TruncationNotice.tsx` ·
`web/app/loading.tsx` · `web/app/error.tsx` · `web/app/global-error.tsx` ·
`web/app/layout.tsx`

**Purpose of the region.** Everything that is true of the application rather than of a
market: the provider stack, the route-level fallbacks, the crash containment, and the
shared vocabulary for degraded states. Chrome is where the product's fifth principle —
*degrade honestly* — is made structural rather than left to each surface's good intentions.

**Boundary.** The wallet *button* is `UI-HEADER-WALLET`; this region owns the build-time
seam that decides which wallet runtime exists. The in-overlay error boundary and network
gate are `action.md`; this region owns the route-level fallbacks around them.

---

## The five degraded states

`../SCHEMAS.md` §1 requires loading, stale, unavailable, failed, and empty to stay
distinguishable. This table is the map of where each is rendered, so an agent can check a
change against a single list instead of rediscovering it per component.

| State | Means | Rendered by | Never rendered as |
|---|---|---|---|
| **loading** | The ask is in flight; the answer is not yet known | `UI-CHROME-ROUTE-LOADING`; `LOADING MARKETS` / `LOADING` in the table, position list, and repay flow; `LOADING` in quote and preview summaries; `DEMAND: LOADING` | `0`, `—` meaning "none", or an empty list |
| **empty** | The ask succeeded and the answer is genuinely nothing | `NO APPROVED MARKETS`; `—` in strip cells; `NOTHING CLAIMABLE`; `NO LOANS IN 30 DAYS`; `NOTHING CLAIMABLE YET`; a position group that renders nothing at all | an error, a warning colour, or a retry prompt |
| **unavailable** | The ask could not be completed | `MARKET REGISTRY UNAVAILABLE — RETRY`; `UNAVAILABLE` in the rates cell; `UNABLE TO LOAD LENDING POSITIONS`; `UI-POSITIONS-STREAMS-UNAVAILABLE`; `DEMAND DATA UNAVAILABLE — INDEXER UNREACHABLE`; the claim-all preflight block reasons | an empty result, a zero, or a confident `—` |
| **error / failed** | Something threw, reverted, or was rejected — a fault, not a missing answer | `UI-CHROME-ROUTE-ERROR`; `UI-CHROME-GLOBAL-ERROR`; `UI-CHROME-MODAL-ERROR-BOUNDARY`; `TRANSACTION REVERTED ON-CHAIN` and the error branch of `UI-ACTION-TX-STATE` | an unavailable read, a blank surface, or a silent no-op |
| **truncated** | The answer is real but incomplete by budget | `UI-CHROME-TRUNCATION-NOTICE`; `UI-MARKETS-TABLE-TRUNCATION`; `MARKET REGISTRY UNAVAILABLE — DISCOVERY BUDGET EXCEEDED` | a complete list, and never silently |
| **disconnected** | No wallet, so account-scoped questions are not asked | `UI-CHROME-DISCONNECTED` — the positions strip renders nothing, the balances block is absent, and `SUPPLY`/`BORROW` disable with `CONNECT WALLET` | "you have no positions", a zero balance, or an error |

Two further states earn a name because they are routinely collapsed into the rows above:

- **stale** — a value that was read but may have moved since. The incumbent surfaces it as a
  forced re-confirmation rather than a passive badge:
  `LIQUIDITY CHANGED SINCE YOUR QUOTE — REVIEW THE NEW NUMBER AND RE-CONFIRM`,
  `IDLE AMOUNT CHANGED SINCE THE FORM OPENED — …`, and
  `ACTION INPUTS CHANGED — REVIEW AND CONFIRM AGAIN` (`UI-ACTION-TX-STATE`). Stale is not
  loading and not failed; it is known-but-superseded.
- **confirmed-but-unrefreshed** — the transaction succeeded and only the UI's re-read failed
  (`TRANSACTION CONFIRMED — REFRESH FAILED`, `UI-ACTION-TX-STATE`). Reporting it as a failure
  would tell a user their money did not move when it did.

---

## `UI-CHROME-PROVIDERS`

- **ID.** `UI-CHROME-PROVIDERS`
- **Purpose.** Establish the wagmi and react-query context every read and write depends on,
  and initialise the wallet kit exactly once.
- **Visible when.** Always — it wraps the entire page and renders no UI of its own.
- **States.** One: mounted. There is deliberately no runtime branch inside it. The wallet
  runtime is selected at **build time** by resolving the `wallet-runtime` module specifier;
  the E2E runtime is chosen by running a different build command, not by setting an
  environment variable, so the production bundle contains no test connector and no
  environment variable can activate one.
- **Action.** None — it is structural. Its consequence is that every downstream `on-chain`
  read has a client and a cache.
- **Copy rules.** It renders no copy. It must not grow a user-facing status banner; app-wide
  status has owners (`UI-CHROME-ROUTE-ERROR`, `UI-CHROME-GLOBAL-ERROR`, and the per-region
  unavailable states).
- **Data authority.** `pure-client` — configuration and context. It carries no fact about
  chain state.

## `UI-CHROME-ROUTE-LOADING`

- **ID.** `UI-CHROME-ROUTE-LOADING`
- **Purpose.** Say the app is coming up, before any market data exists to show.
- **Visible when.** The route's loading boundary is active (`web/app/loading.tsx`).
- **States.** One: `loading`, under `role="status" aria-live="polite"`, reading
  `LOADING MARKETS` with `Preparing the verified mainnet view.`
- **Action.** None.
- **Copy rules.** It says loading and nothing more. It must never render a skeleton table of
  plausible-looking rows, a placeholder rate, or a zeroed total — a skeleton that resembles
  data is a confident answer to a question that has not been asked. This state must stay
  visually distinct from the empty table (`NO APPROVED MARKETS`) and from the unavailable
  registry.
- **Data authority.** `pure-client`.

## `UI-CHROME-ROUTE-ERROR`

- **ID.** `UI-CHROME-ROUTE-ERROR`
- **Purpose.** Recover the Markets route from a client-side crash without losing the tab,
  and reassure the user about the one thing that matters: money.
- **Visible when.** The route error boundary catches (`web/app/error.tsx`).
- **States.** One: `caught`, under `role="alert"` — heading `MARKET VIEW UNAVAILABLE`, body
  `A client-side error interrupted this route. No transaction was submitted.`, plus
  `TRY AGAIN`.
- **Action.** `TRY AGAIN` calls Next's `reset()` to re-render the route segment. It submits
  nothing and reverts nothing.
- **Copy rules.** The "no transaction was submitted" sentence is load-bearing and must
  survive rewording: a user whose screen breaks mid-flow needs to know whether they signed
  something. It is accurate because the boundary catches render faults, not broadcast
  transactions — if the boundary is ever made to catch post-submission faults, that sentence
  must change with it. Do not blame the user's wallet or network for a client render fault.
- **Data authority.** `pure-client` — a render fault, not chain state.

## `UI-CHROME-GLOBAL-ERROR`

- **ID.** `UI-CHROME-GLOBAL-ERROR`
- **Purpose.** Last-resort recovery when even the root layout failed.
- **Visible when.** The global error boundary catches (`web/app/global-error.tsx`); it
  renders its own `<html>`/`<body>`.
- **States.** One: `caught`, under `role="alert"` — `OVRFLO UNAVAILABLE`, body
  `The application could not recover this view. No transaction was submitted.`, plus
  `RELOAD APPLICATION`.
- **Action.** `RELOAD APPLICATION` calls `reset()`. No transaction.
- **Copy rules.** Distinct from `UI-CHROME-ROUTE-ERROR`: the route error scopes the failure
  to the market view, the global error scopes it to the application. The two must not share
  a heading, or the user cannot tell how much of the app is gone. Keep the same
  no-transaction guarantee.
- **Data authority.** `pure-client`.

## `UI-CHROME-MODAL-ERROR-BOUNDARY`

- **ID.** `UI-CHROME-MODAL-ERROR-BOUNDARY`
- **Purpose.** Contain a crash inside an action form so the dialog stays escapable.
- **Visible when.** A modal **body** throws. It wraps the body only; the modal header and
  close button are deliberately outside it.
- **States.** One: `caught` — `SOMETHING WENT WRONG — <message>` with `TRY AGAIN`, under
  `role="alert"`.
- **Action.** `TRY AGAIN` clears the error **and** calls `onReset`, so the parent bumps a
  remount key. Without the remount, retry would re-render the same failing subtree and
  re-throw immediately. It submits nothing.
- **Copy rules.** Never claim a transaction did or did not go through — the boundary does not
  know. Never render the crash as an empty form. Error reporting is a deliberate no-op hook
  point; `console.*` is banned by the repo's mechanical checks, so do not "improve" this by
  logging.
- **Data authority.** `pure-client`. Documented in full as `UI-ACTION-ERROR-BOUNDARY` in
  `action.md`; this entry records it as chrome because the containment rule is app-wide.

## `UI-CHROME-TRUNCATION-NOTICE`

- **ID.** `UI-CHROME-TRUNCATION-NOTICE`
- **Purpose.** Give every capped list one shared way to admit it is capped, so a fourth
  capped list cannot quietly skip the disclosure.
- **Visible when.** Wherever an enumerated list is rendered up to a limit. **Present state of
  the code:** the component exists and is exported, but nothing imports it — the markets
  table renders its own truncation copy inline (`UI-MARKETS-TABLE-TRUNCATION`). Recorded as
  fact, not as a design intent: the shared component is the intended home for this
  disclosure and the inline copy is the surviving duplicate.
- **States.** One: rendered, `role="status"`, `status-warning`, reading
  `SHOWING FIRST <limit> <noun> — <detail or "DATA TRUNCATED">`.
- **Action.** None — disclosure only. It offers no "show more", because the cap is a
  discovery budget rather than a pagination control.
- **Copy rules.** Warning, not error: a truncated list is incomplete, not broken. The
  sentence shape is shared and the `detail` carries what is surface-specific; do not fork the
  wording per call site, which is the drift this component was created to end. A truncated
  list must never be presented as complete.
- **Data authority.** `projection` in role — it reports the completeness of a discovery, never
  a fact about the entities listed, and it must never gate an action.

## `UI-CHROME-DISCONNECTED`

- **ID.** `UI-CHROME-DISCONNECTED`
- **Purpose.** Define one app-wide behaviour for "no wallet connected", so no surface invents
  its own.
- **Visible when.** `useConnection()` reports no connected address. The app is fully usable
  in this state: market discovery, maturities, TVL, and the aggregate rate range are all
  account-independent and continue to render.
- **States.** One state, three consistent consequences:
  - the positions strip renders **nothing at all** — not an empty strip, not zeros
    (`PositionSummary` returns `null`);
  - the expanded row's balances block and its conversion controls are **absent**, not
    disabled-with-zero;
  - `SUPPLY` and `BORROW` render as peers, disabled, both captioned `CONNECT WALLET`.
- **Action.** None here — connecting is `UI-HEADER-WALLET`. Its consequence is app-wide:
  connecting arms the account-scoped surfaces, and changing account clears the expanded row
  and any open overlay, because their contents describe a different account.
- **Copy rules.** Disconnected is **not** empty and **not** an error. Never render "you have
  no positions", a zero balance, or a red state for a missing wallet. Where a control is
  blocked by it, the caption is exactly `CONNECT WALLET` — one wording, so it reads as a
  precondition rather than a per-surface complaint.
- **Data authority.** `on-chain` — the connection state itself, which gates every
  account-scoped read.

---

## Region copy rules

1. **Five states, five representations.** Loading, stale, unavailable, failed, and empty
   never share a rendering. A confident empty result standing in for "could not ask" is the
   specific failure this region exists to prevent (`PRODUCT.md` principle 5;
   `../SCHEMAS.md` §1).
2. **A truncated list always says so.** Silent capping is not an option, and the disclosure
   is a warning, not an error.
3. **A crash never claims to know the chain.** Error boundaries report render faults. Where
   the code can honestly guarantee no transaction was submitted, say so; where it cannot,
   say nothing rather than guessing.
4. **Disconnected is a precondition, not a failure.** One wording, one behaviour, no red.
5. **No liquidation, health-factor, or margin framing anywhere in chrome** — including in
   error, empty, and loading copy, where invented urgency is easiest to smuggle in. OVRFLO
   has no liquidation mechanism (`PRODUCT.md` — *Positioning*).
6. **Comps do not define chrome behaviour.** A comp's skeleton screens, status pills, or
   risk banners are pixels; whether a state exists, and what it is allowed to claim, is
   settled here (`../README.md`, authority order).
7. **The wallet session is volatile external state.** The account, chain, and connection
   can change during reads, simulation, signing, and while operations are pending. An
   operation belongs to the identity captured when it started: a switch mid-run pauses the
   queue (the `account` / `chain` pause reasons), a switch mid-form re-asks
   (`UI-ACTION-WALLET-CHANGED`), and nothing is ever silently re-attributed to — or
   silently signed by — the newly active session. A disconnect or reload does not erase
   the record of a transaction already broadcast. (Adapted from ponytail-fullstack-web3's
   `web3-wallet`.)
