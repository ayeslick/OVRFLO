# PT Flash-Loan Impact on the Pendle AMM Ecosystem

Scope: Analysis of a *proposed* OVRFLO feature that flash-lends deposited Pendle
Principal Tokens (PT) atomically (same-transaction repayment required), charging
the borrower a fee in the vault's underlying asset to the treasury. The feature
does not exist in `src/` today (no `flashLoan`/`IERC3156` surface in
`OVRFLO.sol`, `OVRFLOFactory.sol`, or `OVRFLOToken.sol`).

Key code references used:
- `src/OVRFLO.sol` `deposit()` reads `IPendleOracle(oracle).getPtToSyRate(market, info.twapDurationFixed)` to split `ptAmount` into `toUser` (immediate ovrfloToken) and `toStream` (Sablier stream). `twapDurationFixed` is bounded to `[15m, 30m]` (invariant I-7). Oracle freshness/cardinality is validated only at market onboarding (`OVRFLOFactory.setSeriesApproved`), **not** revalidated per deposit (trust assumption X-1).
- `CONCEPTS.md` "OVRFLO cycle": deposit + book sale + unwrap/swap converts the PT discount to extractable underlying; executable today with held PT or zero capital via an **underlying** flash loan (swap underlying → PT on the Pendle AMM, run the cycle, repay in underlying).

Pendle V2 mechanics confirmed from official docs/whitepaper:
- Pendle V2 uses a **custom AMM** (adapted from Notional Finance), not `x*y=k`. It concentrates liquidity within a configured **yield/APY range**, with **dynamic curve tightening** as PT approaches maturity. Trading out of the configured yield range becomes prohibitively expensive / impossible (liquidity thins to zero).
- **All Pendle swaps are flash swaps** (Uniswap-V2-style): the Market sends output tokens first, then enforces sufficient input has arrived by the end of the callback. So the AMM itself already has a built-in same-tx callback/flash primitive.
- TWAP oracle adapted from Uniswap V3; queryable for any duration up to 9 days. Observations are written when the pool is touched (swaps/LP actions), so a single block contributes at most one observation per touch.
- Post-maturity the AMM is inactive; PT redeems 1:1 for the accounting (underlying) asset. There is no PT/SY swap market post-maturity.

---

## 1. PT supply shock (large flash-loaned PT sold then bought back within one tx)

**Verdict: NO CONCERN (for the AMM's integrity); minor note on within-tx state exposure.**

Reasoning: A flash loan from OVRFLO that is sold on the Pendle AMM and bought back
before the transaction ends produces **net-zero token flow** to the pool. The AMM
pool's reserves return to their starting state by the end of the tx, so:

- **No lasting price impact** for subsequent users. The post-tx spot rate and
  reserves are unchanged (modulo swap fees, which accrue to LPs — a net positive
  for LPs, not a harm).
- **No TWAP impact**: the Pendle TWAP oracle (Uniswap-V3-derived) accumulates
  time-weighted observations. A round-trip sell+buy within a single block touches
  the oracle at most a couple of times within the same timestamp; the
  15–30 minute `twapDurationFixed` window means the intrablock excursion is
  diluted to a negligible contribution to the average. Net-zero reserve movement
  also means the *direction* of any observation is not sustained.
- The only within-tx effect is transient: while the sell leg is open, the pool's
  internal state (active liquidity, implied APY) is shifted. But no other user
  can observe an inconsistent intermediate state and act on it atomically *before*
  the buyback, because the entire flash loan executes in one transaction; any
  concurrent call in the same block sees either the pre-sell or post-buyback
  state, and EVM atomicity guarantees the round-trip either fully completes or
  fully reverts. There is no durable "supply shock."

Caveat: if the flash-loaned amount exceeds the pool's effective liquidity within
the yield range, the sell leg reverts (slippage/protection), which simply fails
the flash loan — no AMM harm. This is self-limiting.

---

## 2. TWAP oracle manipulation via flash loan to depress the rate for a simultaneous deposit

**Verdict: NO CONCERN (given the 15–30 min TWAP window); the X-1 freshness gap is unchanged by this feature.**

Reasoning: The proposed attack is: flash-loan PT → sell on AMM to depress
`getPtToSyRate` → call `deposit()` in the same tx to capture a favorable split →
buy back PT → repay. The flaw:

- `getPtToSyRate` is a **time-weighted average over 15–30 minutes**, not an
  instantaneous slot-0 price. A single-block sell cannot move a 15–30 minute
  average by a material amount. To shift the TWAP you must sustain the depressed
  price across many blocks for ~the full window — which a same-tx flash loan
  structurally cannot do (it must repay within the transaction).
- The existing `rejected-findings-record.md` already records this: "15–30 min
  TWAP window (I-7) resists single-block flash-loan manipulation." The PT flash
  loan does not change this — it adds no new ability to move the average that the
  existing underlying-flash-loan cycle didn't already have (an underlying flash
  loan can equally sell PT-amount-equivalent on the AMM intrablock).
