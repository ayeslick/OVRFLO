# README Rewrite: Self-Repaying Loans Focus

**Date:** 2026-06-24
**Status:** Requirements — ready for implementation
**Approach:** A — Product-led with technical reference

## 1. Outcome

Rewrite `README.md` so the lending platform (OVRFLOBook) is the product and the core vault is presented as the collateral creation mechanism that enables it. The current README only documents the core; the rewrite covers the full system.

## 2. Narrative Hierarchy

1. **Headline**: "OVRFLO enables Self-Repaying Loans" (not "Fixed Yield Collateral")
2. **How It Works**: Two-layer system
   - Layer 1 — Collateral Creation: deposit PT → receive ovrfloTokens + deterministic Sablier stream
   - Layer 2 — The Market: sell or borrow against that stream via OVRFLOBook
   - Why "self-repaying": Sablier streams are deterministic, non-cancelable, non-underperforming → no liquidations, no health factor, the stream itself repays the loan
3. **Architecture diagram**: Redrawn to show OVRFLOBook + StreamPricing alongside the core
4. **Contracts**: All 5 contracts documented with updated signatures
5. **User flows**: Core (deposit, claim, wrap, unwrap) + Book (sell, borrow, loan servicing)
6. **Admin flows**: Updated for new constructor signatures
7. **Roadmap**: Pool (passive loan aggregation) as a one-line mention

## 3. Sections to Write

### 3.1 Headline & Value Prop

- Lead with "Self-Repaying Loans"
- One-paragraph explanation: OVRFLO turns Pendle PT deposits into deterministic streaming collateral, then lets users sell or borrow against that collateral. The stream itself repays the loan — no liquidations, no health checks.
- Example flow updated to show the full journey: deposit → receive stream → borrow against stream → stream repays lender → residual returns to borrower

### 3.2 How It Works

- Two-layer explanation with the deposit example from current README, extended to show the lending use case
- ASCII diagram showing the full flow: deposit → split (immediate + stream) → sell/borrow against stream → lender draws from stream → residual returns

### 3.3 Architecture

- Redrawn ASCII diagram showing:
  - OVRFLOFactory (owns → deploys + admin)
  - OVRFLO core (deposit, claim, wrap, unwrap)
  - OVRFLOToken (per underlying)
  - OVRFLOBook (sale offers, sale listings, lend offers, borrow listings, loan servicing)
  - StreamPricing (shared pricing + eligibility, used by Book)
  - External: Pendle Oracle, Sablier V2 LL

### 3.4 Contracts

**OVRFLOBook.sol** (new section — the lending platform):

| Function | Description |
|----------|-------------|
| `postSaleOffer(market, aprBps, capacity)` | Post standing buy-side liquidity for any eligible stream |
| `cancelSaleOffer(offerId)` | Cancel unmatched sale offer, refund remaining capacity |
| `sellIntoOffer(offerId, streamId, minNetOut)` | Sell a stream into a standing offer for discounted underlying |
| `postSaleListing(market, streamId, aprBps)` | List a specific stream for sale |
| `cancelSaleListing(listingId)` | Cancel unmatched sale listing, return stream |
| `buyListing(listingId, maxPriceIn)` | Buy a listed stream at its discounted price |
| `postLendOffer(market, aprBps, capacity)` | Post standing lend-side liquidity |
| `cancelLendOffer(offerId)` | Cancel unmatched lend offer, refund remaining capacity |
| `borrowAgainstOffer(offerId, streamId, borrowAmount, minNetOut)` | Borrow against a standing lend offer, pledging stream as collateral |
| `postBorrowListing(market, streamId, aprBps, borrowAmount)` | Post a borrow request for a specific stream |
| `cancelBorrowListing(listingId)` | Cancel unmatched borrow listing, return stream |
| `lendAgainstListing(listingId, minObligationOut)` | Fill a borrow listing, advancing underlying to the borrower |
| `claimLoan(loanId)` | Lender draws accrued ovrfloToken from a loan's pledged stream |
| `closeLoan(loanId)` | Permissionless: draw remaining outstanding, return stream to borrower |
| `repayLoan(loanId, amount)` | Borrower repays ovrfloToken to reduce or clear the obligation |
| `quote(market, streamId, aprBps, borrowAmount)` | Preview price, obligation, fee, net, and residual for a given stream |
| `setAprBounds(aprMinBps, aprMaxBps)` | Set accepted APR range for new posts (owner) |
| `setFee(feeBps)` | Set protocol fee on fills (owner) |
| `setTreasury(treasury)` | Set fee recipient (owner) |

**StreamPricing.sol** (new section — shared pricing):

- Pure library: factor, grossPrice, obligation, obligationForFill, fee, marketActive, requireEligible
- Linear discount model: `f = 1 + apr * ttm / year`
- Rounding: grossPrice floors (buyer-favorable), obligation ceils (lender-favorable)
- Critical invariant: `obligation <= remaining` for all partial borrows (proven, stress-tested)

**OVRFLOFactory.sol** (updated signatures):

