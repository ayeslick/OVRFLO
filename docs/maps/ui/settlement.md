# Region brief — Expanded settlement

**Slug:** `SETTLEMENT` · **Control ID prefix:** `UI-SETTLEMENT-` (`../SCHEMAS.md` §1)

**Incumbent code:** `web/components/MarketRowDetail.tsx` (expanded-row body: balances,
conversion utilities, advanced disclosure, the two market actions) ·
`web/components/MarketDetail.tsx` (the overlay container these actions open)

**Purpose of the region.** Once a market row is expanded, this is where a user settles with
that market: see the three wallet balances that matter, convert between them, and enter
either side of the lending market.

**Boundary.**

- The row toggle that opens this region is `UI-MARKETS-TABLE-ROW-TOGGLE`.
- The position cards rendered in the middle of this region belong to `positions.md`.
- `MarketDetail.tsx` is the dialog shell every action here opens. Its own controls — scrim,
  focus trap, Escape, close, error boundary, wrong-network gate — are documented in
  `action.md`, because they are properties of every action rather than of settlement.
  `ui/README.md` lists `MarketDetail.tsx` under this region; that is the charter's incumbent
  mapping and it is kept, but the shell's control contracts live in `action.md`.

**SUPPLY and BORROW are peers.** They are the two sides of one market and this region gives
them equal standing: same row, same size, same caption mechanism, neither nested under the
other, neither behind a disclosure, and neither presented as the default. They differ only
in accent (gold for the lend side, cyan for the borrow side per `DESIGN.md` §6) and in the
conditions that disable them. Any change that promotes one over the other — ordering it
first as a primary CTA, styling the other as secondary or ghost, hiding one behind a tab —
is a change to this brief, not a visual tweak.

---

## `UI-SETTLEMENT-BALANCES`

- **ID.** `UI-SETTLEMENT-BALANCES`
- **Purpose.** Show the three balances that determine what the user can do in this market:
  underlying, PT, and ovrfloToken.
- **Visible when.** A wallet is connected. With no wallet, the entire balances block —
  including its conversion actions — is not rendered at all.
- **States.**
  - `loading` — the multicall has not resolved; each row's amount formatter renders its
    unknown form.
  - `ready` — three rows, one per token, each with its symbol.
  - A failed leg renders as unknown, never as `0`. Reading "0 PT" when the read failed
    would tell the user they cannot deposit when they can.
- **Action.** None itself — it is the context for the four conversion controls below.
- **Copy rules.** Label `BALANCES`. PT has no entry in the market's symbol map, so it is
  named literally `PT`. Never show a fiat value. Never present a balance as spendable
  without the approval it will require; approvals are requested inside the overlay.
- **Data authority.** `on-chain` — three `balanceOf` reads batched into one multicall
  against the ovrfloToken, underlying, and PT token.

## `UI-SETTLEMENT-DEPOSIT-PT`

- **ID.** `UI-SETTLEMENT-DEPOSIT-PT`
- **Purpose.** Enter the vault: deposit Pendle PT to receive ovrfloToken now plus a Sablier
  stream of the remaining fixed discount.
- **Visible when.** A wallet is connected **and** the market has not matured. After maturity
  the control is **removed**, not disabled — depositing into a matured series is not a
  temporarily unavailable action, it is not an action.
- **States.**
  - `enabled` — PT balance greater than zero.
  - `disabled` — PT balance is zero; caption `NO BALANCE`.
  - `absent` — matured, or no wallet connected.
- **Action.** Opens the deposit flow in the overlay (`ConvertFlow`, title `DEPOSIT PT`),
  which previews the split and submits `OVRFLO.deposit(market, amount, minToUser)`. The
  on-chain consequence: PT leaves the wallet, ovrfloToken arrives, and a per-deposit
  Sablier stream is created for the remainder, less the market-value fee.
- **Copy rules.** `DEPOSIT PT`. It sits beside the PT balance deliberately so it has one
  canonical entry point rather than competing with SUPPLY/BORROW — it is a vault action,
  not a lending-market action. Never describe the deposit as locking collateral or as
  taking on a loan; nothing is borrowed and nothing can be liquidated.
- **Data authority.** `on-chain` for the PT balance that gates it and for maturity.

## `UI-SETTLEMENT-CLAIM-PT`

- **ID.** `UI-SETTLEMENT-CLAIM-PT`
- **Purpose.** After maturity, burn ovrfloToken to claim the backing PT.
- **Visible when.** A wallet is connected **and** the market has matured. It is the
  post-maturity replacement for `UI-SETTLEMENT-UNWRAP` in the ovrfloToken balance row.
- **States.**
  - `enabled` — ovrfloToken balance greater than zero.
  - `disabled` — balance zero; caption `NO BALANCE`.
  - `absent` — pre-maturity, or no wallet.
