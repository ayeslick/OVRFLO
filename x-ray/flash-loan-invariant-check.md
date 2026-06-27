# Flash-Loan Invariant Re-Verification

Proposed function: `OVRFLO.flashLoan(ptToken, amount, data)`.

- Cap: `amount <= marketTotalDeposited[market]` (state variable, not `balanceOf`).
- Disbursement: `safeTransfer(ptToken, msg.sender, amount)`.
- Repayment: `safeTransferFrom(msg.sender, vault, amount)` (not a balance check).
- Fee: `safeTransferFrom(msg.sender, TREASURY, flashFee)` in `underlying`.
- No `nonReentrant` on `flashLoan` or any existing vault function.

Reentrancy surface (callable during `onFlashLoan` callback, all ungated by reentrancy
guards): `deposit`, `claim`, `wrap`, `unwrap`, `sweepExcessPt` (admin-only via G-1,
blocked for a non-admin borrower), `sweepExcessUnderlying` (admin-only, blocked).

Key state variables touched by the flash loan itself: **none**. `flashLoan` reads
`ptToMarket` and `marketTotalDeposited` but never writes them. It only moves PT
out and back, and pulls a fee in underlying.

---

## Result table

| ID  | Verdict           | Explanation |
|-----|-------------------|-------------|
| I-1 | NEEDS ATTENTION   | The flash loan sends PT out, so mid-transaction `balanceOf(vault) < marketTotalDeposited[market]`. The invariant as written ("on-chain: No", always-on) is **violated during the callback**. It is restored atomically by the repayment `safeTransferFrom`. Reentrancy audit of every reader of `balanceOf`/`marketTotalDeposited`: (a) `claim` decrements `marketTotalDeposited` then `safeTransfer`s PT; if physical balance is short the transfer reverts, so no ovrfloToken is burned without receiving PT — claims are *bounded by physical balance* during the window, i.e. a large claimant is temporarily DoS'd but not exploited. (b) `sweepExcessPt` computes `excess = balance > deposited ? balance - deposited : 0`; with `balance < deposited` it yields 0 and reverts "no excess" — loaned PT cannot be swept as "excess". (c) `deposit` pulls fresh PT via `safeTransferFrom` then increments `marketTotalDeposited`; preserves I-1 on its own sub-state. No path steals PT. **Action**: re-scope I-1 to "holds at transaction boundaries / between non-callback external calls" and document the transient window, OR add `nonReentrant` to `flashLoan` (preferred — keeps the always-on reading and removes the DoS-on-claimant liveness gap). |
| I-2 | HOLDS             | Flash loan touches neither `underlying` balance nor `wrappedUnderlying`. Reentrant `wrap`/`unwrap` are independently gated by G-11/G-12 and preserve the inequality on their own. `sweepExcessUnderlying` is admin-only. No new write site to `wrappedUnderlying`. |
| I-3 | HOLDS             | Flash loan never writes `SeriesInfo.feeBps`. Only writer is `setSeriesApproved` (G-1 admin + G-2 one-shot latch); the borrower is not admin, so reentrancy cannot reach it. |
| I-4 | HOLDS             | `OVRFLOBook.feeBps` is a book-contract variable. The vault flash loan does not call into the book's `setFee`. Reentrancy into the book from the callback is just a normal external call with no elevated privilege. |
| I-5 | HOLDS             | Book APR bounds. Untouched by the vault flash loan; same reasoning as I-4. |
| I-6 | HOLDS             | Posted-offer APR-at-post invariant. Flash loan does not post/cancel book offers and grants no privilege to bypass `_validateApr`. A reentrant book call is a normal call. |
| I-7 | HOLDS             | `twapDurationFixed` written only by `setSeriesApproved` (admin + one-shot). Flash loan is a user function; reentrancy cannot reach the setter. |
| I-8 | HOLDS             | Flash loan writes neither `marketTotalDeposited` nor `marketDepositLimits`. A reentrant `deposit` is gated by G-6 and preserves the bound at deposit; `setMarketDepositLimit` is admin-only. The pre-existing "admin can lower limit below deposited" gap (On-chain=No) is unchanged by the flash loan. |
| I-9 | HOLDS             | Series immutability. Flash loan writes no `SeriesInfo` field. The only writer (`setSeriesApproved`) is admin-gated and one-shot (G-2/G-3); unreachable by a borrower callback. |
| I-10| HOLDS             | Book loan state machine. Vault flash loan does not touch `Loan.closed` or any book loan op. |
| I-11| HOLDS (note)      | Deposit/claim temporal gates (G-5/G-9) are untouched — the flash loan neither deposits nor claims. **Note**: `flashLoan` itself has **no temporal gate**, so it is callable post-maturity. This does not violate I-11 as stated (which scopes only deposits/claims), but it is a design decision to confirm: post-maturity PT is at par and flash-loanable, which is harmless to accounting (atomic repayment) but enables a transient claim-DoS window after maturity when claim volume is highest. Recommend gating `flashLoan` to `block.timestamp < expiryCached` if post-maturity liveness matters, or document that flash loans are intentionally always-on. |
| I-12| HOLDS             | Book fills pre-maturity. Flash loan does not call `_requireEligible`/`marketActive`; reentrancy into a book fill is a normal call that still passes `marketActive`. |
| I-13| HOLDS             | Offer/listing one-shot deactivation. Book state; flash loan does not touch offers. |
| X-1 | HOLDS             | Oracle freshness gap is a deposit-time concern. Flash loan does not read the oracle. A reentrant `deposit` reads it identically to a standalone deposit — no new exposure. |
| X-2 | HOLDS             | Sablier withdrawable/ACL assumption is a book concern. Flash loan does not touch Sablier streams or the book. |
| X-3 | HOLDS             | Book immutables vs. factory registry. Flash loan writes neither side; `ovrfloInfo` is written once at `deploy`. No reentrancy path mutates it. |
| X-4 | HOLDS             | `isMarketApproved` never unset. Flash loan does not touch it; no unapprove function exists to reach via reentrancy. |
| X-5 | HOLDS             | Stream/series match at pledge. Flash loan does not pledge streams or call `_requireEligible`. |
| E-1 | HOLDS             | `totalSupply(ovrfloToken) <= wrappedUnderlying + Σ marketTotalDeposited + streamedUndrawn`. Flash loan does not mint/burn ovrfloToken, does not change `wrappedUnderlying`, `marketTotalDeposited`, or streams. The accounting identity holds continuously (it is expressed in *state variables*, not `balanceOf`). The transient physical-PT absence is captured by the I-1 finding above; no ovrfloToken is issued without backing because reentrant claims are bounded by physical balance and revert when short. Reentrant `deposit`/`wrap`/`unwrap`/`claim` each preserve E-1 on their own sub-state. |
| E-2 | HOLDS             | Book loan conservation. Vault flash loan does not touch book loans, `obligation`, `drawn`, `repaid`, or Sablier withdrawals. |
| E-3 | HOLDS             | ovrfloToken cross-series fungibility. Flash loan does not mint/burn ovrfloToken, does not change series config, does not alter `addMarket`'s underlying-match. Reentrancy into `addMarket` is factory-admin-gated. |

