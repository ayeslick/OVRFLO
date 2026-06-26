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

## Also reviewed — no medium+ issue (consensus)

The internal review's "Reviewed — no medium+ issue (consensus)" table (in `x-ray/multi-agent-audit-report.md`) covers consensus-reviewed design decisions that are neither rejected findings nor resolved Q&A: maker fee snapshots, `lendAgainstListing` obligation-before-slippage ordering, loan accounting `drawn + repaid ≤ obligation`, stream eligibility vs deposit creation alignment, reentrancy guards on book mutators, admin APR drift as a governance/trust boundary, and book `claimLoan`/`closeLoan` Sablier calls (fork-tested). If you are about to raise one of these, it has already been consensus-reviewed — the table entry is the starting point, not a wall.
