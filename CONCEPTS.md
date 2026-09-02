# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all. The column tower and hop table live in `docs/agents/system.md`.

## OVRFLO core

### Column

One underlying plus the vault, receipt token, wrap reserve, lending market, and (after CS3) request book that serve it. The factory admits at most one column per underlying.

ovrfloToken, streams, loans, and supply positions of that column belong to that underlying only. A USD quote for that column keys by `vault.underlying()`. Never apply another column's quote, backing, or lending book. A later underlying is a new column with its own reviewed recipe row.

### Denomination

Column identity is the underlying (`vault.underlying()`). After CS1, streams, loans, lender supply, borrower proceeds, and the deposit fee are ovrfloToken. Wrap and unwrap stay 1:1 underlying ↔ ovrfloToken on `OVRFLOReserve`.

### Factory

The registry and admin hub that verifies and registers externally deployed OVRFLO vaults and OVRFLOLendings, and serves as the single governance entry point for every contract it registers.

The factory is owned by a timelocked multisig and is the permanent admin on every registered vault and the owner of every registered lending. All admin actions flow multisig -> factory -> vault or lending; no dependent contract is administered directly. A factory ownership transfer moves governance for all vaults and lending markets atomically. The factory contains no child deployment code — children are constructed externally and admitted through Registration — and one vault per underlying is enforced at registration.

### OVRFLO vault

The protocol vault for a single underlying asset that accepts supported Pendle principal-token positions and manages the corresponding fungible OVRFLO receipt token.

An OVRFLO vault has two backing sources for the same receipt token: matured principal-token claims and underlying wrap reserves. These backing sources must remain separately accounted even though the receipt token is fungible. Wrap reserves live on `OVRFLOReserve`. The vault holds PT backing and holds no underlying.

### OVRFLOReserve

The wrap-reserve contract for one column. The vault constructs it. It constructs the column's ovrfloToken. It holds the underlying that backs 1:1 wrap and unwrap. Admin is the factory. `wrappedUnderlying` is the tracked unwrap bound. Direct transfers do not increase that counter. Excess underlying above the counter can be swept. ERC-3156 flash mint of ovrfloToken is a later unit (CS2) and is not live in `src/` yet.

### Combined solvency

The real solvency condition for a column, pinned in KD13: `ovrfloToken.totalSupply() <= Σ_pt.balanceOf(vault) + underlying.balanceOf(reserve)`. The PT term sums the vault's PT balance across **every approved series**, not one market's PT. Per-origin equality also holds: `totalSupply == Σ marketTotalDeposited + reserve.wrappedUnderlying`. Individual checks (`wrappedUnderlying <= underlying.balanceOf(reserve)`, `marketTotalDeposited <= ptToken.balanceOf`) are sufficient but not necessary — they hold pre-maturity (claim is blocked, no cross-exit possible) but can break post-maturity when ovrfloToken fungibility allows cross-exits. Ticket 06 re-derives the invariant suite; until then treat these identities as pinned, not as re-derived.

### Three labeled exits

Every ovrfloToken holder can leave through one of three labeled exits, subject to that exit's backing:

1. **Unwrap** — burn ovrfloToken on `OVRFLOReserve` for underlying 1:1, bounded by `wrappedUnderlying`.
2. **Claim** — burn ovrfloToken on the vault for PT 1:1 after series maturity, bounded by `marketTotalDeposited`.
3. **DEX** — sell ovrfloToken on an external market. No protocol backing check.

As long as combined solvency holds, every holder can exit through some path.

### ovrfloToken

The fungible receipt token for one column. The vault mints it on deposit and burns it on claim. The reserve mints it on wrap and burns it on unwrap. A holder has a one-to-one claim on supported exits for that column's underlying.

ovrfloToken is intentionally fungible across holder origins and supported market series for the same underlying asset. The holder's acquisition path does not restrict whether they can use a supported exit; availability is constrained by that exit's backing pool.

### Principal Token

A Pendle token representing the principal component of a yield-bearing position that converges to redemption at maturity.

OVRFLO treats Principal Tokens as the backing asset for the post-maturity claim path. Principal-token accounting is separate from underlying reserve accounting.

### Underlying asset

The base asset associated with an OVRFLO vault and its receipt token. It is the column's identity.

