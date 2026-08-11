# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## OVRFLO core

### Factory

The registry and admin hub that verifies and registers externally deployed OVRFLO vaults and OVRFLOLendings, and serves as the single governance entry point for every contract it registers.

The factory is owned by a timelocked multisig and is the permanent admin on every registered vault and the owner of every registered lending. All admin actions flow multisig -> factory -> vault or lending; no dependent contract is administered directly. A factory ownership transfer moves governance for all vaults and lending markets atomically. The factory contains no child deployment code — children are constructed externally and admitted through Registration — and one vault per underlying is enforced at registration.

### OVRFLO vault

The protocol vault for a single underlying asset that accepts supported Pendle principal-token positions and manages the corresponding fungible OVRFLO receipt token.

An OVRFLO vault has two backing sources for the same receipt token: matured principal-token claims and underlying wrap reserves. These backing sources must remain separately accounted even though the receipt token is fungible.

### Combined solvency

The real solvency condition for an OVRFLO vault: `ovrfloToken.totalSupply() <= underlying.balanceOf(vault) + ptToken.balanceOf(vault)`. Individual checks (`wrappedUnderlying <= underlying.balanceOf`, `marketTotalDeposited <= ptToken.balanceOf`) are sufficient but not necessary — they hold pre-maturity (claim is blocked, no cross-exit possible) but can break post-maturity when ovrfloToken fungibility allows cross-exits. As long as the combined invariant holds, every holder can exit through some path (unwrap, claim, or DEX). Established during the 2026-07-01 fuzz campaign (GL-02, GL-55, GL-56).

### ovrfloToken

The fungible receipt token minted by an OVRFLO vault to represent a one-to-one claim on supported exits for the vault's underlying asset.

ovrfloToken is intentionally fungible across holder origins and supported market series for the same underlying asset. The holder's acquisition path does not restrict whether they can use a supported exit; availability is constrained by that exit's backing pool.

### Principal Token

A Pendle token representing the principal component of a yield-bearing position that converges to redemption at maturity.

OVRFLO treats Principal Tokens as the backing asset for the post-maturity claim path. Principal-token accounting is separate from underlying reserve accounting.

### Underlying asset

The base asset associated with an OVRFLO vault and its receipt token.

Underlying assets back the wrap/unwrap path directly and are also used for fee payment in deposit flows. Underlying held as wrap reserve is not interchangeable with Principal Tokens in accounting, even when both are economically one-to-one at maturity.

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

The permissionless process where a user contributes underlying asset and receives OVRFLO receipt tokens one-to-one without a stream or fee.

Wrap increases the underlying reserve by the same amount of receipt tokens minted.

### Unwrap

The permissionless process where a receipt-token holder burns OVRFLO receipt tokens to receive underlying asset one-to-one.

Unwrap capacity is bounded by underlying reserve, not by the vault's raw underlying token balance or by principal-token backing.

### Wrap reserve

The tracked amount of underlying asset that backs the unwrap path.

Direct token transfers or donations to the vault do not increase the wrap reserve. Excess underlying above the tracked reserve can be recovered without reducing unwrap capacity.

### Sablier stream

A per-deposit linear vesting stream used by OVRFLO to deliver the discount between a principal token's current value and its face value over time. OVRFLO mints the non-discounted portion to the depositor immediately as ovrfloToken and streams only the remaining discount, so a stream's face value is that discount — not the deposited principal token amount, which can be far larger.

Sablier streams belong to the PT deposit path. Wrap and unwrap do not create, modify, or settle streams.

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

The composition of PT deposit, lending, and unwrap or swap that lets the PT discount -- fixed at deposit -- overflow into extractable value. A depositor receives immediate ovrfloToken (principal at TWAP value) plus a Sablier stream (the yield). Borrowing the stream's full discounted price on the lending (economically a sale — see "Loan" above) and exiting the immediate portion via unwrap or a swap pool converts both legs to underlying, capturing the fixed yield. Executable today with held PT, zero capital via an underlying flash loan from an external provider (swap for PT on the Pendle AMM, run the cycle, repay in underlying), or zero capital via a PT flash loan from OVRFLO itself (run the cycle, buy PT on the Pendle AMM for repayment). The protocol remains solvent throughout: the deposit adds PT backing, the unwrap (if used) consumes wrap-reserve backing, and every participant is economically whole. See `README.md` "What's Fixed Will OVRFLO" for the full example.

