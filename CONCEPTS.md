# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## OVRFLO core

### Factory

The admin hub that deploys OVRFLO vaults, OVRFLOTokens, and OVRFLOBooks, and serves as the single governance entry point for every contract it creates.

The factory is owned by a timelocked multisig and is the permanent admin on every deployed vault and the owner of every deployed book. All admin actions flow multisig -> factory -> vault or book; no dependent contract is administered directly. A factory ownership transfer moves governance for all vaults and books atomically. One vault per underlying is enforced; duplicate deployment for the same underlying is rejected before any vault is created.

### OVRFLO vault

The protocol vault for a single underlying asset that accepts supported Pendle principal-token positions and manages the corresponding fungible OVRFLO receipt token.

An OVRFLO vault has two backing sources for the same receipt token: matured principal-token claims and underlying wrap reserves. These backing sources must remain separately accounted even though the receipt token is fungible.

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

A per-deposit linear vesting stream used by OVRFLO to deliver the discount between a principal token's current value and its face value over time.

Sablier streams belong to the PT deposit path. Wrap and unwrap do not create, modify, or settle streams.

## OVRFLOBook

### Offer

A standing buy-side or lend-side order in the OVRFLOBook secondary market where a maker posts underlying liquidity not bound to a specific stream, fillable by any eligible stream from a chosen market.

Offers carry no stream at creation, so they front-load only market-level validation (market approved, series approved, not matured); full stream eligibility is checked per-fill.

### Listing

A sell-side or borrow-side order in the OVRFLOBook secondary market where a maker escrows a specific Sablier stream, priced at a discount rate until the series maturity.

Listings bind a stream at creation and run full stream eligibility validation at post time.

### Loan

A borrow in the OVRFLOBook backed by a pledged Sablier stream, where the obligation is denominated in the stream's payout asset (ovrfloToken) and the lender recovers by drawing from the stream or by direct repayment.

Total lender recovery is capped at the obligation; the pledged stream is returned to the borrower once the loan closes.

### Self-repaying loan

A loan against a pledged Sablier stream where the stream's deterministic payouts repay the lender without liquidations, health checks, or loan-time oracles. The stream is non-cancelable and pays a fixed asset on a fixed schedule, so it cannot underperform; the lender draws accrued value until the obligation is satisfied, then the residual stream returns to the borrower.

### Pool

The only lending mechanism in the OVRFLOBook: an atomic batch primitive that aggregates multiple offers or listings into a single transaction. A borrower pool (`createBorrowPool`) batches borrows across multiple lend offers; a lender pool (`createLenderPool`) batches lends across multiple borrow listings. The pool becomes the virtual lender on every loan it creates (`loan.lender = address(book)`, tracked via `loanPoolId`). Claims are address-based (no NFTs): contributors claim pro-rata proceeds via `claimPoolShare` (from accumulated `poolProceeds`) or `poolClaimLoan` (direct draw from a specific loan's stream). A single `poolReceived` variable caps total received across both channels at the contributor's pro-rata entitlement.

### OVRFLO cycle

The composition of PT deposit, book sale, and unwrap or swap that lets the PT discount -- fixed at deposit -- overflow into extractable value. A depositor receives immediate ovrfloToken (principal at TWAP value) plus a Sablier stream (the yield). Selling the stream on the book and exiting the immediate portion via unwrap or a swap pool converts both legs to underlying, capturing the fixed yield. Executable today with held PT, zero capital via an underlying flash loan from an external provider (swap for PT on the Pendle AMM, run the cycle, repay in underlying), or zero capital via a PT flash loan from OVRFLO itself (run the cycle, buy PT on the Pendle AMM for repayment). The protocol remains solvent throughout: the deposit adds PT backing, the unwrap (if used) consumes wrap-reserve backing, and every participant is economically whole. See `README.md` "What's Fixed Will OVRFLO" for the full example.

### PT flash loan

An atomic loan of deposited PT from the OVRFLO vault, repaid via safeTransferFrom within the same transaction. The borrower implements an EIP-4531 callback that receives PT, executes logic (typically the OVRFLO cycle), and returns PT plus an oracle-adjusted fee in underlying. The fee routes to the treasury, which wraps it to fund the wrap reserve. Capped by marketTotalDeposited, gated pre-maturity, and globally pausable by the multisig. No nonReentrant modifier is applied because the borrower must deposit during the callback to run the cycle.
