# Sablier V2 Interface Contract for OVRFLO

> **Stale IDs.** Invariant/guard IDs in this document predate the 2026-08-10 `x-ray/` regeneration at `f0661ab`; resolve them by statement via the ID map in `AUDIT.md`, not by number.

> Dependency assumptions OVRFLO relies on from the bound stream lockup, scoped to the calls OVRFLO actually makes. This is a contract to falsify, not a Sablier tutorial.

**Bound contract:** OVRFLO Streams — a GPL fork of Sablier v2-core **v1.1.2**, Solidity contract `SablierV2LockupLinear`, deployed ERC721 identity `OVRFLOStream`. Vault getter name stays `sablierLL()`. Factory storage is `ovrfloStream` (set once via `setOvrfloStream`).

**Address change (R11):** `sablierLL` **no longer** resolves to the canonical Sablier deployment `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`. Binding is the constructor argument on each vault / lending market, admitted by `factory.ovrfloStream()`. Checking canonical Sablier and lucking into the right ACL answer is not following evidence.

**Provenance:** fork of Sablier v2-core v1.1.2. The withdraw ACL is preserved byte-for-byte from v1.1 (**plan R3**), so the twice-rejected third-party-withdraw disproof still holds against the fork. The v1.1 version distinction remains load-bearing — see the ACL table below.

**Preserve-exactly set:** rows S1–S5 below (SC12). Do not treat `StreamPricing.sol:209` as create-side cliff arithmetic — that line is the consume-side `CliffPresent` check.

OVRFLO uses the bound lockup only for linear vesting streams created on PT deposit and then pledged through `OVRFLOLending`. It never cancels a stream programmatically and relies on non-cancelability for the self-repaying-loan design.

## Assumption rows

### S1. `createWithDurations` creates a non-cancelable, no-cliff linear stream

- **Assumed property:** The stream is created with `sender = OVRFLO vault`, `recipient = depositor`, `asset = ovrfloToken`, a fixed end time = series `expiryCached`, no cliff, and **non-cancelable**.
- **Cliff encoding (SC12):** Vault `deposit` passes `durations.cliff: 0`. Upstream v1.1 stores that as `cliffTime == startTime`. Consume-side `StreamPricing.requireEligible` reverts `CliffPresent` when `cliffTime != startTime` (`StreamPricing.sol:209` — consume-side only, not create-side arithmetic).
- **Enforced?** **Yes, at creation** via `OVRFLO.deposit()`, and **at every lending entry** via `StreamPricing.requireEligible()` which validates sender, asset, end time, no-cliff, and non-cancelability (market-approval layer: invariant **X-1**).
- **If violated:** A cancelable or cliff-bearing stream could be pledged as loan collateral and then voided, breaking the self-repaying-loan invariant. `requireEligible` rejects these; the residual risk is `requireEligible` being bypassed or stale-cached (see probe direction below).
- **OVRFLO call site:** `OVRFLO.deposit()` (creation), `StreamPricing.requireEligible()` (validation at every lending trade/loan).

### S2. `withdrawableAmountOf` is monotonic and reflects accrued value

- **Assumed property:** `withdrawableAmountOf(streamId)` increases monotonically with time and drops only by the amount withdrawn on a successful `withdraw`.
- **Enforced?** **External (trusted).** OVRFLO depends on fork v1.1.2 / upstream v1.1 behavior it cannot enforce locally. `OVRFLOLending.close()` uses `withdrawableAmountOf()` to gate closability (guard **G-23**).
- **If violated:** Closability and lender draw paths deviate from local lendingkeeping. See `x-ray/invariants.md` and the trust-assumption ledger.
- **OVRFLO call site:** `OVRFLOLending.close()`, `OVRFLOLending.claim()` (just-in-time harvest).

### S3. `transferFrom` moves the stream NFT and changes recipient/ownership

- **Assumed property:** `sablier.transferFrom(from, to, streamId)` moves the NFT so that `to` becomes the recipient/owner for withdraw-ACL purposes.
- **Enforced?** **External (trusted).** OVRFLO relies on standard ERC-721 `transferFrom` semantics; the lending takes custody via `transferFrom` and later returns (or burns) the stream on loan settlement.
- **If violated:** NFT ownership/recipient tracking diverges from the lending's loan state. Standard ERC-721 behavior; residual risk is a non-standard lockup override.
- **OVRFLO call site:** `OVRFLOLending.borrow()` (escrow), `OVRFLOLending.close()` / completing `repay` (return or burn).

### S4. `withdraw` ACL — sender / NFT owner / approved operator only (v1.1)

- **Assumed property:** `SablierV2Lockup.withdraw(streamId, to, amount)` reverts `SablierV2Lockup_Unauthorized` unless `msg.sender` is the stream **sender**, the **NFT owner (recipient)**, or an **ERC-721 approved operator**. There is **no permissionless public withdraw** in v1.1.
- **Enforced?** **External (trusted).** This is the exact distinction that flipped internal-review **H-2** and `audit-2026-07-28 H-1` from High to Rejected — see the ACL table and `rejected-findings-record.md`. The fork preserves this ACL byte-for-byte (**R3**).
- **If violated:** A permissionless withdraw path would let a third party drain an escrowed stream. Verified not to exist in upstream v1.1; preserved on the fork by R3.
- **OVRFLO call site:** `OVRFLOLending.claim()` / `close()` (lending, as NFT owner, withdraws to itself then pays lenders).

### S5. `withdraw` fires no recipient hook when the caller *is* the recipient (v1.1)

