# Form state

Per-form input and guard state inside the action overlay. All `pure-client`.

The load-bearing rule for this file: **nothing here may decide what an action is
allowed to do.** Amounts are re-derived at submit, approvals are re-read from the
token, and eligibility is re-read from chain. These keys shape the form; the
authority sits in `chain-reads.md`.

Entry format and rules: `README.md`.

---

### `action.amount-raw`

The literal string in the amount field, before parsing.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/SupplyFlow.tsx` — `raw`, from `AmountInput`
  - `web/components/action-flow/BorrowFlow.tsx` — `raw`, from `AmountInput`
  - `web/components/action-flow/RepayFlow.tsx` — `raw`, from `AmountInput`
  - `web/components/action-flow/ConvertFlow.tsx` — `raw`, from `AmountInput`
  - `web/hooks/useClearOnConfirm.ts` — clears it exactly once per confirmation
- **readers:**
  - `web/components/action-flow/ActionFlowShell.tsx` — `parseAmount` turns it into the 18-decimal `bigint` the call uses
  - `web/components/action-flow/SupplyFlow.tsx` — validation, MAX handling, submit
  - `web/components/action-flow/BorrowFlow.tsx` — validation and submit
  - `web/components/action-flow/RepayFlow.tsx` — validation, bounded by outstanding obligation rather than wallet balance
  - `web/components/action-flow/ConvertFlow.tsx` — validation and submit
- **notes:** Kept as a string on purpose — a `bigint` cannot represent a
  half-typed decimal, and round-tripping through one eats keystrokes.
  `parseAmount` returns `0n` for anything unparseable, so *invalid* and *zero*
  are the same value downstream; forms must reject on their own validation, not
  on the parsed number being falsy. Clearing on confirmation is only safe
  because the form simultaneously shows CONFIRMED and CLOSE — an empty field
  alone is indistinguishable from a form never touched.

### `action.selected-apr-raw`

The ladder tick the user picked, in raw basis-point form. `null` means untouched.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/SupplyFlow.tsx` — `selectedAprRaw`
  - `web/components/action-flow/BorrowFlow.tsx` — `selectedAprRaw`
  - `web/components/action-flow/PositionFlow.tsx` — `selectedAprRaw`
- **readers:**
  - `web/components/action-flow/SupplyFlow.tsx` — the APR argument of the supply call
  - `web/components/action-flow/BorrowFlow.tsx` — bounds the ladder scan and the quote
  - `web/components/action-flow/PositionFlow.tsx` — the target tick of a rate adjustment
- **notes:** A selection, not a quote. The depth behind the chosen tick comes
  from `projection.market-apr`, which is a candidate set — the fill is decided
  on chain at submit, and a tick that looked deep may fill short. That race
  surfaces as a classified stale error and is handled by
  `action.stale-recovery`, not by trusting this key.

### `action.selected-stream-id`

The Sablier stream the borrower intends to pledge.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/BorrowFlow.tsx` — `selectedStreamId`, seeded from the invoking action and changed by the picker
- **readers:**
  - `web/components/action-flow/BorrowFlow.tsx` — chooses which held stream backs the quote and the loan call
- **notes:** An ID is a **pointer, not a claim of ownership or eligibility**. The
  candidate list comes from `projection.stream`; whether this stream is owned by
  the connected address, matches the series, and is neither cancelled nor
  depleted is decided by the Sablier hydration behind `projection.stream` and by
  `isSeriesMatchedStream` in `web/lib/modal-logic.ts` against hydrated fields —
  never by projection metadata. Selecting an ID must never widen what the user
  can do.

### `action.slippage-raw`

Borrow slippage tolerance as typed, in percent.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/BorrowFlow.tsx` — `slippageRaw`, defaulted rather than left blank
- **readers:**
  - `web/components/action-flow/BorrowFlow.tsx` — becomes the minimum-net bound carried into the call
- **notes:** This is a *user-chosen bound on an on-chain check*, not a client-side
  check. The contract enforces the bound; the form only chooses it.

### `action.show-alternative`

Whether the borrow form is showing the alternative fill it found.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/BorrowFlow.tsx` — `showAlternative`
- **readers:**
  - `web/components/action-flow/BorrowFlow.tsx` — swaps the quote panel for the alternative
- **notes:** Disclosure only. Accepting the alternative writes
  `action.selected-apr-raw`; this key never becomes an argument.

### `action.approved-amount`

The form's memory of the approval it just issued, per token.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/SupplyFlow.tsx` — `approvedAmount`
  - `web/components/action-flow/RepayFlow.tsx` — `repayApprovedAmount`
  - `web/components/action-flow/PositionFlow.tsx` — `approvedAmount`
  - `web/components/action-flow/ConvertFlow.tsx` — `ptApprovedAmount` and `underlyingApprovedAmount`
  - `web/components/action-flow/BorrowFlow.tsx` — `streamApprovedId`, the NFT-approval equivalent
