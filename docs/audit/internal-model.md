# OVRFLO Internal Protocol Model

> The two subtlest OVRFLO mechanics, framed for an auditor as checkable accounting identities rather than happy-path prose. Insolvency-first: the thesis is "here is every way the books could stop balancing," not "here is the happy path." Links to `x-ray/invariants.md` for derivations instead of restating them.

## Part 1 — Dual-backing solvency tie-out

One fungible `ovrfloToken` is backed by **two separately-accounted pools** that must stay separately accounted even though the receipt token is fungible across holder origins and supported maturities:

| Backing pool | Ledger | Increases on | Decreases on |
|--------------|--------|--------------|--------------|
| Matured PT claims | `marketTotalDeposited[market]` | `deposit()` (+`ptAmount`) | `claim()` (−`amount`) |
| Underlying wrap reserve | `wrappedUnderlying` | `wrap()` (+`amount`) | `unwrap()` (−`amount`) |

These pools are **non-interchangeable** even when both are economically 1:1 at maturity. The conservation identities an auditor can tie out against on-chain state:

- **Invariant I-1** — `marketTotalDeposited[market]` tracks net PT principal per market (+deposit / −claim). Derivation: `x-ray/invariants.md#i-1`.
- **Invariant I-2** — `wrappedUnderlying` is a reserve ledger (+wrap / −unwrap); sweep computes excess against it without mutating it. Derivation: `x-ray/invariants.md#i-2`.
- **Invariant E-3** — 1:1 wrap/unwrap liquidity stays solvent while reserve accounting (I-2) and registry wiring (X-3) hold. Derivation: `x-ray/invariants.md` (Economic Invariants).

### The seam where conservation can silently break

Direct token transfers or donations to the vault increase the **raw** underlying balance but do **not** increase `wrappedUnderlying`. `unwrap()` capacity is bounded by the tracked reserve (guard **G-12**: `require(reserve >= amount)`), not by the raw balance. Conversely, `sweepExcessUnderlying()` recovers the excess (raw − reserve) without reducing unwrap capacity. An auditor should confirm:

- Every unwrap path trusts only `wrappedUnderlying`, never `IERC20.balanceOf(address(this))`.
- Sweep never mutates `wrappedUnderlying`.
- Donations cannot inflate either backing pool.

This is the `x-ray` attack surface **"Wrap reserve accounting under direct token transfers [I-2, X-3]."**

### Cross-market fungibility is a feature

One `ovrfloToken` per underlying across approved maturities is an intentional product feature (`README.md`, `CONCEPTS.md`). Claim capacity is bounded by PT backing per market; wrap/unwrap capacity is bounded by the shared wrap reserve. The two constraints are independent and must both hold.

## Part 2 — Self-repaying-loan economics

OVRFLOBook loans are **not** standard collateralized debt. They depart from auditor priors in three ways that pre-empt a whole class of false-positive findings:

1. **No health check.** There is no loan-to-value ratio, no health factor, no liquidation threshold.
2. **No loan-time oracle.** Loan origination and servicing use `StreamPricing` time/factor math against the series maturity, not a live price feed.
3. **No liquidation.** There is no liquidator role, no auction, no bad-debt path.

The pledged Sablier stream is **non-cancelable** and pays a fixed asset (`ovrfloToken`) on a fixed schedule, so it **cannot underperform**. The lender recovers by drawing accrued stream value until the obligation is satisfied; the residual stream returns to the borrower.

### The accounting identity

For every loan, **outstanding = obligation − (drawn + repaid)** (invariant **E-2**; loan state machine **I-10**):

- `obligation` is computed at fill via `StreamPricing.obligationForFill()` and stored.
- `drawn` increases on `poolClaimLoan()` (contributor draws from the stream) and on `closeLoan()` (final draw to `poolProceeds`).
- `repaid` increases on `repayLoan()` (borrower repays directly).
- Repay is capped at remaining outstanding (guard **G-17**); loan servicing preserves monotonic outstanding reduction.

Derivation: `x-ray/invariants.md#e-2`.

### Permissionless `closeLoan()` is liveness, not exploit

`closeLoan()` is callable by **anyone** once `Sablier.withdrawableAmountOf(streamId) >= outstanding`. This is intentional liveness (book plan R15; audit-report **I-3 (ex-M-3)**): it removes borrower timing optionality on when to finish via `repayLoan`, but it does not misroute funds — the lender receives the final draw, the borrower receives the residual NFT. An auditor anchored to standard lending will flag "no liquidation logic" or "permissionless close" — both are by design. See `rejected-findings-record.md` (I-3) and the resolved Q&A on `closeLoan` intent.

### Pricing at fill

At trade/loan fill, the stream's already-withdrawn value is excluded: pricing uses `deposited − withdrawn` so the buyer/lender pays only for remaining stream value. Fee is snapshotted at listing/offer post time (maker protection), so a later `setFee()` does not retroactively change resting orders (audit-report resolved Q&A #5).

### Economic invariants

- **E-1** — dual-backing solvency: every ovrfloToken is backed by wrapped underlying, deposited PT, or unvested stream value (see Part 1).
- **E-2** — lender extractable value per loan is capped by the recorded obligation (`obligation <= remaining`, self-repaying liveness).

Derivations: `x-ray/invariants.md` (Economic Invariants).
