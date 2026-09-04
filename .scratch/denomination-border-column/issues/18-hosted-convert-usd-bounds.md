# 18 — Hosted Convert and USD execution bounds

**What to build:** Pendle Hosted Convert is a dedicated canonical action. `createLiveActionDraft` re-decodes it. Hosted responses are untrusted. Chain, tokens, Router V4 allowlist, calldata semantics, token-native bounds, deadline, and immediate simulation are validated before any wallet prompt. Ordinary USD stays display-only. USD lookup is keyed by the column `underlying`. Execution-grade USD resolves through a separate integer resolver into enclosing token-native min and max for **that** underlying. Canonical actions, calldata, and committed receipts contain no USD.

**Blocked by:** 17

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS4-U4 hosted conversion and USD only (= this ticket).
Ticket: .scratch/denomination-border-column/issues/18-hosted-convert-usd-bounds.md
Spec/harness: .scratch/denomination-border-column/spec.md
Do not edit the plan. Do not reopen recovery (17). Do not add an app server.
Do not hardcode wstETH as the only USD path. Lookup is per underlying.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read KD17 hosted and USD paragraphs (recipe table), AS6, CS4-U4 hosted/USD
bullets, sweep rule 11, and Verification Contract successors
*Hosted-response hostility* and *USD boundary*.
Hosted: POST https://api-v2.pendle.finance/core/v3/sdk/{chainId}/convert
Origin in CSP connect-src. Router allowlist
0x888888888889758F76e7103c6CbF23ABbF58F946 only.
USD: recipe table keyed by underlying; launch row is wstETH; missing row
fails closed; never reuse another column's quote.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/18 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD17 hosted-conversion and per-underlying USD recipe paragraphs
- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Scratch intent capsule exists before the first state-touching edit
- [x] Hosted Convert uses its dedicated action/contract kind, is re-decoded by `createLiveActionDraft`, and never enters legacy raw-call
- [x] Each wrong hosted chain/token/router/semantics/bounds/deadline case fails before prompt
- [x] A changed hosted response is revalidated and simulated immediately before prompt
- [x] Reviewed hosted origin `https://api-v2.pendle.finance` is included in CSP generation and security-packaging tests
- [x] `tx.to` and approval spenders equal Pendle Router V4 `0x888888888889758F76e7103c6CbF23ABbF58F946`
- [x] Token/USD display switching changes no canonical amount or calldata
- [x] `useUsdPrice` and the execution resolver take `underlying` and never return another column's quote
- [x] A column with no recipe shows USD unavailable and still accepts token-native submit
- [x] A stale or incomplete round blocks USD submission instead of reusing the display quote
- [x] USD resolver fixtures prove per-underlying lookup, decimal normalization, freshness, 50 bps enclosing interval, and exact token-native bound formulas using integer `mulDiv`-equivalent arithmetic, never JavaScript `Number`
- [x] Browser-only static export remains intact; local fork disables Hosted Convert
- [x] Policy module (KD17 owner pin 2026-09-01) owns `PENDLE_SLIPPAGE_BPS = 50` and `MAX_PENDLE_PRICE_IMPACT_BPS = 100`; `web/lib/modal-logic.ts` `DEFAULT_SLIPPAGE_BPS` reads from it; no component defines either number
- [x] `Default` applies 50 bps with no control; a hosted candidate at 101 bps impact is rejected before review with "This amount would move the PT market too much" and the two actions (smaller amount, open `Advanced`); 100 bps passes
- [x] `Advanced` sets slippage within the existing 10–500 bps range and shows impact without blocking

## Plan unit

CS4-U4 hosted-conversion and USD slice in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Deviation log (ticket/18, 2026-09-03)

- TokenUsdSwitch stays display-only. The execution resolver is not wired
  into a USD submit path. No flow sends a USD amount.
- `createLiveExecutionPlan` rebuilds the same `hostedResponse` on
  confirm. A new quote is a new `writeContract` with a new response.
- A missing deadline does not fail. An expired deadline fails.
- An omitted approval spender uses `tx.to`. `tx.to` must be Router V4.
- The route error-boundary test now matches ticket 17 resume copy. This
  ticket does not change recovery runtime.

## Reviewer findings applied

Read-only review (`gpt-5.6-sol-medium`) reported hosted hostility gaps.
This chat applied:

1. Token input rejects a non-zero `tx.value`.
2. Swap calldata market must equal the selected Pendle market.
3. Missing price impact fails. String impact `0.01009` is 101 bps.
4. Review economics use the decoded `minOut`.

Residual: no USD submit path; no hosted re-fetch on rebuild.

2026-09-04: mint-py / `mintPyFromToken` was removed. Token-to-PT is
`swapExactTokenForPt` only. A mint body now rejects with
`hosted-semantics`.
