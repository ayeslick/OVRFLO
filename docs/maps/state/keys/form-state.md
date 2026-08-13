# Form state

Per-form input and guard state inside Borrow, Supply, Assets, and in-place watch
actions. All `pure-client`.

The load-bearing rule for this file: **nothing here may decide what an action is
allowed to do.** Amounts are re-derived at submit, approvals are re-read from the
token, eligibility is re-read from chain, depths are re-quoted at every
checkpoint. These keys shape the form; the authority sits in `chain-reads.md`.

Entry format and rules: `README.md`.

---

### `action.amount-raw`

The literal string in the amount field, before parsing.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/kit/AmountField.tsx` — landing U4: `inputmode="decimal"`; never blocks paste
  - `web/hooks/useClearOnConfirm.ts` — clears it exactly once per confirmation
- **readers:**
  - `web/lib/parse.ts` — landing U5: locale-aware parse into branded wei (German `1,5`)
  - `web/components/supply/AmountStep.tsx` — landing U8: validation, MAX, `MIN_LIQUIDITY_AMOUNT`
  - `web/components/borrow/AmountStep.tsx` — landing U9: bounded by stream remaining, not wallet balance
  - `web/app/assets/page.tsx` — landing U10: wrap / unwrap / PT deposit amounts
- **notes:** Kept as a string on purpose — a `bigint` cannot represent a
  half-typed decimal, and round-tripping through one eats keystrokes. Invalid
  and zero are different; forms reject on their own validation, not on a parsed
  `0n`. Several independent per-flow instances share this *meaning*, not one
  cell. Locale-aware parsing is mandatory (browser-runtime pathology).

### `action.selected-apr-raw`

The ladder tick the user picked, in raw basis-point form. `null` means untouched.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/kit/RateWindow.tsx` — landing U4: stepper paddles
  - `web/components/rates/Workspace.tsx` — landing U8/U9: direct pick from `UI-RATES-ROW`
- **readers:**
  - `web/components/supply/RateStep.tsx` — landing U8: supply tick argument
  - `web/components/borrow/RateStep.tsx` — landing U9: borrow tick; pool band
  - `web/lib/ladder.ts` — landing U5: window centering
- **notes:** A selection, not a quote. Depth behind the chosen tick comes from
  `chain.tick-depths`. The fill is decided on chain at submit. Changing
  selection resets `action.stale-recovery` and `action.frozen-quote`.

### `action.selected-stream-id`

The Sablier stream the borrower intends to pledge.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/borrow/SelectStream.tsx` — landing U9: picker; seeded from `UI-WATCH-BORROW-ROUTE`
- **readers:**
  - `web/components/borrow/StreamContext.tsx` — landing U9: `UI-BORROW-STREAM-CONTEXT`
  - `web/lib/actions/borrow.ts` — landing U6: stream id argument of the loan call
- **notes:** An ID is a **pointer, not a claim of ownership or eligibility**.
  The candidate list comes from `projection.stream`; whether this stream is
  owned, matches the series, and passes `requireEligible` is decided by
  `chain.stream-truth`. Selecting an ID must never widen what the user can do.
  Continue does not authorise the borrow.

### `action.selected-market`

The market the supply or stream-deposit flow is targeting.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/components/supply/SelectMarket.tsx` — landing U8: `UI-SUPPLY-SELECT-MARKET`
  - `web/components/assets/StreamSelectMarket.tsx` — landing U10: `UI-ASSETS-STREAM-SELECT-MARKET`
- **readers:**
  - `web/components/supply/AmountStep.tsx` — landing U8: scopes balances and ladder
  - `web/app/assets/page.tsx` — landing U10: scopes PT / series
- **notes:** A pointer. If the market matures or deactivates mid-flow,
  `UI-SUPPLY-MARKET-UNAVAILABLE` returns here and keeps the amount when it
  still applies — never silently retargets another market or APR.

### `action.approved-amount`

The form's memory of the approval it just issued, per token (or stream operator).

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useApprovalWriteFlows.ts` — set when the approve receipt lands
- **readers:**
  - `web/components/kit/SettlementTrace.tsx` — landing U4: which stage is primary
  - `web/hooks/useApprovalWriteFlows.ts` — step indicator only
- **notes:** **Progress display, never a gate.** The real allowance is
  `chain.allowances` / `chain.nft-operator`, refreshed as a touched resource.
  Treating this as a gate would let a stale or externally-revoked allowance
  present as approved. Approval states never render `CONFIRMED`
  (`UI-REVIEW-APPROVE`).

### `action.frozen-quote`

The review snapshot: amounts, tick, depth, fee, net, captured when review opened.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useWriteFlow.ts` — captured at review; compared to the rebuilt plan at sign
- **readers:**
  - `web/hooks/useWriteFlow.ts` — drift → `needs_review`
  - `web/components/kit/Receipt.tsx` — landing U4: ACTION RECEIPT lines; `UI-BORROW-QUOTE-UPDATED` / `UI-REVIEW-STALE`