- The one residual the audit already flags (X-1) is **freshness/cardinality not
  rechecked per deposit** — i.e. a *stale* oracle, not a *manipulated* one. A PT
  flash loan does not create staleness; it only enables intrablock spot moves,
  which the TWAP explicitly ignores. So the feature introduces no new oracle
  attack surface beyond what's already accepted.

Bottom line: the oracle reads a multi-minute average; an atomic round-trip cannot
move it. No new concern.

---

## 3. AMM liquidity concern from OVRFLO accumulating a large PT fraction then flash-loaning it

**Verdict: NO CONCERN.**

Reasoning: Flash-loaning PT out does **not** add PT to the AMM's liquidity. The
AMM's liquidity is its LP deposits; OVRFLO's held PT sits in the OVRFLO vault,
not in the pool. Flash-loaning it temporarily puts PT in a borrower's hands, who
may *trade* against the pool — but that is just a trade against existing LP
liquidity, identical to any other trader selling PT. It does not inflate the
pool's reserves or the "circulating supply" in any way that changes AMM math.

- The pool's depth is fixed by LP positions for the block; a flash-loaned sell is
  bounded by that same depth and the configured yield range. If the sell would
  trade out of range, it reverts.
- "Effective circulating supply increases" is a soft concept that doesn't map to
  any AMM invariant here: the AMM price is a function of its own reserves and
  curve, not of off-pool holdings. A large off-pool holder selling is no
  different from any whale selling — price impact is real but transient and
  bounded, and in a flash-loan round trip it reverts by end of tx.
- There is no governance/voting/quorum use of PT that a temporary supply spike
  could attack (PT is not a governance token).

No AMM-integrity concern. The only effect is normal, bounded, transient price
impact that the round-trip cancels.

---

## 4. Pendle AMM mechanics: does a large PT sell distort the PT/SY rate, and are there flash-loan protections?

**Verdict: NO CONCERN (mechanically bounded + self-reverting).**

Reasoning:
- The Pendle V2 AMM is not `x*y=k`. It concentrates liquidity in a yield range
  with dynamic curve tightening. Selling a large PT amount pushes the implied
  APY toward the edge of the configured range; once at the edge, liquidity thins
  to the point that further selling becomes effectively impossible (revert or
  extreme slippage). So large sells are **bounded by design** — they cannot push
  price to arbitrary values; they run out of liquidity at the yield-range
  boundary.
- The AMM's own **flash-swap callback** (output-first, input-enforced-by-end-of-tx)
  is structurally identical to a flash loan and is already a first-class feature
  of every Pendle market. Pendle has operated with this primitive since V2 launch
  without it being a manipulation vector, precisely because the curve + yield
  range + TWAP oracle compose to make intrablock excursions harmless. OVRFLO
  adding an external PT flash lender does not give attackers any capability the
  AMM's native flash swap doesn't already provide.
