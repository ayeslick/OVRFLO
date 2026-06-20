# OVRFLO Secondary Market (Book + Pool) — Requirements

**Date:** 2026-06-20
**Status:** Requirements (reconciled from two source specs); ready for `/ce-plan`
**Source specs:** `ovrflo lending pool spec.pdf`, `ovrflo stream market spec v1.pdf`
**Builds on:** `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`, `interfaces/ISablierV2LockupLinear.sol`

## 1. Summary

Two sibling products that let holders of OVRFLO yield streams (Sablier streams that
pay `ovrfloToken`, where 1 OVRFLO = 1 unit of the series **underlying**) get the
underlying now, and let capital providers earn a fixed return by buying or lending
against those deterministic streams:

- **Book** — a continuous, two-sided, fully on-chain order market. Active.
- **Pool** — a closed-end, sealed, pro-rata aggregation of loans. Passive.

Both share one priced primitive (pricing + eligibility + fee), a **per-order APR
bounded by admin-set min/max**, one series per market, and
OVRFLO-core/Sablier-attested provenance. The book is the engine; the pool is the
passive aggregation layer over the same loan core, **built later** (see §3 — the
immediate scope is the book + APR bounds + provenance).

**Underlying is parameterized, not hardcoded.** Each series is denominated in some
underlying ERC-20. **wstETH is the launch asset** (it aligns most closely with
OVRFLO and is the first market, PT-wstETH), but the design must treat the
underlying as a per-series parameter so other assets can be added without redesign.
Constraint: only **standard ERC-20** underlyings are supported — no
fee-on-transfer, no rebasing tokens (consistent with OVRFLO core's non-rebasing
assumption and the 1 OVRFLO = 1 underlying peg). All amounts below written as
"wstETH" are shorthand for "the series underlying."

**APR is market-set within admin bounds.** Every order carries its own `apr`,
validated on post against admin-set bounds `aprMinBps ≤ apr ≤ aprMaxBps`. The book
is built APR-aware from day one (the order struct stores `apr`, the pricing
function takes it as a parameter, events carry it). The bounds are the only knob
that gates it:

- **Launch:** `aprMinBps = aprMaxBps = 1000` (10%). The bounds collapse the field
  to a single legal value, so v1 behaves exactly like a fixed-rate book — no
  spread, no crossed orders — with zero special-casing in the code.
- **Later:** the admin widens the bounds (toward effectively no limit), and the
  same code lets buyers/lenders set their own APR. The **market** then decides the
  rate; a real two-sided spread and crossing emerge automatically.

This is why the **pool launches later**: once the book sets a market APR, the pool
derives its own price from the book rather than from a hardcoded constant.

This document reconciles the two source specs, which overlapped heavily but
conflicted on loan semantics, the pool's settlement model, and provenance.

## 2. Reconciled model

There are **two verbs**, not the three the specs imply:

1. **Sale (buy/sell)** — *book only*. The whole stream transfers permanently for
   `grossPrice`. This **absorbs the book spec's mislabeled "v1 loan"**: that
   escrow-loan returned an exhausted stream, so it was never a loan — it is a sale
   executed through escrow. The concept and its duplicate language are deleted.

2. **Loan (borrow/lend)** — *book + pool*. The borrower pledges a stream as
   collateral and borrows `borrowAmount ≤ grossPrice` (over-collateralized). The
   lender draws a fixed OVRFLO obligation; when satisfied, the **residual stream
   returns to the borrower**. Deterministic non-cancellable streams ⇒ no
   liquidation, no health factor, cannot underperform.

3. **Pool** — passive aggregation of verb #2. Many lenders pool the underlying
   (closed-end, sealed), many borrowers each take a loan against their pledged
   stream, residuals return per borrower, lenders own pro-rata the **sum of
   obligations**.

### 2.1 Pricing (shared, pure)

`apr` is the order's own rate, fixed when the order is posted and validated against
`[aprMinBps, aprMaxBps]`. The pricing function takes it as a parameter; nothing
below assumes a constant.

```
timeToMaturity = seriesMaturity − block.timestamp
grossPrice     = remainingStreamAmount / (1 + apr·timeToMaturity / YEAR)   // floors toward capital provider
fee            = floor(borrowAmount · feeBps / 10000)                       // borrower-paid, in the underlying
netToBorrower  = borrowAmount − fee
obligation     = borrowAmount · (1 + apr·timeToMaturity / YEAR)             // OVRFLO the lender side draws
residual       = remainingStreamAmount − obligation                        // ≥ 0 since borrowAmount ≤ grossPrice
```

