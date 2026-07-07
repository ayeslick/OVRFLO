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

The rejected/downgraded findings and the reclassifications below are now canonicalized in [`docs/audit/rejected-findings-record.md`](../docs/audit/rejected-findings-record.md), with full evidence. Summary: **H-2 rejected** (Sablier v1.1 ACL — no permissionless withdraw); **H-1 downgraded to Low** (L-1 remains an active finding — see Findings below); **M-5 rejected** (cross-series `ovrfloToken` fungibility is intentional); **M-1/M-2 reclassified informational** (Pendle-only onboarding trust boundary); **M-3 reclassified informational / by design** (permissionless `closeLoan()` = liveness). The verified Sablier v1.1 withdraw-ACL table lives in [`docs/audit/sablier-interface-contract.md`](../docs/audit/sablier-interface-contract.md).

---

## Sablier V2 integration (verified)

The verified v1.1 withdraw-ACL table, the NFT-ownership-through-the-Book lifecycle, and the version caveat (v1.1 vs later Sablier Lockup docs) are now canonicalized in [`docs/audit/sablier-interface-contract.md`](../docs/audit/sablier-interface-contract.md), pinned to the deployed address `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (v2-core tag `v1.1`). Key fact retained here: OVRFLO deposits create streams with `sender = OVRFLO` and `recipient = depositor`; when `OVRFLOBook` takes custody via `transferFrom` the book becomes recipient/owner, and lender recovery uses `claimPoolShare`/`closeLoan` where **the book** calls `sablier.withdraw(streamId, lender, amount)` — not the lender directly. Book flows require user `approve(book, streamId)` before `transferFrom` (exercised in `test/fork/OVRFLOBookMainnetFork.t.sol`).

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

### L-2 — Dust loan/fill griefing and unbounded ID growth — REJECTED

| Field | Detail |
|-------|--------|
| **Location** | `src/OVRFLOBook.sol` — offer/listing/loan ID allocators |
| **Agents** | ce-performance-reviewer, ce-security-sentinel |
| **Confidence** | Low |
| **Status** | **Rejected** (2026-06-28) |

**Root cause:** `borrowAmount > 0` and `capacity > 0` only; monotonic IDs with permanent mapping writes.

**Impact:** Storage/event spam; indexer/UI pressure — not direct fund theft.

**Rejection rationale:** Regardless of what minimum threshold is set, someone determined to grief can always post entries just above it. A minimum does not eliminate griefing — it merely raises the floor. The real natural floor is already in place: every loan-creating fill must escrow a real Sablier stream NFT, and streams are created by vault deposits which have `MIN_PT_AMOUNT = 1e6`. See [`docs/audit/rejected-findings-record.md`](../docs/audit/rejected-findings-record.md) — 2026-06-28 gap review section.

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
| No `factory` migration on `OVRFLO` | **By design** — `factory` is immutable, set in constructor; factory is permanent admin hub |
| No per-market book freeze beyond deposit limits | **Rejected** (2026-06-28) — global `feeBps = 100%` circuit breaker is sufficient; per-market toggles contradict project simplicity preferences. See [`docs/audit/rejected-findings-record.md`](../docs/audit/rejected-findings-record.md) |
| Immutable Sablier in `OVRFLO` / `OVRFLOBook` | **Intentional** (immutable V2 integration) |
| `OVRFLOBook` constructor `MAX_FEE_BPS` not capped at `10_000` | Deploy footgun; runtime `setFee()` enforces `<= MAX_FEE_BPS` |

---

## Rejected findings

The full rejected-findings decision record — H-2 (Sablier v1.1 ACL, no permissionless withdraw), M-5 (cross-market `ovrfloToken` fungibility by design), the H-1→L-1 downgrade rationale, the self-loan fix (correctness guard, not security), L-2 (dust griefing), I-4 per-market freeze, and the informational reclassifications (ex-M-1/M-2/M-3) with full evidence and Q&A — is now canonicalized in [`docs/audit/rejected-findings-record.md`](../docs/audit/rejected-findings-record.md). L-1 remains an active finding (see Findings below).

---

## Reviewed — no medium+ issue (consensus)

| Area | Result |
|------|--------|
| Sablier withdraw during book escrow | V2 v1.1 ACL: sender / owner / approved only — no unprivileged path |
| Maker fee snapshots on listings | `feeBps` snapshotted at post; settlement uses stored fee — intentional |
| `createLenderPool(minAcceptable)` | Obligation computed before slippage check |
| Loan accounting `drawn + repaid ≤ obligation` | Enforced via `_outstanding` |
| Stream eligibility vs `OVRFLO.deposit` creation | Sender, asset, end time, non-cancelable aligned |
| Reentrancy on book mutators | `nonReentrant` on state-changing externals |
| Admin APR drift on resting offers | Governance/trust boundary ([I-7](invariants.md#i-7)), not unprivileged exploit |
| Book `claimPoolShare` / `closeLoan` Sablier calls | Book as NFT owner/recipient withdraws to `poolProceeds`; fork-tested |

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

| Priority | Gap | Suggested test | Status |
|----------|-----|----------------|--------|
| P1 | No negative auth tests on book cancel paths | Prank non-maker; assert revert + unchanged escrow | **Done** — `test_Cancel*_RevertForWrong*` in `OVRFLOBook.t.sol` |
| P1 | No invariant/fuzz on loan lifecycle interleaving | Random `claimPoolShare` / `repayLoan` / `closeLoan` sequences | **Done** — `OVRFLOBookInvariant.t.sol` (R6-R9) |
| P2 | `toStream > uint128.max` deposit path | Assert revert, not silent truncation | Open (L-1 / R-03 rejected) |
| P2 | `expiryCached > uint40.max` at deposit | Assert revert (or align deposit with eligibility bound) | Open (L-1 / R-03 rejected) |
| P2 | Sablier `Unauthorized` on pranked withdraw during book escrow | Fork test: stranger, former borrower, lender prank `withdraw` → revert | **Done** — `test_BookEscrow_StrangerCannotWithdrawFromEscrowedStream` in `OVRFLOBookMainnetFork.t.sol` |
| P3 | Oracle rate `>= 1e18` deposit branch | Mock TWAP; assert `nothing to stream` revert | **Done** — `test_OracleEdge_RateAbovePar_Reverts` in `OVRFLOFuzz.t.sol` |
| ~~P2~~ | ~~Cross-market same-expiry stream reuse~~ | **Removed** — would encode wrong product behavior | — |
| ~~P2~~ | ~~Sablier withdraw-to-book grief~~ | **Removed** — rejected finding | — |

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

1. **L-1** — Add `toStream <= type(uint128).max` and `duration <= type(uint40).max` in `deposit()` (cheap; matches book patterns). **Note:** R-03 in `ovrflo-critical-patterns.md` rejects this as redundant given protocol constraints, but the rejection is subject to revisitation if deposit limits are raised.
2. **M-4** — Document oracle trust boundary; optional staleness policy if ops require it.
3. **I-1 / I-2** — Document Pendle-only token assumptions in security docs (optional balance-delta hardening).
4. **I-3** — Document permissionless `closeLoan` as intentional liveness.

~~H-2~~ and ~~M-5~~ require no code changes. ~~L-2~~ rejected (2026-06-28) — see [`docs/audit/rejected-findings-record.md`](../docs/audit/rejected-findings-record.md).

---

*Report generated from parallel multi-agent review, revised after Sablier V2 v1.1 source verification and OVRFLO product-design alignment. No on-chain code was modified as part of this revision.*
