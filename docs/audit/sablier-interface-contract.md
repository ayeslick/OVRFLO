# Sablier V2 Interface Contract for OVRFLO

> **Stale IDs.** Invariant/guard IDs in this document predate the 2026-08-10 `x-ray/` regeneration at `f0661ab`; resolve them by statement via the ID map in `AUDIT.md`, not by number.

> Dependency assumptions OVRFLO relies on from Sablier V2 Lockup Linear, scoped to the calls OVRFLO actually makes. This is a contract to falsify, not a Sablier tutorial. Pinned to the deployed address `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (tag `v1.1`). The v1.1 version distinction is load-bearing — see the ACL table below.

OVRFLO uses Sablier only for linear vesting streams created on PT deposit and then traded/pledged through `OVRFLOLending`. It never cancels a stream programmatically and relies on non-cancelability for the self-repaying-loan design.

## Assumption rows

### S1. `createWithDurations` creates a non-cancelable, no-cliff linear stream

- **Assumed property:** The stream is created with `sender = OVRFLO vault`, `recipient = depositor`, `asset = ovrfloToken`, a fixed end time = series `expiryCached`, no cliff, and **non-cancelable**.
- **Enforced?** **Yes, at creation** via `OVRFLO.deposit()`, and **at every lending entry** via `StreamPricing.requireEligible()` which validates sender, asset, end time, no-cliff, and non-cancelability (market-approval layer: invariant **X-1**).
- **If violated:** A cancelable or cliff-bearing stream could be pledged as loan collateral and then voided, breaking the self-repaying-loan invariant. `requireEligible` rejects these; the residual risk is `requireEligible` being bypassed or stale-cached (see probe direction below).
- **OVRFLO call site:** `OVRFLO.deposit()` (creation), `StreamPricing.requireEligible()` (validation at every lending trade/loan).

### S2. `withdrawableAmountOf` is monotonic and reflects accrued value

- **Assumed property:** `withdrawableAmountOf(streamId)` increases monotonically with time and drops only by the amount withdrawn on a successful `withdraw`.
- **Enforced?** **External (trusted).** OVRFLO depends on Sablier v1.1 behavior it cannot enforce locally. `OVRFLOLending.closeLoan()` uses `withdrawableAmountOf()` to gate closability (guard **G-23**).
- **If violated:** Closability and lender draw paths deviate from local lendingkeeping. See `x-ray/invariants.md` and the trust-assumption ledger.
- **OVRFLO call site:** `OVRFLOLending.closeLoan()`, `OVRFLOLending.claimLoanPoolShare()` (via _claimFair harvest).

### S3. `transferFrom` moves the stream NFT and changes recipient/ownership

- **Assumed property:** `sablier.transferFrom(from, to, streamId)` moves the NFT so that `to` becomes the recipient/owner for withdraw-ACL purposes.
- **Enforced?** **External (trusted).** OVRFLO relies on standard ERC-721 `transferFrom` semantics; the lending takes custody via `transferFrom` and later returns the stream via `transferFrom` on loan close.
- **If violated:** NFT ownership/recipient tracking diverges from the lending's loan state. Standard ERC-721 behavior; residual risk is a non-standard Sablier override.
- **OVRFLO call site:** `OVRFLOLending` (escrow on list/borrow), `OVRFLOLending.closeLoan()` (return to borrower).

### S4. `withdraw` ACL — sender / NFT owner / approved operator only (v1.1)

- **Assumed property:** `SablierV2Lockup.withdraw(streamId, to, amount)` reverts `SablierV2Lockup_Unauthorized` unless `msg.sender` is the stream **sender**, the **NFT owner (recipient)**, or an **ERC-721 approved operator**. There is **no permissionless public withdraw** in v1.1.
- **Enforced?** **External (trusted).** This is the exact distinction that flipped audit finding **H-2** from High to Rejected — see the ACL table and `rejected-findings-record.md`.
- **If violated:** A permissionless withdraw path would let a third party drain an escrowed stream. Verified not to exist in v1.1 bytecode at the pinned address.
- **OVRFLO call site:** `OVRFLOLending.claimLoanPoolShare()` (via _claimFair harvest) / `closeLoan()` (lending, as NFT owner, withdraws to lender or `loanPoolProceeds`).

### S5. `withdraw` fires no recipient hook when the caller *is* the recipient (v1.1)

- **Assumed property:** v2-core v1.1 `SablierV2Lockup.withdraw` calls `ISablierV2LockupRecipient.onStreamWithdrawn` on the stream's recipient — in a `try/catch`, so a reverting hook cannot block the withdraw — **only** when the recipient is a contract **and** the source predicate `msg.sender != recipient` holds. When the caller is the recipient itself, the hook branch is skipped entirely and `withdraw` performs no callback into any address.
- **Enforced?** **Structurally, at every OVRFLO call site.** `OVRFLOLending` only ever withdraws from a stream whose NFT it currently owns (it takes custody with `transferFrom` at borrow and gives it back at close), so at each call `msg.sender == address(this) == recipient` and the predicate is false. There is no OVRFLO path that withdraws from a stream owned by someone else — S4's ACL would reject it anyway. Belt-and-braces: `claim`, `close`, and `repay` each carry `nonReentrant` individually, so even a hook that did fire could not re-enter the market.
- **If violated:** A recipient callback would hand an arbitrary contract control mid-`withdraw`, before OVRFLO's post-call transfers. The claim path is written effects-before-interactions regardless (all of `received`, `proceeds`, and `loan.drawn` are written before the first external call), so a firing hook would observe consistent state — but the assumption above is what makes the callback surface empty in the first place, and it is the falsifiable claim: **if a v1.1 `withdraw` ever invokes `onStreamWithdrawn` when `msg.sender == recipient`, this row is wrong.**
- **OVRFLO call site:** `OVRFLOLending.claim()` (just-in-time deficit harvest, `sablier.withdraw(loan.streamId, address(this), harvestAmount)`) and `OVRFLOLending.close()` (settlement draw, `sablier.withdraw(streamId, address(this), outstanding)`). Both pass `address(this)` as `to`, and both run while the market is the NFT owner — the only two `withdraw` call sites in the contract.

## Verified v1.1 withdraw-ACL table

Keyed to deployed `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (v2-core tag `v1.1`). Source of truth: `x-ray/multi-agent-audit-report.md` (verified against v1.1 source).