- **readers:**
  - `web/components/action-flow/SupplyFlow.tsx` — step indicator and which button is primary
  - `web/components/action-flow/RepayFlow.tsx` — step indicator and primary button
  - `web/components/action-flow/PositionFlow.tsx` — step indicator and primary button
  - `web/components/action-flow/ConvertFlow.tsx` — step indicator and primary button, per token
  - `web/components/action-flow/BorrowFlow.tsx` — step indicator and primary button
- **notes:** **Progress display, never a gate.** The real allowance is the
  on-chain `allowance` read (`chain.wagmi-reads`), refreshed as a touched
  resource after the approval confirms; the contract reverts if it is
  insufficient regardless of what this key says. Treating it as a gate would let
  a stale or externally-revoked allowance present as approved. It is per-token
  because Convert approves two.

### `action.submitted`

The borrow target and quoted net captured at submit.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/BorrowFlow.tsx` — `submitted`, set when the loan call is issued
- **readers:**
  - `web/components/action-flow/BorrowFlow.tsx` — compares the settled result against what was quoted, so a short fill is reported rather than silently accepted
- **notes:** Exists to make a partial fill visible. The comparison is display
  only; the fill itself is whatever the chain did.

### `action.wallet-changed`

Latch raised when the connected address changes while a form is open.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useWalletChangeReset.ts` — raises it on an address change and clears it on explicit acknowledgement
- **readers:**
  - `web/components/action-flow/SupplyFlow.tsx` — replaces the form body with WALLET CHANGED — RE-ENTER
  - `web/components/action-flow/BorrowFlow.tsx` — same
  - `web/components/action-flow/RepayFlow.tsx` — same
  - `web/components/action-flow/ConvertFlow.tsx` — same
  - `web/components/action-flow/PositionFlow.tsx` — same
  - `web/components/action-flow/ClaimFlow.tsx` — same
  - `web/components/action-flow/ActionFlowShell.tsx` — renders `WalletChangedNotice`
- **notes:** The hook resets the form's own state *and* raises the latch, so a
  selection made as one account can never be submitted as another. It is a
  **UX guard, not the security boundary** — the executor independently refuses
  to broadcast on an identity change (`executor.status` → `identity_changed`),
  and the queue independently pauses. Removing the latch degrades the
  experience; removing the executor check is a trust-domain change.

### `action.stale-recovery`

Latch raised when a write failed because someone else's transaction moved the book.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useStaleRecovery.ts` — raised on a `stale`-classified error; each form clears it on submit, selection change, or wallet change
- **readers:**
  - `web/components/action-flow/BorrowFlow.tsx` — requires one explicit re-confirm instead of dead-ending
  - `web/components/action-flow/PositionFlow.tsx` — same
- **notes:** Raising it also fires `invalidateAllOnChainReads` — deliberately
  unscoped, because the change came from another party's write and there is no
  transaction of ours to scope by. The re-confirm is what makes the refreshed
  numbers something the user actually saw before signing.

### `action.pending-label`

Which sub-step of a multi-call claim is currently in flight.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/action-flow/ClaimFlow.tsx` — `pendingLabel`
- **readers:**
  - `web/components/action-flow/ClaimFlow.tsx` — passed to `TxState` as the pending prefix
  - `web/components/action-flow/ActionFlowShell.tsx` — prefixes SIGNING / CONFIRMING copy
- **notes:** Labelling only. The authoritative phase is `executor.status`.

### `approve.clearing`

Whether a zero-first approval fallback is mid-sequence.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useZeroFirstApprove.ts` — set when a reverted approve is retried via zero-first
- **readers:**
  - `web/hooks/useApprovalWriteFlows.ts` — folded into the shared `busy` flag every approve-then-write form gates its buttons on
- **notes:** The fallback fires only when the approve reverted *and* both the
  existing and target allowances were non-zero — the exact shape of the
  USDT-class revert. Paying for the extra transaction unconditionally would be
  real gas spent against a revert wstETH cannot produce.

### `approve.used-fallback`

Whether the zero-first path was taken for the current approval.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useZeroFirstApprove.ts` — set once the fallback is used
- **readers:**
  - `web/hooks/useZeroFirstApprove.ts` — prevents a second fallback attempt, so a token failing for another reason surfaces its error instead of looping
- **notes:** A loop-breaker. Clearing it without also clearing the attempt refs
  reintroduces the loop.