- There is no documented "flash-loan protection" switch because none is needed:
  protection comes from (a) the yield-range-bounded curve, (b) the TWAP oracle
  for price *reads*, and (c) EVM atomicity for round trips.

No concern. The AMM is designed to tolerate exactly this class of intrablock
movement.

---

## 5. Cycle amplification: does the PT-flash-loan cycle create more AMM volume, and is "AMM as oracle + venue" a problem?

**Verdict: NO CONCERN (volume is benign; oracle/venue dual-use is already accepted).**

Reasoning:
- The PT-flash-loan cycle (flash-loan PT → deposit into OVRFLO → unwrap → sell
  stream → buy PT on AMM → repay) does route a PT buy through the AMM for
  repayment, generating AMM volume. But "more volume" is not a harm — it generates
  fees for LPs and does not degrade the pool. Volume is not an attack vector.
- Compared to the **underlying**-flash-loan version (already accepted by design,
  see `CONCEPTS.md` "OVRFLO cycle" and `rejected-findings-record.md`), the
  PT-flash-loan version *reduces* AMM dependence: the underlying version must
  *swap underlying→PT* on the AMM to acquire PT (one AMM trade) then repay in
  underlying; the PT-flash-loan version starts with PT in hand and only needs to
  *buy back* PT on the AMM for repayment. Net AMM touches are comparable or fewer.
- "AMM as price oracle AND trading venue simultaneously": OVRFLO does **not** read
  the AMM spot price — it reads the TWAP oracle (`getPtToSyRate`), which is
  manipulation-resistant over 15–30 min. The AMM as a venue for the buyback leg
  is independent of the oracle read; using the AMM to trade does not corrupt the
  TWAP that `deposit()` consumes (per Q2). This dual-use already exists in the
  accepted underlying-flash-loan cycle and was deemed acceptable.

No new concern. The feature does not amplify any unaccepted risk.

---

## 6. Multi-market interaction: flash-loan PT from market A, trade on market B's AMM

**Verdict: NO CONCERN.**

Reasoning:
- OVRFLO vaults are **per-underlying**; a single vault can hold PT from multiple
  markets sharing that underlying but with different maturities. A PT flash loan
  would lend a specific market's PT (PT is market-specific).
- Trading market-A PT on market-B's AMM is **not possible**: each Pendle market
  is a PT/SY pool for *one specific PT*. You cannot sell PT-marketA into
  market-B's pool; the tokens are different. So "flash-loan from A, sell on B" is
  mechanically impossible at the AMM level.
- What *is* possible: flash-loan PT-A, redeem/unwrap to underlying, then use that
  underlying on market-B's AMM to trade PT-B. But that is just routing underlying
  through to a different market — identical to an underlying flash loan targeting
  market B, with no cross-market feedback into market A's AMM or oracle. Each
  market's TWAP is independent (per-market oracle state).
- Cross-market contagion would require a shared price feed; OVRFLO queries
  `getPtToSyRate` per market with per-market oracle addresses stored in
  `SeriesInfo`. There is no shared cross-market oracle state to corrupt.

No concern.

---

## 7. Post-maturity AMM is disabled — can matured-PT flash loans be repaid?

**Verdict: CONCERN — flash loans of matured PT can become unrepayable via the AMM; block flash loans for matured (or maturity-passing) series.**

Reasoning: This is the one substantive issue. Post-maturity:
- The Pendle AMM for that market is **inactive** — no PT/SY swap venue exists.
- Matured PT redeems 1:1 for the underlying (accounting asset) via Pendle's
  `redeemPY`/`redeem` path. So a borrower who flash-loans matured PT *can* redeem
  it to underlying — but then to **repay the PT flash loan** they need to return
  **PT**, not underlying. Post-maturity there is no AMM to buy PT back with
  underlying, and minting fresh PT is impossible post-maturity (the SY→PT/YT
  split is disabled at/after expiry).