Underlying assets back the wrap/unwrap path directly on `OVRFLOReserve`. The deposit fee is ovrfloToken from the mint split. Underlying held as wrap reserve is not interchangeable with Principal Tokens in accounting, even when both are economically one-to-one at maturity.

## OVRFLO processes

### Registration

The owner-only act by which an externally deployed vault or lending is verified and admitted into the Factory's registry, becoming the system's trusted instance for its underlying.

Registration verifies on-chain every binding the candidate's constructor fixed — admin wiring, oracle, ownership, Sablier binding, one vault per underlying — but not code identity, which the multisig verifies off-chain against the audited build's creation code before registering. An unregistered candidate is inert with respect to the protocol: the admin actions that would activate it (series approval, tick spacing) flow only through the Factory's forwarders, which refuse unknown contracts. A vault must be registered before its lending can be constructed at all.

### PT deposit

The process where a user contributes Pendle principal tokens before maturity and receives OVRFLO receipt-token value immediately plus streamed discount value over time.

PT deposits increase principal-token backing and do not create underlying wrap reserve.

### Claim

The post-maturity exit where an OVRFLO receipt-token holder burns receipt tokens to receive Principal Tokens.

Claim capacity is bounded by principal-token backing, not by underlying reserves.

### Wrap

The permissionless process where a user contributes underlying asset to `OVRFLOReserve` and receives OVRFLO receipt tokens one-to-one without a stream or fee.

Wrap increases the underlying reserve by the same amount of receipt tokens minted.

### Unwrap

The permissionless process where a receipt-token holder burns OVRFLO receipt tokens on `OVRFLOReserve` to receive underlying asset one-to-one.

Unwrap capacity is bounded by underlying reserve on `OVRFLOReserve`, not by the vault's token balance or by principal-token backing.

### Wrap reserve

The tracked amount of underlying asset that backs the unwrap path. The counter lives on `OVRFLOReserve` as `wrappedUnderlying`.

Direct token transfers or donations do not increase the wrap reserve. Excess underlying above the tracked reserve can be recovered without reducing unwrap capacity.

### USD display

A per-column overlay. The Markets app shows amounts in USD by default when that column's Chainlink recipe is live. The customer can switch to token units. USD never enters calldata. A missing or stale recipe hides USD for that column only. Token-native submit still works. Never reuse another column's quote.

### Flash mint

An atomic ERC-3156 mint of ovrfloToken from `OVRFLOReserve`, repaid in the same transaction. Later unit (CS2). Not live in `src/` yet. The economic cap is a factory-set per-call `flashMintMax`. Wrap and unwrap stay callable in the callback. Net `totalSupply` does not change.

### Request book

A thin router that escrows an OVRFLO Stream until lending depth can fill a borrow for the human owner. Later unit (CS3). Not live in `src/` yet. Core `borrow` uses `onBehalfOf`. The book holds no loan-to-borrower table.

### OVRFLO Stream

A per-deposit linear vesting stream used by OVRFLO to deliver the discount between a principal token's current value and its face value over time. OVRFLO mints the non-discounted portion to the depositor immediately as ovrfloToken and streams only the remaining discount, so a stream's face value is that discount — not the deposited principal token amount, which can be far larger.