A sale is the degenerate loan where `borrowAmount = grossPrice` ⇒
`obligation = remainingStreamAmount` ⇒ `residual = 0`. The math closes: a lender
who advances `borrowAmount` draws `borrowAmount·(1+apr·t/YEAR)` OVRFLO, earning the
fixed APR; the borrower keeps everything above that.

### 2.2 Everything fixed at origination, stored in the loan object

`remainingStreamAmount` is read from Sablier **once, at origination**, to compute
the numbers. Thereafter the loan object is the only source of truth — no
re-reading the stream, no re-pricing, no dynamic "how much is due" checks.

```solidity
struct Loan {            // book: one per borrow; pool: one per pledged stream
    address borrower;
    uint256 streamId;
    uint128 obligation;  // OVRFLO owed to the lender side — FIXED at origination
    uint128 drawn;        // cumulative drawn so far
}
```

Every draw/claim: pull `withdrawable_now`, then `loan.drawn += amount` with the
hard cap `loan.drawn ≤ loan.obligation`. Once `drawn == obligation`, the stream
returns to `loan.borrower` and nothing else is ever pulled from it.

### 2.3 Critical correctness invariant (both source specs got this wrong)

A loan/pool must **never draw a stream past its obligation** — the residual
belongs to the borrower. Each draw caps at
`min(withdrawable, obligation − drawn)`. The pool PDF's "drain all streams /
Settled = all streams exhausted" is wrong under loan semantics. The corrected
meaning: **Settled = all obligations drawn and all residual streams returned.**

### 2.4 APR bounds: validation, not economic clamps

APR bounds are **economic guardrails governed by the timelocked multisig, not
safety invariants.** A per-order `apr` only prices its own order, and the
counterparty opts in, so a "wacky" APR hurts only the poster and the market
self-corrects (nobody takes a bad order; no theft, no protocol loss). Per the
project rule "prefer off-chain multisig verification over redundant on-chain
checks," the contract does **not** police "min too high" or "max too low" — those
are governance judgment, and `setAprBounds` already passes through multisig
consensus + timelock delay.

Only two checks are enforced on-chain:

1. **`aprMaxBps >= aprMinBps` (anti-brick).** If `min > max`, *no* `apr` is legal
   and every `postOffer`/`listStream` reverts — bricking the book until a fix that
   itself eats a timelock delay. A one-line `require` in `setAprBounds` prevents the
   fat-finger DoS. This is the only strictly-required check.
2. **An immutable hard ceiling on `aprMaxBps` (math-domain safety, recommended).**
   Not economic — it keeps the fixed-point pricing domain sane (no pathological
   precision/overflow, `grossPrice` can't be pushed toward 0 by a future erroneous
   bounds-set). Set generously and never changed, mirroring the existing immutable
   `MAX_FEE_BPS`/`FEE_MAX_BPS` pattern. The `apr` storage type can also *be* the
   ceiling (e.g. `uint16` bps caps at 655.35%, like `feeBps`).

**Launch → post-launch path** (the intended end state):

- **Launch:** `aprMinBps = aprMaxBps = 1000` → only 10% legal.
- **After:** `aprMinBps = 0`, `aprMaxBps = HARD_CEILING` → effectively no limits,
  the market decides. `min = 0` is mathematically safe: at `apr = 0`,
  `grossPrice = remainingStreamAmount` (no discount) and `obligation = borrowAmount`
  (zero yield) — such orders are merely unattractive, never unsafe, so no positive
  floor is needed.

**Bounds changes are not retroactive.** Each order's `apr` is fixed at post time and
stored in the order, so widening or tightening the band affects only *new* posts;
resting orders keep their original rate. Repricing an existing order is
cancel-and-repost (already supported via `multicall`), never a mutation.

### 2.5 Custody, escrow & cancellation

Escrow is held by **`OVRFLOBook`** (the market contract). The book is a non-discretionary rail: it can only execute fixed settlement, return
escrowed assets on cancel, and route the fee.

**Posting escrows the asset:**