| Function | Description |
|----------|-------------|
| `constructor(owner, oracle)` | Deploy factory with Pendle oracle address (immutable) |
| `configureDeployment(treasury, underlying, nameSuffix, symbolSuffix)` | Stage deployment parameters |
| `deploy()` | Deploy OVRFLO + OVRFLOToken from stored config |
| `addMarket(ovrflo, market, twapDuration, feeBps)` | Add a PT maturity (no oracle param — uses factory immutable) |
| `prepareOracle(market, twapDuration)` | Increase oracle cardinality (no oracle param) |
| `setMarketDepositLimit(ovrflo, market, limit)` | Set deposit cap |
| `sweepExcessPt(ovrflo, ptToken, to)` | Sweep excess PT |
| `sweepExcessUnderlying(ovrflo, to)` | Sweep excess underlying |

**OVRFLO.sol** (updated — reframed as "Collateral Creation"):

- Same function table as current README but with updated `setSeriesApproved` signature (6 params, no oracle/underlying/ovrfloToken)
- `series()` getter returns 8-tuple ABI (synthesized from immutables)
- Note the vault immutables: underlying, ovrfloToken, oracle

**OVRFLOToken.sol**: Unchanged from current README.

### 3.5 User Flows

**Creating Collateral (Core):**
- Depositing: same as current README
- Claiming: same as current README
- Withdrawing from stream: same as current README
- Wrap/unwrap: add brief mention (permissionless 1:1 underlying ↔ ovrfloToken)

**Selling a Stream (Book):**
- Two paths: sell into a standing offer (`sellIntoOffer`) or list for sale (`postSaleListing` → `buyListing`)
- Both transfer the stream permanently for discounted underlying

**Borrowing Against a Stream (Book):**
- Two paths: borrow against a standing lend offer (`borrowAgainstOffer`) or post a borrow listing (`postBorrowListing` → `lendAgainstListing`)
- Pledge stream as collateral, receive underlying, owe ovrfloToken obligation at maturity
- Stream deterministically pays the lender — no liquidations

**Loan Servicing (Book):**
- Lender draws accrued ovrfloToken via `claimLoan` (capped at outstanding)
- `closeLoan` (permissionless): draw remaining, return stream to borrower
- `repayLoan`: borrower can repay early in ovrfloToken to reduce obligation and reclaim stream

### 3.6 Admin Flows

Updated for new signatures:
- Factory constructor: `new OVRFLOFactory(multisig, PENDLE_ORACLE)`
- Book constructor: `new OVRFLOBook(factory, core, sablier)` (3 params, no APR/fee ceiling)
- `addMarket`: 4 params (no oracle)
- `prepareOracle`: 2 params (no oracle)
- APR bounds: `setAprBounds(min, max)` — capped at 10,000 (100%) constant
- Fee: `setFee(feeBps)` — capped at 10,000 (100%) constant

### 3.7 Fee Structure

Two separate fees:
- **Core deposit fee**: charged on immediate portion, paid in underlying, sent to treasury
- **Book protocol fee**: charged on sale price or borrow amount, paid in underlying, sent to book treasury
- Both capped at 100% by constant (`FEE_MAX_BPS` on core, `MAX_FEE_BPS` on book)

### 3.8 Security

Updated section:
- Access control: same hierarchy (multisig → factory → vault; multisig → book owner)
- APR ceiling: hardcoded at 100% (`APR_MAX_CEILING = 10_000`)
- Fee ceiling: hardcoded at 100% on both core and book
- StreamPricing math: floor/ceil rounding is directional and load-bearing, stress-tested (link to `plans/streampricing-math-analysis.md`)
- No liquidations: deterministic non-cancelable streams can't underperform
- Slippage protection on all book fills (`minNetOut`, `minObligationOut`)
- Two-step ownership on factory and book
- Design notes: ovrfloToken fungibility across maturities (preserved from current README)

### 3.9 Roadmap

One paragraph: The Pool — passive, closed-end, sealed, pro-rata aggregation of loans over the same StreamPricing core. Many lenders pool underlying, many borrowers each pledge a stream, residuals return per borrower, lenders own pro-rata the sum of obligations. Built after the Book sets a market APR.

### 3.10 Preserved Sections

Keep as-is (with minor signature updates where needed):
- External Dependencies table
- Deployments table
- Development (build, test, fork tests, frontend, deploy, local loop, devnet loop)
- Integration Guide (update `series()` destructuring for 8-tuple)
- License

## 4. Hard Floor

- Must cover all 5 contracts (OVRFLOBook, StreamPricing, OVRFLO, OVRFLOFactory, OVRFLOToken)
- Must lead with Self-Repaying Loans as the product, not Fixed Yield Collateral
- Must document all book user flows (sell, borrow, loan servicing)
- Must use updated function signatures from this session's refactors
- Must mention Pool as roadmap
- Must not change any code

## 5. Deferred

- Detailed API reference (beyond function tables) — link to NatSpec in source
- Frontend documentation — separate concern
- Deployment addresses — TBD, same as current
- StreamPricing deep-dive — link to `plans/streampricing-math-analysis.md`

## 6. Outstanding Questions

None — scope is clear.
