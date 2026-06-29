# Sablier V2 Interface Contract for OVRFLO

> Dependency assumptions OVRFLO relies on from Sablier V2 Lockup Linear, scoped to the calls OVRFLO actually makes. This is a contract to falsify, not a Sablier tutorial. Pinned to the deployed address `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (tag `v1.1`). The v1.1 version distinction is load-bearing — see the ACL table below.

OVRFLO uses Sablier only for linear vesting streams created on PT deposit and then traded/pledged through `OVRFLOBook`. It never cancels a stream programmatically and relies on non-cancelability for the self-repaying-loan design.

## Assumption rows

### S1. `createWithDurations` creates a non-cancelable, no-cliff linear stream

- **Assumed property:** The stream is created with `sender = OVRFLO vault`, `recipient = depositor`, `asset = ovrfloToken`, a fixed end time = series `expiryCached`, no cliff, and **non-cancelable**.
- **Enforced?** **Yes, at creation** via `OVRFLO.deposit()`, and **at every book entry** via `StreamPricing.requireEligible()` which validates sender, asset, end time, no-cliff, and non-cancelability (invariant **X-5**).
- **If violated:** A cancelable or cliff-bearing stream could be pledged as loan collateral and then voided, breaking the self-repaying-loan invariant. `requireEligible` rejects these; the residual risk is `requireEligible` being bypassed or stale-cached (see X-5 probe direction below).
- **OVRFLO call site:** `OVRFLO.deposit()` (creation), `StreamPricing.requireEligible()` (validation at every book trade/loan).

### S2. `withdrawableAmountOf` is monotonic and reflects accrued value

- **Assumed property:** `withdrawableAmountOf(streamId)` increases monotonically with time and drops only by the amount withdrawn on a successful `withdraw`.
- **Enforced?** **External (trusted).** This is invariant **X-2 (On-chain: No)** — OVRFLO depends on Sablier v1.1 behavior it cannot enforce locally. `OVRFLOBook.closeLoan()` uses `withdrawableAmountOf()` to gate closability.
- **If violated:** Closability and lender draw paths deviate from local bookkeeping. See `x-ray/invariants.md#x-2`.
- **OVRFLO call site:** `OVRFLOBook.closeLoan()`, `OVRFLOBook.poolClaimLoan()`.

### S3. `transferFrom` moves the stream NFT and changes recipient/ownership

- **Assumed property:** `sablier.transferFrom(from, to, streamId)` moves the NFT so that `to` becomes the recipient/owner for withdraw-ACL purposes.
- **Enforced?** **External (trusted).** OVRFLO relies on standard ERC-721 `transferFrom` semantics; the book takes custody via `transferFrom` and later returns the stream via `transferFrom` on loan close.
- **If violated:** NFT ownership/recipient tracking diverges from the book's loan state. Standard ERC-721 behavior; residual risk is a non-standard Sablier override.
- **OVRFLO call site:** `OVRFLOBook` (escrow on list/borrow), `OVRFLOBook.closeLoan()` (return to borrower).

### S4. `withdraw` ACL — sender / NFT owner / approved operator only (v1.1)

- **Assumed property:** `SablierV2Lockup.withdraw(streamId, to, amount)` reverts `SablierV2Lockup_Unauthorized` unless `msg.sender` is the stream **sender**, the **NFT owner (recipient)**, or an **ERC-721 approved operator**. There is **no permissionless public withdraw** in v1.1.
- **Enforced?** **External (trusted).** This is the exact distinction that flipped audit finding **H-2** from High to Rejected — see the ACL table and `rejected-findings-record.md`.
- **If violated:** A permissionless withdraw path would let a third party drain an escrowed stream. Verified not to exist in v1.1 bytecode at the pinned address.
- **OVRFLO call site:** `OVRFLOBook.poolClaimLoan()` / `closeLoan()` (book, as NFT owner, withdraws to contributor or `poolProceeds`).

## Verified v1.1 withdraw-ACL table

Keyed to deployed `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (v2-core tag `v1.1`). Source of truth: `x-ray/multi-agent-audit-report.md` (verified against v1.1 source).

| Caller | While user holds NFT | While book holds NFT |
|--------|----------------------|----------------------|
| Random third party | `Unauthorized` revert | `Unauthorized` revert |
| User (owner/recipient) | withdraw to any `to` | N/A (no longer owner) |
| Book (owner/recipient) | N/A | withdraw to any `to` (e.g. contributor in `poolClaimLoan`) |
| Approved operator | withdraw to any `to` | depends on approval state |
| OVRFLO vault (sender) | only `to == recipient` | only `to == book` (trusted) |

> **Version caveat:** Some newer Sablier Lockup docs describe a public "withdraw to recipient" path. That does **not** apply to the V2 v1.1 bytecode OVRFLO integrates. An auditor who reads the newer docs and re-raises this as a High finding is re-litigating settled ground — see `rejected-findings-record.md` (H-2).

## NFT ownership through the Book lifecycle

The loan close path hinges on who is the Sablier NFT owner at each stage:

| Stage | NFT owner / recipient | Who can withdraw |
|-------|----------------------|------------------|
| After deposit, user holds | user | user (to any `to`); vault-as-sender only to `to == user` |
| Stream listed / pledged as loan collateral | `OVRFLOBook` (took custody via `transferFrom`) | book (to any `to`, e.g. lender) |
| Loan closed (withdrawable ≥ outstanding) | returned to borrower via `transferFrom` | borrower |

Pricing at fill uses `deposited − withdrawn` (already-withdrawn value is excluded), documented in the book plan and the internal-model explainer.

## X-5 probe direction (enforced, but probe anyway)

`requireEligible()` (invariant **X-5**) is enforced on-chain at every book trade/loan path, so it does **not** appear in the not-enforced ledger. However, `x-ray/x-ray.md` flags it as a key attack surface: *"worth checking any path that can bypass or stale-cache this gate."* When reviewing the book, probe whether any entry can reach a trade/loan fill without passing through `requireEligible`, or whether eligibility state could be stale-cached relative to the live Sablier stream metadata.
