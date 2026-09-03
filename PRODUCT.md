# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

OVRFLO serves three closely related DeFi participants:

- Lenders supply ovrfloToken liquidity at a chosen APR and earn fixed-rate yield from deterministic collateral streams.
- Borrowers pledge eligible OVRFLO Streams to access ovrfloToken liquidity without liquidation risk or health-factor management.
- Pendle PT holders deposit principal tokens to receive immediate ovrfloToken value plus a stream of the remaining fixed discount, which they can hold, sell, or use as collateral.

Users interact through a wallet-connected application and are expected to understand token approvals, transaction signing, maturities, APRs, and on-chain settlement.

## Product Purpose

OVRFLO enables self-repaying loans backed by deterministic, non-cancelable OVRFLO Streams created from Pendle PT deposits. It turns the fixed discount embedded in a principal token into two usable legs: immediate ovrfloToken value and streamed value through maturity.

The product unit is a **column**: one underlying (wstETH, rETH, sUSDe, or a later one) with its vault, receipt token, wrap reserve, and lending market. A second underlying is a second column. The Markets app shows each column's amounts in USD by default and keeps token units available. Transactions stay in token units.

Success means users can supply liquidity at a fixed APR, borrow against streams (a maximum borrow is economically a sale), manage positions, and exit their ovrfloToken positions with the exact financial consequences visible before signing.

The column tower for agents is `docs/agents/system.md`.

## Positioning

OVRFLO removes liquidations and health factors from its lending mechanism because eligible collateral is a fixed-asset, fixed-schedule, non-cancelable stream whose remaining value covers the loan obligation. The protocol does not predict or continuously reprice volatile collateral; the pledged stream repays the lender on schedule.

The broader OVRFLO cycle lets a Pendle PT holder make its fixed discount immediately useful: deposit the PT, receive current principal value as ovrfloToken, and sell or borrow against the streamed remainder.

## Operating Context

The primary product is a wallet-connected web application backed by Ethereum-compatible smart contracts. The Markets app's Default home is `Your OVRFLO`. Navigation is `Your OVRFLO` and `Create` on `/` and `/create/`. Create offers two position types: Self-Repaying Loan at `/borrow/` and Fixed Return at `/supply/`. Advanced is a disclosure level over the current destination. It does not add a second home, a Dashboard, a Markets destination, or an Activity destination. Wallet and network stay visible and secondary. A wallet confirmed empty of positions, loans, and streams lands on a guided first run, then the Create chooser.

Core workflows include:

- depositing an approved Pendle PT series to create ovrfloTokens and an OVRFLO Stream;
- supplying standing ovrfloToken liquidity at a chosen fixed APR tick, where it rests until matched;
- borrowing ovrfloToken against one stream at one APR tick in a single blind fill, up to the stream's full remaining value (there are no sale listings; a maximum borrow is economically a sale);
- claiming lender proceeds on the supplied position that earned them, repaying or closing loans from the borrowed detail, and watching streams, loans, and supplied liquidity on the home wall;
- wrapping and unwrapping the column underlying one-to-one with ovrfloToken on `OVRFLOReserve`;
- claiming PT against ovrfloToken after series maturity.

Users evaluate amounts, APR, maturity, stream value, loan obligation, fees, residual value, wallet state, approvals, and transaction status. The Markets app shows amounts in USD by default for the selected column's underlying (wstETH, rETH, sUSDe, or any later underlying). The customer can switch and see the same amounts in token units. Each underlying has its own USD quote. The Markets app must not show another column's dollars on this position. If the USD quote is missing or stale, the Markets app shows token units and does not invent a dollar figure. Transactions stay denominated in token units. USD never enters calldata. There is no indexer backend. Held streams, loans, supplies, and resting requests come from on-chain enumerable lists. The browser does not scan logs for portfolio history.

## Capabilities and Constraints

- OVRFLO is Pendle-specific. Pendle PT is always treated as 18-decimal, and support for another principal-token protocol would require a separate adapter or wrapper.
- Collateral streams use OVRFLO Streams, the protocol's own stream layer. It is a fork of Sablier V2 v1.1, and it keeps that version's stream behaviour and its withdrawal access control. Streams are per deposit and per customer, linear, deterministic, non-cancelable, and denominated in ovrfloToken. Shipped holder discovery does not list streams via Enumerable; the frontend still finds candidates from verified logs and hydrates each id on-chain.
- Loans are self-repaying and require no liquidation mechanism or health factor. A lender may recover from streamed accrual or direct borrower repayment, capped at the obligation.
- Lending is a loan-only, fixed-rate tick order book. Lenders rest capital at an APR tick; a borrow is a blind fill against one tick that never enumerates lender positions; lender attribution is computed by interval overlap and claims are pro rata against a loan's recovered value.
- One ovrfloToken exists per underlying. Its fungibility across PT deposit and underlying wrap origins is intentional and increases exit optionality.
- Wrap and unwrap are permissionless and one-to-one, bounded by a separately tracked underlying reserve. PT claims are bounded by PT backing.
- Administrative actions flow from a timelocked multisig through OVRFLOFactory to vaults and lending markets. Product design must not imply direct administration of dependent contracts.
- Market data and transaction previews must preserve exact asset, maturity, fee, APR, obligation, and residual semantics. Unsupported or stale data must degrade explicitly rather than appear authoritative.
- USD display is per underlying and defaults on when that column's quote is live. A missing recipe or a stale quote hides USD for that column only. Token-native submit remains available. USD never becomes execution authority.
- The name is always `OVRFLO`; `OVFL` is not a product or token name. Receipt tokens use the `OVRFLO` or `ovrflo` prefix.

## Brand Commitments

The product name is OVRFLO. Its durable voice is precise, technical, direct, and skeptical of unsupported claims. Financial consequences should be explained concretely rather than through vague promises.

The public product statement is: **OVRFLO enables self-repaying loans.**

Existing brand and interface assets live under `web/public/brand/` and `web/public/images/`. The incumbent visual system is documented separately in `DESIGN.md`; visual rules do not belong in this product record.

## Evidence on Hand

- `README.md` contains the public product narrative, worked lending example, protocol architecture, contract capabilities, and user flows.
- `CONCEPTS.md` defines shared OVRFLO vocabulary and the exact meanings of the PT deposit, wrap, unwrap, claim, stream, and v1-lite lending (tick, tape, blind fill, epoch) processes.
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