- **Assumed property:** v2-core v1.1 `SablierV2Lockup.withdraw` calls `ISablierV2LockupRecipient.onStreamWithdrawn` on the stream's recipient — in a `try/catch`, so a reverting hook cannot block the withdraw — **only** when the recipient is a contract **and** the source predicate `msg.sender != recipient` holds. When the caller is the recipient itself, the hook branch is skipped entirely and `withdraw` performs no callback into any address.
- **Enforced?** **Structurally, at every OVRFLO call site.** `OVRFLOLending` only ever withdraws from a stream whose NFT it currently owns (it takes custody with `transferFrom` at borrow and gives it back or burns it at settlement), so at each call `msg.sender == address(this) == recipient` and the predicate is false. There is no OVRFLO path that withdraws from a stream owned by someone else — S4's ACL would reject it anyway. Belt-and-braces: `claim`, `close`, and `repay` each carry `nonReentrant` individually, so even a hook that did fire could not re-enter the market.
- **SETTLED `isCancelable` normalization (SC12):** Upstream `getStream` normalizes `isCancelable` for SETTLED streams. Consume-side eligibility still treats cancelability as a hard reject via `requireEligible`; do not invent create-side semantics from that view normalization alone.
- **If violated:** A recipient callback would hand an arbitrary contract control mid-`withdraw`, before OVRFLO's post-call transfers. The claim path is written effects-before-interactions regardless (all of `received`, `proceeds`, and `loan.drawn` are written before the first external call), so a firing hook would observe consistent state — but the assumption above is what makes the callback surface empty in the first place, and it is the falsifiable claim: **if a v1.1 `withdraw` ever invokes `onStreamWithdrawn` when `msg.sender == recipient`, this row is wrong.**
- **OVRFLO call site:** `OVRFLOLending.claim()` (just-in-time deficit harvest, `sablier.withdraw(loan.streamId, address(this), harvestAmount)`) and `OVRFLOLending.close()` (settlement draw, `sablier.withdraw(streamId, address(this), outstanding)`). Both pass `address(this)` as `to`, and both run while the market is the NFT owner — the only two `withdraw` call sites in the contract.

## Verified v1.1 withdraw-ACL table

Keyed to the **bound OVRFLO Streams fork** (provenance: fork of Sablier v2-core v1.1.2; ACL identical to upstream tag `v1.1` by **R3**). Historical canonical address `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` is **not** the bound contract. Source of truth for the table shape: `x-ray/multi-agent-audit-report.md` (verified against v1.1 source); live binding: `factory.ovrfloStream()` / vault `sablierLL()`.

| Caller | While user holds NFT | While lending holds NFT |
|--------|----------------------|----------------------|
| Random third party | `Unauthorized` revert | `Unauthorized` revert |
| User (owner/recipient) | withdraw to any `to` | N/A (no longer owner) |
| Lending (owner/recipient) | N/A | withdraw to any `to` (e.g. lending in claim/close harvest) |
| Approved operator | withdraw to any `to` | depends on approval state |
| OVRFLO vault (sender) | only `to == recipient` | only `to == lending` (trusted) |

> **Version caveat:** Some newer Sablier Lockup docs describe a public "withdraw to recipient" path. That does **not** apply to the V2 v1.1 bytecode lineage the fork preserves. An auditor who reads the newer docs and re-raises this as a High finding is re-litigating settled ground — see `rejected-findings-record.md` (internal-review H-2 / `audit-2026-07-28 H-1`). Cite **R3**, not a live check of canonical Sablier.

## NFT ownership through the Lending lifecycle

The loan close path hinges on who is the stream NFT owner at each stage:

| Stage | NFT owner / recipient | Who can withdraw |
|-------|----------------------|------------------|
| After deposit, user holds | user | user (to any `to`); vault-as-sender only to `to == user` |
| Stream pledged as loan collateral | `OVRFLOLending` (took custody via `transferFrom`) | lending (to any `to`, e.g. self then lenders) |
| Loan closed / fully repaid | returned to borrower via `transferFrom`, or burned if empty | borrower (if returned) |

Pricing at fill uses `deposited − withdrawn` (already-withdrawn value is excluded), documented in the lending plan and the internal-model explainer.

## Registration trust shift (R8 / KTD6)

After KTD6, the vault stream binding is a constructor argument (getter stays `sablierLL()`). Matching audited vault bytecode alone is **not** a safe stream-binding predicate: two vaults can share bytecode and bind different stream addresses. The safe on-chain predicate is registration:

- `registerOvrflo` / `registerLending` require the candidate binds `factory.ovrfloStream()`.
- `SablierMismatch` still proves vault and lending bind the **same** stream.
- The Safe still checks creation bytecode off-chain (existing register checklist).

## Fees immutable by construction (SC13)

Zero protocol fees on the lockup and comptroller are immutable by construction, not a Safe policy choice. The factory is `initialAdmin` on both. `Adminable` is one-step. The factory forwards `setNFTDescriptor` only (`setStreamNFTDescriptor`) and has no `transferAdmin` forwarder. So `setProtocolFee`, `setFlashFee`, `toggleFlashAsset`, `setComptroller`, and `claimProtocolRevenues` cannot succeed for anyone — not the Safe, not a future factory owner. Human control of stream admin is factory `Ownable2Step` rotation, which carries lockup/comptroller admin with it.

## requireEligible probe direction (enforced, but probe anyway)

`requireEligible()` is enforced on-chain at every lending trade/loan path, so it does **not** appear in the not-enforced ledger. However, `x-ray/x-ray.md` flags it as a key attack surface: *"worth checking any path that can bypass or stale-cache this gate."* When reviewing the lending, probe whether any entry can reach a trade/loan fill without passing through `requireEligible`, or whether eligibility state could be stale-cached relative to the live stream metadata on the bound fork.
