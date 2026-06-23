# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## OVRFLO core

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