| Caller | While user holds NFT | While lending holds NFT |
|--------|----------------------|----------------------|
| Random third party | `Unauthorized` revert | `Unauthorized` revert |
| User (owner/recipient) | withdraw to any `to` | N/A (no longer owner) |
| Lending (owner/recipient) | N/A | withdraw to any `to` (e.g. lending in `_claimFair` harvest) |
| Approved operator | withdraw to any `to` | depends on approval state |
| OVRFLO vault (sender) | only `to == recipient` | only `to == lending` (trusted) |

> **Version caveat:** Some newer Sablier Lockup docs describe a public "withdraw to recipient" path. That does **not** apply to the V2 v1.1 bytecode OVRFLO integrates. An auditor who reads the newer docs and re-raises this as a High finding is re-litigating settled ground — see `rejected-findings-record.md` (H-2).

## NFT ownership through the Lending lifecycle

The loan close path hinges on who is the Sablier NFT owner at each stage:

| Stage | NFT owner / recipient | Who can withdraw |
|-------|----------------------|------------------|
| After deposit, user holds | user | user (to any `to`); vault-as-sender only to `to == user` |
| Stream listed / pledged as loan collateral | `OVRFLOLending` (took custody via `transferFrom`) | lending (to any `to`, e.g. lender) |
| Loan closed (withdrawable ≥ outstanding) | returned to borrower via `transferFrom` | borrower |

Pricing at fill uses `deposited − withdrawn` (already-withdrawn value is excluded), documented in the lending plan and the internal-model explainer.

## requireEligible probe direction (enforced, but probe anyway)

`requireEligible()` is enforced on-chain at every lending trade/loan path, so it does **not** appear in the not-enforced ledger. However, `x-ray/x-ray.md` flags it as a key attack surface: *"worth checking any path that can bypass or stale-cache this gate."* When reviewing the lending, probe whether any entry can reach a trade/loan fill without passing through `requireEligible`, or whether eligibility state could be stale-cached relative to the live Sablier stream metadata.