OVRFLO Streams belong to the PT deposit path. Wrap and unwrap do not create, modify, or settle streams. Each NFT is minted on the bound OVRFLO Streams lockup (deployed ERC721 identity `OVRFLOStream`; Solidity contract `SablierV2LockupLinear`). Historically these NFTs lived on canonical Sablier v1.1 at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`.

### OVRFLO Streams (layer)

The OVRFLO-owned stream layer that replaces the canonical Sablier deployment as the bound address and the wallet identity. Upstream Solidity names stay in both repos (`SablierV2LockupLinear`, `sablierLL`, `ISablierV2LockupLinear`, and the rest). `OVRFLOStream` is the deployed ERC721 `name`/`symbol` only — not a Solidity contract name. The lockup is a GPL fork of Sablier v2-core v1.1.2 with three deployed-logic changes: ERC721 becomes ERC721Enumerable, the NFT descriptor becomes an on-chain ledger card, and `create*` admits only a registered OVRFLO vault (`ovrfloInfo(msg.sender)` treasury != 0). There is no minter slot and no `setMinter`. One lockup serves every registered vault. LockupDynamic stays in the fork tree unrenamed and is never deployed. The v1.1 withdraw ACL is preserved byte-for-byte (plan R3). Protocol fees on the lockup and comptroller are immutable at zero by construction: the factory is admin, `Adminable` is one-step, and the factory forwards only `setNFTDescriptor` (no `transferAdmin` forwarder). Lives in its own GPL repo (`OVRFLO-Streams`); this repo stays MIT and never compiles the fork. In prose: "OVRFLO Streams" (the layer), "OVRFLO Stream" (one stream), `OVRFLOStream` (identifier form). Never write a hyphenated or all-caps variant. See `docs/plans/2026-08-13-001-feat-ovrflo-streams-plan.md`.

### Ledger card

The OVRFLO Stream NFT's on-chain SVG direction: a data-dense card with a segmented progress bar and typographic rows (streamed %, streamed/remaining amounts, rate, end date, asset, status) — no pictorial motif. Chosen over dot-ribbon, progress-arc, and overflow-vessel directions. In the watch surface it renders as a selected stream's detail view; list rows keep the dot-ribbon idiom.

## OVRFLOLending (superseded — see "OVRFLOLending v1-lite" below)

**Superseded 2026-08 by the v1-lite tick order book** (`docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`). The entries in this section describe the pre-rewrite contract (liquidity positions, sale listings, and pooled loan-pool batching) and are kept for history — none of `sellStreamToLiquidity`, `postSaleListing`, `cancelSaleListing`, `buyListing`, `createBorrowerLoanPool`, or `claimLoanPoolShare` exist in the shipped contract. See "OVRFLOLending v1-lite" for the current vocabulary.

### LiquidityPosition

**Superseded** — replaced by Position (see "OVRFLOLending v1-lite" below); the sale/loan duality this entry describes no longer exists (loan-only market).

A standing order in the OVRFLOLending secondary market where a lender posts underlying liquidity at a discount rate (APR), not bound to a specific stream, consumable by any eligible stream from a chosen market. An liquidity can be consumed as a sale (stream transfers permanently to the lender via `sellStreamToLiquidity`) or as a loan (stream pledged with obligation via `createBorrowerLoanPool`); the lender cannot restrict which.

LiquidityPositions carry no stream at creation, so they front-load only market-level validation (market approved, series approved, not matured); full stream eligibility is checked per-fill.

### Listing

**Superseded** — deleted with no replacement; a full borrow is now economically a sale (obligation caps at the stream's remaining value), so a separate sale-listing mechanism is redundant.

A sell-side order in the OVRFLOLending secondary market where a lender escrows a specific Sablier stream, priced at a discount rate until the series maturity.

Listings bind a stream at creation and run full stream eligibility validation at post time.

### Loan

**Amended for v1-lite:** origination is no longer a `createBorrowerLoanPool` batch across LiquidityPositions — a loan now originates from a single `borrow()` blind fill against one APR tick (see "Blind fill" below), and the lender side is one or more Positions attributed lazily by interval overlap rather than a pool of address-keyed contributions. The paragraphs below (obligation semantics, recovery cap, re-pledging) remain accurate.

A borrow in the OVRFLOLending backed by a pledged Sablier stream, where the obligation is denominated in the stream's payout asset (ovrfloToken) and the lender recovers by drawing from the stream or by direct repayment.

Total lender recovery is capped at the obligation; the pledged stream is returned to the borrower once the loan closes. A returned stream can be re-pledged to a new loan — the stream's cumulative withdrawn amount spans all loans that have used it, not just the most recent.

A loan's obligation size depends on how much of the pledged stream's discounted price is borrowed: borrowing the stream's entire discounted price sets the obligation to the stream's full remaining value; borrowing any smaller amount scales the obligation to roughly that amount (rounded slightly in the lender's favor) instead. Borrowing the full discounted price is a distinct case, not just the top of a continuous scale — a caller that intends a small, partial borrow must request strictly less than the stream's full discounted price, or it silently becomes a full borrow with a much larger obligation.

### Self-repaying loan

A loan against a pledged Sablier stream where the stream's deterministic payouts repay the lender without liquidations or health checks. The stream is non-cancelable and pays a fixed asset on a fixed schedule, so it cannot underperform; the lender draws accrued value until the obligation is satisfied, then the residual stream returns to the borrower.

Unchanged by the v1-lite rewrite — this concept-level definition applies to loans originated either the old (pool) or current (blind-fill) way.

### Pool

**Superseded** — deleted; lender attribution across a shared borrow is now lazy interval-overlap over a tick's tape (see "Blind fill" and "Frozen history" below), not an explicit batch/pool struct. `claimLoanPoolShare` is replaced by `claim(loanId, positionId, amount)`.

The only lending mechanism in the OVRFLOLending: an atomic batch primitive where a borrower aggregates multiple liquidityPositions into a single transaction. A borrower pool (`createBorrowerLoanPool`) batches borrows across multiple liquidityPositions; the borrower is the only pooling actor. The pool is the virtual lender on its loan (the lending contract itself holds the lender role, since each pool has exactly one loan and they share a single ID space). Each pool has exactly one loan. Claims are address-based (no NFTs): lenders claim pro-rata proceeds via `claimLoanPoolShare`, which works for both open and closed loans. Claimable amount is the lender's pro-rata share of total recovery (drawn plus repaid, plus stream withdrawable for open loans) minus cumulative prior receipts, ensuring order-independent fairness.

### OVRFLO cycle

The composition of PT deposit, lending, and unwrap or swap that lets the PT discount -- fixed at deposit -- overflow into extractable value. A depositor receives immediate ovrfloToken (principal at TWAP value) plus a Sablier stream (the yield). Borrowing the stream's full discounted price on the lending (economically a sale — see "Loan" above) and exiting the immediate portion via unwrap or a swap pool converts both legs toward underlying, capturing the fixed yield. Executable today with held PT, or zero capital via an underlying flash loan from an external provider (swap for PT on the Pendle AMM, run the cycle, repay in underlying). PT flash from the OVRFLO vault is removed. The protocol remains solvent throughout: the deposit adds PT backing, the unwrap (if used) consumes wrap-reserve backing on `OVRFLOReserve`, and every participant is economically whole. See `README.md` "What's Fixed Will OVRFLO" for the full example.

### PT flash loan

**Removed (CS1).** The vault no longer lends deposited PT. Historical EIP-4531 `OVRFLO.flashLoan` is gone. Do not describe PT flash as a live vault facility. ERC-3156 flash mint of ovrfloToken on `OVRFLOReserve` is a later unit (see "Flash mint").

## OVRFLOLending v1-lite

Current vocabulary for the loan-only, fixed-rate tick order book shipped per `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md` — this is the live `OVRFLOLending` contract. The "OVRFLOLending" section above describes the pre-rewrite contract it replaced.

### Position

A lender's permanent coordinate in one tick epoch's tape, created by `supply(market, aprBps, amount)`. Replaces LiquidityPosition: a Position is not itself consumable as a sale or a loan — it is a claim on a contiguous tape interval that `borrow()` fills blindly (see "Blind fill") and that later loans' `contributionOf`/`claim` attribute against by interval overlap (see "Frozen history"). Never restricted to one loan; one Position can contribute to many loans, and one loan can draw from many Positions, with no stored link between them.

### Claimed

The OVRFLOLending payout event for one position against one loan. Confirmed watch RECEIVED is the sum of those amounts on the receipt. It is not the vault Claim of Principal Tokens after maturity.

Pre-tx claimable is a forecast. Confirmed RECEIVED is the event amount. Missing evidence is CHECKING…, not a paid zero.

### Tick

A fixed APR price level in a lending market's order book, at a per-market spacing set once via the factory's `setLendingTickSpacing` forwarder (a separate admin action from series approval; no default is enforced on-chain — the plan's stated per-market default is 25 bps). Lenders rest capital at a tick; every fill at a tick executes at the tick's deterministic price (`1/factor(aprBps, ttm)`), so bidders at one tick get identical terms and ordering carries no adverse selection.

### Tape

A tick's append-only cumulative-quantity space. Every supplied position occupies the next contiguous interval; a monotone `filled` counter records consumption sweeping left to right, which makes FIFO a property of the geometry rather than queue machinery. Available depth is the identity `root − filled`, never stored state.

### Blind fill

A borrow that consumes tick liquidity by advancing the tape's `filled` counter without reading, naming, or enumerating any lender position. "Blind" refers to lender identities, not the collateral — the borrower's own pledged stream is fully specified. Blind fills make fill gas flat in the number of positions crossed and delete client-side ID selection (and with it, the duplicate-ID collision problem).

### Frozen history

The safety property that no cancellation can ever alter any tape coordinate below `filled`: cancellations remove only unfilled spans, which always lie at-or-above the counter, so loan intervals — which live entirely below it — are immutable forever. This is what makes lazily computed interval-overlap attribution exact at any later time. Lender contributions to a loan are derived as the overlap of the position's interval with the loan's frozen interval, never stored at fill time.

### Epoch (lending)

One generation of a tick's bookkeeping — one segment tree, one `filled` counter, one coordinate space. Not a time period. When a tick's tree reaches its height cap, the tick rolls to a new epoch for new posts while fills drain older epochs first via a cursor; old epochs are never migrated, only settled. Sized to be a backstop, expected never to fire organically.

### UNIT

The book's quantization granule (1e12 wei ≈ one-millionth of an 18-decimal token). All supply, fill, and depth quantities are exact UNIT multiples, enforced at the boundary, which makes book arithmetic exact (no rounding exists inside the book) and lets tree nodes be 64-bit values packed four per storage slot. Series onboarding must verify the underlying's total supply is at most `2^54 × UNIT` (the bound documented at `OVRFLOFactory.setLendingTickSpacing`, headroom under the uint64 packed-node ceiling).

## Testing infrastructure

### Live market discovery

The process of selecting which Pendle PT markets to seed on a local Anvil mainnet fork that tracks the live chain head, by querying Pendle's public markets API and filtering for the vault's underlying, a minimum remaining time to expiry, and highest liquidity — rather than hardcoding market addresses that eventually expire relative to wall-clock time.

Used by local bootstrap and E2E arrangement. Distinct from pinned fork fixtures, which freeze a specific market choice into a historical block for deterministic Solidity fork tests.

### Pinned fork fixtures

The shared constants (market addresses, expiries, and fork block) that mainnet fork tests load so every run starts from the same historical chain state. The pin itself does not age with wall-clock time; only the hand-chosen market inside the pin can become irrelevant, which is why refreshing those constants is a deliberate, scripted maintenance step rather than live discovery on every test run.

### Ghost variable

A shadow variable in a fuzz handler that mirrors a piece of protocol state so invariant functions can detect drift between what the protocol recorded and what the fuzzer observed.

Each ghost is updated in the same handler branch that triggers the corresponding state transition. A missing ghost update on one branch causes false-positive invariant violations later (e.g. a re-pledged stream appears still-pledged), which wastes triage time and erodes trust in the suite.

### Fixture-direct arrangement

An E2E arrange step that mutates chain state directly, bypassing the running app's own UI and write flow, for state the connected persona cannot produce by driving the UI itself — most commonly a counterparty's state, such as a different wallet's posted liquidity.

Because the mutation happens outside the app, none of the app's own write-triggered invalidation or refetching fires for it. A later step that depends on the app observing that mutated state must synchronize on an app-observable signal — a full reload, or a UI state that only settles once the app's own prior async effects have finished — rather than on an unrelated step simply having completed. Racing a fixture-direct mutation against the app's in-flight reaction to an earlier UI-driven action can make the wrong side "win," causing the app to discover the mutation through an incidental background effect instead of through the code path the scenario intends to exercise.

When that race makes the scenario's target action unreachable because a client-side validation is correctly and accurately blocking it, the fix belongs in the test's synchronization, not in loosening the validation — a race losing is not evidence the validation itself was wrong, only that the test didn't wait for the app to settle before injecting the mutation. Some state genuinely has no app-observable settle signal to wait for (nothing in the UI changes when the mutation lands); those reads need their own periodic refresh instead, since neither an app write nor a synchronized test step will ever surface the change.

## Web app processes

### Runtime profile

The web app's explicit operating mode: `local` for developer/fork convenience, or `production` for mainnet packaging and runtime. Production fail-closed checks (required anchors, zero-address rejection, verified deployment artifact binding) apply only in production. A deployable production build must refuse to activate the local profile — local relaxations must never ride into a packaged artifact.

### Reviewed action

A user-confirmed write proposal that still must be rebuilt and identity-checked before every wallet prompt and submission. "Reviewed" is a latch, not a capability: chain state and the connected account can move between review and broadcast, so the executor rebuilds the exact calldata and rechecks the latched account/chain before approve or submit. Material drift (including borrow route changes) returns the user to review rather than silently resubmitting. Reviewed numeric bounds (for example a deposit min-to-wallet) are honored across mid-flow block advances while they remain as protective as the fresh floor; outside that window the rebuild forces re-review instead of recomputing silently on every block.

### Clearing Ledger

A superseded visual-world candidate for the Markets app (security-paper white, navy rules, wave-as-O lockup), replaced 2026-08-11 by the Three-Bay Instrument Workbench direction (`docs/plans/2026-08-11-three-bay-instrument-workbench-design-direction.md` and ratifications in `docs/plans/2026-08-11-002-feat-web-v1-lite-frontend-rebuild-plan.md`). Retained as a name so older artifacts stay legible; it is not a live authority.

### Watch surface

The Markets app's home for any connected wallet holding protocol objects: the wallet's entities rendered through a role lens (Supplied / Borrowed / Streams; supplied is the default for dual-role wallets) as a wall of rows, each opening its detail in place. There is no aggregate action strip — actions live on the entities that own them. Its job is trust at natural moments (post-sign, claim-ready, covered, maturity), never engagement-driven retention.

### Wrap shortfall

The repay prepare state when the wallet holds enough underlying to wrap the ovrfloToken gap, but not enough ovrfloToken to repay. REPAY stays disabled. WRAP SHORTFALL is the next write. A wallet that also lacks underlying is not a wrap shortfall.

### Meter wall

The watch surface's landing scan: one row per entity in the active lens, each carrying identity, a human-readable state line, a miniature ribbon, and the role's decisive number (earnings accruing, outstanding shrinking, match state, or vested amount). A resting supply row renders visibly inert — animating it would be dishonest.

### Ribbon

The canonical form for every moving value: a horizontal dot band — dense recorded dots for what has happened, a gold edge marker at now, faint dots for the scheduled future — ending at the entity's terminal date. The borrowed detail leads with the outstanding counting down above its debt ribbon; the supplied detail leads with earnings counting up above its earnings ribbon and a segmented capital band whose fills are divided by hard rules. Supersedes the earlier x/y strip-chart "recorder" treatment.

### Split-truth rendering

The honesty rule for every moving number: schedule truth (Sablier's immutable start/end/deposited) is interpolated client-side per second and stays exact with no RPC; event truth (repay, claim, close, fill) changes only on chain reads and carries visible freshness. Degraded reads keep schedule motion running while the surface marks events as-of; the display never freezes and never pretends.

### Cover date

The computed date a loan's pledged stream covers its outstanding obligation — the answer to "when is this over?", displayed as approximate (`~08 JAN 2027`) because repayments and claims shift it. Deterministic by construction; the one number fear-driven lending apps cannot show.

Borrowed detail always shows DONE DATE. Missing schedule is CHECKING…. An uncovered loan is UNCOVERED. The label stays while the value hydrates.

### Claim-all

Historical name for a retired global CLAIM ALL queue on the old position summary strip. v1-lite has no cross-position claim.

Claim is per supplied position, in place on that row's watch detail. The write is `claim(loanId, positionId, type(uint128).max)` for each of that position's `loansOf` pairs with nonzero claimable — a single pair is one `claim` call; several pairs go through `multicall`, capped at 32 named pairs per submission. The `uint128` max is a sentinel (claim whatever is claimable), not an amount the user types. There is no global queue, no stream-withdrawal step inside claim, and no resume-over-confirmed-ids planner.

### Loan book

The client-side enumeration of one connected user's v1-lite book against one OVRFLOLending market. It is not an on-chain object and it is not a merged `useLoanBook`.

The lender lens is `useLenderBook` (`web/hooks/useLenderBook.ts`): `lenderPositionCount` / `lenderPositionAt`, then a batched `positionState` read, then paginated `loansOf` per position. The borrower lens is `useBorrowerBook` (`web/hooks/useBorrowerBook.ts`): `borrowerLoanCount` / `borrowerLoanAt`, then a batched `loanState` read. There is no `loanPools` field and no shared id-space multicall over pools.

Both hooks cap enumeration at `MAX_ENUMERATION_IDS` (500). Over-budget is the *tooLarge* case: the read fails closed as unavailable rather than silently truncating. That is distinct from *confirmed-empty* (count is 0 and the outcome is ready with an empty list) and from *unavailable* (transport or incomplete subcall). Zero-count lenses are hidden on the watch wall; unavailable lenses stay visible in a degraded state.

### Ponder

Historical name for an off-chain indexer the frontend once queried for held-stream discovery and a borrow-demand ladder. It is not a live authority.

Discovery today is Enumerable holder lists on the bound lockup. See Stream discovery.

### Stream discovery

Finding which streams a connected wallet holds. Markets reads the lockup holder list onchain: `balanceOf`, then `tokensOfOwnerIn`, then hydrates each id with `ownerOf`, `getStream`, `withdrawableAmountOf`, and `statusOf`. Every displayed or actionable fact is a contract read. A stream whose owner is not the connected address is dropped.

Results are three-valued: streams, no streams, and unavailable. Unavailable must never paint as empty. Zero `balanceOf` is confirmed-empty. A positive balance with no ids, an over-budget list, or a failed read is unavailable.

A pledged stream leaves this list when the market owns the NFT. It appears on Borrowed as a loan. Streams does not copy open loans back onto the wall.

Shipped discovery is Enumerable. Log-scan is not live. There is no log-scan fallback.

### Position groups

Historical name for the old market-row split LENDING / BORROWING / STREAMS inside an expanded table row.

The watch wall uses role lenses instead: Supplied, Borrowed, and Streams. Dual-role wallets default to Supplied. Zero-count lenses are hidden; an unavailable or still-pending Streams discovery keeps the Streams lens visible in its degraded state rather than asserting emptiness. Selecting a row opens that entity's detail in place. Actions live on the entity (CLAIM / WITHDRAW on a supplied position, REPAY / CLOSE on a loan, borrow route on an eligible stream).

### Signing block

The named reason that disables every wallet broadcast on a review — both the token or stream approve and the action — when the chain is wrong, event truth is stale, or the quoted fill has already drifted.

A signing block is a pre-prompt gate. It is not the same as stale-recovery classification, which sorts a write that already failed. The reason occupies the disabled approve or action slot. A silent no-op behind an armed button is not a signing block. Wrong-chain may also keep a live switch control above that disabled slot.

### Stale-recovery classification

The three-way sorting of a failed write transaction that decides what the form offers next: *stale* (on-chain liquidity or pricing moved between quoting and signing — refresh every on-chain read, show a "here's the new number" banner, and offer one explicit re-confirm), *terminal* (the input can never succeed, such as an ineligible stream or self-match — disable the action and say why, never invite a retry), or *retryable* (wallet rejection or transport failure — leave the action live).

Classification is per flow, not global: the same revert can be terminal in one flow and stale in another (an ERC20 shortfall is a liquidity race inside a withdraw-then-supply multicall). A stale outcome is never presented as a dead-end error. Pre-submit rebuild failures that only carry structured `errors` must still be surfaced as a single consumer-visible error so this classification can run — an `invalid` result that hides its payload dead-ends the recovery path.

This classification only covers failures that populate the transaction's error signal (wallet rejection, transport failure, a revert caught before broadcast, or a synthesized rebuild error). A transaction that mines but reverts on-chain populates no error at all and is surfaced as its own distinct failure state outside this three-way sort — the per-position claim write (see Claim-all) and the other in-place watch writes render that as a reverted action receipt, not as a queue skip.

## Refactoring patterns

### Vestigial state

Correct but redundant protocol state that duplicates information recoverable from other on-chain sources. Common forms in OVRFLO: duplicate ID spaces with translation maps (loan vs loan-pool), derived booleans that mirror a quantitative check (`active` vs `availableLiquidity > 0`), dual registries that duplicate a sentinel (`approved` vs `ptToken != address(0)`), and hand-rolled wrapper getters that re-shape data the compiler's auto-getters already expose. Vestigial state is not a bug, but it is attack surface, gas cost, and cognitive load. Deleting it is a behavior-preserving refactor: prove no consumer depends on the redundant field (grep-verified across `src/` and `test/`), delete the declaration, then mechanically update all destructures and call sites. See `docs/solutions/architecture-patterns/behavior-preserving-simplification-refactor.md`.

## Flagged ambiguities

- "Claim" is the vault Principal Token exit after maturity. "Claimed" is the lending payout event. They are distinct.