- **Action.** Opens the claim-matured flow (`ConvertFlow`, title `CLAIM MATURED PT`), which
  submits `OVRFLO.claim(ptToken, amount)`. The on-chain consequence: ovrfloToken is burned
  and PT is transferred out, bounded by PT backing.
- **Copy rules.** `CLAIM PT`. Do not present claim and unwrap as interchangeable: they pay
  out different assets. Do not imply a deadline or a forfeiture — claim has no expiry.
- **Data authority.** `on-chain` for the ovrfloToken balance and for maturity
  (`expiryCached` against a live clock).

## `UI-SETTLEMENT-UNWRAP`

- **ID.** `UI-SETTLEMENT-UNWRAP`
- **Purpose.** Exit ovrfloToken one-to-one into the underlying, before maturity.
- **Visible when.** A wallet is connected **and** the market has not matured.
- **States.**
  - `enabled` — ovrfloToken balance greater than zero and the wrap reserve is non-empty.
  - `disabled — reserve empty` — caption `WRAP RESERVE EMPTY`; this caption wins over the
    balance caption, because the reserve is the binding constraint.
  - `disabled — no balance` — caption `NO BALANCE`.
  - `absent` — matured (replaced by `UI-SETTLEMENT-CLAIM-PT`), or no wallet.
- **Action.** Opens the unwrap flow (`ConvertFlow`, title `UNWRAP`), which submits
  `OVRFLO.unwrap(amount)`. The on-chain consequence: ovrfloToken burned, underlying paid
  out one-to-one, bounded by the separately tracked wrap reserve.
- **Copy rules.** The reserve caption must name the reserve, not the user's balance — the
  user has done nothing wrong and their balance is fine. Unwrap is permissionless and
  one-to-one; never describe it as a swap, a redemption at a rate, or a sale. Distinguish
  it from claim: unwrap returns the underlying, claim returns PT.
- **Data authority.** `on-chain` — ovrfloToken balance and `OVRFLO.wrappedUnderlying()` for
  the reserve. The reserve is a gate, so it is read from the vault, never inferred from a
  token balance or a projection.

## `UI-SETTLEMENT-ADVANCED`

- **ID.** `UI-SETTLEMENT-ADVANCED`
- **Purpose.** Keep the wrap direction reachable without putting it in the default journey.
- **Visible when.** A wallet is connected (it lives inside the balances block).
- **States.** `collapsed` (`ADVANCED ▸`, `aria-expanded="false"`) and `expanded`
  (`ADVANCED ▾`, `aria-expanded="true"`). It is not persisted across renders of the row.
- **Action.** Client-side disclosure only — reveals `UI-SETTLEMENT-WRAP`. No transaction.
- **Copy rules.** `ADVANCED`. Do not use the disclosure to hide anything a user needs to
  make an informed decision; it exists because wrapping underlying into ovrfloToken is
  deliberately not the default journey (locked decision 3 in
  `docs/plans/ux-personas-journeys-screens.md`), not because it is risky.
- **Data authority.** `pure-client`.

## `UI-SETTLEMENT-WRAP`

- **ID.** `UI-SETTLEMENT-WRAP`
- **Purpose.** Convert underlying into ovrfloToken one-to-one.
- **Visible when.** A wallet is connected and `UI-SETTLEMENT-ADVANCED` is expanded.
- **States.** `enabled` (underlying balance greater than zero) and `disabled` with caption
  `NO BALANCE`.
- **Action.** Opens the wrap flow (`ConvertFlow`, title `WRAP`), which submits
  `OVRFLO.wrap(amount)` after an exact-amount approval. The on-chain consequence:
  underlying is taken in and ovrfloToken is minted one-to-one, increasing the wrap reserve.
- **Copy rules.** Label the direction explicitly: `WRAP <underlying> → <ovrfloToken>`. Do
  not describe wrapping as earning, staking, or depositing — it mints no stream and accrues
  nothing. ovrfloToken fungibility across wrap and PT-deposit origins is intentional and
  increases exit optionality; never present wrapped ovrfloToken as a lesser or separate
  token.
- **Data authority.** `on-chain` for the underlying balance.

## `UI-SETTLEMENT-SUPPLY`

- **ID.** `UI-SETTLEMENT-SUPPLY`
- **Purpose.** Enter the lend side of this market: post underlying liquidity at a chosen
  tick for a fixed return.
- **Visible when.** Always rendered in the expanded row, in the same action row as
  `UI-SETTLEMENT-BORROW` and with equal weight — including when disconnected, so the two
  sides of the market are visible before a wallet is connected.
- **States.** Enabled, or disabled with exactly one caption, in this precedence:
  - `CONNECT WALLET` — no wallet connected.
  - `LENDING NOT DEPLOYED` — the market has no lending deployment.
  - `MARKET MATURED` — past `expiryCached`.
  - otherwise `enabled`.
