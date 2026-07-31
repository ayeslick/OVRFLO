# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

OVRFLO serves three closely related DeFi participants:

- Lenders supply underlying liquidity at a chosen APR and earn fixed-rate yield from deterministic collateral streams.
- Borrowers pledge eligible OVRFLO Sablier streams to access underlying liquidity without liquidation risk or health-factor management.
- Pendle PT holders deposit principal tokens to receive immediate ovrfloToken value plus a stream of the remaining fixed discount, which they can hold, sell, or use as collateral.

Users interact through a wallet-connected application and are expected to understand token approvals, transaction signing, maturities, APRs, and on-chain settlement.

## Product Purpose

OVRFLO enables self-repaying loans backed by deterministic, non-cancelable Sablier streams created from Pendle PT deposits. It turns the fixed discount embedded in a principal token into two usable legs: immediate ovrfloToken value and streamed value through maturity.

Success means users can supply liquidity, borrow against streams, sell streams, manage positions, and exit their ovrfloToken positions with the exact financial consequences visible before signing.

## Positioning

OVRFLO removes liquidations and health factors from its lending mechanism because eligible collateral is a fixed-asset, fixed-schedule, non-cancelable stream whose remaining value covers the loan obligation. The protocol does not predict or continuously reprice volatile collateral; the pledged stream repays the lender on schedule.

The broader OVRFLO cycle lets a Pendle PT holder make its fixed discount immediately useful: deposit the PT, receive current principal value as ovrfloToken, and sell or borrow against the streamed remainder.

## Operating Context

The primary product is a wallet-connected web application backed by Ethereum-compatible smart contracts. Core workflows include:

- depositing an approved Pendle PT series to create ovrfloTokens and a Sablier stream;
- supplying standing liquidity for eligible streams at a chosen APR;
- borrowing underlying against one stream across one or more liquidity positions;
- selling a stream into standing liquidity or through a listing;
- claiming lender proceeds, repaying or closing loans, and tracking streams, loans, and supplied liquidity;
- wrapping and unwrapping the vault underlying one-to-one with ovrfloToken;
- claiming PT against ovrfloToken after series maturity.

Users evaluate token amounts, APR, maturity, stream value, loan obligation, fees, residual value, wallet state, approvals, and transaction status. Ponder may discover candidate streams and demand data, but ownership and all action-critical stream facts are verified on-chain.

## Capabilities and Constraints

- OVRFLO is Pendle-specific. Pendle PT is always treated as 18-decimal, and support for another principal-token protocol would require a separate adapter or wrapper.
- Collateral streams use the immutable Sablier V2 deployment intentionally. They are per deposit and per customer, linear, deterministic, non-cancelable, and denominated in ovrfloToken.
- Loans are self-repaying and require no liquidation mechanism or health factor. A lender may recover from streamed accrual or direct borrower repayment, capped at the obligation.
- Borrowing uses loan pools that atomically aggregate multiple liquidity positions against one pledged stream. Each pool has one loan, and lenders claim proceeds pro rata.
- One ovrfloToken exists per underlying. Its fungibility across PT deposit and underlying wrap origins is intentional and increases exit optionality.
- Wrap and unwrap are permissionless and one-to-one, bounded by a separately tracked underlying reserve. PT claims are bounded by PT backing.
- Administrative actions flow from a timelocked multisig through OVRFLOFactory to vaults and lending markets. Product design must not imply direct administration of dependent contracts.
- Market data and transaction previews must preserve exact asset, maturity, fee, APR, obligation, and residual semantics. Unsupported or stale data must degrade explicitly rather than appear authoritative.
- The name is always `OVRFLO`; `OVFL` is not a product or token name. Receipt tokens use the `OVRFLO` or `ovrflo` prefix.

## Brand Commitments

The product name is OVRFLO. Its durable voice is precise, technical, direct, and skeptical of unsupported claims. Financial consequences should be explained concretely rather than through vague promises.

The public product statement is: **OVRFLO enables self-repaying loans.**

Existing brand and interface assets live under `web/public/brand/` and `web/public/images/`. The incumbent visual system is documented separately in `DESIGN.md`; visual rules do not belong in this product record.

## Evidence on Hand

- `README.md` contains the public product narrative, worked lending example, protocol architecture, contract capabilities, and user flows.
- `CONCEPTS.md` defines shared OVRFLO vocabulary and the exact meanings of the PT deposit, wrap, unwrap, claim, lending, stream, and loan-pool processes.
- `src/` and `interfaces/` contain the protocol implementation and external integration boundaries.
- `web/` contains the Next.js application, wallet integration, on-chain reads and writes, transaction flows, and automated tests.
- `docs/audit/`, `docs/solutions/`, `BASE_SECURITY.md`, and `VAULT_SECURITY.md` contain security evidence, rejected-finding records, and enforceable implementation guidance.
- No testimonials, customer logos, adoption figures, performance benchmarks, or third-party endorsements are established in the repository; future product work must not fabricate them.

## Product Principles

1. **Show the obligation, not a promise.** Users should see the exact assets, amounts, timing, fees, and on-chain consequence before signing.
2. **Let determinism replace liquidation machinery.** Preserve the fixed-stream mechanism that makes loans self-repaying without health factors.
3. **Treat chain state as financial truth.** Indexers may aid discovery, but ownership, eligibility, pricing inputs, and action-critical values come from on-chain reads.
4. **Keep the protocol legible.** Favor Pendle-specific terminology and direct mappings over unnecessary generalization or abstraction.
5. **Degrade honestly.** Loading, stale, unavailable, failed, and empty states are distinct and must never be collapsed into a misleading result.
