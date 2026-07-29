# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## OVRFLO core

### Factory

The admin hub that deploys OVRFLO vaults, OVRFLOTokens, and OVRFLOLendings, and serves as the single governance entry point for every contract it creates.

The factory is owned by a timelocked multisig and is the permanent admin on every deployed vault and the owner of every deployed lending. All admin actions flow multisig -> factory -> vault or lending; no dependent contract is administered directly. A factory ownership transfer moves governance for all vaults and lending markets atomically. One vault per underlying is enforced; duplicate deployment for the same underlying is rejected before any vault is created.

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

## OVRFLOLending

### LiquidityPosition

A standing order in the OVRFLOLending secondary market where a lender posts underlying liquidity at a discount rate (APR), not bound to a specific stream, consumable by any eligible stream from a chosen market. An liquidity can be consumed as a sale (stream transfers permanently to the lender via `sellStreamToLiquidity`) or as a loan (stream pledged with obligation via `createBorrowerLoanPool`); the lender cannot restrict which.

LiquidityPositions carry no stream at creation, so they front-load only market-level validation (market approved, series approved, not matured); full stream eligibility is checked per-fill.

### Listing

A sell-side order in the OVRFLOLending secondary market where a lender escrows a specific Sablier stream, priced at a discount rate until the series maturity.

Listings bind a stream at creation and run full stream eligibility validation at post time.

### Loan

A borrow in the OVRFLOLending backed by a pledged Sablier stream, where the obligation is denominated in the stream's payout asset (ovrfloToken) and the lender recovers by drawing from the stream or by direct repayment.

Total lender recovery is capped at the obligation; the pledged stream is returned to the borrower once the loan closes. A returned stream can be re-pledged to a new loan — the stream's cumulative withdrawn amount spans all loans that have used it, not just the most recent.