- **Action.** Opens the supply flow in the overlay (`SupplyFlow`, title `SUPPLY LIQUIDITY`,
  gold accent), which submits `OVRFLOLending.supplyLiquidity(market, aprBps, amount)` after
  an ERC-20 approval. The on-chain consequence: underlying moves to the lending market as a
  liquidity position at one discrete tick, withdrawable while it stays idle.
- **Copy rules.** `SUPPLY`. The caption states the blocking condition and nothing else —
  disabled controls explain themselves rather than going silent. Never promise that supplied
  liquidity will be consumed, and never let the label imply the lender chooses how it is
  consumed: a lender's liquidity may be filled as a loan **or** as an outright stream
  purchase, and the flow says so before the decision. Supply and borrow copy must stay
  symmetric in tone; neither is the "safe" side and neither is the "advanced" side.
- **Data authority.** `on-chain` for the connection, the lending deployment address, and
  maturity — every input to the gate is authoritative.

## `UI-SETTLEMENT-BORROW`

- **ID.** `UI-SETTLEMENT-BORROW`
- **Purpose.** Enter the borrow side of this market: pledge an eligible stream and receive
  underlying upfront.
- **Visible when.** Always rendered in the expanded row, peer to `UI-SETTLEMENT-SUPPLY`.
- **States.** Enabled, or disabled with exactly one caption, in this precedence:
  - `CONNECT WALLET` — no wallet connected.
  - `LENDING NOT DEPLOYED` — no lending deployment for this market.
  - `MARKET MATURED` — past `expiryCached`.
  - `NO STREAMS AVAILABLE` — the account holds no series-matched stream for this market.
  - `NO LIQUIDITY POSTED AT ANY RATE` — asserted **only** once the lending-params and
    liquidity reads have settled.
  - `disabled-unsettled` — reads have not settled: the button is disabled with **no**
    caption. An in-flight read is not-yet-known, not empty, and the control refuses to claim
    a reason it does not have. Opening the flow blind is what walks a borrower into a wasted
    `APPROVE STREAM` signature.
- **Action.** Opens the borrow flow in the overlay (`BorrowFlow`, title
  `BORROW AGAINST STREAM`, cyan accent), which quotes on-chain and submits
  `OVRFLOLending.createBorrowerLoanPool(routeIds, streamId, fill, minAcceptable)`. The
  on-chain consequence: the pledged stream transfers to the lending market, underlying
  arrives in the wallet now, and the loan self-repays from the stream until the obligation
  is met — after which the residual stream returns to the borrower.
- **Copy rules.** `BORROW`. Never introduce liquidation, health factor, margin call,
  collateral ratio, or liquidation price anywhere on this control or its captions — a
  pledged OVRFLO stream is a fixed-asset, fixed-schedule, non-cancelable instrument whose
  remaining value covers the obligation, which is precisely why the product has none of
  that machinery (`PRODUCT.md` — *Positioning*, *Capabilities and Constraints*). Never
  render borrowing as riskier-looking than supplying through copy, colour weight, or
  placement; the accent difference is a side marker, not a severity marker. The distinction
  between "no liquidity" and "not yet known" must survive any rewording.
- **Data authority.** `on-chain` for connection, lending address, maturity, and the ladder
  depth behind the liquidity gate. `projection` for the discovered eligible-stream set —
  which is why `NO STREAMS AVAILABLE` disables a convenience entry point and never asserts
  that the user holds no streams; stream-discovery failure is reported separately by
  `UI-POSITIONS-STREAMS-UNAVAILABLE`.

---

## Region copy rules

1. **SUPPLY and BORROW stay peers.** Equal placement, equal prominence, symmetric copy,
   symmetric caption mechanism. Neither is a default, neither is nested, neither is
   labelled advanced or risky.
2. **A disabled control names its blocker.** Except where the blocker is unknown — then it
   stays disabled and silent rather than guessing. Never substitute a confident empty
   reason for an unsettled read.
3. **Absent ≠ disabled.** Deposit disappears after maturity; unwrap is replaced by claim.
   An action that cannot exist in a state is removed; an action that is temporarily blocked
   is disabled with a caption.
4. **No liquidation, health-factor, margin, or collateral-ratio framing.** Not in labels,
   captions, tooltips, badges, or colour semantics. This region is where such framing is
   most tempting and least true.
5. **Comps do not add product behaviour.** A gauge, risk meter, or score that appears in a
   comp without product truth behind it does not enter the product (`../README.md`).
6. **Every gate reads from chain.** Balances, reserve, maturity, and lending deployment all
   reach an `if (…) allow`, so all are `on-chain` (`../SCHEMAS.md` §2).
