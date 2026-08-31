# 18 — Hosted Convert and USD execution bounds

**What to build:** Pendle Hosted Convert is a dedicated canonical action. `createLiveActionDraft` re-decodes it. Hosted responses are untrusted. Chain, tokens, router allowlist, calldata semantics, token-native bounds, deadline, and immediate simulation are validated before any wallet prompt. Ordinary USD stays display-only. An execution-grade USD request resolves through a separate integer resolver into enclosing token-native min and max. Canonical actions, calldata, and committed receipts contain no USD.

**This ticket stays needs-info** until the owner selects the execution-grade USD authority and approves the Hosted Convert browser-contract proof. Do not invent a provider. Do not reuse a display feed as authority. Do not add an app server.

**Blocked by:** 17

**Status:** needs-info
**Labels:** needs-info

## Session prompt (paste into a new chat)

```text
STOP unless both owner gates are closed:
1. Execution-grade USD authority selected and reviewed (decimal normalization,
   maxBlockLag, maxAgeSeconds, minimum confidence, maximum source deviation,
   failure behavior, and KD17 token-native formulas).
2. Hosted Convert compatibility proof approved (static export, CORS, CSP via
   build-time CSP generation, response decoding, maintainable router allowlist).

If either gate is open, leave Status: needs-info and do not implement.

When both gates are closed:
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md
Scope: CS4-U4 hosted conversion and USD only (= this ticket).
Ticket: .scratch/denomination-border-column/issues/18-hosted-convert-usd-bounds.md
Spec/harness: .scratch/denomination-border-column/spec.md
Do not edit the plan. Do not reopen recovery (17). Do not add an app server.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read KD17 hosted and USD paragraphs, AS1, AS6, ### CS4-U4 hosted/USD bullets,
and Verification Contract successors *Hosted-response hostility* and *USD boundary*.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD17 hosted-conversion and USD resolver paragraphs (including the `tokenNativeMin` / `tokenNativeMax` formulas)
- `docs/maps/SCHEMAS.md` §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Owner USD-authority decision is recorded; reviewers verified it against the resolver requirements
- [ ] Owner approved the Hosted Convert browser-contract proof
- [ ] Scratch intent capsule exists before the first state-touching edit
- [ ] Hosted Convert uses its dedicated action/contract kind, is re-decoded by `createLiveActionDraft`, and never enters legacy raw-call
- [ ] Each wrong hosted chain/token/router/semantics/bounds/deadline case fails before prompt
- [ ] A changed hosted response is revalidated and simulated immediately before prompt
- [ ] Reviewed hosted origin is included in CSP generation and security-packaging tests
- [ ] Token/USD display switching changes no canonical amount or calldata
- [ ] A stale, unavailable, or unreviewed USD authority blocks submission instead of reusing the display quote
- [ ] USD resolver fixtures prove decimal normalization, freshness, confidence/deviation handling, conservative rounding, and exact token-native bound formulas using integer `mulDiv`-equivalent arithmetic, never JavaScript `Number`
- [ ] Browser-only static export remains intact

## Plan unit

CS4-U4 hosted-conversion and USD slice in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