- Therefore a flash loan of matured PT is **only repayable if the borrower never
  disposes of the PT** (i.e., the loan is useless) or has another source of the
  same matured PT. Any cycle that converts the matured PT to underlying (redeem,
  unwrap, sell stream) leaves the borrower holding underlying with no path back to
  PT → the flash loan reverts. That's safe-by-revert for OVRFLO (no loss — the
  atomic repayment check fails and the tx reverts), but it makes the feature
  non-functional and could cause confusing reverts or griefing-style gas burns.

Recommendation: **gate PT flash loans to pre-maturity series only**, and ideally
enforce `block.timestamp < info.expiryCached` at loan time (mirroring the
`claim`/deposit pre-maturity guards). This both prevents unrepayable-loan reverts
and aligns with the existing design rule that post-maturity PT exits go through
the claim path, not the AMM. (Consistent with `4626_SECURITY.md` cautions on
flash-loan-driven forced-redemption paths.)

---

## 8. Fee model interaction: can flash-loan fee + AMM buyback cost exceed captured yield?

**Verdict: NO CONCERN (self-policing by economics; borrower bears the risk, OVRFLO is not harmed).**

Reasoning: The borrower's sources of underlying are (a) unwrap of the immediate
`toUser` ovrfloToken portion and (b) sale of the Sablier stream on the book. Their
underlying obligations are (a) the OVRFLO flash-loan fee, (b) buying PT on the AMM
to repay the principal, and (c) any underlying-flash-loan fee if they also borrow
underlying.

- If `flashLoanFee + AMM buyback cost > yield captured`, the borrower simply
  **loses money on the cycle** — the tx either reverts (if they can't repay the
  flash loan) or completes at a loss to the borrower. In **no case is OVRFLO's
  solvency impaired**: the flash loan requires atomic PT repayment (so OVRFLO's PT
  holdings are restored) and the fee is taken in underlying to the treasury. The
  downside is entirely the borrower's; OVRFLO either gets its PT back plus a fee,
  or the tx reverts and nothing happens.
- This is the same economic self-policing that already governs the accepted
  underlying-flash-loan cycle (`rejected-findings-record.md`: flash loans "remove
  the capital requirement but do not create a new vulnerability"). Adding a PT
  flash-loan fee just inserts another cost line; it can only *reduce* borrower
  profit, never create a protocol loss.
- The one scenario worth flagging (not a concern for OVRFLO, but for the
  borrower's UX): if the AMM buyback is expensive because the sell leg moved the
  pool, the borrower pays the spread. This is normal AMM round-trip cost and is
  bounded by the yield range; it self-limits because an unprofitable cycle
  simply isn't executed (rational borrowers check `minToUser`/slippage).

No protocol concern. The fee model is strictly additive to OVRFLO's revenue and
risk is borne by the borrower.

---

## Summary table

| # | Question | Verdict |
|---|----------|---------|
| 1 | PT supply shock (sell+buyback in one tx) | NO CONCERN |
| 2 | TWAP oracle manipulation for simultaneous deposit | NO CONCERN |
| 3 | AMM liquidity / circulating-supply inflation | NO CONCERN |
| 4 | Pendle AMM mechanics + flash-loan protections | NO CONCERN |
| 5 | Cycle amplification / AMM-as-oracle-and-venue | NO CONCERN |
| 6 | Multi-market (flash from A, trade on B) | NO CONCERN |
| 7 | Post-maturity AMM disabled → unrepayable flash loans | **CONCERN** |
| 8 | Fee + AMM cost exceeding captured yield | NO CONCERN |

**Single actionable recommendation:** gate PT flash loans to pre-maturity series
(`block.timestamp < info.expiryCached`) to avoid unrepayable post-maturity loans.
All other dimensions are bounded by existing Pendle V2 design (yield-range curve,
Uniswap-V3-style TWAP, native flash swaps) and by OVRFLO's atomic-repayment +
underlying-fee model, and add no risk beyond the already-accepted
underlying-flash-loan OVRFLO cycle.
