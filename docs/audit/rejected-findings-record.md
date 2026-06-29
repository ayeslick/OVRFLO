# Rejected-Findings Decision Record + Q&A Bank

> The internal 10-persona review's settled conclusions, promoted to a persistent record so the external auditor starts where the last review ended instead of re-deriving it. Every entry is framed as **evidence to challenge**, not a conclusion to accept — if you find new evidence, re-raise it. Source: `x-ray/multi-agent-audit-report.md` (the overlapping detail there is trimmed to point here; the report's severity summary and agent-coverage list remain as backing evidence).

## Decision record — settled findings

### H-2 — Escrow value sink / permissionless withdraw while book holds stream NFT — REJECTED

- **Original claim (High):** A third party could call `sablier.withdraw(streamId, address(book), amount)` while the book escrows the NFT, reducing `remaining` and stranding `ovrfloToken` on the book.
- **Disproof:** Sablier V2 v1.1 requires `msg.sender` to be the stream **sender**, **NFT owner**, or **approved operator** — otherwise `SablierV2Lockup_Unauthorized`. There is **no permissionless withdraw** in v1.1. When the book holds the NFT it **is** the recipient; only the book (or its approved operators) can withdraw. The OVRFLO vault as sender may only withdraw `to == recipient` (the book), which is trusted.
- **Evidence:** Verified against `sablier-labs/v2-core` tag `v1.1` and the deployed bytecode at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`. See the ACL table in `sablier-interface-contract.md`.
- **Why this matters:** The v1.1-vs-later-version distinction is the whole finding. Some newer Sablier Lockup docs describe a public "withdraw to recipient" path; that does **not** apply to the v1.1 bytecode OVRFLO integrates. An auditor reading the newer docs will re-raise this as High — it is already settled.

### M-5 — Cross-market stream reuse when `expiryCached` collides — REJECTED (by design)

- **Original claim (Medium):** Streams from market A could be used against market B liquidity when both share `expiryCached` and `ovrfloToken`.
- **Disproof:** (1) One `ovrfloToken` per underlying across approved maturities is an **intentional product feature** (`README.md`, `CONCEPTS.md`); `endTime == expiryCached` is the deliberate series pin. (2) Distinct Pendle markets for the same underlying use distinct expiries; onboarding two with identical `expiryCached` is not a normal deployment pattern. (3) Same `ovrfloToken` + same maturity end time ⇒ economically identical stream claim regardless of which `market` parameter is passed.
- **Evidence:** `README.md`, `CONCEPTS.md` cross-market fungibility note; `x-ray/multi-agent-audit-report.md` Rejected findings.

### H-1 → L-1 — Unchecked `uint128` / `uint40` narrowing in `OVRFLO.deposit` — DOWNGRADED

- **Original claim (High):** `toStream` is cast `uint128(toStream)` for Sablier and `duration` cast `uint40(expiry - block.timestamp)` without explicit bounds; truncation could strand excess minted `ovrfloToken`.
- **Disproof (downgrade rationale):** With 18-decimal Pendle PT, `toStream > type(uint128).max` (~3.4×10³⁸) is not reachable in practice. Technically valid as a defense-in-depth cast guard; economically unreachable. Downgraded to **L-1** (active Low finding).
- **Note for the auditor:** Only the **downgrade rationale** is settled here. **L-1 remains an active Low finding** with a recommended fix (`require(toStream <= type(uint128).max)` and `require(duration <= type(uint40).max)` before mint + `createWithDurations`) — see `x-ray/multi-agent-audit-report.md` Findings (severity-ranked). Do not treat L-1 as rejected.

### Self-loan `repayLoan` revert — REJECTED as security finding, FIXED as correctness guard

- **Original claim (Low):** The book allows `borrower == lender` (self-loans via `createBorrowPool` or `createLenderPool`), but `repayLoan()` calls `_pullExact(ovrfloToken, msg.sender, loan.lender, amount)`. When `from == to`, an OZ ERC20 self-transfer is a net-zero balance change, so the `balanceAfter - balanceBefore == amount` check reverts. Self-loans therefore cannot be early-repaired.
- **Disproof (security):** Self-lending is economically irrational — the user posts `capacity` in underlying, borrows against their own stream, receives `borrowAmount - fee` back, and the fee goes to treasury. Nobody does this intentionally. The loan is still fully resolvable via `poolClaimLoan()` and `closeLoan()` (the book calls `sablier.withdraw(streamId, msg.sender, amount)` for `poolClaimLoan`, which has no self-transfer issue). No fund safety issue: no one else is affected, accounting is correct, nothing is permanently locked (`closeLoan` is permissionless and works at maturity). The only impact is a self-inflicted UX edge case for irrational behavior.
- **Fix applied (2026-06-28):** Despite being a non-security UX edge case, self-match prevention guards were added to both pool-creation paths as a correctness guard: `require(offer.lender != borrower, "OVRFLOBook: self-match")` in `createBorrowPool` (via `_validateBorrowOffers`) and `require(msg.sender != listing.borrower, "OVRFLOBook: self-match")` in `createLenderPool`. This prevents the irrational state at the root cause rather than special-casing the repayment transfer. Tests added in `test/OVRFLOBook.t.sol` (`test_CreateBorrowPool_SelfMatchReverts`, `test_CreateLenderPool_SelfMatchReverts`). Documented as pattern #4 in `docs/solutions/patterns/ovrflo-critical-patterns.md`.
- **Evidence:** `src/OVRFLOBook.sol` — self-match guards in `createBorrowPool` and `createLenderPool`; `docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md` — companion finding section; `docs/solutions/patterns/ovrflo-critical-patterns.md` — pattern #4.

### Pre-maturity flash-loan PT yield extraction via deposit + book sale + unwrap — REJECTED (accepted by design + normal arb)

- **Original claim (Medium):** An attacker can flash-loan PT, deposit to get the TWAP split (`toUser` + `toStream`), unwrap the `toUser` portion from the wrap reserve, sell the stream on the book for underlying, buy PT back on the Pendle AMM, and repay the flash loan — profiting the PT yield (discount) with zero capital.
- **Disproof:** This is accepted-by-design behavior, not a protocol vulnerability:
  (1) **Wrap reserve drain is explicitly accepted.** The reserve accounting doc (`docs/solutions/architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md`) states "deposit-origin ovrfloToken can consume wrap reserve as a designed feature." The wrapper is economically whole at maturity — the deposit added PT backing (`marketTotalDeposited` increased), so the wrapper can `claim` PT for their ovrfloToken.
  (2) **The profit is legitimate yield extraction.** The attacker captures the PT discount by selling the stream on the book at the offer maker's chosen APR. The offer maker posted at that rate voluntarily — it is a fair trade. Without the book, the stream holder would just wait for vesting; the book provides the early-exit liquidity that is its entire purpose.
  (3) **The protocol remains solvent.** E-1 holds: the deposit added PT backing, the unwrap consumed reserve backing, net ovrfloToken supply = net backing. No funds are stolen; all parties are economically whole at maturity.
  (4) **Flash-loan amplification doesn't change the economics.** Without flash loans, any PT holder can do this (deposit + sell stream + unwrap) — it is using the protocol as designed. Flash loans are a standard DeFi primitive for arbitrage; they remove the capital requirement but do not create a new vulnerability.
  (5) **The existing post-maturity analysis** (`docs/solutions/security-issues/flash-loan-wrap-claim-redeem-griefing-WrapUnwrap-20260622.md`) covers a different cycle (wrap → claim → Pendle redeem) and says "a liquid AMM would change the conclusion." Pre-maturity the Pendle AMM is active, but the cycle here is different (deposit + book sale + unwrap, not wrap + claim + redeem). The pre-maturity case is covered by the accepted wrap-reserve-drain design, not by the post-maturity value-neutral identity.
- **Evidence:** `src/OVRFLO.sol` deposit (lines 321-377), unwrap (lines 297-310); `src/OVRFLOBook.sol` sellIntoOffer (lines 399-420); `docs/solutions/architecture-patterns/ovrflo-wrap-unwrap-reserve-accounting.md` (cross-origin fungibility section); `docs/solutions/security-issues/flash-loan-wrap-claim-redeem-griefing-WrapUnwrap-20260622.md` (post-maturity analysis, "what would change this conclusion" section).

### Other probed vectors — NOT EXPLOITABLE (consensus)

The following attack vectors were systematically probed and found not exploitable. An auditor encountering these should treat them as closed:

| Vector | Why not exploitable |
|--------|-------------------|
| Flash-loan TWAP manipulation | 15-30 min TWAP window (I-7) resists single-block flash-loan manipulation; cardinality validated at onboarding |
| Self-filling offers / listings | Self-fill (`msg.sender == offer.maker`) loses fees to treasury; no value extraction; no fill redirection (explicit offer/listing IDs) |
| Sandwich on book fills | Same-block `block.timestamp` for all txs; `remaining` (Sablier `deposited - withdrawn`) cannot be manipulated by third parties (v1.1 ACL); all fills have slippage params |
| Cross-market arb | Per-market claim bounds (G-10: `currentDeposited >= amount`); cross-market fungibility is M-5 by design |
| Wrap/unwrap circular arb | Post-maturity: value-neutral (settled in flash-loan-wrap-claim doc). Pre-maturity: `claim` blocked by G-9 |
| Deposit fee avoidance | Fee is immutable per series (I-9, one-shot latch G-2); TWAP rate can't be single-user manipulated; `wrap()` is a different product (no PT, no stream) |
| TOCTOU on stream remaining | `requireEligible` re-reads `deposited - withdrawn` at fill time (every fill calls `_requireEligible`); listings escrow the stream so `remaining` is stable between post and fill |
| Reentrancy on vault (no `nonReentrant`) | CEI followed: `marketTotalDeposited` and `wrappedUnderlying` updated before all external calls; `wrap` has balance-delta check (G-11); canonical Pendle PT/underlying tokens don't have callbacks |
| Multicall sequencing | OZ `multicall` reverts on any delegatecall failure (all-or-nothing); each delegated call hits `nonReentrant`; double-fill reverts on `require(listing.active)` / `require(offer.active)` |
| Loan accounting underflow | `drawn + repaid <= obligation` guaranteed: `poolClaimLoan` caps at `_outstanding(loan)`, `repayLoan` requires `amount <= outstanding` (G-17); no sequence of claim/repay/close can overflow `drawn + repaid` past `obligation` |
| Stream withdrawal before pledging | `requireEligible` uses `deposited - withdrawn`; if user withdraws accrued value before listing, `remaining` is lower and price is proportionally lower — correct behavior, no exploit |
| Third-party `closeLoan` | By design (I-3 / audit-report I-3): lender gets `outstanding`, borrower gets residual stream, no misrouting; borrower loses only timing optionality, not value |
| Book underlying insolvency | `buyListing` / `createLenderPool` are net-zero for the book (buyer/lender pays in = seller/borrower + treasury paid out); offer capacity tracked per-offer with pre-check (`grossPrice <= offer.capacity` or `borrowAmount <= offer.capacity`); total payouts can never exceed total offer deposits |

### Informational reclassifications (audit-report IDs, ex-Medium)

These were Medium findings reclassified to **Informational** under the documented trust model (Pendle-only onboarding, multisig-validated markets). They are **accepted trust boundaries**, not bugs:

- **audit-report I-1 (ex-M-1)** — `deposit()` PT transfer accounting trusts user-supplied `ptAmount` without balance-delta check. Pendle-only scope; multisig validates canonical markets. See `trust-assumption-ledger.md`.
- **audit-report I-2 (ex-M-2)** — Underlying fee collection in `deposit()` assumes exact transfer. Same trust boundary as I-1 for canonical underlyings.
- **audit-report I-3 (ex-M-3)** — Permissionless `closeLoan()`. **By design** — liveness per book plan R15; does not misroute funds. See internal-model explainer.
- **audit-report I-4 (ex-M-6)** — Operational trust concentration (no `factory` migration by design — `factory` is immutable; immutable Sablier; book fee cap is a deploy footgun, runtime-enforced). Informational / operational.

> **ID disambiguation:** `I-1..I-13` in `x-ray/invariants.md` are **invariants**; `I-1..I-4` here are **audit-report informational findings** (ex-M-1..M-6). Where this doc says "audit-report I-1 (ex-M-1)" it means the finding; "invariant I-8" means the invariant.

## Q&A bank — resolved open questions

These are the questions an auditor predictably asks in week one. They are already answered.

1. **Sablier withdraw ACL while book is recipient?** — Closed. V2 v1.1: only sender, NFT owner, or approved operator. No public withdraw. (See H-2 above and the ACL table.)
2. **`closeLoan` permissionless intent?** — By design — liveness per book plan R15. Removes borrower timing optionality; does not misroute funds.
3. **Token assumptions (Pendle PT / exact transfer)?** — Trust boundary. Admin onboarding validates canonical Pendle markets; documented explicitly in the trust-assumption ledger and the Pendle interface contract.
4. **Multi-market same `expiryCached`?** — Not a practical Pendle concern; cross-market `ovrfloToken` fungibility makes cross-market routing acceptable anyway. (See M-5.)
5. **Stale fee on listings after `setFee()`?** — Intentional maker protection. `feeBps` is snapshotted at listing/offer post time; settlement uses the stored fee, so `setFee()` does not retroactively change resting orders.
6. **Flash-loan PT yield extraction pre-maturity?** — Accepted by design. Flash-loan PT → deposit → sell stream on book → unwrap → buy PT back is yield arbitrage using the protocol as designed. Wrap reserve drain is accepted (cross-origin fungibility). Protocol remains solvent (E-1). Wrapper is economically whole at maturity. Flash loan only removes the capital requirement. See rejected finding above.
7. **Self-loan `repayLoan` revert?** — UX edge case, not a security finding. Self-lending is economically irrational. Loan still resolvable via `poolClaimLoan`/`closeLoan`. Self-match prevention guards added as a correctness fix (2026-06-28); see rejected finding above and pattern #4 in `ovrflo-critical-patterns.md`.
8. **Sandwich / flash-loan manipulation of book pricing?** — Not exploitable. Book pricing is purely `StreamPricing` (remaining, APR, time-to-maturity) with no oracle dependency. `remaining` can't be manipulated (Sablier v1.1 ACL). Same-block `block.timestamp`. Slippage params on all fills. See "Other probed vectors" table above.
9. **Reentrancy on vault paths (no `nonReentrant`)?** — CEI is followed on all vault paths (`deposit`, `claim`, `wrap`, `unwrap`). State is updated before external calls. `wrap` has balance-delta check (G-11). Canonical Pendle PT/underlying tokens don't have transfer callbacks. See "Other probed vectors" table above.

## 2026-06-27 code review — rejected findings

The following findings were raised in a comprehensive review of all non-test `*.sol` files (following ethskills.com ship/security/concepts/audit guidance) and rejected by the project owner. They are recorded here so future reviewers do not re-derive them.

### CR-M1 — OVRFLOToken custom ownership instead of OZ Ownable2Step — REJECTED (unnecessary complexity)

- **Original claim (Medium):** `OVRFLOToken` implements a hand-rolled one-step `transferOwnership` instead of using OpenZeppelin's `Ownable2Step`, contrary to the ethskills guidance "don't reinvent AccessControl."
- **Rejection rationale:** The token is deployed by the factory and immediately transferred to the vault in the same transaction. There is no window for ownership error. Adding `Ownable2Step` would require an extra `acceptOwnership` call on the vault (an external contract with no current acceptance logic) for a one-time transfer that is already atomic. The custom ownership is simpler and sufficient for this controlled deployment path.
- **Evidence:** `src/OVRFLOToken.sol` (custom `owner`/`transferOwnership`); `src/OVRFLOFactory.sol` `deploy()` creates token then calls `token.transferOwnership(ovrflo)` in the same tx.

### CR-L1 — Missing `nonReentrant` on `deposit`/`wrap`/`unwrap`/`claim` — REJECTED (PTs are not hookable)

- **Original claim (Low):** `flashLoan` is `nonReentrant` but the other four user functions are not. Defense-in-depth recommends adding it.
- **Rejection rationale:** Pendle PT tokens and the underlyings used (WETH, wstETH) are standard ERC20s without transfer hooks. They cannot trigger reentrancy during `safeTransferFrom`. The `flashLoan` function needs `nonReentrant` because it sends PT before the callback and pulls it back after — a classic reentrancy vector that doesn't exist in the other functions. CEI ordering is the correct protection for non-hookable tokens, and the `wrap` CEI violation has been fixed (see below).
- **CEI fix applied:** `wrap()` previously updated `wrappedUnderlying` after `safeTransferFrom` (effect after interaction). Fixed: `wrappedUnderlying += amount` is now before the transfer. This makes the "Reentrancy on vault" row in the "Other probed vectors" table above fully accurate.
- **Evidence:** `src/OVRFLO.sol` `wrap()` — `wrappedUnderlying += amount` now precedes `safeTransferFrom`; `deposit()`, `claim()`, `unwrap()` already followed CEI.

### CR-L2 — Infinite approval to Sablier in OVRFLO constructor — REJECTED (intentional, gas optimization)

- **Original claim (Low):** `IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max)` contradicts the "never use infinite approvals" guidance.
- **Rejection rationale:** The approval is to an immutable, trusted Sablier address. The vault is the sole minter of ovrfloToken and does not store ovrfloToken as a balance (minted tokens go to users or directly into Sablier streams). Re-approving per stream would waste gas on every deposit for zero security benefit. The approval is for ovrfloToken only, not for PT or underlying.
- **Evidence:** `src/OVRFLO.sol` constructor — `IERC20(ovrfloToken).approve(address(sablierLL), type(uint256).max)`; `sablierLL` is `immutable`.

### CR-L3 — `sweepExcessPt`/`sweepExcessUnderlying` don't validate `to != address(0)` — REJECTED (admin-controlled)

- **Original claim (Low):** The `to` parameter is not checked for the zero address. Tokens sent to `address(0)` are burned forever.
- **Rejection rationale:** Both functions are `onlyAdmin` (multisig → factory → vault). The timelocked multisig is the trust boundary for admin operations. Adding a zero-address check duplicates what the multisig already validates off-chain.
- **Evidence:** `src/OVRFLO.sol` — `sweepExcessPt` and `sweepExcessUnderlying` are `onlyAdmin`.

### CR-L4 — OVRFLOBook fee cap of 100% (`MAX_FEE_BPS = 10_000`) — REJECTED (intentional pause mechanism)

- **Original claim (Low):** The owner can set `feeBps` to 100%, taking the entire sale/borrow amount as a fee, which could be used to rug users on offer fills.
- **Rejection rationale:** The 100% cap is an intentional emergency pause mechanism. If there is a bug in the contract, setting the fee to 100% prevents users from interacting with the book without adding a separate `Pausable` contract or increasing the attack surface. The timelocked multisig is the trust boundary. Existing listings are protected by snapshotted fees; only new offer fills would be affected. A lower cap could be set, but the current cap provides a gas-free circuit breaker.
- **Evidence:** `src/OVRFLOBook.sol` — `MAX_FEE_BPS = 10_000`; `setFee` enforces `feeBps_ <= MAX_FEE_BPS`; listings snapshot `feeBps` at post time.

### CR-I2 — Hardcoded Sablier address in OVRFLO — REJECTED (intentional transparency)

- **Original claim (Informational):** `sablierLL` is hardcoded to a mainnet address, limiting portability to other chains.
- **Rejection rationale:** Hardcoding ensures all participants know exactly where the stream is created. The project intentionally stays on Sablier V2 (smaller attack surface, immutable). The address is `immutable` in the contract and read by the factory's `deployBook` for consistency.
- **Evidence:** `src/OVRFLO.sol` — `ISablierV2LockupLinear(0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9)`; AGENTS.md "Stay on Sablier V2 intentionally."

### CR-I3 — `SeriesInfo.expiryCached` is `uint256` but could be `uint32` — REJECTED (non-issue)

- **Original claim (Informational):** Timestamps fit in `uint32` until 2106. Packing as `uint32` would save one storage slot per series.
- **Rejection rationale:** Non-issue. The gas savings are marginal and the current `uint256` avoids casting complexity.
- **Evidence:** `src/OVRFLO.sol` — `SeriesInfo.expiryCached` is `uint256`.

### Review fixes applied (not rejected)

The following fixes from the same review were applied:
- `MIN_PT_AMOUNT` changed from `immutable` to `constant` (compile-time literal, zero SLOAD cost).
- `wrap()` CEI fix: `wrappedUnderlying += amount` moved before `safeTransferFrom`.
- OVRFLOBook view functions (`saleOfferState`, `saleListingState`, `lendOfferState`, `borrowListingState`) now revert for non-existent IDs, matching the existing `loanState` pattern.
- Interface licenses: `IPendleOracle`, `IPendleMarket`, `ISablierV2LockupLinear` changed from `UNLICENSED` to `MIT` (project-written minimal interfaces). Contradictory MIT comment block removed from `IStandardizedYield` (kept GPL SPDX, Pendle's interface).
- `prepareOracle` in `OVRFLOFactory` now validates `twapDuration <= MAX_TWAP_DURATION` (was externally applied before this review session).

## 2026-06-28 OVRFLOBook / StreamPricing gap review — rejected findings

The following findings were raised during a focused gap review of `OVRFLOBook` and `StreamPricing` and rejected by the project owner. They are recorded here so future reviewers do not re-derive them.

### L-2 — Dust loan/fill griefing and unbounded ID growth — REJECTED (minimums are ineffective)

- **Original claim (Low, from multi-agent audit):** `borrowAmount > 0` and `capacity > 0` are the only floors; monotonic IDs with permanent mapping writes allow storage/event spam.
- **Rejection rationale:** Regardless of what minimum threshold is set, someone determined to grief can always post entries just above it. A minimum does not eliminate griefing — it merely raises the floor. Worse, a minimum that is high enough to deter spam would also exclude legitimate small streams, harming usability. The real natural floor is already in place: every loan-creating fill must escrow a real Sablier stream NFT, and streams are created by vault deposits which have `MIN_PT_AMOUNT = 1e6`. This rate-limits spam at the source without an arbitrary book-level minimum. Adding `MIN_BORROW`/`MIN_FILL` would add complexity for no real protection, contradicting the project's simplicity preference.
- **Evidence:** `src/OVRFLO.sol` — `MIN_PT_AMOUNT = 1e6` deposit floor; `src/OVRFLOBook.sol` — `borrowAmount > 0` and `capacity > 0` checks; streams are NFT-escrowed (rate-limiting by design).

### I-4 — No per-market book freeze — REJECTED (by design, global circuit breaker sufficient)

- **Original claim (Informational/operational, from multi-agent audit):** Setting a market's deposit limit to 0 stops new vault deposits but does not pause secondary market trading on the book for that market. The only circuit breaker is the global `feeBps = 100%`.
- **Rejection rationale:** The global `feeBps = 100%` circuit breaker is the intentional emergency pause mechanism (see CR-L4 rejection above). Adding per-market freeze toggles would increase the attack surface and contradict the project preference against adding `disableSeries`/`enableSeries` toggles (AGENTS.md). A per-market freeze is also economically unnecessary: if deposits are frozen (limit = 0), no new streams are created for that market; existing streams can still be traded on the book, which is the book's purpose (providing early-exit liquidity for existing positions). The multisig can set `feeBps = 100%` globally if a hard stop is needed.
- **Evidence:** `src/OVRFLOBook.sol` — `MAX_FEE_BPS = 10_000`; `setFee` enforces `feeBps_ <= MAX_FEE_BPS`; AGENTS.md — "do not add `disableSeries`/`enableSeries` toggles."

### No `deadline` parameter on taker entrypoints — REJECTED (slippage params are load-bearing)

- **Original claim (Informational, deferred in maker protections plan):** `sellIntoOffer`, `buyListing`, `createBorrowPool`, and `createLenderPool` have slippage params but no time-based `deadline` parameter.
- **Rejection rationale:** Slippage parameters (`minNetOut`, `maxPriceIn`, `minAcceptable`) are the load-bearing protection against time-drift. Book pricing is purely deterministic from `StreamPricing` (remaining, APR, time-to-maturity) with no oracle dependency, so the only risk from a delayed transaction is that the price drifts — which the slippage params already bound. A `deadline` would be redundant API surface that adds no protection beyond what slippage already provides. The maker protections plan explicitly deferred this as "an API-symmetry nicety, not a correctness fix."
- **Evidence:** `src/OVRFLOBook.sol` — all four taker entrypoints have slippage params; `docs/plans/2026-06-23-001-feat-ovrflo-book-maker-protections-plan.md` — Scope Boundaries section.

## Also reviewed — no medium+ issue (consensus)

The internal review's "Reviewed — no medium+ issue (consensus)" table (in `x-ray/multi-agent-audit-report.md`) covers consensus-reviewed design decisions that are neither rejected findings nor resolved Q&A: maker fee snapshots, `createLenderPool` obligation-before-slippage ordering, loan accounting `drawn + repaid ≤ obligation`, stream eligibility vs deposit creation alignment, reentrancy guards on book mutators, admin APR drift as a governance/trust boundary, and book `poolClaimLoan`/`closeLoan` Sablier calls (fork-tested). If you are about to raise one of these, it has already been consensus-reviewed — the table entry is the starting point, not a wall.
