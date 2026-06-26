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

### Self-loan `repayLoan` revert — REJECTED (UX edge case, not a security finding)

- **Original claim (Low):** The book allows `borrower == lender` (self-loans via `borrowAgainstOffer` or `lendAgainstListing`), but `repayLoan()` calls `_pullExact(ovrfloToken, msg.sender, loan.lender, amount)`. When `from == to`, an OZ ERC20 self-transfer is a net-zero balance change, so the `balanceAfter - balanceBefore == amount` check reverts. Self-loans therefore cannot be early-repaid.
- **Disproof:** Self-lending is economically irrational — the user posts `capacity` in underlying, borrows against their own stream, receives `borrowAmount - fee` back, and the fee goes to treasury. Nobody does this intentionally. The loan is still fully resolvable via `claimLoan()` and `closeLoan()` (the book calls `sablier.withdraw(streamId, loan.lender, amount)`, which has no self-transfer issue). No fund safety issue: no one else is affected, accounting is correct, nothing is permanently locked (`closeLoan` is permissionless and works at maturity). The only impact is a self-inflicted UX edge case for irrational behavior.
- **Evidence:** `src/OVRFLOBook.sol` — `_storeLoan(msg.sender, offer.lender, ...)` at `borrowAgainstOffer` (line 585) and `_storeLoan(listing.borrower, msg.sender, ...)` at `lendAgainstListing` (line 683) have no `borrower != lender` guard; `_pullExact` (line 971-975) enforces a strict balance delta; `claimLoan` (line 721) and `closeLoan` (line 744) use `sablier.withdraw` which is unaffected by the self-transfer issue.

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
| Loan accounting underflow | `drawn + repaid <= obligation` guaranteed: `claimLoan` caps at `_outstanding(loan)`, `repayLoan` requires `amount <= outstanding` (G-17); no sequence of claim/repay/close can overflow `drawn + repaid` past `obligation` |
| Stream withdrawal before pledging | `requireEligible` uses `deposited - withdrawn`; if user withdraws accrued value before listing, `remaining` is lower and price is proportionally lower — correct behavior, no exploit |
| Third-party `closeLoan` | By design (I-3 / audit-report I-3): lender gets `outstanding`, borrower gets residual stream, no misrouting; borrower loses only timing optionality, not value |
| Book underlying insolvency | `buyListing` / `lendAgainstListing` are net-zero for the book (buyer/lender pays in = seller/borrower + treasury paid out); offer capacity tracked per-offer with pre-check (`grossPrice <= offer.capacity` or `borrowAmount <= offer.capacity`); total payouts can never exceed total offer deposits |

### Informational reclassifications (audit-report IDs, ex-Medium)

These were Medium findings reclassified to **Informational** under the documented trust model (Pendle-only onboarding, multisig-validated markets). They are **accepted trust boundaries**, not bugs:

- **audit-report I-1 (ex-M-1)** — `deposit()` PT transfer accounting trusts user-supplied `ptAmount` without balance-delta check. Pendle-only scope; multisig validates canonical markets. See `trust-assumption-ledger.md`.
- **audit-report I-2 (ex-M-2)** — Underlying fee collection in `deposit()` assumes exact transfer. Same trust boundary as I-1 for canonical underlyings.
- **audit-report I-3 (ex-M-3)** — Permissionless `closeLoan()`. **By design** — liveness per book plan R15; does not misroute funds. See internal-model explainer.
- **audit-report I-4 (ex-M-6)** — Operational trust concentration (no `adminContract` migration by design; immutable Sablier; book fee cap is a deploy footgun, runtime-enforced). Informational / operational.

> **ID disambiguation:** `I-1..I-13` in `x-ray/invariants.md` are **invariants**; `I-1..I-4` here are **audit-report informational findings** (ex-M-1..M-6). Where this doc says "audit-report I-1 (ex-M-1)" it means the finding; "invariant I-8" means the invariant.

## Q&A bank — resolved open questions

These are the questions an auditor predictably asks in week one. They are already answered.

1. **Sablier withdraw ACL while book is recipient?** — Closed. V2 v1.1: only sender, NFT owner, or approved operator. No public withdraw. (See H-2 above and the ACL table.)
2. **`closeLoan` permissionless intent?** — By design — liveness per book plan R15. Removes borrower timing optionality; does not misroute funds.
3. **Token assumptions (Pendle PT / exact transfer)?** — Trust boundary. Admin onboarding validates canonical Pendle markets; documented explicitly in the trust-assumption ledger and the Pendle interface contract.
4. **Multi-market same `expiryCached`?** — Not a practical Pendle concern; cross-market `ovrfloToken` fungibility makes cross-market routing acceptable anyway. (See M-5.)
5. **Stale fee on listings after `setFee()`?** — Intentional maker protection. `feeBps` is snapshotted at listing/offer post time; settlement uses the stored fee, so `setFee()` does not retroactively change resting orders.
6. **Flash-loan PT yield extraction pre-maturity?** — Accepted by design. Flash-loan PT → deposit → sell stream on book → unwrap → buy PT back is yield arbitrage using the protocol as designed. Wrap reserve drain is accepted (cross-origin fungibility). Protocol remains solvent (E-1). Wrapper is economically whole at maturity. Flash loan only removes the capital requirement. See rejected finding above.
7. **Self-loan `repayLoan` revert?** — UX edge case, not a security finding. Self-lending is economically irrational. Loan still resolvable via `claimLoan`/`closeLoan`. See rejected finding above.
8. **Sandwich / flash-loan manipulation of book pricing?** — Not exploitable. Book pricing is purely `StreamPricing` (remaining, APR, time-to-maturity) with no oracle dependency. `remaining` can't be manipulated (Sablier v1.1 ACL). Same-block `block.timestamp`. Slippage params on all fills. See "Other probed vectors" table above.
9. **Reentrancy on vault paths (no `nonReentrant`)?** — CEI is followed on all vault paths (`deposit`, `claim`, `wrap`, `unwrap`). State is updated before external calls. `wrap` has balance-delta check (G-11). Canonical Pendle PT/underlying tokens don't have transfer callbacks. See "Other probed vectors" table above.

## Also reviewed — no medium+ issue (consensus)

The internal review's "Reviewed — no medium+ issue (consensus)" table (in `x-ray/multi-agent-audit-report.md`) covers consensus-reviewed design decisions that are neither rejected findings nor resolved Q&A: maker fee snapshots, `lendAgainstListing` obligation-before-slippage ordering, loan accounting `drawn + repaid ≤ obligation`, stream eligibility vs deposit creation alignment, reentrancy guards on book mutators, admin APR drift as a governance/trust boundary, and book `claimLoan`/`closeLoan` Sablier calls (fork-tested). If you are about to raise one of these, it has already been consensus-reviewed — the table entry is the starting point, not a wall.