A loan's obligation size depends on how much of the pledged stream's discounted price is borrowed: borrowing the stream's entire discounted price sets the obligation to the stream's full remaining value; borrowing any smaller amount scales the obligation to roughly that amount (rounded slightly in the lender's favor) instead. Borrowing the full discounted price is a distinct case, not just the top of a continuous scale — a caller that intends a small, partial borrow must request strictly less than the stream's full discounted price, or it silently becomes a full borrow with a much larger obligation.

### Self-repaying loan

A loan against a pledged Sablier stream where the stream's deterministic payouts repay the lender without liquidations or health checks. The stream is non-cancelable and pays a fixed asset on a fixed schedule, so it cannot underperform; the lender draws accrued value until the obligation is satisfied, then the residual stream returns to the borrower.

### Pool

The only lending mechanism in the OVRFLOLending: an atomic batch primitive where a borrower aggregates multiple liquidityPositions into a single transaction. A borrower pool (`createBorrowerLoanPool`) batches borrows across multiple liquidityPositions; the borrower is the only pooling actor. The pool is the virtual lender on its loan (the lending contract itself holds the lender role, since each pool has exactly one loan and they share a single ID space). Each pool has exactly one loan. Claims are address-based (no NFTs): lenders claim pro-rata proceeds via `claimLoanPoolShare`, which works for both open and closed loans. Claimable amount is the lender's pro-rata share of total recovery (drawn plus repaid, plus stream withdrawable for open loans) minus cumulative prior receipts, ensuring order-independent fairness.

### OVRFLO cycle

The composition of PT deposit, lending sale, and unwrap or swap that lets the PT discount -- fixed at deposit -- overflow into extractable value. A depositor receives immediate ovrfloToken (principal at TWAP value) plus a Sablier stream (the yield). Selling the stream on the lending and exiting the immediate portion via unwrap or a swap pool converts both legs to underlying, capturing the fixed yield. Executable today with held PT, zero capital via an underlying flash loan from an external provider (swap for PT on the Pendle AMM, run the cycle, repay in underlying), or zero capital via a PT flash loan from OVRFLO itself (run the cycle, buy PT on the Pendle AMM for repayment). The protocol remains solvent throughout: the deposit adds PT backing, the unwrap (if used) consumes wrap-reserve backing, and every participant is economically whole. See `README.md` "What's Fixed Will OVRFLO" for the full example.

### PT flash loan

An atomic loan of deposited PT from the OVRFLO vault, repaid via safeTransferFrom within the same transaction. The borrower implements an EIP-4531 callback that receives PT, executes logic (typically the OVRFLO cycle), and returns PT plus an oracle-adjusted fee in underlying. The fee routes to the treasury, which wraps it to fund the wrap reserve. Capped by marketTotalDeposited, gated pre-maturity, and globally pausable by the multisig. No nonReentrant modifier is applied because the borrower must deposit during the callback to run the cycle.

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

### Claim-all

The batch exit flow where a connected lender reviews and sequentially confirms all pending pool share claims and withdrawable Sablier stream balances from the position summary strip.

Each step is a separate on-chain transaction: pool claims batch per lending contract via multicall, then individual stream withdrawals. The plan shown for review is a snapshot taken when the flow opens, but the plan actually submitted is recomputed from live data at the moment of confirmation — and again on resume — so work claimed elsewhere in the interval is never re-submitted. A recomputation that comes back empty is reported as such rather than treated as a completed queue.

A step failure — including a transaction that mines but reverts on-chain, not only a signature rejection or transport error — halts the queue immediately. Already-confirmed steps stay checked off; resuming always re-plans from live data rather than retrying the step that failed.

### Loan book

The client-side enumeration of one connected user's full position against one OVRFLOLending market — every loan pool they've contributed to (lender view) plus every loan they've borrowed (borrower view) — assembled from a single multicall over the shared id space rather than two separate scans.

A loan book is not an on-chain concept; it's the frontend's `useLoanBook` hook (`web/hooks/useLoanBook.ts`) reading the same five per-id fields (`loanPools`, `loans`, `loanPoolContributions`, `loanPoolReceived`, `loanPoolProceeds`) once, plus one shared Sablier `withdrawableAmountOf` batch over the union of loans either view needs, then deriving the lender-view `pools` and borrower-view `loans` from that shared result. Capped at `MAX_ENUMERATION_IDS`; a market with more ids than the cap sets `tooLarge` rather than silently truncating. Call sites that only need the lean borrower-only shape for a single loan (e.g. `RepayForm`) intentionally stay on the narrower `useBorrowerLoans` rather than pulling in a full loan book — the merge exists for callers that need both views of the same `(lending, user)` pair (`PositionSummary`, `PositionList`), not as a universal replacement for every lending read.

### Ponder

The off-chain indexer the frontend queries for data assembled from historical chain events rather than a direct RPC read. Current consumers: held-stream discovery for a connected wallet, and the borrow-demand ladder.

Ponder is a different reliability domain than a direct on-chain read: it can lag behind chain head while backfilling, or be briefly unreachable, independent of whether RPC reads are succeeding at the same moment. Frontend surfaces that combine Ponder-sourced data with on-chain data should treat a Ponder failure and an on-chain read failure as distinct, independently-degrading states rather than folding them into one combined error or loading flag.

Ponder is also a different *trust* domain, not only a different reliability one — see Stream discovery for the rule governing which questions it is allowed to answer.

### Stream discovery

Finding which Sablier streams a connected wallet may hold. The indexer answers this one question and nothing else; every value the app then displays or acts on is read from Sablier directly.

The split is a trust boundary, not an optimisation. An indexer naming a stream id is a hint, not a claim of ownership — a stream whose on-chain owner is not the connected address is dropped rather than rendered, and the fields that decide whether a stream is eligible for an action are always re-read from chain. Discovery results are also three-valued: streams, no streams, and *unavailable*. The third must never be presented as the second, since "you hold nothing" and "this list cannot be trusted" call for opposite user responses. A previously-discovered set may be served past a discovery failure only within a bounded staleness window, after which it is discarded rather than shown behind a warning.

### Position groups

The three-way split the frontend's position list uses to present one connected user's holdings for a market: LENDING (liquidityPositions plus the lender half of their loan book — see Loan book), BORROWING (the borrower half of their loan book), and STREAMS (Sablier streams held, discovered via Ponder).

LENDING and BORROWING are both sourced from on-chain reads; STREAMS is sourced from Ponder. Because the two sources are different reliability domains (see Ponder), the groups render and fail independently — a Ponder outage hides only STREAMS, and an on-chain read failure hides only LENDING/BORROWING.

### Stale-recovery classification

The three-way sorting of a failed write transaction that decides what the form offers next: *stale* (on-chain liquidity or pricing moved between quoting and signing — refresh every on-chain read, show a "here's the new number" banner, and offer one explicit re-confirm), *terminal* (the input can never succeed, such as an ineligible stream or self-match — disable the action and say why, never invite a retry), or *retryable* (wallet rejection or transport failure — leave the action live).

Classification is per flow, not global: the same revert can be terminal in one flow and stale in another (an ERC20 shortfall is a liquidity race inside a withdraw-then-supply multicall). A stale outcome is never presented as a dead-end error.

This classification only covers failures that populate the transaction's error signal (wallet rejection, transport failure, or a revert caught before broadcast). A transaction that mines but reverts on-chain populates no error at all and is surfaced as its own distinct failure state outside this three-way sort — see Claim-all above for the queue-level version of that state.

## Refactoring patterns

### Vestigial state

Correct but redundant protocol state that duplicates information recoverable from other on-chain sources. Common forms in OVRFLO: duplicate ID spaces with translation maps (loan vs loan-pool), derived booleans that mirror a quantitative check (`active` vs `availableLiquidity > 0`), dual registries that duplicate a sentinel (`approved` vs `ptToken != address(0)`), and hand-rolled wrapper getters that re-shape data the compiler's auto-getters already expose. Vestigial state is not a bug, but it is attack surface, gas cost, and cognitive load. Deleting it is a behavior-preserving refactor: prove no consumer depends on the redundant field (grep-verified across `src/` and `test/`), delete the declaration, then mechanically update all destructures and call sites. See `docs/solutions/architecture-patterns/behavior-preserving-simplification-refactor.md`.
