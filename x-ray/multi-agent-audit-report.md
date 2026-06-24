# Multi-Agent Solidity Audit Report

> OVRFLO | branch `main` | 23/06/26 (revised 23/06/26)  
> Scope: `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`, `src/OVRFLOBook.sol`, `src/StreamPricing.sol`, `src/OVRFLOToken.sol`

---

## Summary

Multi-agent security review across 10 distinct audit personas (9 completed; 1 performance pass blocked by API quota). No **Critical** or **High** unprivileged exploit was identified under documented trust assumptions (timelocked multisig admin, canonical Pendle PT/oracle integrations, Sablier V2 Lockup Linear v1.1 at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`, standard ERC20 behavior).

| Severity | Count | Notes |
|----------|------:|-------|
| High | 0 | H-2 rejected after on-chain Sablier V2 ACL verification; H-1 downgraded |
| Medium | 1 | Oracle / operational risk (M-4) |
| Low | 3 | Defense-in-depth cast (ex-H-1), dust spam, deploy footguns |
| Informational | 4 | Trust-boundary / by-design items (ex-M-1, M-2, M-3, M-6 partial) |
| Rejected | 1 | H-2 (Sablier withdraw grief); M-5 (cross-market fungibility) |

Related pre-audit context: [x-ray.md](x-ray.md), [invariants.md](invariants.md), [entry-points.md](entry-points.md).

---

## Post-review revisions (23/06/26)

Follow-up review against OVRFLO product design and **Sablier V2 Lockup Linear v1.1** source ([`sablier-labs/v2-core` tag `v1.1`](https://github.com/sablier-labs/v2-core/tree/v1.1), matching deployed `0xAFb979…`). Key corrections:

1. **H-2 rejected.** Sablier V2 `withdraw()` reverts `SablierV2Lockup_Unauthorized` unless `msg.sender` is the stream **sender**, **NFT owner (recipient)**, or **ERC-721 approved operator**. There is no permissionless public withdraw path in v1.1 (unlike some newer Sablier Lockup docs for later versions).
2. **H-1 downgraded to Low.** Technically valid cast guard; economically unreachable with 18-decimal Pendle PT.
3. **M-5 rejected.** Cross-series `ovrfloToken` fungibility is intentional (`README.md`, book plan). Pendle does not normally produce two onboarded markets with identical `expiryCached` under one core.
4. **M-1 / M-2 reclassified informational.** Pendle-only onboarding assumption; multisig validates markets at `addMarket()`.
5. **M-3 reclassified informational / by design.** Permissionless `closeLoan()` matches spec (liveness once stream is closable).

---

## Sablier V2 integration (verified)

OVRFLO deposits create streams with `sender = OVRFLO` and `recipient = depositor` (`src/OVRFLO.sol`). In Sablier V2, **recipient = NFT owner** (`_ownerOf(streamId)`).

When `OVRFLOBook` takes custody via `sablier.transferFrom`, the **book becomes recipient/owner**. Withdraw ACL from `SablierV2Lockup.withdraw()` (v1.1):

```solidity
bool isCallerStreamSender = _isCallerStreamSender(streamId);
if (!isCallerStreamSender && !_isCallerStreamRecipientOrApproved(streamId)) {
    revert Errors.SablierV2Lockup_Unauthorized(streamId, msg.sender);
}
address recipient = _ownerOf(streamId);
if (isCallerStreamSender && to != recipient) {
    revert Errors.SablierV2Lockup_InvalidSenderWithdrawal(streamId, msg.sender, to);
}
```

| Caller | While user holds NFT | While book holds NFT |
|--------|----------------------|----------------------|
| Random third party | ❌ `Unauthorized` | ❌ `Unauthorized` |
| User (owner/recipient) | ✅ withdraw to any `to` | N/A (no longer owner) |
| Book (owner/recipient) | N/A | ✅ withdraw to any `to` (e.g. lender in `claimLoan`) |
| Approved operator (e.g. book pre-transfer) | ✅ withdraw to any `to` | Depends on approval state |
| OVRFLO vault (sender) | ✅ only `to == recipient` | ✅ only `to == book` (trusted protocol) |

Book flows require user `approve(book, streamId)` before `transferFrom` (exercised in `test/fork/OVRFLOBookMainnetFork.t.sol`). Lender recovery uses `claimLoan` / `closeLoan` where **the book** calls `sablier.withdraw(streamId, lender, amount)` — not the lender directly.

**Pre-custody note:** Original recipient may withdraw vested `ovrfloToken` before listing/borrowing; pricing uses `deposited − withdrawn` at fill time (documented in book plan). After NFT transfer to the book, former holder cannot withdraw.

---

## Findings (severity-ranked)

### L-1 — Unchecked `uint128` / `uint40` narrowing in `OVRFLO.deposit` (ex-H-1)

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLO.sol` — `deposit()` |
| **Agents** | solidity-security-auditor, ce-correctness-reviewer |
| **Confidence** | High (code path); **Low practical exploitability** |
| **Prior severity** | High → **Low** |

**Root cause:** `toStream` is cast `uint128(toStream)` for Sablier without an explicit bound; `duration` is cast `uint40(expiryCached - block.timestamp)` without an onboard-time bound in `deposit()` (eligibility rejects `expiryCached > type(uint40).max` in `StreamPricing`, but deposit does not).

**Impact:** If `toStream > type(uint128).max`, truncation could strand excess minted `ovrfloToken` on the vault. With 18-decimal Pendle PT this is not reachable in practice (`uint128.max ≈ 3.4×10³⁸`).

**Minimal fix (defense in depth):**

```solidity
require(toStream <= type(uint128).max, "OVRFLO: stream amount overflow");
require(duration <= type(uint40).max, "OVRFLO: duration overflow");
// before mint + createWithDurations
```

`OVRFLOBook` already uses `_toUint128()` for analogous bounds.

---

### M-4 — Oracle-driven deposit split and availability

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLO.sol` — `deposit()`; `src/OVRFLOFactory.sol` — `addMarket()` |
| **Agents** | security-sentinel, ce-adversarial-reviewer, ce-reliability-reviewer |
| **Confidence** | Medium |

**Issues:**

- Oracle TWAP is validated at onboarding, not re-checked per deposit ([X-2](invariants.md#x-2)).
- If `getPtToSyRate() >= 1e18`, `toStream == 0` and `require(toStream > 0)` blocks deposits — **correct product behavior** (no discount → nothing to stream), not a logic bug.
- Manipulated/stale TWAP can skew immediate vs streamed split; fee is charged only on `toUser`, so depressed rate reduces protocol fee.

**Minimal fix:** Document oracle trust boundary; optional per-deposit staleness/deviation bounds if ops want tighter gates.

---

### L-2 — Dust loan/fill griefing and unbounded ID growth

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLOBook.sol` — offer/listing/loan ID allocators |
| **Agents** | ce-performance-reviewer, ce-security-sentinel |
| **Confidence** | Low |

**Root cause:** `borrowAmount > 0` and `capacity > 0` only; monotonic IDs with permanent mapping writes.

**Impact:** Storage/event spam; indexer/UI pressure — not direct fund theft.

**Minimal fix:** `MIN_BORROW` / `MIN_FILL` / minimum offer notional; optional listing fee.

---

### L-3 — `OVRFLOToken.transferOwnership` is single-step

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLOToken.sol` |
| **Agents** | solidity-security-auditor |
| **Confidence** | Low |

Factory uses `Ownable2Step`; token ownership handoff to vault is one-step. Fat-finger risk at deploy only.

---

### I-1 — PT transfer accounting assumes exact transfer in `deposit()` (ex-M-1)

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLO.sol` — `deposit()` |
| **Agents** | security-sentinel, ce-adversarial-reviewer |
| **Confidence** | Informational (admin scope) |
| **Prior severity** | Medium → **Informational** |

**Root cause:** `marketTotalDeposited` and mint split use user-supplied `ptAmount`, not measured PT received. Unlike `wrap()` and `OVRFLOBook._pullExact()`, no balance-delta check after `safeTransferFrom`.

**Impact:** Only if non-standard PT were onboarded — outside stated Pendle-only scope. Multisig `addMarket()` validates canonical Pendle markets.

**Minimal fix (optional):** Balance delta or `require(actualReceived == ptAmount)`; document “Pendle PT only” in security docs.

---

### I-2 — Fee collection assumes exact-transfer underlying (ex-M-2)

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLO.sol` — `deposit()` |
| **Agents** | ce-security-sentinel |
| **Confidence** | Informational (admin scope) |
| **Prior severity** | Medium → **Informational** |

Fee computed on `toUser` and transferred to treasury without balance-delta verification. Same trust boundary as I-1 for canonical yield underlyings.

---

### I-3 — Permissionless `closeLoan()` (ex-M-3)

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLOBook.sol` — `closeLoan()` |
| **Agents** | solidity-security-auditor, x-ray threat model |
| **Confidence** | Informational / by design |
| **Prior severity** | Medium → **Informational** |

**Root cause:** Any address can call `closeLoan()` once `withdrawable >= outstanding`.

**Impact:** Removes borrower timing optionality on when to finish via `repayLoan`; does not misroute funds — lender receives final draw, borrower receives residual NFT ([I-8](invariants.md#i-8), book plan R15).

**Resolution:** Accept as intentional liveness; document in security README if not already explicit.

---

### I-4 — Operational trust concentration (ex-M-6)

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLO.sol`, `src/OVRFLOFactory.sol`, `src/OVRFLOBook.sol` |
| **Agents** | ce-reliability-reviewer, solidity-security-auditor |
| **Confidence** | Informational (operational) |
| **Prior severity** | Medium → **Informational** |

| Item | Assessment |
|------|------------|
| No `adminContract` migration on `OVRFLO` | **By design** — set once in constructor; factory is permanent admin hub |
| No per-market book freeze beyond deposit limits | Operational gap; stop deposits via `limit = 0` does not pause secondary market |
| Immutable Sablier in `OVRFLO` / `OVRFLOBook` | **Intentional** (immutable V2 integration) |
| `OVRFLOBook` constructor `MAX_FEE_BPS` not capped at `10_000` | Deploy footgun; runtime `setFee()` enforces `<= MAX_FEE_BPS` |

---

## Rejected findings

### ~~H-2~~ — Escrow value sink / permissionless withdraw while book holds stream NFT

| Field | Detail |
|-------|--------|
| **Original severity** | High (conditional) |
| **Status** | **Rejected — not exploitable** |
| **Verified against** | Sablier V2 Lockup v1.1 `SablierV2Lockup.sol` + deployed `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` |

**Original claim:** Third parties could call `sablier.withdraw(streamId, address(book), amount)` while the book escrows the NFT, reducing `remaining` and stranding `ovrfloToken` on the book.

**Why rejected:** Sablier V2 v1.1 requires `msg.sender` to be stream **sender**, **NFT owner**, or **approved operator** — otherwise `SablierV2Lockup_Unauthorized`. There is no permissionless withdraw, including no “withdraw to recipient on behalf of anyone” path. When the book holds the NFT it **is** the recipient; only the book (or its approved operators) can withdraw to third parties such as the lender. The OVRFLO vault as sender may only withdraw **to** the current recipient (the book), which is trusted protocol behavior.

**Note:** Initial review and some Sablier Lockup docs (later versions) describe a public “withdraw to recipient” row; that does **not** apply to the V2 v1.1 bytecode OVRFLO integrates.

No `_sweepOvrfloTo` or similar is required for this threat model.

---

### ~~M-5~~ — Cross-market stream reuse when `expiryCached` collides

| Field | Detail |
|-------|--------|
| **Original severity** | Medium |
| **Status** | **Rejected — not a bug under OVRFLO design** |

**Original claim:** Streams from market A could be used against market B liquidity when both share `expiryCached` and `ovrfloToken`.

**Why rejected:**

1. **Intentional fungibility** — one `ovrfloToken` per underlying across approved maturities is a documented product feature (`README.md`, `CONCEPTS.md`, book plan). `endTime == expiryCached` is the deliberate series pin when `asset` alone cannot identify series.
2. **Pendle practice** — distinct Pendle markets for the same underlying use distinct expiries; onboarding two markets with identical `expiryCached` is not a normal deployment pattern.
3. **Economic equivalence** — same `ovrfloToken` + same maturity end time ⇒ economically identical stream claim regardless of which `market` parameter is passed to the book.

---

## Reviewed — no medium+ issue (consensus)

| Area | Result |
|------|--------|
| Sablier withdraw during book escrow | V2 v1.1 ACL: sender / owner / approved only — no unprivileged path |
| Maker fee snapshots on listings | `feeBps` snapshotted at post; settlement uses stored fee — intentional |
| `lendAgainstListing(minObligationOut)` | Obligation computed before slippage check |
| Loan accounting `drawn + repaid ≤ obligation` | Enforced via `_outstanding` |
| Stream eligibility vs `OVRFLO.deposit` creation | Sender, asset, end time, non-cancelable aligned |
| Reentrancy on book mutators | `nonReentrant` on state-changing externals |
| Admin APR drift on resting offers | Governance/trust boundary ([I-7](invariants.md#i-7)), not unprivileged exploit |
| Book `claimLoan` / `closeLoan` Sablier calls | Book as NFT owner/recipient withdraws to lender; fork-tested |

---

## Resolved open questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Sablier withdraw ACL while book is recipient? | **Closed.** V2 v1.1: only sender, NFT owner, or approved operator. No public withdraw. |
| 2 | `closeLoan` permissionless intent? | **By design** — liveness per book plan R15. |
| 3 | Token assumptions (Pendle PT / exact transfer)? | **Trust boundary** — admin onboarding; document explicitly. |
| 4 | Multi-market same `expiryCached`? | **Not a practical Pendle concern**; fungibility makes cross-market routing acceptable anyway. |
| 5 | Stale fee on listings after `setFee()`? | **Intentional maker protection** (fee snapshotted at listing post). |

---

## Test gaps (prioritized)

| Priority | Gap | Suggested test |
|----------|-----|----------------|
| P1 | No negative auth tests on book cancel paths | Prank non-maker; assert revert + unchanged escrow |
| P1 | No invariant/fuzz on loan lifecycle interleaving | Random `claimLoan` / `repayLoan` / `closeLoan` sequences |
| P2 | `toStream > uint128.max` deposit path | Assert revert, not silent truncation |
| P2 | `expiryCached > uint40.max` at deposit | Assert revert (or align deposit with eligibility bound) |
| P2 | Sablier `Unauthorized` on pranked withdraw during book escrow | Fork test: stranger, former borrower, lender prank `withdraw` → revert |
| P3 | Oracle rate `>= 1e18` deposit branch | Mock TWAP; assert `nothing to stream` revert |
| ~~P2~~ | ~~Cross-market same-expiry stream reuse~~ | **Removed** — would encode wrong product behavior |
| ~~P2~~ | ~~Sablier withdraw-to-book grief~~ | **Removed** — rejected finding |

---

## Audit coverage

| Agent | Status | Focus |
|-------|--------|-------|
| solidity-security-auditor | Complete | Full repo audit |
| security-sentinel | Complete | Auth, oracle, token assumptions |
| ce-adversarial-reviewer | Complete | Permissionless exploit playbooks |
| ce-security-reviewer | Complete | Trust boundaries, config |
| ce-correctness-reviewer | Complete | Edge-case logic, casts |
| ce-reliability-reviewer | Complete | Outage, control-plane gaps |
| ce-performance-reviewer | Complete | State growth, gas griefing |
| ce-testing-reviewer | Complete | Test coverage gaps |
| security-review | Complete | OVRFLOBook / StreamPricing deep pass |
| ce-security-sentinel | Complete | Exploit paths under trust model |
| ce-performance-oracle | **Not run** | API quota limit |
| Manual follow-up (23/06/26) | Complete | Sablier V2 v1.1 ACL verification; OVRFLO design alignment |

---

## Recommended fix order

1. **L-1** — Add `toStream <= type(uint128).max` and `duration <= type(uint40).max` in `deposit()` (cheap; matches book patterns).
2. **M-4** — Document oracle trust boundary; optional staleness policy if ops require it.
3. **I-1 / I-2** — Document Pendle-only token assumptions in security docs (optional balance-delta hardening).
4. **I-3** — Document permissionless `closeLoan` as intentional liveness.
5. **L-2** — Minimum notionals on book if operational spam is a concern.

~~H-2~~ and ~~M-5~~ require no code changes.

---

*Report generated from parallel multi-agent review, revised after Sablier V2 v1.1 source verification and OVRFLO product-design alignment. No on-chain code was modified as part of this revision.*