---

## Summary of findings requiring action

1. **I-1 (primary)** — The always-on reading `balanceOf(vault) >= marketTotalDeposited` is
   violated mid-transaction during the flash callback. It is restored atomically and no
   exploitation path exists (claims revert when physical PT is short; `sweepExcessPt`
   returns 0 excess; deposits pull fresh PT). But the invariant's *semantic scope* must
   change to "transaction boundaries", **or** `flashLoan` should be guarded with
   `nonReentrant` to preserve the always-on reading and remove the transient
   claim-liveness DoS. Recommended: add `nonReentrant` to `flashLoan` (the existing vault
   functions already lack it, so this is the minimal change that keeps I-1's semantics
   intact without retrofitting reentrancy guards everywhere).

2. **I-11 (secondary, design call)** — `flashLoan` has no temporal gate and is callable
   post-maturity. This does not break I-11 (which scopes only deposit/claim) but creates a
   claim-DoS window exactly when claim traffic peaks. Decide explicitly: either gate
   `flashLoan` to `block.timestamp < expiryCached`, or document that post-maturity flash
   loans are intentional and the atomic-revert liveness impact is acceptable.

3. **No new write sites** are introduced to any state variable that the invariants depend
   on (`marketTotalDeposited`, `wrappedUnderlying`, `SeriesInfo.*`, book state). The only
   state the flash loan mutates is transient token balances, which is why every invariant
   except I-1 (and the I-11 design note) continues to hold.

No other invariant (I-2..I-10, I-12, I-13, X-1..X-5, E-2, E-3) is affected.