- **notes:** See-equals-sign. Drift between this snapshot and the rebuilt
  calldata routes through visible re-confirmation, never silent resubmit.
  Display only; the fill is whatever the chain does. Partial-fill actuals
  (`UI-BORROW-PARTIAL-FILL`) re-present before sign against live depth, not
  against this snapshot's target.

### `action.wallet-changed`

Latch raised when the connected address changes while a form is open.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useWalletChangeReset.ts` — raises it on an address or chain change, drops identity-keyed queries, and clears it on explicit acknowledgement
- **readers:**
  - `web/components/kit/SettlementTrace.tsx` — landing U4: replaces the form body with `UI-SHELL-WALLET-CHANGED`
  - `web/app/borrow/page.tsx` — landing U9: form reset
  - `web/app/supply/page.tsx` — landing U8: form reset
  - `web/app/assets/page.tsx` — landing U10: form reset
- **notes:** The hook resets the form's own state *and* raises the latch, so a
  selection made as one account can never be submitted as another. It is a
  **UX guard, not the security boundary** — the executor independently refuses
  to broadcast on an identity change (`executor.status` → `identity_changed`).
  Watch selection and lens memory re-key to the new account.

### `action.stale-recovery`

Latch raised when a write failed because someone else's transaction moved the book.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useStaleRecovery.ts` — raised on a `stale`-classified error; each form clears it on submit, selection change, or wallet change
- **readers:**
  - `web/app/borrow/page.tsx` — landing U9: requires one explicit re-confirm
  - `web/app/supply/page.tsx` — landing U8: same
- **notes:** Raising it also fires `invalidateAllOnChainReads` — unscoped,
  because the change came from another party's write. The re-confirm is what
  makes the refreshed numbers something the user actually saw before signing
  (`UI-REVIEW-STALE`).

### `approve.clearing`

Whether a zero-first approval fallback is mid-sequence.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useZeroFirstApprove.ts` — set when a reverted approve is retried via zero-first
- **readers:**
  - `web/hooks/useApprovalWriteFlows.ts` — folded into the shared `busy` flag
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
  - `web/hooks/useZeroFirstApprove.ts` — prevents a second fallback attempt
- **notes:** A loop-breaker. Clearing it without also clearing the attempt refs
  reintroduces the loop.

### `persist.drafts`

Unsubmitted amount / tick / stream / market drafts, per wallet, chain, and factory.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/lib/storage.ts` — landing U12: throw-tolerant `ovrflo:draft:{kind}:{factory}:{chainId}:{account}`
  - `web/lib/parse.ts` — landing U5: bigint-safe serializer (`JSON.stringify` throws on bigint)
- **readers:**
  - `web/components/supply/SupplyFlow.tsx` — landing U12: restore selections on return
  - `web/components/borrow/BorrowFlow.tsx` — landing U12: restore selections on return
- **notes:** Selections only — never a quote, fill, or ahead figure. Factory
  namespacing keeps a fork session (chainId 1) from poisoning mainnet storage.
  Quotes always rebuild from live reads. Throw-tolerant storage; missing
  store → empty draft, not an error.

### `action.flow-step`

The current decision stage in history (`select` · `amount-rate` · `review`), carried as `?step=`.

- **trust_domain:** `pure-client`
- **writers:**
  - `web/hooks/useFlowDecisionHistory.ts` — landing U12: `pushState` / `replaceState` / popstate
  - `web/lib/flow-history.ts` — landing U12: parse, serialize, revalidate; checkpoints map to review
- **readers:**
  - `web/components/supply/SupplyFlow.tsx` — landing U12: Back moves one decision
  - `web/components/borrow/BorrowFlow.tsx` — landing U12: Back moves one decision
- **notes:** Transaction checkpoints (`acknowledge` · `approve` · `sign` ·
  `pending` · `confirmed`) are never enterable from history. A URL that names
  one revalidates to review, then drops to amount-rate when no frozen snapshot
  exists. Valid selections survive Back.