### PT flash loan

An atomic loan of deposited PT from the OVRFLO vault, repaid via safeTransferFrom within the same transaction. The borrower implements an EIP-4531 callback that receives PT, executes logic (typically the OVRFLO cycle), and returns PT plus an oracle-adjusted fee in underlying. The fee routes to the treasury, which wraps it to fund the wrap reserve. Capped by marketTotalDeposited, gated pre-maturity, and globally pausable by the multisig. No nonReentrant modifier is applied because the borrower must deposit during the callback to run the cycle.

## OVRFLOLending v1-lite

Current vocabulary for the loan-only, fixed-rate tick order book shipped per `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md` — this is the live `OVRFLOLending` contract. The "OVRFLOLending" section above describes the pre-rewrite contract it replaced.

### Position

A lender's permanent coordinate in one tick epoch's tape, created by `supply(market, aprBps, amount)`. Replaces LiquidityPosition: a Position is not itself consumable as a sale or a loan — it is a claim on a contiguous tape interval that `borrow()` fills blindly (see "Blind fill") and that later loans' `contributionOf`/`claim` attribute against by interval overlap (see "Frozen history"). Never restricted to one loan; one Position can contribute to many loans, and one loan can draw from many Positions, with no stored link between them.

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

The approved visual world for the Markets app: security-paper white canvas, navy/graphite structural rules, muted gold for Supply facts and muted cyan for Borrow facts, humanist grotesk + tabular mono, and the nested-wave mark reading as OVRFLO’s first O.

Clearing Ledger is a visual metaphor only. Product identity remains self-repaying loans; the UI must not claim OVRFLO is a securities clearing house or clearing-ledger product. Architectural Dark (obsidian, Inter, tiled grid) is the incumbent anti-reference this world replaces.

### Claim-all

The batch exit flow where a connected lender reviews and sequentially confirms all pending pool share claims and withdrawable Sablier stream balances from the position summary strip.

Each step is a separate on-chain transaction: pool claims batch per lending contract via multicall, then individual stream withdrawals. The plan shown for review is a snapshot taken when the flow opens, but the plan actually submitted is recomputed from live data at the moment of confirmation — and again on resume — so work claimed elsewhere in the interval is never re-submitted. A recomputation that comes back empty is reported as such rather than treated as a completed queue. Resume subtracts already-confirmed and skipped claim IDs so an expanded pool group cannot replay finished work; changed or newly appearing constituents require explicit re-review before the queue continues.

A step failure — including a transaction that mines but reverts on-chain, not only a signature rejection or transport error — halts the queue immediately. Already-confirmed steps stay checked off; resuming always re-plans from live data rather than retrying the step that failed.

### Loan book

The client-side enumeration of one connected user's full position against one OVRFLOLending market — every loan pool they've contributed to (lender view) plus every loan they've borrowed (borrower view) — assembled from a single multicall over the shared id space rather than two separate scans.

A loan book is not an on-chain concept; it's the frontend's `useLoanBook` hook (`web/hooks/useLoanBook.ts`) reading the same five per-id fields (`loanPools`, `loans`, `loanPoolContributions`, `loanPoolReceived`, `loanPoolProceeds`) once, plus one shared Sablier `withdrawableAmountOf` batch over the union of loans either view needs, then deriving the lender-view `pools` and borrower-view `loans` from that shared result. Capped at `MAX_ENUMERATION_IDS`; a market with more ids than the cap sets `tooLarge` rather than silently truncating. Call sites that only need the lean borrower-only shape for a single loan (e.g. `RepayForm`) intentionally stay on the narrower `useBorrowerLoans` rather than pulling in a full loan book — the merge exists for callers that need both views of the same `(lending, user)` pair (`PositionSummary`, `PositionList`), not as a universal replacement for every lending read.

