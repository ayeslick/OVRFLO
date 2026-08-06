# OVRFLOLending market design space — ten mechanisms

Written 2026-08-03, from a brainstorm session on eliminating frontend ID-selection collisions and rethinking the market structure. The "Pool" text in README's Roadmap is stale per the owner; this document supersedes nothing and decides nothing — it maps the option space.

## The frame

Because OVRFLO collateral is deterministic (non-cancelable linear Sablier streams, `obligation <= remaining` proven), OVRFLOLending is not a credit market. It is a fixed-income exchange for one homogeneous instrument per market. There is nothing to underwrite and nothing to liquidate, so every design below differs only along four axes:

1. **Matching** — how a stream meets money (order book, listing, pool, AMM, auction, signatures, none).
2. **Rate discovery** — how the APR gets set (limit orders, auction clearing, bonding curve, utilization curve, quoted).
3. **Capital residence** — where lender money waits (locked in the contract, in the lender's wallet, pooled).
4. **Instrument shape** — what is actually traded (whole-maturity fills, time slices, fungible zero-coupons, flows).

One structural fact unlocks several designs: **within a market, streams are fungible per unit of remaining face.** Every eligible stream vests linearly to zero at the same series maturity with no cliff, so once accrued withdrawable is harvested, a stream's entire future cashflow is determined by its remaining face alone — two streams with equal remaining are economically identical regardless of when they were created.

The collision problem that started this thread disappears in *all ten* designs, because every one of them moves ID selection out of the client and into the contract, a signature, or nothing at all.

---

## Part 1 — Five designs, thought through

### 1. Resting-order book with per-tick FIFO queues

The refined version of today's model. Lenders post liquidity at APR ticks exactly as `supplyLiquidity` does now, but the contract threads each `(market, aprBps)` tick into a FIFO queue (linked list with head cursor). Borrowers call `borrowUpToApr(market, maxAprBps, streamId, targetBorrow, minAcceptable)`; the contract walks ticks from lowest APR upward, consuming positions in price-time priority until the target fills. Per-loan contribution accounting (`loanPoolContributions`, `_claimFair`) survives unchanged — only *how positions are found* changes.

- **Solves:** collisions (selection is atomic, inside the tx), fairness (price-time priority instead of frontend largest-first), and the discovery problem (the queue *is* the enumeration; `gatherLiquidity` becomes a queue walk).
- **Design work:** dust griefing needs a `MIN_LIQUIDITY_AMOUNT` (precedent: `MIN_STREAM_AMOUNT = 1e6`); withdrawn positions leave holes handled by lazy deletion with the head cursor advancing past them once, not per-borrow; self-match positions are skipped in-walk.
- **Prior art:** on-chain CLOBs; Liquity's sorted list; classic limit-order markets.
- **Distance from current code:** moderate — new queue storage plus one new entrypoint; everything downstream intact.

### 2. Stream-first funding round (the two-sided direction)

The inverse posting direction, which the current contract lacks. A borrower escrows a stream and posts an open **borrow listing**: `(streamId, aprBps, targetBorrow)`. Lenders fill it incrementally — `fundListing(listingId, amount)` — and each fill immediately pays the borrower (net of fee) and accrues an obligation **priced at fill-time `ttm`** via `obligationForFill`, with a running check that cumulative obligations stay `<= remaining`. There is no atomicity problem at all: the listing is the loan pool, contributions arrive whenever they arrive, and two lenders filling simultaneously just both fill. The borrower can close the round at any time; unfilled capacity simply expires when they reclaim the stream (only if nothing has filled yet — once funded, the standard loan lifecycle applies).

Combined with design 1 this becomes the complete symmetric market: **both sides can rest orders** (standing liquidity at ticks; standing borrow listings at asked rates) **and both sides can take** (borrowers sweep ticks; lenders fill listings). Either side crossing the spread executes instantly; either side can wait for their price. That is a full two-sided market built from two primitives that each already half-exist (`supplyLiquidity` and `postSaleListing` are the two halves).

- **Solves:** collisions (fills are additive, not selective), borrower rate-setting (today only lenders quote rates), and it gives the ladder a real bid side, which sharpens rate discovery.
- **Design work:** per-fill obligation accounting; decide whether a partially-funded listing's borrower can cancel remaining capacity (yes, trivially) and whether fills below some minimum are rejected (dust).
- **Prior art:** bond bookbuilding / primary issuance; crowdfund escrow; NFT collection offers (bids resting against an asset class).
- **Distance:** small-to-moderate — one new listing type plus per-fill pricing; reuses escrow, eligibility, claim channels wholesale.

### 3. The Pool — closed-end epoch fund

A sealed, passive vehicle per `(market, epoch)`. Lifecycle: a **subscription window** where lenders deposit underlying and receive ERC-20 shares; a **deployment window** where borrowers pledge streams and draw at the pool's posted APR; then run-off to maturity. Because collateral is deterministic, the pool's terminal NAV is *exactly computable* the moment deployment closes — shares converge to a known redemption value, and the interim share price is closed-form (sum of obligations discounted by time). Undeployed cash at window close is refunded pro-rata so nobody pays for idle capital.

The stale-README version had the rate "established by the Lending market"; without presuming that, the epoch APR can be set three ways: governance within `aprMin/aprMax` bounds, seeded from the discrete market's recent prints (designs 1/2), or discovered by a per-epoch auction (design 5). The pool socializes *utilization* — every lender earns the same blended rate — which is the honest trade against designs 1/2 where whoever gets matched earns and whoever doesn't sits idle.

- **Solves:** collisions (bucket — no IDs anywhere), passive UX for lenders, and it manufactures a new asset: the share token is a fixed-maturity, fixed-rate note that can itself trade on any DEX.
- **Design work:** share accounting (index-based, replacing nothing — this is a *new* contract beside OVRFLOLending, not a rewrite of it); epoch cadence; rate-setting choice; whether borrowers may also repay early into the pool (yes — routes to pool proceeds like `repayLoan` does today).
- **Prior art:** closed-end funds; Element/Pendle fixed-rate vaults; money-market fund mechanics.
- **Distance:** a new sibling contract over the same `StreamPricing` core; OVRFLOLending untouched.

### 4. Fungible zero-coupon tokenization + maturity-aware AMM

The most transformative option, built directly on the fungibility fact. A wrapper per market accepts any eligible stream, **harvests accrued withdrawable on deposit** (returning that cash to the depositor — this is what makes remaining a sufficient statistic), and mints `zcOVRFLO-M` tokens 1:1 against the stream's pure-future remaining face. Each zc token redeems exactly 1 ovrfloToken at maturity; pre-maturity, the wrapper's harvested balance supports pro-rata early redemption. The wrapper holds all streams and harvests permissionlessly — the v1.1 ACL (owner withdraws to any destination) supports this exactly as `_claimFair` uses it today.

Then the entire market collapses into token swaps:

- **"Borrowing"** = deposit stream, mint zc, sell the portion you want as cash, keep the rest — the retained zc *is* the residual. Nothing to repay, ever: the sold zc are backed by the escrowed stream. Loan and sale, today two primitives, become one.
- **"Lending"** = buy zc at a discount. The discount is the APR.
- **"Early repay"** = buy zc back at market rate and redeem a stream of equivalent remaining (fungibility means any stream, which is fine).
- **Venue** = a YieldSpace-style AMM (Pendle's own invariant) whose curve prices *rate* rather than *price*, so passive LPs don't bleed as `ttm` decays. A plain constant-product pool works at launch with the caveat that LPs must manage time drift.

Yes, this re-creates a PT one level up — OVRFLO unwraps Pendle PTs into streams and this re-tokenizes the streams. But the traded rate is OVRFLO's *own* market APR on its own collateral, which is precisely the number the whole protocol wants discovered, and continuous AMM pricing is the strongest possible oracle for it.

- **Solves:** everything at once — collisions, discovery (fungible ERC-20, indexable by any DEX tooling), passive LPing, instant exit both directions, composability (zc tokens as collateral elsewhere).
- **Costs:** the biggest build (wrapper + pool), a product-identity change (no per-loan lender/borrower relationship), and the maturity-aware AMM is real math work if built rather than borrowed.
- **Prior art:** Yield Protocol fyTokens, Element principal tokens, Pendle PT/AMM — all battle-tested shapes.

### 5. Uniform-price batch auction

Periodic (say daily, or per-epoch feeding design 3) sealed matching. Borrowers submit `(streamId, targetBorrow, maxAprBps)`; lenders submit `(amount, minAprBps)`. Orders insert into an on-chain sorted list at submission time — Liquity-style, with the submitter paying insertion gas and supplying a position hint, so no on-chain sorting ever happens. At the bell, a permissionless `clear()` walks the two sorted sides to the crossing point and executes **everyone at the single clearing APR**, pro-rata at the marginal tick; unmatched orders roll to the next batch or withdraw.

The special property: uniform price kills not just collisions but *priority games entirely* — there is no advantage to transaction ordering, no MEV in the match, and the output is one clean market-clearing APR per epoch, which is the best possible reference rate for a Pool (design 3) or a desk (design 10). The cost is latency by construction: nobody trades until the bell, so it suits a market that values a trustworthy rate print over immediacy — plausibly true for a maturity-dated instrument.

- **Design work:** bounded clear-walk (cap orders per batch or make `clear()` resumable across txs); minimum order sizes; what happens to streams escrowed for orders that don't match (returnable anytime pre-clear).
- **Prior art:** Gnosis EasyAuction, Term Finance's weekly fixed-rate auctions, frequent-batch-auction market design literature (Budish et al.).
- **Distance:** a new matching module; loan bookkeeping downstream of the match reuses the existing pool-loan machinery.

---

## Part 2 — Five additional ideas (not previously discussed)

### 6. Signed-order RFQ — the off-chain order book with no server

Lenders sign EIP-712 offers — "I will lend up to X against market M at ≥Y bps until deadline D, nonce N" — and funds **never leave their wallet** until a fill. A borrower collects signatures and calls `fillOffers(offers[], sigs[], streamId, target, minAcceptable)`; the contract verifies, pulls via allowance, and books the loan pool exactly as today. Unfillable offers (cancelled nonce, moved funds) are *skipped*, not fatal — the skip-empty semantics fall out naturally. Distribution needs no server and stays CROPS-clean: offers can be published as calldata-only events on-chain (a few hundred bytes each — a bulletin board the existing log-scanner already knows how to read). Capital efficiency is the standout: lender money earns elsewhere (Aave, the wrap reserve, anywhere) until the moment it lends. The trade is fill reliability — an offer is a signature, not escrow — mitigated by over-collecting signatures and skipping duds.
**Prior art:** 0x RFQ, Seaport, UniswapX, 1inch limit orders. **Distance:** small — one settlement entrypoint; no new storage besides nonces.

### 7. Time-strips — sell the front of the stream, keep the back

Linear vesting makes a stream sliceable by time: "the cashflow from now to T₁" is a deterministic amount, and so is "T₁ to maturity." The escrow contract (already the NFT owner, already harvesting) can enforce a **priority waterfall**: lender A funds against the first slice at a short-duration APR, lender B against the next, the borrower keeps the tail — each harvest pays the most-senior unfilled slice first. No Sablier changes; it's pure accounting on harvested funds. This creates something none of the other designs have: a **term structure**. A lender who only wants 30-day exposure can buy the front strip of a 90-day stream and be fully paid out by a date known at origination; short-duration strips should clear at lower APRs than the tail, and the protocol starts printing a yield curve instead of a single rate.
**Prior art:** Treasury STRIPS, CLO time tranches, coupon stripping. **Distance:** moderate — the waterfall replaces per-loan flat pro-rata in `_claimFair` for strip loans; pricing per slice is `StreamPricing` with slice-specific `ttm`.

### 8. Open-end floating-rate facility — the money-market shape

Drop matching and rate negotiation entirely. Lender side: one ERC-4626 vault per market — deposit and withdraw underlying anytime, share price accrues. Borrower side: a credit line — deposit stream(s), draw up to a cap, accrue interest at a **utilization-curve rate** (Compound/Aave shape). Determinism removes the machinery those protocols need: no liquidations, no oracles, no bad debt. The one real design constraint is that a floating obligation must never outgrow the collateral — so the draw cap prices in max-rate accrual to maturity (`cap = grossPrice(remaining, aprMax, ttm)`), and accrual hard-stops at `remaining`; worst case the facility harvests the stream to maturity and is made exactly whole. This is Alchemix's self-repaying loan — OVRFLO's closest spiritual cousin — but with *deterministic* repayment instead of variable yield.
**Prior art:** Aave/Compound (mechanics), Alchemix (product shape), Maker D3M (rate policy). **Distance:** a new sibling contract; gives up limit-order price discovery for always-on convenience — plausibly the mass-market front door while designs 1/2/5 remain the pro venue.

### 9. Flow swap — fund a stream with a counter-stream

Instead of a lump sum, the lender funds the borrower with a *stream of underlying* (a new Sablier stream, or internal drip accounting) while the collateral stream's vesting flows to the lender — two deterministic legs exchanged at a spread, which *is* the APR. Since both legs are fully determined, the contract can net them and move only the difference. This changes the payment shape rather than the matching: borrowers who want income smoothing take a counter-stream; lenders ladder in rather than deploying at once. It's honestly the weakest general-purpose fit — most borrowers against a stream want cash now — but it's the seed of a genuine **rate-swap market** (fixed-vs-floating on stream value, calendar spreads between maturities) if OVRFLO ever wants derivatives on its own curve, and it composes with design 2 as an alternative payout mode for a funded listing.
**Prior art:** interest-rate swaps, Superfluid flow agreements, Voltz/IPOR. **Distance:** large relative to its near-term value; note it and shelve it.

### 10. Protocol-owned desk — bonding-curve pools for stream NFTs

Streams are NFTs and `StreamPricing` is a closed-form price for any of them — which is exactly the setup for Sudoswap-style pools: a treasury-funded desk quotes a standing **bid APR** (it buys/lends against any eligible stream instantly) and an **ask APR** (it re-sells inventory), with the spread as revenue and quotes bounded by the multisig's `aprMin/aprMax`. Users get guaranteed instant liquidity with zero waiting for a match; arbitrageurs trading against the desk's quotes bootstrap price discovery before organic depth exists. The unusual part: desk inventory is *riskless to maturity* — a bought stream cannot underperform — so the only cost of making markets is duration (capital locked until maturity), not credit. That makes this one of the safest protocol-owned-liquidity designs possible, and a natural companion to any other design during the cold-start phase.
**Prior art:** Sudoswap/NFTX (mechanism), Olympus POL (funding model), every OTC desk (economics). **Distance:** small contract, but a treasury capital-allocation decision more than an engineering one.

---

## Comparison

| # | Design | Matching | APR discovery | LP capital while waiting | Distance from current code |
|---|--------|----------|---------------|--------------------------|---------------------------|
| 1 | Tick-queue order book | book, price-time | limit orders | locked | moderate |
| 2 | Stream-first rounds | resting listings | both sides quote | locked per fill | small-moderate |
| 3 | Closed-end Pool | none (bucket) | epoch-set / imported | pooled | new sibling contract |
| 4 | zc tokens + AMM | AMM | continuous curve | AMM LP, earns fees | large |
| 5 | Batch auction | periodic clearing | uniform clearing price | escrowed per batch | moderate |
| 6 | Signed-order RFQ | signatures | quoted offers | **stays in wallet** | small |
| 7 | Time-strips | any of the above | per-duration (curve!) | locked per slice | moderate |
| 8 | Floating facility | none | utilization curve | pooled, instant exit | new sibling contract |
| 9 | Flow swap | bilateral | spread between legs | streams in gradually | large |
| 10 | Protocol desk | quote-driven | desk spread | treasury inventory | small |

## How they compose

These aren't ten rivals; they're mostly three layers that can coexist over the same `StreamPricing` core and the same escrow/eligibility machinery:

- **A matching venue** (1+2 as the symmetric book, or 5 as the auction, or 6 as the serverless cheap version) — the active market that discovers the rate.
- **A passive wrapper** (3 closed-end or 8 open-end) — consumes the discovered rate, gives lenders a no-decisions product.
- **Liquidity backstops and instruments** (10 for cold start; 7 for a yield curve; 4 as the long-term end-state that eventually absorbs the venue's job entirely; 9 shelved until derivatives matter).

The near-term standout is **1+2 together** — it is literally the "stream on one side, LPs on the other, whoever is locked in first gets filled by the other side" market, it kills the collision problem structurally, and it's the smallest step that adds a genuinely new capability (borrower-side quoting) rather than repairing the current one.

---

## Addendum (2026-08-04): exploration outcomes + Morpho Midnight prior art

Session decisions: **design 8 rejected** (floating return kills the fixed-amount-fixed-date lender pitch — "not Aave with streams"). **Design 4 (zc) favored**, framed as self-repaying loans; venue = bid-side-only APR-quoted book at fixed ticks (today's `supplyLiquidity` shape aimed at a fungible token), full 1&2 symmetry optional later. Interim collision fix for the current market: skip-empty fill semantics + submit-time `gatherLiquidity`.

**Morpho Midnight** (whitepaper May 2026, launched on Base 2026-07-21) independently shipped the same thesis: fixed-rate fixed-term lending as tradable zero-coupon units in isolated per-maturity markets, rates purely from maker/taker offer trading (no utilization curve), signed offers that don't lock capital settled by a ratifier, positions fungible by maturity, early exit by trading back. Identical instrument shape to zc; their offer layer ≈ our design 6.

**Structural difference in OVRFLO's favor:** Midnight's borrowers carry live debt against volatile third-asset collateral (cbBTC vs USDC), so they need debt units, per-collateral oracles, LLTV, health-factor liquidations (restorative close-out), and bad-debt booking. OVRFLO's zc "borrower" fully collateralizes at mint — the escrowed stream vests the same asset the zc redeems — so debt units, oracles, LLTV, liquidations, and default states do not exist; solvency reduces to one conservation invariant (`zc.totalSupply == Σ remaining + harvested`). One-liner: *zc is Midnight's lender product with the borrower risk machinery deleted.*

**License note:** morpho-org/midnight core is BUSL-1.1; `src/interfaces`, `src/libraries`, `src/ratifiers`, `src/periphery`, `test`, `certora` are GPL-2.0-or-later. OVRFLO is MIT — neither BUSL nor GPL code can be adapted without changing OVRFLO's licensing. Whitepaper + Certora property lists are fair to study as design references.

## Addendum (2026-08-05): v1-lite scope + on-chain CLOB techniques survey

Session decisions: **v1-lite** = strip buy/sale paths entirely (`sellStreamToLiquidity`, `postSaleListing`, `cancelSaleListing`, `buyListing` deleted — a max borrow is economically identical to a sale since `obligationForFill` fast-paths full-borrow to `remaining`). Lenders post at fixed APR ticks; borrowers assemble against streams. Fixed tick spacing (Jay's call: simpler math, smaller attack surface). zc deferred on legal-risk posture while Morpho absorbs the instrument class's regulatory first-mover risk; revisit as environment clarifies.

**Discovery stack settled:** market bitmap (1 word, absolute-indexed ticks) → exact `tickDepth` per tick → per-tick packed depth words (quantized per-slot amounts, round-DOWN so encoded ≤ actual; zero = dead; field order = FIFO) → position structs (exact, touched only on consumption). Selection on encoded floors can only over-select, never under-fill. Reject Fenwick/prefix-sum trees for the base: they optimize free reads with costly writes.

**CLOB survey (for the loan book as an order book):**
- **Clober LOBSTER — claim ranges + cumulative fill counter** (ethresear.ch): each maker order gets interval `[a,b)` in the level's cumulative-quantity space; level tracks total-filled `T`; maker's filled amount = `min(max(0, T−a), b−a)`. Takers never iterate makers — fills are O(1) writes regardless of orders crossed; attribution computed lazily at claim time. Maps to v1-lite: loan stores its consumed interval, `loanPoolContributions` becomes O(1) overlap math. **Requires** a prefix-sum structure (their segmented segment tree: 4 nodes/slot, height 4, ~4 SSTOREs/update) to keep intervals valid under cancellation/withdrawal.
- **Segmented segment tree**: packed-slot tree making order-size prefix sums O(log) with cancellation support. Reimplement from the ethresear.ch publication if adopted (do not copy Clober code without a license check).
- **Octopus heap** (price discovery across gaps): NOT needed — fixed one-word tick space already solves what it solves.
- **Quote-unit size quantization** (Clober packs order sizes as 64-bit linear units): validates the packed-depth-word approach; linear 64-bit (4/word, near-exact) vs minifloat 16-bit (16/word, ~0.05% floor) is a density-vs-precision knob.
- **Econia (Aptos) AVL-queue**: tree-of-levels + FIFO lists + tail eviction; superseded by fixed ticks; eviction irrelevant given `MIN_LIQUIDITY_AMOUNT`. Project unmaintained.
- **Off-chain matching family** (dYdX v4, Hyperliquid, RFQ books): not applicable — v1-lite is fully on-chain by design.

**Decision (2026-08-05): build B directly for launch** — greenfield, no sunk cost (Jay). Claim ranges + per-tick cumulative fill counter + segmented segment tree. Key consequence: `createBorrowerLoanPool` loses its `liquidityIds[]` parameter entirely — fills are blind (one counter bump), so client-side ID selection, and with it the original collision problem, is deleted from v1 itself. OVRFLO's variant is simpler than Clober's because fill coordinates below the counter are frozen forever (lenders never exit filled contributions — they're locked in loans), so no claim-deflation bookkeeping is needed; the tree is touched only on post and cancel. Self-match prevention (pattern #4) becomes impractical at fill time (fills don't enumerate positions) — accepted per the L-12 rejected-finding reasoning (self-consumption is economically self-neutral minus fee). **Repay-at-face is a design invariant, not a naive implementation** (Jay, 2026-08-05): discounted/PV early repayment would hand lenders less than their promised fixed amount and inject reinvestment risk — breaking the product's core promise — while face repayment delivers the same amount sooner (lender weakly better than promised). Rationally repay is never used (costs `O − O/f ≥ 0` vs letting the collateral pay); it exists as exit optionality and borrower comfort. Do not "optimize" it into PV repayment. Packed depth words (former package A's layer 1) retire; the tree's stored sums are the middle cache layer and `root − filled` IS tick depth. Full mechanism spec: see session 2026-08-05 walkthrough (claim ranges, frozen-history lemma, unit quantization, epoch rollover).