- **Offer** (lender/buyer side) — escrows the **underlying** into the book ("I will
  buy/lend").
- **Listing** (borrower/seller side) — escrows the **stream NFT** into the book ("I
  will sell/borrow"). A listed stream is **never drawn from** while it rests.

**Cancellation — you cancel the *resting* order, anytime it's unmatched:**

- Resting orders never expire. **Offers** cancel full or partial (any unmatched
  capacity returned); **listings** cancel whole (the stream is atomic), returned
  intact.
- **Matched into a sale:** already settled atomically and the order is consumed —
  nothing to cancel, nothing pending.
- **Matched into an active loan:** the stream is now **loan collateral**, not a
  cancellable listing. It **cannot** be cancelled or repaid early (no early
  repayment in v1); it returns to the borrower only when the lender has drawn the
  full `obligation` (`closeLoan`, permissionless). For a partially-filled loan
  offer, only the still-resting underlying remainder is cancellable; the matched
  slice is a live loan.
- An order ID is an **immutable commitment** to its terms — a taker racing a cancel
  reverts against a dead ID and loses only gas (no amend/cancel front-run vector).

So: **cancel anytime while resting; once it becomes an active loan (or settles as a
sale) there is nothing to cancel.** The only asset the book holds over time is
active-loan collateral, under fixed, non-discretionary settlement.

## 3. Pool specifics

> **Status: deferred — not in the immediate build.** The pool launches after the
> book, because it will price off the book's market-set APR rather than a constant.
> The only hard requirement on it *now* is forward-compatibility: **the pool must
> fit with zero redesign to `src/OVRFLO.sol`** (it reuses the same read-only
> provenance and Sablier draws the book uses — no core change, ever). The design
> below is the captured reconciliation, kept for when the pool work begins; do not
> build it in this phase.

- **Positions are address-keyed; no NFT, no ERC-4626.** Consistent with the book's
  address-tied, non-transferable orders. External protocols may wrap into an
  NFT/4626 vault later; out of scope here.

  ```solidity
  mapping(uint256 poolId => mapping(address lender => uint256 shares)) shares;       // = underlying deposited
  mapping(uint256 poolId => mapping(address lender => uint256)) claimedOVRFLO;
  mapping(uint256 poolId => mapping(address lender => bool)) claimedRemainder;
  mapping(uint256 poolId => uint256) totalShares;       // frozen at seal
  mapping(uint256 poolId => uint256) totalObligations;  // Σ obligations = lender lifetime entitlement; frozen at seal
  mapping(uint256 poolId => uint256) totalDrawn;        // Σ loan.drawn pulled into the pool
  ```

  `shareRatio = shares[poolId][lender] / totalShares[poolId]` (frozen at seal).

- **Lifecycle:** `Open → ClosedToDeposits → Sealed → Settled`. Two levers: amount
  cap (closes deposits, borrowing continues) and time deadline (seals).
- **Lazy seal:** folded into the first post-deadline claim (freeze shares, fix
  undrawn remainder, then claim). No keeper, no bounty. An unpaid permissionless
  `seal(poolId)` exists only as a convenience.
- **Three-number gate:** every claim pays `min(requested, available, owed)`, where
  `owed = floor(shareRatio · totalDrawn) − claimedOVRFLO[lender]`, capped at
  `shareRatio · totalObligations`; per-stream draws capped by each loan object's
  `obligation − drawn`.
- **Undrawn underlying** (deposited but never borrowed) returns pro-rata at seal.
- **Balance-checked borrow:** a borrow succeeds only if the pool currently holds
  enough underlying to cover the advance; else reverts. This is the entire
  imbalance-prevention mechanism.

## 4. Provenance / eligibility (no core change)

Reconstructed live at pledge from three sources that already exist — `OVRFLO.sol`
needs **no** new `streamId → series` storage:

1. **`OVRFLOFactory`** — registry of legit OVRFLO cores (`ovrfloInfo`) and approved
   markets (`isMarketApproved`, with `series[market]` on the core giving
   `ovrfloToken` + `expiryCached`).
2. **Sablier stream metadata** (read live): `sender == <a registered OVRFLO core>`,
   `asset == <that series' ovrfloToken>`, `cancelable == false`,
   `transferable == true`.
3. **Maturity pin:** under one core, all maturities share one `ovrfloToken` (the
   documented cross-market fungibility feature), so the asset can't identify the
   series alone. The stream's `endTime == series[market].expiryCached` pins the
   exact series (core sets stream duration to `expiry − now`).

Eligibility =
`sender ∈ cores ∧ asset == ovrfloToken ∧ endTime == seriesMaturity ∧ !cancelable ∧ transferable ∧ remaining ≥ minStreamSize`.
All on-chain, no oracle. This is the most security-critical check in the system.

## 5. Architecture (best way to build)

| Component | Change |
|---|---|
| `src/OVRFLO.sol` | **unchanged** |
| `src/OVRFLOFactory.sol` | **unchanged**; consumed as a read-only provenance registry |
| `interfaces/ISablierV2LockupLinear.sol` | **extend** — add `getStream`/`getSender`/`getAsset`/`getEndTime`/`isCancelable`/`isTransferable` and `withdraw`/`withdrawMultiple` (the only required edit to an existing file) |
| `StreamPricing` (new library) | pure pricing + eligibility helpers, shared by book and pool |
| `OVRFLOBook.sol` (new) | **active scope.** sale + loan; per-order APR within admin bounds; address-tied orders; `multicall`; non-payable; `Ownable2Step` (multisig) |
| `OVRFLOPool.sol` (new) | **deferred.** closed-end pool; prices off the book; must fit with no OVRFLO change. Not built this phase (see §3) |

**Topology:** standalone book + pool, `Ownable2Step` owned directly by the
multisig, reading the factory as a read-only provenance registry. Rationale: the
factory must mediate the vault because it owns the token/mint chain; the book and
pool have no such relationship — they only *read* provenance — so factory
mediation would add a hop and forwarder boilerplate for cosmetic uniformity with
no security gain. Timelock is preserved either way (the owner is the same
timelocked multisig).

### 5.1 Function surface (indicative)

- **Book — sale:** `postOffer(…, apr)`/`cancelOffer`/`hitOffer`,
  `listStream(…, apr)`/`cancelListing`/`takeListing`, `multicall`. Each post writes
  the order's `apr` and validates `aprMinBps ≤ apr ≤ aprMaxBps`.
- **Book — loan:** `postLendOffer(…, apr)`/`cancelLendOffer`/`borrowAgainstOffer(…, borrowAmount, minNetOut)`,
  `postBorrowListing(…, apr)`/`cancelBorrowListing`/`lendAgainstListing(…, maxPriceIn)`,
  `drawLoan` (permissionless collect) / `claimLoanDraws` (owner-only) / `closeLoan`
  (permissionless; returns residual once `drawn == obligation`).
- **Admin (multisig, book):** `setFee` (≤ `MAX_FEE_BPS`), `setTreasury`,
  `setAprBounds(aprMinBps, aprMaxBps)` — requires `aprMaxBps >= aprMinBps` and
  `aprMaxBps <= APR_MAX_CEILING` (immutable); launch `1000`/`1000`, widened later
  (see §2.4).
- **Pool (deferred):** `deposit` / `borrow` / `claim` / `returnStream` / `seal` /
  `settle` / `createPool` — designed in §3, not built this phase.
- **Views:** `quote(streamId)`, `loanState(loanId)`, pool `claimable(poolId, lender)`
  returning `(owed, available, claimable-now, streamIds[])`, `poolState(poolId)`.

## 6. Economics / ops decisions

- **100% of the fee → treasury. No close/seal bounty.** Every collective
  transition is folded into an individually-motivated action (lender's first claim
  seals; borrower triggers residual return and can permissionlessly push draws to
  complete sooner). A bounty would violate the "entire fee to treasury" and "every
  action paid for by the party that wants it; no liveness subsidy" invariants for
  zero correctness gain. A late seal loses nothing (streams keep vesting,
  entitlements fixed, dust to the final claimant).
- **APR is per-order, bounded by `[aprMinBps, aprMaxBps]`** (admin-set, under an
  immutable `APR_MAX_CEILING`). Launch bounds `1000/1000` lock every order to 10%;
  widening them later (toward `0`/`APR_MAX_CEILING`) hands rate discovery to the
  market. The code path is identical at both ends — only the bounds change. On-chain
  the contract enforces only `aprMaxBps >= aprMinBps` (anti-brick) and the immutable
  ceiling; "min too high / max too low" is left to the timelocked multisig (see
  §2.4).
- **No protocol LTV cap.** The borrower chooses `borrowAmount`; choosing the max
  degenerates to a sale. Deterministic non-cancellable streams mean no liquidation
  machinery regardless of LTV.
- **Fee is borrower-paid in the underlying**, bounded by an immutable
  `MAX_FEE_BPS`. OVRFLO is never taken as fee; every wei of drawn OVRFLO belongs to
  the lender side.

## 7. Build & test sequence

1. **Foundation:** extend the Sablier interface; build `StreamPricing` lib
   (APR-aware) + the provenance helper (reads factory + core + Sablier).
2. **Book (active scope):** sale path first (simplest, zero pooled custody), then
   loan path; per-order APR with `setAprBounds` (launch-locked to 10%). Ship and
   test fully.
3. **Pool (deferred):** out of scope for this phase. The only obligation now is to
   confirm the book/provenance/Sablier seams let the pool attach later **with no
   `src/OVRFLO.sol` change** and let it price off the book's market APR.

**Tests (book scope; pool tests deferred with the pool build):**

- **Unit:** pricing math and rounding direction (always favors capital provider),
  `borrowAmount = grossPrice` degeneracy, dust handling; **APR bounds** (reject
  `apr` outside `[aprMinBps, aprMaxBps]`, accept at the bounds, launch `1000/1000`
  admits only 10%, `setAprBounds` widening then admits a range); eligibility
  rejection (wrong sender/asset/maturity, cancelable, non-transferable, below min);
  fee cap.
- **Book lifecycle:** post/cancel/fill for offers and listings (sale + loan);
  loan `drawLoan`/`claimLoanDraws`/`closeLoan` returning the residual once
  `drawn == obligation`; slippage guards (`minNetOut`/`maxPriceIn`); cancel-vs-take
  race reverts against a dead order ID.
- **Invariants (fuzz):** per-stream `drawn ≤ obligation` (residual never stolen);
  taker pays/escrows exactly `grossPrice`, borrower nets `grossPrice − fee`;
  rounding always favors the capital provider; all functions non-payable
  (multicall msg.value-safe).
- **Fork (mainnet, building on `test/fork/OVRFLOForkBase.t.sol`):** real Pendle PT
  + real Sablier streams minted via `OVRFLO.deposit`, then sold/borrowed end-to-end
  through the book; draw + claim against real vesting.
- **Pool tests:** deferred to the pool build (lifecycle `Open→…→Settled`, lazy
  seal, balance-checked borrow, pro-rata claims, undrawn-underlying return).

## 8. Assumptions

- The OVRFLO core (`src/OVRFLO.sol`) is still modifiable in principle, but this
  design requires **no** core change; provenance is satellite/read-only.
- The underlying is a **per-series parameter**, not a hardcoded constant.
  **wstETH is the launch asset**; other standard ERC-20s will be added. Only
  standard ERC-20s are supported — **no fee-on-transfer, no rebasing** (the
  1 OVRFLO = 1 underlying peg and OVRFLO core's non-rebasing assumption depend on
  this). Each underlying has its own OVRFLO core; the factory registry already
  enumerates multiple cores, so multi-underlying is registry-driven, not a redesign.
- The APR mechanism (per-order field + bounds) is **built now**, not deferred; it
  is merely launch-locked to 10% via `aprMinBps = aprMaxBps = 1000`. Going
  "market-rate" is an admin bounds change, not a code change.
- v1 runs PT-wstETH as the first market; storage stays series-keyed and
  underlying-parameterized for v2-compat.
- Book keeps the collect (permissionless) / claim (owner-only) split for loans; the
  pool uses a one-step claim (seal-folded, batch-withdraw).
- Stays on Sablier V2 (per project preference).

## 9. Open questions (non-blocking; resolve in planning)

- Multi-pool vs single-pool-per-series storage layout (recommend series-keyed,
  multi-pool for v2-compat).
- Whether the pool needs `minStreamSize` / `minDeposit` values distinct from the
  book's.
- Exact off-chain `claimable` view shape and stream-selection guidance for the
  frontend (caller builds the `streamIds[]` array; contract curates nothing).
- The **pool** itself (full build): closed-end lifecycle, sealing, pro-rata claims,
  and pricing off the book's market APR. Deferred to a later phase; §3 holds the
  captured design.
- v2 candidates (out of scope now): auto-matching of crossed orders (only
  meaningful once APR bounds are widened), early repayment with peg-deviation
  handling, additional series/underlyings, an NFT/4626 wrapper over pool positions.