### Ponder

The off-chain indexer the frontend used to query for data assembled from historical chain events rather than a direct RPC read (held-stream discovery for a connected wallet, and the borrow-demand ladder). Removed in favor of browser-side verified-log projection plus direct contract hydration. See Stream discovery below for the rule now governing which questions on-chain discovery is allowed to answer.

### Stream discovery

Finding which Sablier streams a connected wallet may hold. Browser-side on-chain discovery answers this one question and nothing else; every value the app then displays or acts on is read from Sablier directly.

The split is a trust boundary, not an optimisation. A discovery projection naming a stream id is a candidate set, not a claim of ownership — a stream whose on-chain owner is not the connected address is dropped rather than rendered, and the fields that decide whether a stream is eligible for an action are always re-read from chain. Discovery results are also three-valued: streams, no streams, and *unavailable*. The third must never be presented as the second, since "you hold nothing" and "this list cannot be trusted" call for opposite user responses. Partial or stale projections stay unavailable/preparing, never ready-empty or actionable. A previously-discovered set may be served past a discovery failure only within a bounded staleness window, after which it is discarded rather than shown behind a warning.

### Position groups

The three-way split the frontend's position list uses to present one connected user's holdings for a market: LENDING (liquidityPositions plus the lender half of their loan book — see Loan book), BORROWING (the borrower half of their loan book), and STREAMS (Sablier streams held, discovered via the browser-side on-chain event projection — see Stream discovery).

LENDING and BORROWING are sourced from direct contract reads; STREAMS is sourced from the same on-chain projection transport (verified-log scan plus direct Sablier hydration) but through a different code path. The groups still render and fail independently — a projection-layer failure hides only STREAMS, and a direct-read failure hides only LENDING/BORROWING — but the source for all three is now on-chain data rather than a separate indexer.

### Stale-recovery classification

The three-way sorting of a failed write transaction that decides what the form offers next: *stale* (on-chain liquidity or pricing moved between quoting and signing — refresh every on-chain read, show a "here's the new number" banner, and offer one explicit re-confirm), *terminal* (the input can never succeed, such as an ineligible stream or self-match — disable the action and say why, never invite a retry), or *retryable* (wallet rejection or transport failure — leave the action live).

Classification is per flow, not global: the same revert can be terminal in one flow and stale in another (an ERC20 shortfall is a liquidity race inside a withdraw-then-supply multicall). A stale outcome is never presented as a dead-end error. Pre-submit rebuild failures that only carry structured `errors` must still be surfaced as a single consumer-visible error so this classification can run — an `invalid` result that hides its payload dead-ends the recovery path.

This classification only covers failures that populate the transaction's error signal (wallet rejection, transport failure, a revert caught before broadcast, or a synthesized rebuild error). A transaction that mines but reverts on-chain populates no error at all and is surfaced as its own distinct failure state outside this three-way sort — see Claim-all above for the queue-level version of that state.

## Refactoring patterns

### Vestigial state

Correct but redundant protocol state that duplicates information recoverable from other on-chain sources. Common forms in OVRFLO: duplicate ID spaces with translation maps (loan vs loan-pool), derived booleans that mirror a quantitative check (`active` vs `availableLiquidity > 0`), dual registries that duplicate a sentinel (`approved` vs `ptToken != address(0)`), and hand-rolled wrapper getters that re-shape data the compiler's auto-getters already expose. Vestigial state is not a bug, but it is attack surface, gas cost, and cognitive load. Deleting it is a behavior-preserving refactor: prove no consumer depends on the redundant field (grep-verified across `src/` and `test/`), delete the declaration, then mechanically update all destructures and call sites. See `docs/solutions/architecture-patterns/behavior-preserving-simplification-refactor.md`.
