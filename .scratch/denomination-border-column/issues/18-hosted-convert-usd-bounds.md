# 18 — Hosted Convert and USD execution bounds

**What to build:** Pendle Hosted Convert is a dedicated canonical action. `createLiveActionDraft` re-decodes it. Hosted responses are untrusted. Chain, tokens, Router V4 allowlist, calldata semantics, token-native bounds, deadline, and immediate simulation are validated before any wallet prompt. Ordinary USD stays display-only. USD lookup is keyed by the column `underlying`. Execution-grade USD resolves through a separate integer resolver into enclosing token-native min and max for **that** underlying. Canonical actions, calldata, and committed receipts contain no USD.

**Blocked by:** 17

**Status:** ready-for-agent
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
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD17 hosted-conversion and per-underlying USD recipe paragraphs
- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] Hosted Convert uses its dedicated action/contract kind, is re-decoded by `createLiveActionDraft`, and never enters legacy raw-call
- [ ] Each wrong hosted chain/token/router/semantics/bounds/deadline case fails before prompt
- [ ] A changed hosted response is revalidated and simulated immediately before prompt
- [ ] Reviewed hosted origin `https://api-v2.pendle.finance` is included in CSP generation and security-packaging tests
- [ ] `tx.to` and approval spenders equal Pendle Router V4 `0x888888888889758F76e7103c6CbF23ABbF58F946`
- [ ] Token/USD display switching changes no canonical amount or calldata
- [ ] `useUsdPrice` and the execution resolver take `underlying` and never return another column's quote
- [ ] A column with no recipe shows USD unavailable and still accepts token-native submit
- [ ] A stale or incomplete round blocks USD submission instead of reusing the display quote
- [ ] USD resolver fixtures prove per-underlying lookup, decimal normalization, freshness, 50 bps enclosing interval, and exact token-native bound formulas using integer `mulDiv`-equivalent arithmetic, never JavaScript `Number`
- [ ] Browser-only static export remains intact; local fork disables Hosted Convert

## Plan unit

CS4-U4 hosted-conversion and USD slice in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
